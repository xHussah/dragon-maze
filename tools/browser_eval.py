"""
browser_eval.py - measures how often the dragon catches scripted "bot" players
in the REAL game (game.js running in headless Chrome), with the trained AI ON
and with the AI OFF (plain shortest-path chasing).

Before running:
    1. Backend running on   http://localhost:8000   ->  docker compose up
    2. Frontend served on   http://localhost:5500   ->  cd frontend
                                                        python -m http.server 5500
    3. pip install playwright
       playwright install chromium

Run (from the project root):
    python tools/browser_eval.py                      # all 7 levels, 100 games per cell
    python tools/browser_eval.py --levels 6 --games 50

Bot players (each plays every level):
    rusher  - shortest path to the door
    reward  - collects the nearest star first, then goes to the door
    random  - random walk
    dodger  - heads for the door but keeps away from the dragon
Score = catch rate (%): how often the dragon catches the bot within 150 moves.
Each cell carries about +/-5 points of noise at 100 games.
"""

import argparse
import json
import sys

from playwright.sync_api import sync_playwright

STYLES = ["rusher", "reward", "random", "dodger"]

# Runs inside the page. Uses game.js's own functions (initLevel, movePlayer, ...).
BOT_JS = """
async (args) => {
  const {level, style, games, maxMoves, useAI} = args;
  const out = {policy: 0, fallback: 0, caught: 0, escaped: 0, timeouts: 0, games: 0};
  const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];

  function distMap(tr, tc) {                        // BFS distance from a target cell
    const S = LEVELS[state.level].size;
    const d = Array.from({length: S}, () => Array(S).fill(999));
    d[tr][tc] = 0; const q = [[tr, tc]];
    while (q.length) {
      const [r, c] = q.shift();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc) || d[nr][nc] !== 999 || !isWalkable(nr, nc)) continue;
        d[nr][nc] = d[r][c] + 1; q.push([nr, nc]);
      }
    }
    return d;
  }
  function options() {
    return DIRS.filter(([dr, dc]) => isWalkable(state.playerPos[0] + dr, state.playerPos[1] + dc));
  }
  function best(opts, score) {                      // lowest score, random tie-break
    let m = Infinity, c = [];
    for (const o of opts) { const s = score(o); if (s < m) { m = s; c = [o]; } else if (s === m) c.push(o); }
    return c[Math.floor(Math.random() * c.length)];
  }
  function chooseMove(doorD) {
    const [pr, pc] = state.playerPos, opts = options();
    if (!opts.length) return null;
    const door = state.doorPos;
    const at = ([dr, dc]) => [pr + dr, pc + dc];
    if (style !== 'random') {
      for (const o of opts) { const [r, c] = at(o); if (r === door[0] && c === door[1]) return o; }
    }
    if (style === 'random') return opts[Math.floor(Math.random() * opts.length)];
    if (style === 'rusher') return best(opts, o => doorD[at(o)[0]][at(o)[1]]);
    if (style === 'reward') {
      if (state.rewardPositions.length) {
        let t = null, td = Infinity;
        for (const [r, c] of state.rewardPositions) {
          const d = Math.abs(r - pr) + Math.abs(c - pc);
          if (d < td) { td = d; t = [r, c]; }
        }
        const dm = distMap(t[0], t[1]);
        return best(opts, o => dm[at(o)[0]][at(o)[1]]);
      }
      return best(opts, o => doorD[at(o)[0]][at(o)[1]]);
    }
    if (style === 'dodger') {
      return best(opts, o => {
        const [r, c] = at(o);
        const m = Math.min(...state.dragonPositions.map(d => Math.abs(d[0] - r) + Math.abs(d[1] - c)));
        return doorD[r][c] + (m <= 1 ? 8 : m <= 2 ? 3 : 0);
      });
    }
  }

  for (let g = 0; g < games; g++) {
    initLevel(level);
    for (let i = 0; i < 200 && state.policyStatus === 'loading'; i++)
      await new Promise(r => setTimeout(r, 20));
    if (state.policyStatus !== 'loaded') return {error: 'policy not loaded'};
    if (!useAI) state.activePolicy = null;          // AI off = plain pathfinding
    const doorD = distMap(state.doorPos[0], state.doorPos[1]);
    let moves = 0;
    while (state.running && !state.gameOver && moves < maxMoves) {
      const m = chooseMove(doorD); if (!m) break;
      movePlayer(m[0], m[1]); moves++;
    }
    out.games++; out.policy += agentStats.policy; out.fallback += agentStats.fallback;
    const atDoor = state.playerPos[0] === state.doorPos[0] && state.playerPos[1] === state.doorPos[1];
    if (state.gameOver && atDoor) out.escaped++;
    else if (state.gameOver) out.caught++;
    else out.timeouts++;
    clearInterval(state.timerInterval); cancelAnimationFrame(state.animFrame);
  }
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5500/index.html")
    ap.add_argument("--games", type=int, default=100, help="games per (level, bot style, mode)")
    ap.add_argument("--levels", type=int, nargs="*", default=list(range(1, 8)), help="1-based levels")
    ap.add_argument("--max-moves", type=int, default=150)
    ap.add_argument("--out", default=None, help="optional path to save raw results as JSON")
    args = ap.parse_args()

    catch = {}   # (mode, level, style) -> catch %
    ai_share = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1000, "height": 700})
        page.goto(args.url)
        page.wait_for_timeout(500)
        for mode, use_ai in (("plain", False), ("ai", True)):
            for lvl in args.levels:
                for style in STYLES:
                    r = page.evaluate(BOT_JS, {"level": lvl - 1, "style": style, "games": args.games,
                                               "maxMoves": args.max_moves, "useAI": use_ai})
                    if "error" in r:
                        sys.exit("The policy could not be loaded. Is the backend running on "
                                 "http://localhost:8000 (docker compose up)?")
                    catch[(mode, lvl, style)] = 100 * r["caught"] / r["games"]
                    used = r["policy"] + r["fallback"]
                    ai_share[(mode, lvl, style)] = 100 * r["policy"] / used if used else 0.0
                    print(f"  {mode:>5} | level {lvl} | {style:>6}: caught {catch[(mode, lvl, style)]:5.1f}%",
                          flush=True)
        browser.close()

    print(f"\nCatch rate % ({args.games} games per cell)")
    print("Level | " + " | ".join(f"{s:>7}" for s in STYLES) + " |    mean   (plain -> AI)")
    means = {"plain": [], "ai": []}
    for lvl in args.levels:
        row = []
        for s in STYLES:
            row.append(f"{catch[('plain', lvl, s)]:3.0f}>{catch[('ai', lvl, s)]:3.0f}")
        mp = sum(catch[("plain", lvl, s)] for s in STYLES) / len(STYLES)
        ma = sum(catch[("ai", lvl, s)] for s in STYLES) / len(STYLES)
        means["plain"].append(mp); means["ai"].append(ma)
        print(f"{lvl:>5} | " + " | ".join(f"{c:>7}" for c in row) + f" | {mp:5.1f} -> {ma:5.1f}")
    n = len(args.levels)
    print(f"\nOverall mean catch rate: plain pathfinding {sum(means['plain'])/n:.1f}%  |  "
          f"trained agent {sum(means['ai'])/n:.1f}%")
    share = sum(ai_share[("ai", l, s)] for l in args.levels for s in STYLES) / (n * len(STYLES))
    print(f"Share of dragon moves taken from the trained policy: {share:.0f}%")

    if args.out:
        with open(args.out, "w") as f:
            json.dump({f"{k[0]}|{k[1]}|{k[2]}": v for k, v in catch.items()}, f, indent=2)


if __name__ == "__main__":
    main()
