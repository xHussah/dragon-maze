# ═══════════════════════════════════════════════════════════
#  evaluate.py — does the trained dragon beat plain pathfinding?
#
#  Simulates the GAME's rules (player moves first, then the dragon(s);
#  a star freezes the dragons for a turn; per-level dragon randomness;
#  both dragons on level 7) and compares:
#     bfs      → dragon always takes the shortest path to the player
#     <policy> → dragon uses the Q-table, falling back to BFS for states
#                it has never seen (exactly what game.js does)
#  against every player type. "evader" is never used in training.
#
#  python evaluate.py --policies new=policies old=old_policies --games 300
#  Vision radius, fog, speed bursts and falling stars are NOT simulated.
# ═══════════════════════════════════════════════════════════

import argparse
import json
import os
import random

from environment import (LEVEL_CONFIGS, DRAGON_RANDOMNESS, OPPONENT_MIX,
                         HELD_OUT_OPPONENT, geometry, player_step)

MAX_TURNS = 150


def load_table(path):
    with open(path) as f:
        return json.load(f)["q_table"]


def dragon_move(geom, table, d, p, randomness, rng, stats):
    """One dragon turn. Mirrors dragonStepToward() in game.js."""
    if d == p:
        return d
    if rng.random() < randomness:                        # random wobble
        return rng.choice(geom.dragon_nbrs[d])
    if table is not None:
        key = f"({d[0]}, {d[1]}, {p[0]}, {p[1]}, {p[0]-d[0]}, {p[1]-d[1]}, {abs(p[0]-d[0])+abs(p[1]-d[1])})"
        q = table.get(key)
        if q:
            for a in sorted(range(4), key=lambda i: -q[i]):
                nb = geom.dragon_move[d][a]
                if nb:
                    stats["policy"] += 1
                    return nb
    stats["fallback"] += 1                               # BFS fallback
    dist = geom.dist_dragon
    best = min(dist[n].get(p, 999) for n in geom.dragon_nbrs[d])
    return next(n for n in geom.dragon_nbrs[d] if dist[n].get(p, 999) == best)


def play(level, opponent, table, rng, stats):
    """One game. Returns 'caught' | 'escaped' | 'timeout' and the turn count."""
    g = geometry(level)
    randomness = DRAGON_RANDOMNESS[level]
    player  = g.player_start
    dragons = list(g.dragon_starts)
    stars   = list(g.stars)
    for turn in range(1, MAX_TURNS + 1):
        player = player_step(g, opponent, player, dragons, stars, rng)
        got_star = player in stars
        if got_star:
            stars.remove(player)
        if player == g.door:
            return "escaped", turn
        if got_star:                                     # star: dragons are frozen this turn
            if player in dragons:
                return "caught", turn
            continue
        dragons = [dragon_move(g, table, d, player, randomness, rng, stats) for d in dragons]
        if player in dragons:
            return "caught", turn
    return "timeout", MAX_TURNS


def evaluate(level, opponent, table, games, seed):
    rng = random.Random(seed)
    stats = {"policy": 0, "fallback": 0}
    caught = 0
    for _ in range(games):
        result, _ = play(level, opponent, table, rng, stats)
        caught += result == "caught"
    used = stats["policy"] + stats["fallback"]
    return 100 * caught / games, (100 * stats["policy"] / used if used else 0.0)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--policies", nargs="+", required=True, help="name=dir pairs, e.g. new=policies")
    ap.add_argument("--games", type=int, default=300)
    ap.add_argument("--seed", type=int, default=123)
    args = ap.parse_args()

    dirs = dict(p.split("=") for p in args.policies)
    seen = [n for n, _ in OPPONENT_MIX]
    modes = ["bfs"] + list(dirs)

    print(f"\nCatch rate % (higher = better dragon), {args.games} games per cell, real start positions")
    print(f"'seen' = average over {seen}; 'held-out' = {HELD_OUT_OPPONENT} (never trained on)\n")
    header = f"{'Level':>5} | " + " | ".join(f"{m:>8} seen" for m in modes) + " || " + " | ".join(f"{m:>8} held" for m in modes)
    print(header); print("-" * len(header))
    usage = {}
    for lvl in range(len(LEVEL_CONFIGS)):
        row_seen, row_held = [], []
        for m in modes:
            table = None if m == "bfs" else load_table(os.path.join(dirs[m], f"level_{lvl+1}.json"))
            rates, uses = [], []
            for opp in seen:
                r, u = evaluate(lvl, opp, table, args.games, args.seed)
                rates.append(r); uses.append(u)
            r_held, u_held = evaluate(lvl, HELD_OUT_OPPONENT, table, args.games, args.seed)
            row_seen.append(sum(rates) / len(rates)); row_held.append(r_held)
            usage[(lvl, m)] = (sum(uses) / len(uses), u_held)
        print(f"{lvl+1:>5} | " + " | ".join(f"{v:>13.1f}" for v in row_seen) + " || "
              + " | ".join(f"{v:>13.1f}" for v in row_held))

    print("\nShare of dragon moves that came from the Q-table (%), seen | held-out")
    for lvl in range(len(LEVEL_CONFIGS)):
        print(f"{lvl+1:>5} | " + " | ".join(f"{m}: {usage[(lvl, m)][0]:5.1f} | {usage[(lvl, m)][1]:5.1f}" for m in modes[1:]))
