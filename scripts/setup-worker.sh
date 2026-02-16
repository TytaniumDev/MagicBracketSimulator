#!/usr/bin/env bash
set -euo pipefail

# setup-worker.sh — Bootstrap a remote worker machine from GCP Secret Manager.
#
# Must be run on a Unix system (macOS, Linux, or WSL). The script will install
# jq and gcloud CLI if missing, prompt for GCP project and auth, then configure
# and start the worker. Docker must be installed and running (see docs).
#
# Usage:
#   ./scripts/setup-worker.sh                    # standard setup
#   ./scripts/setup-worker.sh --worker-id=mac1   # with a worker identifier

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKER_DIR="$REPO_ROOT/worker"
SECRET_NAME="worker-host-config"

# Simulation image is derived from the worker image name (public, not in secret):
# e.g. ghcr.io/org/repo/worker -> ghcr.io/org/repo/simulation, or magic-bracket-worker -> magic-bracket-simulation
# ── Unix-only ────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux|Darwin) ;;
  *)
    echo "This script must be run on a Unix system (macOS, Linux, or WSL)."
    exit 1
    ;;
esac

# ── Parse arguments ──────────────────────────────────────────────────
WORKER_ID=""
for arg in "$@"; do
  case $arg in
    --worker-id=*) WORKER_ID="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--worker-id=NAME]"
      echo ""
      echo "Bootstraps a remote worker by reading config from GCP Secret Manager."
      echo "Run on a Unix system (macOS, Linux, or WSL). Docker must be installed."
      exit 0
      ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Ensure jq ────────────────────────────────────────────────────────
ensure_jq() {
  if command -v jq &>/dev/null; then return; fi
  echo "jq not found; installing..."
  case "$(uname -s)" in
    Darwin)
      if ! command -v brew &>/dev/null; then
        echo "ERROR: jq is required. Install Homebrew from https://brew.sh, then re-run this script."
        exit 1
      fi
      brew install jq
      ;;
    Linux)
      if command -v apt-get &>/dev/null; then
        sudo apt-get update && sudo apt-get install -y jq
      else
        echo "ERROR: jq is required. Install it (e.g. apt install jq or dnf install jq) and re-run."
        exit 1
      fi
      ;;
  esac
}

# ── Ensure gcloud CLI ────────────────────────────────────────────────
ensure_gcloud() {
  if command -v gcloud &>/dev/null; then return; fi
  echo "gcloud CLI not found; installing..."
  case "$(uname -s)" in
    Darwin)
      if ! command -v brew &>/dev/null; then
        echo "ERROR: gcloud is required. Install Homebrew from https://brew.sh, then re-run this script."
        exit 1
      fi
      brew install --cask google-cloud-sdk
      # Cask installs gcloud; ensure this shell can see it
      BREW_PREFIX=$(brew --prefix 2>/dev/null || echo "/usr/local")
      export PATH="$BREW_PREFIX/Caskroom/google-cloud-sdk/latest/google-cloud-sdk/bin:$PATH"
      ;;
    Linux)
      if command -v apt-get &>/dev/null; then
        sudo apt-get update && sudo apt-get install -y apt-transport-https ca-certificates gnupg
        sudo mkdir -p /usr/share/keyrings
        curl -sSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
        echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee /etc/apt/sources.list.d/google-cloud-sdk.list
        sudo apt-get update && sudo apt-get install -y google-cloud-cli
      else
        echo "ERROR: gcloud is required. Install from https://cloud.google.com/sdk/docs/install then re-run."
        exit 1
      fi
      ;;
  esac
  if ! command -v gcloud &>/dev/null; then
    echo "ERROR: gcloud still not in PATH. Open a new terminal and re-run, or add the SDK bin to PATH."
    exit 1
  fi
}

# ── Preflight: install deps and auth ──────────────────────────────────
echo "=== Magic Bracket Worker Setup ==="
echo ""

ensure_jq
ensure_gcloud

# Resolve gcloud path (in case we just installed it and PATH isn't updated in this shell)
GCLOUD=$(command -v gcloud)
export PATH="$(dirname "$GCLOUD"):$PATH"

# Ensure GCP project is set
PROJECT_ID=$("$GCLOUD" config get-value project 2>/dev/null || true)
if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "No GCP project set."
  read -r -p "Enter your GCP project ID: " PROJECT_ID
  [ -z "$PROJECT_ID" ] && { echo "ERROR: Project ID required."; exit 1; }
  "$GCLOUD" config set project "$PROJECT_ID"
fi
echo "GCP project: $PROJECT_ID"

# Ensure Application Default Credentials
if ! "$GCLOUD" auth application-default print-access-token &>/dev/null; then
  echo "GCP login required (browser will open)."
  "$GCLOUD" auth application-default login
fi
echo "GCP credentials: OK"

# Docker is required; we don't auto-install it
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker not found. Install Docker Desktop (macOS) or the Docker engine (Linux), then re-run."
  exit 1
fi
if ! docker info &>/dev/null 2>&1; then
  echo "ERROR: Docker daemon not running. Start Docker Desktop or: sudo systemctl start docker"
  exit 1
fi
echo "Docker: OK"

# Ensure Docker Compose is available (v2 plugin or v1 standalone)
ensure_docker_compose() {
  if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
    return
  fi
  if command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
    return
  fi
  echo "Docker Compose not found. Attempting to install..."
  case "$(uname -s)" in
    Darwin)
      if command -v brew &>/dev/null; then
        brew install docker-compose
        COMPOSE_CMD="docker-compose"
      else
        echo "ERROR: Docker Compose not found. Install Homebrew from https://brew.sh, then re-run, or install docker-compose manually."
        exit 1
      fi
      ;;
    Linux)
      if command -v apt-get &>/dev/null; then
        sudo apt-get update && sudo apt-get install -y docker-compose-plugin || sudo apt-get install -y docker-compose
        if docker compose version &>/dev/null; then
          COMPOSE_CMD="docker compose"
        else
          COMPOSE_CMD="docker-compose"
        fi
      else
        echo "ERROR: Docker Compose not found. Install docker-compose or docker-compose-plugin for your distro, then re-run."
        exit 1
      fi
      ;;
    *)
      echo "ERROR: Docker Compose not found. Install docker compose (v2) or docker-compose (v1) and re-run."
      exit 1
      ;;
  esac
}
ensure_docker_compose

# ── Read worker-host-config from Secret Manager ─────────────────────
echo ""
echo "Reading config from Secret Manager ($SECRET_NAME)..."

HOST_CONFIG=$(gcloud secrets versions access latest --secret="$SECRET_NAME" --project="$PROJECT_ID" 2>&1) || {
  echo "ERROR: Failed to read secret '$SECRET_NAME' from Secret Manager."
  echo "$HOST_CONFIG"
  echo ""
  echo "Make sure you've run the 'Provision Worker' GitHub Actions workflow first."
  echo "  gh workflow run provision-worker.yml"
  exit 1
}

# ── Parse config and write files ─────────────────────────────────────
echo "Writing config files..."

# Extract SA key → worker/sa.json
echo "$HOST_CONFIG" | jq -r '.sa_key' > "$WORKER_DIR/sa.json"
chmod 600 "$WORKER_DIR/sa.json"
echo "  worker/sa.json"

# Extract host-level env vars → worker/.env (default when secret has null/missing)
IMAGE_NAME=$(echo "$HOST_CONFIG" | jq -r '.IMAGE_NAME // "magic-bracket-worker"')
GHCR_USER=$(echo "$HOST_CONFIG" | jq -r '.GHCR_USER')
GHCR_TOKEN=$(echo "$HOST_CONFIG" | jq -r '.GHCR_TOKEN')
[ "$IMAGE_NAME" = "null" ] && IMAGE_NAME="magic-bracket-worker"

# Derive simulation image from worker image (public convention: .../worker -> .../simulation)
SIMULATION_IMAGE="${IMAGE_NAME%worker}simulation"

cat > "$WORKER_DIR/.env" <<EOF
# Auto-generated by setup-worker.sh — do not edit manually.
# Re-run ./scripts/setup-worker.sh to update.

# Host-level Docker Compose config (worker runtime config comes from Secret Manager)
SA_KEY_PATH=./sa.json
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
IMAGE_NAME=$IMAGE_NAME
SIMULATION_IMAGE=${SIMULATION_IMAGE}:latest
GHCR_USER=$GHCR_USER
GHCR_TOKEN=$GHCR_TOKEN
EOF

if [ -n "$WORKER_ID" ]; then
  echo "WORKER_ID=$WORKER_ID" >> "$WORKER_DIR/.env"
fi

chmod 600 "$WORKER_DIR/.env"
echo "  worker/.env"

# ── Docker config (credential helper workaround) ─────────────────────
# Use a script-local Docker config so we don't depend on docker-credential-desktop
# (or other credential helpers) which may not be in PATH (e.g. Colima, Docker Desktop).
# Copy only config.json and contexts/ so the current context (e.g. colima) works;
# skip sockets and other special files. Remove credential helpers so login writes to the file.
# This must be set before ANY docker command that might pull images.
DOCKER_CONFIG_DIR="$WORKER_DIR/.docker-login-config"
mkdir -p "$DOCKER_CONFIG_DIR"
if [ -f "${HOME}/.docker/config.json" ]; then
  jq 'del(.credsStore, .credHelpers)' "${HOME}/.docker/config.json" > "$DOCKER_CONFIG_DIR/config.json" 2>/dev/null || cp "${HOME}/.docker/config.json" "$DOCKER_CONFIG_DIR/config.json"
fi
if [ -d "${HOME}/.docker/contexts" ]; then
  cp -R "${HOME}/.docker/contexts" "$DOCKER_CONFIG_DIR/"
fi
export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

# ── Detect Docker socket GID ─────────────────────────────────────────
# On macOS with Colima/Docker Desktop the host symlink GID differs from the VM's
# actual socket GID, so we stat from inside a throwaway container.
DOCKER_SOCK_GID=$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine stat -c '%g' /var/run/docker.sock 2>/dev/null || echo "0")
echo "DOCKER_SOCK_GID=$DOCKER_SOCK_GID" >> "$WORKER_DIR/.env"

# ── Stop and remove existing containers ──────────────────────────────
# (including stopped/exited ones, which still hold the container name)
# Use both compose down and explicit rm so we remove containers even if they
# were started from a different project/directory (e.g. repo root).
echo ""
echo "Stopping existing worker containers..."
cd "$WORKER_DIR"
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml down 2>/dev/null || true
docker rm -f magic-bracket-worker watchtower 2>/dev/null || true

echo ""
echo "Logging into GHCR..."
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

# ── Initialize single-node Docker Swarm (if not already in one) ──────
SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "$SWARM_STATE" != "active" ]; then
  echo ""
  echo "Initializing single-node Docker Swarm..."
  # Use the default route IP as the advertise address; Tailscale IP if available
  ADVERTISE_ADDR=""
  if command -v tailscale &>/dev/null; then
    ADVERTISE_ADDR=$(tailscale ip -4 2>/dev/null || true)
  fi
  if [ -n "$ADVERTISE_ADDR" ]; then
    docker swarm init --advertise-addr "$ADVERTISE_ADDR"
  else
    docker swarm init
  fi
  echo "Docker Swarm initialized (single-node)."
else
  echo ""
  echo "Docker Swarm: already active."
fi

# ── Pull and start ────────────────────────────────────────────────────
echo ""
echo "Pulling latest worker image..."
cd "$WORKER_DIR"
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml pull worker

echo ""
echo "Pulling latest simulation image: ${SIMULATION_IMAGE}:latest..."
docker pull "${SIMULATION_IMAGE}:latest" || echo "Warning: Failed to pull simulation image. Worker will attempt to pull on startup."

echo ""
echo "Starting worker + Watchtower..."
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml up -d

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Useful commands:"
echo "  $COMPOSE_CMD -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml logs -f worker"
echo "  $COMPOSE_CMD -f worker/docker-compose.yml -f worker/docker-compose.watchtower.yml logs -f watchtower"
echo ""
echo "To update secrets: re-run the 'Provision Worker' workflow, then re-run this script."
