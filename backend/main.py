# ═══════════════════════════════════════════════════════════
#  main.py — FastAPI backend for Dragon's Maze
#  Serves trained Q-table policies to the frontend
#  Endpoints:
#    GET  /health           → server status check
#    GET  /policy/{level}   → returns Q-table for that level
#    POST /train/{level}    → triggers training for that level
#    POST /train/all        → trains all 7 levels sequentially
# ═══════════════════════════════════════════════════════════

import os
import json
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ── Mode ─────────────────────────────────────────────────
# DEV_MODE is OFF on the live server (Elastic Beanstalk) and ON only in
# docker-compose for local work. When it is off:
#   - the training endpoints (POST /train/...) answer 404, so nobody on the
#     internet can start CPU-heavy jobs on the server
#   - the interactive API docs (/docs) are switched off
DEV_MODE = os.getenv("DEV_MODE", "false").lower() in ("1", "true", "yes")

# ── App setup ────────────────────────────────────────────
app = FastAPI(
    title="Dragon's Maze API",
    description="Serves trained RL policies for the Dragon's Maze game",
    version="1.1.0",
    docs_url="/docs" if DEV_MODE else None,
    redoc_url=None,
    openapi_url="/openapi.json" if DEV_MODE else None,
)

# ── CORS — which websites may call this API from a browser ─
# The live game calls the API through CloudFront on its own domain
# (same origin), so it does not need CORS at all. These origins are for
# the CloudFront site itself and for local development.
DEFAULT_ORIGINS = ",".join([
    "https://d1czf247jnlvka.cloudfront.net",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
])
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"] if DEV_MODE else ["GET"],
    allow_headers=["*"],
)


def require_dev_mode():
    """Dependency that hides the training endpoints outside DEV_MODE."""
    if not DEV_MODE:
        raise HTTPException(status_code=404, detail="Not Found")

# ── Policies directory ───────────────────────────────────
# When running locally:  ./policies/
# When running in Docker: /app/policies/
POLICIES_DIR = Path(os.getenv("POLICIES_DIR", "policies"))
POLICIES_DIR.mkdir(exist_ok=True)

# ── Training state tracker (so we can report progress) ──
training_status: dict = {}   # level → "idle" | "training" | "done" | "error"
training_lock = threading.Lock()

# ═══════════════════════════════════════════════════════════
#  RESPONSE MODELS
# ═══════════════════════════════════════════════════════════
class HealthResponse(BaseModel):
    status: str
    policies_available: list[int]

class TrainRequest(BaseModel):
    episodes: Optional[int] = None   # override default episode count

class TrainResponse(BaseModel):
    message: str
    level: int

# ═══════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════
def policy_path(level: int) -> Path:
    """Returns path to policy JSON for a given level (1-indexed)."""
    return POLICIES_DIR / f"level_{level}.json"

def get_available_levels() -> list[int]:
    """Returns list of levels that have a trained policy file."""
    available = []
    for lvl in range(1, 8):
        if policy_path(lvl).exists():
            available.append(lvl)
    return available

def run_training(level_index: int, episodes: Optional[int] = None):
    """
    Background function — trains agent for one level and saves policy.
    level_index is 0-based internally, 1-based in file names.
    """
    from agent import QLearningAgent, default_episodes

    lvl_label = level_index + 1

    with training_lock:
        training_status[lvl_label] = "training"

    try:
        # More episodes for bigger grids (same rule as `python agent.py`)
        n_episodes = episodes or default_episodes(level_index)

        print(f"[Training] Level {lvl_label} — {n_episodes} episodes...")

        agent = QLearningAgent(level_index=level_index)   # exploration decay chosen automatically

        agent.train(episodes=n_episodes, log_every=max(n_episodes // 6, 1000))
        agent.save_policy(str(policy_path(lvl_label)))

        with training_lock:
            training_status[lvl_label] = "done"

        print(f"[Training] Level {lvl_label} complete.")

    except Exception as e:
        with training_lock:
            training_status[lvl_label] = f"error: {str(e)}"
        print(f"[Training] Level {lvl_label} FAILED: {e}")

# ═══════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════

# ── GET /health ──────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
def health():
    """
    Quick check that the server is running.
    Also tells the frontend which levels have trained policies ready.
    """
    return {
        "status": "ok",
        "policies_available": get_available_levels(),
    }


# ── GET /policy/{level} ──────────────────────────────────
@app.get("/policy/{level}")
def get_policy(level: int):
    """
    Returns the trained Q-table for a given level (1–7).
    The frontend fetches this when a level loads and uses it
    to drive the dragon's moves instead of the scripted AI.

    Response shape:
    {
      "level": 1,
      "q_table": {
        "(0, 0, 4, 0, 4, 0, 4)": [Q_up, Q_down, Q_left, Q_right],
        ...
      }
    }
    """
    if level < 1 or level > 7:
        raise HTTPException(
            status_code=400,
            detail=f"Level must be between 1 and 7, got {level}"
        )

    path = policy_path(level)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No trained policy found for level {level}. "
                   f"Run POST /train/{level} first."
        )

    with open(path, "r") as f:
        data = json.load(f)

    return JSONResponse(content=data)


# ── GET /policy/{level}/status ───────────────────────────
@app.get("/policy/{level}/status")
def get_training_status(level: int):
    """
    Returns whether a policy is trained, training, or missing.
    Useful for a loading screen in the frontend.
    """
    if level < 1 or level > 7:
        raise HTTPException(status_code=400, detail="Level must be 1–7")

    if policy_path(level).exists():
        status = training_status.get(level, "done")
    else:
        status = training_status.get(level, "idle")

    return {"level": level, "status": status}

# ── POST /train/all ──────────────────────────────────────
@app.post("/train/all", dependencies=[Depends(require_dev_mode)])
def train_all(
    body: TrainRequest = TrainRequest(),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    Trains all 7 levels sequentially in the background.
    Each level trains after the previous one finishes.
    Total time: ~5–10 minutes on a modern CPU.
    """
    def train_all_sequential(episodes_override: Optional[int]):
        for lvl_idx in range(7):
            run_training(lvl_idx, episodes_override)

    background_tasks.add_task(train_all_sequential, body.episodes)

    return {
        "message": "Training all 7 levels sequentially in background.",
        "poll": "GET /policy/{level}/status to track each level.",
    }

# ── POST /train/{level} ──────────────────────────────────
@app.post("/train/{level}", response_model=TrainResponse, dependencies=[Depends(require_dev_mode)])
def train_level(
    level: int,
    body: TrainRequest = TrainRequest(),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """
    Triggers training for a specific level in the background.
    Returns immediately — poll GET /policy/{level}/status to track progress.
    Training time: ~30 seconds per level on a modern CPU.
    """
    if level < 1 or level > 7:
        raise HTTPException(status_code=400, detail="Level must be 1–7")

    with training_lock:
        current = training_status.get(level, "idle")
        if current == "training":
            raise HTTPException(
                status_code=409,
                detail=f"Level {level} is already training. "
                       f"Poll /policy/{level}/status for progress."
            )

    background_tasks.add_task(run_training, level - 1, body.episodes)

    return {
        "message": f"Training started for level {level} in background.",
        "level": level,
    }


# ── GET /docs redirect note ──────────────────────────────
@app.get("/")
def root():
    """Small status page."""
    info = {"message": "Dragon's Maze API is running.", "health": "/health"}
    if DEV_MODE:
        info["docs"] = "/docs"
    return info
