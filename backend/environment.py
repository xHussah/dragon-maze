# ═══════════════════════════════════════════════════════════
#  environment.py — Grid world the RL agent trains inside
#  Mirrors the JS game logic (moves, walls, door, turn order)
# ═══════════════════════════════════════════════════════════

import random
from collections import deque
from typing import Dict, List, Optional, Tuple

# Cell types (match JS constants)
EMPTY    = 0
OBSTACLE = 1
REWARD   = 2
DOOR     = 3

# Actions
UP    = 0
DOWN  = 1
LEFT  = 2
RIGHT = 3
ACTIONS = [UP, DOWN, LEFT, RIGHT]
ACTION_DELTAS = {UP: (-1,0), DOWN: (1,0), LEFT: (0,-1), RIGHT: (0,1)}

# Level definitions — must match JS LEVELS array
LEVEL_CONFIGS = [
    {   # Level — THE BEGINNING
        "size": 5, "player": [4, 0], "door": [0, 4],
        "dragons": [[0, 1]],
        "obstacles": [[1, 1], [2, 3], [3, 2], [1, 3]],
        "rewards":   [[2, 1], [3, 3]],
        "vision_radius": 4,
    },
    {   # Level — THE HUNT BEGINS
        "size": 6, "player": [0, 0], "door": [5, 5],
        "dragons": [[2, 3]],
        "obstacles": [[1, 2], [2, 1], [3, 4], [4, 2], [2, 4], [0, 3], [4, 4]],
        "rewards":   [[3, 1], [1, 4], [4, 3]],
        "vision_radius": 5,
    },
    {   # Level — VANISHING STARS
        "size": 7, "player": [3, 6], "door": [3, 0],
        "dragons": [[0, 3]],
        "obstacles": [[1, 1], [2, 2], [2, 5], [4, 2], [4, 5], [5, 1], [5, 5], [1, 5], [0, 5], [6, 3]],
        "rewards":   [[1, 3], [5, 3], [3, 4]],
        "vision_radius": 6,
    },
    {   # Level — TIGHT CORRIDORS
        "size": 7, "player": [6, 6], "door": [0, 0],
        "dragons": [[6, 0]],
        "obstacles": [[1, 2], [2, 1], [3, 3], [4, 5], [5, 2], [3, 5], [6, 4]],
        "rewards":   [[4, 3], [2, 4]],
        "vision_radius": 7,
    },
    {   # Level — DRAGON FURY
        "size": 8, "player": [0, 7], "door": [7, 0],
        "dragons": [[0, 0]],
        "obstacles": [[1, 5], [2, 3], [3, 6], [4, 2], [4, 5], [5, 3], [5, 6], [6, 1], [6, 5], [2, 1], [3, 3]],
        "rewards":   [[2, 6], [4, 4], [6, 2]],
        "vision_radius": 8,
    },
    {   # Level — SHROUDED IN DARKNESS
        "size": 9, "player": [8, 4], "door": [0, 4],
        "dragons": [[0, 0]],
        "obstacles": [[1, 1], [1, 6], [2, 3], [2, 7], [3, 1], [3, 5], [3, 8], [4, 3], [4, 7], [5, 1], [5, 5], [5, 8], [6, 2], [6, 6], [7, 1], [7, 4], [7, 7], [8, 2], [8, 6]],
        "rewards":   [[2, 1], [4, 6], [6, 3], [1, 7]],
        "vision_radius": 9,
    },
    {   # Level — THE FINAL MAZE
        "size": 10, "player": [9, 5], "door": [0, 4],
        "dragons": [[0, 0], [0, 9]],
        "obstacles": [[1, 2], [1, 7], [2, 1], [2, 5], [2, 8], [3, 3], [3, 6], [4, 2], [4, 7], [4, 9], [5, 1], [5, 4], [5, 8], [6, 3], [6, 6], [7, 2], [7, 5], [7, 8], [8, 1], [8, 4], [8, 7], [3, 0], [6, 9]],
        "rewards":   [[4, 5], [6, 2], [6, 8]],
        "vision_radius": 10,
    },
]



DELTAS = [ACTION_DELTAS[a] for a in ACTIONS]          # index == action id

# Mirrors LEVELS[i].dragonRandomness in game.js (chance the dragon moves randomly)
DRAGON_RANDOMNESS = [0.35, 0.20, 0.15, 0.10, 0.08, 0.05, 0.0]

# ── Opponents (the "player" the dragon is trained against) ──
# Training mix — different ways a person might play:
OPPONENT_MIX = [("rusher", 0.30),   # shortest path to the door
                ("noisy",  0.30),   # rusher that sometimes wanders (30%)
                ("reward", 0.25),   # grabs the stars first, then the door
                ("random", 0.15)]   # random walk
# Never seen during training - used only to test generalisation:
HELD_OUT_OPPONENT = "evader"        # heads for the door but keeps away from the dragon
ALL_OPPONENTS = [name for name, _ in OPPONENT_MIX] + [HELD_OUT_OPPONENT]

Cell = Tuple[int, int]


# ═══════════════════════════════════════════════════════════
#  Level geometry + precomputed distance tables (built once)
# ═══════════════════════════════════════════════════════════
class Geometry:
    """Static facts about one level and BFS distance tables (all O(1) lookups)."""

    def __init__(self, cfg: dict):
        S = cfg["size"]
        self.size          = S
        self.obstacles     = {tuple(o) for o in cfg["obstacles"]}
        self.door          = tuple(cfg["door"])
        self.stars         = [tuple(r) for r in cfg["rewards"]]
        self.player_start  = tuple(cfg["player"])
        self.dragon_starts = [tuple(d) for d in cfg["dragons"]]

        self.open_cells   = [(r, c) for r in range(S) for c in range(S)
                             if (r, c) not in self.obstacles]
        self.dragon_cells = [c for c in self.open_cells if c != self.door]

        # move tables: cell -> [dest for UP, DOWN, LEFT, RIGHT] (None = blocked)
        self.player_move: Dict[Cell, list] = {}
        self.dragon_move: Dict[Cell, list] = {}
        for cell in self.open_cells:
            pm, dm = [], []
            for dr, dc in DELTAS:
                n  = (cell[0] + dr, cell[1] + dc)
                ok = 0 <= n[0] < S and 0 <= n[1] < S and n not in self.obstacles
                pm.append(n if ok else None)
                dm.append(n if ok and n != self.door else None)   # dragons can't enter the door
            self.player_move[cell] = pm
            self.dragon_move[cell] = dm
        self.player_nbrs = {c: [n for n in m if n] for c, m in self.player_move.items()}
        self.dragon_nbrs = {c: [n for n in m if n] for c, m in self.dragon_move.items()}

        self.dist_door   = self._bfs(self.door, self.player_nbrs)
        self.dist_star   = {s: self._bfs(s, self.player_nbrs) for s in self.stars}
        self.dist_dragon = {c: self._bfs(c, self.dragon_nbrs) for c in self.dragon_cells}

    @staticmethod
    def _bfs(start: Cell, nbrs: Dict[Cell, list]) -> Dict[Cell, int]:
        dist = {start: 0}
        q = deque([start])
        while q:
            cur = q.popleft()
            for n in nbrs[cur]:
                if n not in dist:
                    dist[n] = dist[cur] + 1
                    q.append(n)
        return dist


_GEOMETRY: Dict[int, Geometry] = {}

def geometry(level_index: int) -> Geometry:
    if level_index not in _GEOMETRY:
        _GEOMETRY[level_index] = Geometry(LEVEL_CONFIGS[level_index])
    return _GEOMETRY[level_index]


# ═══════════════════════════════════════════════════════════
#  Player behaviours
# ═══════════════════════════════════════════════════════════
def _closest(cells: List[Cell], table: Dict[Cell, int], rng: random.Random) -> Cell:
    best = min(table.get(c, 999) for c in cells)
    return rng.choice([c for c in cells if table.get(c, 999) == best])


def player_step(geom: Geometry, kind: str, player: Cell, dragons: List[Cell],
                stars_left: List[Cell], rng: random.Random) -> Cell:
    """Returns the cell the player moves to this turn."""
    nbrs = geom.player_nbrs[player]
    if not nbrs:
        return player
    if kind != "random" and geom.door in nbrs:       # door next to us -> take it
        return geom.door
    if kind == "random" or (kind == "noisy" and rng.random() < 0.3):
        return rng.choice(nbrs)
    if kind in ("rusher", "noisy"):
        return _closest(nbrs, geom.dist_door, rng)
    if kind == "reward":
        if stars_left:
            s = min(stars_left, key=lambda st: geom.dist_star[st].get(player, 999))
            return _closest(nbrs, geom.dist_star[s], rng)
        return _closest(nbrs, geom.dist_door, rng)
    if kind == "evader":
        def score(n: Cell) -> int:
            m = min(abs(n[0] - d[0]) + abs(n[1] - d[1]) for d in dragons)
            return geom.dist_door.get(n, 999) + (8 if m <= 1 else 3 if m <= 2 else 0)
        best = min(score(n) for n in nbrs)
        return rng.choice([n for n in nbrs if score(n) == best])
    raise ValueError(f"unknown opponent: {kind}")


# ═══════════════════════════════════════════════════════════
#  Training environment
# ═══════════════════════════════════════════════════════════
class GridEnvironment:
    """
    The grid world the dragon (agent) trains inside.
    Turn order matches the game: the dragon moves, then the player moves.

    Differences from the first version (see README notes):
      - random start positions (75% of episodes) so EVERY (dragon, player)
        pair is visited and the Q-table covers the whole level
      - the player is a random opponent type each episode (OPPONENT_MIX)
      - distance shaping uses real BFS path length (walls respected) and is
        potential-based, so it cannot change which policy is optimal
      - collecting a star freezes the dragon for its next turn (game.js rule):
        the player simply gets an extra move before the dragon can act
    """

    def __init__(self, level_index: int = 0, opponent: Optional[str] = None,
                 random_start: bool = True, real_start_prob: float = 0.25,
                 gamma: float = 0.95, max_steps: int = 300,
                 seed: Optional[int] = None):
        self.level_index     = level_index
        self.cfg             = LEVEL_CONFIGS[level_index]
        self.size            = self.cfg["size"]
        self.geom            = geometry(level_index)
        self.opponent_fixed  = opponent
        self.random_start    = random_start
        self.real_start_prob = real_start_prob
        self.gamma           = gamma
        self.max_steps       = max_steps
        self.rng             = random.Random(seed)
        self._names   = [n for n, _ in OPPONENT_MIX]
        self._weights = [w for _, w in OPPONENT_MIX]
        self.reset()

    def reset(self) -> Tuple:
        g = self.geom
        self.opponent = self.opponent_fixed or self.rng.choices(self._names, self._weights)[0]
        if self.random_start and self.rng.random() >= self.real_start_prob:
            while True:
                self.player = self.rng.choice(g.dragon_cells)
                self.dragon = self.rng.choice(g.dragon_cells)
                if self.player != self.dragon and self.player in g.dist_dragon[self.dragon]:
                    break
        else:
            self.player = g.player_start
            self.dragon = g.dragon_starts[0]
        self.stars_left = list(g.stars)
        self.done  = False
        self.steps = 0
        return self._get_state()

    # State: (dragon_row, dragon_col, player_row, player_col, d_row, d_col, manhattan)
    # Keep this EXACT format - game.js builds the same key string.
    def _get_state(self, dragon_idx: int = 0) -> Tuple:
        dr, dc = self.dragon
        pr, pc = self.player
        return (dr, dc, pr, pc, pr - dr, pc - dc, abs(pr - dr) + abs(pc - dc))

    def _phi(self) -> float:
        d = self.geom.dist_dragon[self.dragon].get(self.player, 30)
        return -0.5 * min(d, 30)

    def step(self, action: int, dragon_idx: int = 0) -> Tuple:
        """Dragon takes one action, then the player moves. Returns (state, reward, done)."""
        if self.done:
            return self._get_state(), 0.0, True
        g = self.geom
        phi_old = self._phi()
        reward  = -0.05                                   # small cost per step

        nd = g.dragon_move[self.dragon][action]
        if nd is None:
            reward -= 0.3                                 # bumped into a wall / the door
        else:
            self.dragon = nd
        if self.dragon == self.player:                    # dragon caught the player
            self.done = True
            return self._get_state(), 10.0, True

        while True:
            new_p = player_step(g, self.opponent, self.player, [self.dragon],
                                self.stars_left, self.rng)
            self.player = new_p
            got_star = new_p in self.stars_left
            if got_star:
                self.stars_left.remove(new_p)
            if new_p == g.door:                           # player escaped
                self.done = True
                return self._get_state(), -5.0, True
            if new_p == self.dragon:                      # player walked into the dragon
                self.done = True
                return self._get_state(), 10.0, True
            if not got_star:
                break
            # star collected -> dragon is frozen for its next turn,
            # so the player moves again before the dragon can act

        self.steps += 1
        if self.steps >= self.max_steps:
            self.done = True
        reward += self.gamma * self._phi() - phi_old      # potential-based shaping
        return self._get_state(), reward, self.done
