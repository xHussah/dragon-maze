# ═══════════════════════════════════════════════════════════
#  agent.py — Q-Learning agent (the dragon's brain)
# ═══════════════════════════════════════════════════════════

import argparse
import json
import os
import random
from collections import defaultdict

from environment import GridEnvironment, LEVEL_CONFIGS, ACTIONS, geometry


class QLearningAgent:
    """
    Tabular Q-Learning agent.
    Q-table: dict mapping (state_tuple) → [Q(a0), Q(a1), Q(a2), Q(a3)]
    One agent per level (each level has its own policy file).
    """

    def __init__(
        self,
        level_index:    int   = 0,
        alpha:          float = 0.1,    # learning rate
        gamma:          float = 0.95,   # discount factor
        epsilon:        float = 1.0,    # starting exploration rate
        epsilon_min:    float = 0.05,   # minimum exploration
        epsilon_decay          = None,  # per-episode decay; None = pick automatically
    ):
        self.level_index   = level_index
        self.alpha         = alpha
        self.gamma         = gamma
        self.epsilon       = epsilon
        self.epsilon_min   = epsilon_min
        self.epsilon_decay = epsilon_decay

        # Q-table: state → [Q_up, Q_down, Q_left, Q_right]
        self.q_table: dict = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])

    # ── Action selection (ε-greedy) ──────────────────────────
    def choose_action(self, state: tuple) -> int:
        if random.random() < self.epsilon:
            return random.choice(ACTIONS)               # explore
        qs = self.q_table[state]
        best = max(qs)
        # random tie-break so untrained states don't always pick "up"
        return random.choice([a for a in ACTIONS if qs[a] == best])

    # ── Q-table update (Bellman equation) ───────────────────
    def learn(self, state: tuple, action: int,
              reward: float, next_state: tuple, done: bool):
        qs         = self.q_table[state]
        max_next_q = 0.0 if done else max(self.q_table[next_state])

        # Q(s,a) ← Q(s,a) + α · (r + γ·maxQ(s',a') − Q(s,a))
        qs[action] += self.alpha * (reward + self.gamma * max_next_q - qs[action])

    # ── Training loop ─────────────────────────────────────────
    def train(self, episodes: int = 30_000, log_every: int = 5_000,
              seed=None) -> dict:
        """
        Train for `episodes` episodes against a random mix of player
        behaviours from random start positions (see environment.py).
        Returns stats dict for logging.
        """
        if seed is not None:
            random.seed(seed)
        env = GridEnvironment(self.level_index, seed=seed)

        # Explore for the first ~70% of training, then mostly exploit
        decay = self.epsilon_decay
        if decay is None:
            decay = (self.epsilon_min / max(self.epsilon, 1e-9)) ** (1.0 / (0.7 * episodes))

        rewards_history = []
        catches = escapes = 0

        for ep in range(episodes):
            state = env.reset()
            total_reward = 0.0

            while True:
                action = self.choose_action(state)
                next_state, reward, done = env.step(action)
                self.learn(state, action, reward, next_state, done)
                state         = next_state
                total_reward += reward
                if done:
                    if reward >= 10.0:
                        catches += 1
                    elif reward <= -5.0:
                        escapes += 1
                    break

            self.epsilon = max(self.epsilon_min, self.epsilon * decay)
            rewards_history.append(total_reward)

            if (ep + 1) % log_every == 0:
                window = rewards_history[-log_every:]
                print(f"  Episode {ep+1:>7} | "
                      f"avg reward: {sum(window)/len(window):>7.2f} | "
                      f"catch: {catches/log_every*100:>5.1f}% | "
                      f"escape: {escapes/log_every*100:>5.1f}% | "
                      f"ε: {self.epsilon:.3f} | states: {len(self.q_table)}", flush=True)
                catches = escapes = 0

        last = rewards_history[-1000:]
        return {
            "level":         self.level_index + 1,
            "episodes":      episodes,
            "final_epsilon": round(self.epsilon, 4),
            "q_table_size":  len(self.q_table),
            "avg_last_1k":   round(sum(last) / len(last), 3),
        }

    # ── Save / load policy ────────────────────────────────────
    def save_policy(self, filepath: str):
        """
        Export Q-table to JSON.
        Keys are stringified state tuples, values are Q-value lists.
        """
        serialisable = {
            str(k): [round(v, 3) for v in vals]
            for k, vals in self.q_table.items()
        }
        with open(filepath, "w") as f:
            json.dump({"level": self.level_index,
                       "q_table": serialisable}, f, separators=(",", ":"))
        print(f"  Policy saved → {filepath} "
              f"({len(self.q_table)} states)")

    def load_policy(self, filepath: str):
        """Load a previously trained Q-table from JSON."""
        with open(filepath, "r") as f:
            data = json.load(f)
        self.q_table = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
        for k_str, vals in data["q_table"].items():
            key = tuple(int(x) for x in k_str.strip("()").split(","))
            self.q_table[key] = vals
        print(f"  Policy loaded ← {filepath} "
              f"({len(self.q_table)} states)")


def default_episodes(level_index: int) -> int:
    """More episodes for bigger levels: ~20 visits per (dragon, player) cell pair."""
    pairs = len(geometry(level_index).dragon_cells) ** 2
    return max(30_000, pairs * 20)


# ═══════════════════════════════════════════════════════════
#  Train levels (run this file directly to train)
#    python agent.py                      → all 7 levels into ./policies
#    python agent.py --levels 1 2 --out x → only levels 1 and 2 into ./x
# ═══════════════════════════════════════════════════════════
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--levels", type=int, nargs="*", default=None,
                        help="1-based level numbers (default: all)")
    parser.add_argument("--out", default="policies")
    parser.add_argument("--episodes", type=int, default=None,
                        help="override episodes per level")
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    levels = [l - 1 for l in args.levels] if args.levels else range(len(LEVEL_CONFIGS))

    all_stats = []
    for lvl in levels:
        n = args.episodes or default_episodes(lvl)
        print(f"\n{'='*50}\n  Training Level {lvl+1} / {len(LEVEL_CONFIGS)}  ({n:,} episodes)\n{'='*50}",
              flush=True)
        agent = QLearningAgent(level_index=lvl)
        stats = agent.train(episodes=n, log_every=max(n // 6, 1000), seed=args.seed + lvl)
        agent.save_policy(os.path.join(args.out, f"level_{lvl+1}.json"))
        all_stats.append(stats)

    print("\n\nAll levels trained:")
    for s in all_stats:
        print(f"  Level {s['level']}: {s['q_table_size']} states | "
              f"avg reward (last 1k): {s['avg_last_1k']}")
