# ═══════════════════════════════════════════════════════════
#  Dockerfile — Dragon's Maze backend
#  Builds a container that runs the FastAPI server
# ═══════════════════════════════════════════════════════════

# Start from a slim Python 3.11 image (small = faster to build/deploy)
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Copy requirements first (Docker caches this layer —
# only re-installs packages when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all backend source files
COPY . .

# Create the policies directory (will be populated by training)
RUN mkdir -p policies

# Expose the port FastAPI listens on
EXPOSE 8000

# Start the server
# --host 0.0.0.0 makes it reachable from outside the container
# --reload is OFF in production (remove flag for prod builds)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]