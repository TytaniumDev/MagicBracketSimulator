#!/usr/bin/env bash
set -euo pipefail

# setup-worker.sh — Bootstrap a remote worker machine.
#
# Uses a time-limited setup token from the frontend.
# No gcloud, no GCP project access needed. Works on any Mac/Linux/WSL machine.
#
# Usage:
#   bash <(curl -fsSL <scriptUrl>) --api=<apiUrl>     # interactive (prompt for token)
#   ./scripts/setup-worker.sh --api=URL                # specify API URL
#   ./scripts/setup-worker.sh --token=TOKEN --api=URL  # non-interactive
#   ./scripts/setup-worker.sh --worker-id=mac1         # with a worker identifier

# ── Color & output helpers ─────────────────────────────────────────────
if [ -t 1 ]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  BLUE='\033[0;34m'
  PURPLE='\033[0;35m'
  CYAN='\033[0;36m'
  RESET='\033[0m'
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' BLUE='' PURPLE='' CYAN='' RESET=''
fi

step()   { echo -e "\n${BOLD}${PURPLE}[$1/8]${RESET} ${BOLD}$2${RESET}"; }
info()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${RESET} $1"; }
err()    { echo -e "  ${RED}✗${RESET} $1"; }
detail() { echo -e "  ${DIM}$1${RESET}"; }

banner() {
  echo -e "${BOLD}${PURPLE}"
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║     Magic Bracket Worker Setup       ║"
  echo "  ╚══════════════════════════════════════╝"
  echo -e "${RESET}"
}

# ── Parse arguments ──────────────────────────────────────────────────
WORKER_ID=""
SETUP_TOKEN=""
API_URL=""
for arg in "$@"; do
  case $arg in
    --worker-id=*) WORKER_ID="${arg#*=}" ;;
    --token=*)     SETUP_TOKEN="${arg#*=}" ;;
    --api=*)       API_URL="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--api=URL] [--token=TOKEN] [--worker-id=NAME]"
      echo ""
      echo "Bootstraps a remote worker machine."
      echo ""
      echo "Options:"
      echo "  --api=URL       API endpoint URL (auto-detected if omitted)"
      echo "  --token=TOKEN   Setup token (will prompt interactively if omitted)"
      echo "  --worker-id=ID  Worker identifier (optional)"
      echo ""
      echo "Get a setup token from the Worker Setup page in the frontend."
      exit 0
      ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

banner

# ── Detect if running from a git clone ──────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
IN_REPO=false
if [ -f "$SCRIPT_DIR/../worker/docker-compose.yml" ]; then
  IN_REPO=true
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  WORKER_DIR="$REPO_ROOT/worker"
else
  WORKER_DIR="$HOME/magic-bracket-worker"
fi

# ── Flow mode: always use token-based setup ───────────────────────

# ═══════════════════════════════════════════════════════════════════════
# STEP 1: Checking prerequisites
# ═══════════════════════════════════════════════════════════════════════
step 1 "Checking prerequisites"

# Platform check
case "$(uname -s)" in
  Linux|Darwin) info "Platform: $(uname -s) $(uname -m)" ;;
  MINGW*|MSYS*)
    err "On Windows, this script must be run inside WSL (not Git Bash or MSYS)."
    echo ""
    detail "Docker Desktop uses WSL paths for bind mounts. Running from Git Bash"
    detail "produces Windows paths (C:\\...) that Docker cannot mount correctly."
    echo ""
    detail "Open a WSL terminal and run the setup command there."
    exit 1
    ;;
  *)
    err "This script must be run on a Unix system (macOS, Linux, or WSL)."
    exit 1
    ;;
esac

# WSL filesystem check
if grep -qi microsoft /proc/version 2>/dev/null; then
  if $IN_REPO; then
    case "$REPO_ROOT" in
      /mnt/[a-zA-Z]/*)
        warn "Repo is on the Windows filesystem ($REPO_ROOT)."
        detail "Docker cannot reliably bind-mount files from /mnt/c/... into containers."
        detail "The setup will use ~/magic-bracket-worker instead."
        IN_REPO=false
        WORKER_DIR="$HOME/magic-bracket-worker"
        ;;
    esac
  fi
  info "WSL detected"
fi

# Disk space check
FREE_KB=$(df -k "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' || echo "0")
if [ "$FREE_KB" -lt 2097152 ] 2>/dev/null; then
  warn "Less than 2GB free disk space. Docker images may fail to download."
fi

# Sudo pre-prompt on Linux (so it doesn't interrupt later steps)
if [ "$(uname -s)" = "Linux" ]; then
  if ! docker info &>/dev/null 2>&1 && [ "$(id -u)" -ne 0 ]; then
    detail "Some steps require sudo. You may be prompted for your password."
    sudo -v 2>/dev/null || true
  fi
fi

# ═══════════════════════════════════════════════════════════════════════
# STEP 2: Installing dependencies
# ═══════════════════════════════════════════════════════════════════════
step 2 "Installing dependencies"

DEPS_TO_INSTALL=()

# Check what needs installing
if ! command -v curl &>/dev/null; then DEPS_TO_INSTALL+=("curl"); fi
if ! command -v openssl &>/dev/null; then DEPS_TO_INSTALL+=("openssl"); fi
if ! command -v jq &>/dev/null; then DEPS_TO_INSTALL+=("jq"); fi
NEED_DOCKER=false
if ! command -v docker &>/dev/null; then
  NEED_DOCKER=true
  DEPS_TO_INSTALL+=("docker")
fi

if [ ${#DEPS_TO_INSTALL[@]} -eq 0 ]; then
  info "All dependencies already installed"
else
  detail "Will install: ${DEPS_TO_INSTALL[*]}"

  case "$(uname -s)" in
    Darwin)
      # Ensure Homebrew on macOS
      if ! command -v brew &>/dev/null; then
        detail "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        # Add brew to PATH for this session
        if [ -f /opt/homebrew/bin/brew ]; then
          eval "$(/opt/homebrew/bin/brew shellenv)"
        elif [ -f /usr/local/bin/brew ]; then
          eval "$(/usr/local/bin/brew shellenv)"
        fi
      fi

      for dep in "${DEPS_TO_INSTALL[@]}"; do
        case $dep in
          docker)
            detail "Installing OrbStack..."
            brew install --cask orbstack
            echo ""
            warn "OrbStack needs first-time setup in its GUI window."
            detail "Complete these steps in the OrbStack window that opens:"
            detail "  1. Accept the license agreement"
            detail "  2. Choose the ${BOLD}Docker${RESET}${DIM} option when prompted"
            detail "  3. Grant any macOS permissions it requests"
            detail "This script will resume automatically once OrbStack is ready."
            echo ""
            open -a OrbStack
            # Wait for Docker daemon — generous timeout for first-run GUI setup
            local_timeout=300
            while ! docker info &>/dev/null 2>&1; do
              sleep 3
              local_timeout=$((local_timeout - 3))
              if [ $local_timeout -le 0 ]; then
                err "OrbStack did not become ready within 5 minutes."
                detail "Complete the OrbStack setup wizard, then re-run this script."
                exit 1
              fi
            done
            info "OrbStack is running"
            ;;
          *)
            brew install "$dep"
            ;;
        esac
      done
      ;;

    Linux)
      # Install basic deps via apt
      BASIC_DEPS=()
      for dep in "${DEPS_TO_INSTALL[@]}"; do
        [ "$dep" != "docker" ] && BASIC_DEPS+=("$dep")
      done
      if [ ${#BASIC_DEPS[@]} -gt 0 ]; then
        sudo apt-get update -qq
        sudo apt-get install -y -qq "${BASIC_DEPS[@]}"
      fi

      # Install Docker
      if $NEED_DOCKER; then
        detail "Installing Docker..."
        if command -v apt-get &>/dev/null; then
          sudo apt-get install -y -qq docker.io docker-compose-plugin
        else
          err "Cannot auto-install Docker on this system."
          detail "Install Docker manually: https://docs.docker.com/engine/install/"
          exit 1
        fi
      fi
      ;;
  esac

  info "Dependencies installed"
fi

# Ensure Docker daemon is running
if ! docker info &>/dev/null 2>&1; then
  detail "Starting Docker daemon..."
  case "$(uname -s)" in
    Darwin)
      detail "Launching OrbStack — if this is the first run, complete the setup wizard and choose Docker."
      open -a OrbStack 2>/dev/null || true
      timeout_secs=120
      while ! docker info &>/dev/null 2>&1; do
        sleep 2
        timeout_secs=$((timeout_secs - 2))
        if [ $timeout_secs -le 0 ]; then
          err "Docker daemon did not start within 2 minutes."
          detail "Open OrbStack, ensure setup is complete, then re-run this script."
          exit 1
        fi
      done
      ;;
    Linux)
      sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
      sleep 2
      if ! docker info &>/dev/null 2>&1; then
        err "Docker daemon is not running. Start it with: sudo systemctl start docker"
        exit 1
      fi
      # Add current user to docker group if not root
      if [ "$(id -u)" -ne 0 ] && ! groups | grep -q docker; then
        sudo usermod -aG docker "$USER" 2>/dev/null || true
        warn "Added $USER to docker group. You may need to log out and back in."
      fi
      ;;
  esac
fi
info "Docker daemon: running"

# Ensure Docker Compose
COMPOSE_CMD=""
if docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  detail "Installing Docker Compose..."
  case "$(uname -s)" in
    Darwin)
      if command -v brew &>/dev/null; then
        detail "OrbStack includes docker compose. If this fails, ensure OrbStack is running."
        brew install docker-compose
        COMPOSE_CMD="docker-compose"
      fi
      ;;
    Linux)
      if command -v apt-get &>/dev/null; then
        sudo apt-get install -y -qq docker-compose-plugin 2>/dev/null || sudo apt-get install -y -qq docker-compose 2>/dev/null
      fi
      if docker compose version &>/dev/null; then
        COMPOSE_CMD="docker compose"
      elif command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
      fi
      ;;
  esac
  if [ -z "$COMPOSE_CMD" ]; then
    err "Docker Compose not found. Install it and re-run."
    exit 1
  fi
fi
info "Docker Compose: $COMPOSE_CMD"

# ═══════════════════════════════════════════════════════════════════════
# STEP 3: Setup token
# ═══════════════════════════════════════════════════════════════════════
step 3 "Setup token"

if [ -n "$SETUP_TOKEN" ]; then
  info "Using token from --token argument"
elif [ -t 0 ]; then
  echo ""
  detail "To get a setup token, visit the Worker Setup page on the"
  detail "Magic Bracket frontend, or ask someone with access to generate one."
  echo ""
  read -r -p "  Setup token: " SETUP_TOKEN
  if [ -z "$SETUP_TOKEN" ]; then
    err "No token provided."
    exit 1
  fi
  info "Token received"
else
  err "No setup token provided and no interactive terminal."
  detail "Use --token=TOKEN or run interactively."
  exit 1
fi

# ═══════════════════════════════════════════════════════════════════════
# STEP 4: Fetching configuration
# ═══════════════════════════════════════════════════════════════════════
step 4 "Fetching configuration"

# Determine API URL
if [ -z "$API_URL" ]; then
  detail "Detecting API URL from GitHub config..."
  CONFIG_JSON=$(curl -fsSL "https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main/frontend/public/config.json" 2>/dev/null || echo "")
  if [ -n "$CONFIG_JSON" ]; then
    API_URL=$(echo "$CONFIG_JSON" | jq -r '.apiUrl // empty' 2>/dev/null || echo "")
  fi
  if [ -z "$API_URL" ]; then
    err "Could not detect API URL. Use --api=URL."
    exit 1
  fi
fi
# Strip trailing slash
API_URL="${API_URL%/}"
info "API: $API_URL"

# Generate AES-256 key
AES_KEY=$(openssl rand -hex 32)

# Fetch encrypted config
detail "Requesting encrypted config..."
HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-Setup-Token: $SETUP_TOKEN" \
  -H "X-Encryption-Key: $AES_KEY" \
  "$API_URL/api/worker-setup/config" 2>&1) || {
  err "Failed to connect to API at $API_URL"
  exit 1
}

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -1)

if [ "$HTTP_CODE" = "401" ]; then
  err "Token expired or invalid. Generate a new one from the Worker Setup page."
  exit 1
elif [ "$HTTP_CODE" != "200" ]; then
  ERROR_MSG=$(echo "$HTTP_BODY" | jq -r '.error // empty' 2>/dev/null || echo "")
  err "API returned HTTP $HTTP_CODE${ERROR_MSG:+: $ERROR_MSG}"
  exit 1
fi

# Parse encrypted response
ENC_IV=$(echo "$HTTP_BODY" | jq -r '.iv')
ENC_CIPHERTEXT=$(echo "$HTTP_BODY" | jq -r '.ciphertext')
ENC_TAG=$(echo "$HTTP_BODY" | jq -r '.tag')

if [ -z "$ENC_IV" ] || [ "$ENC_IV" = "null" ]; then
  err "Invalid response from API (missing encryption data)"
  exit 1
fi

# Decrypt AES-256-GCM — try node first (cleanest), then python3 fallback
detail "Decrypting configuration..."
if command -v node &>/dev/null; then
  HOST_CONFIG=$(node -e "
const crypto = require('crypto');
const iv = Buffer.from('$ENC_IV', 'base64');
const ct = Buffer.from('$ENC_CIPHERTEXT', 'base64');
const tag = Buffer.from('$ENC_TAG', 'base64');
const key = Buffer.from('$AES_KEY', 'hex');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
let dec = decipher.update(ct, undefined, 'utf-8');
dec += decipher.final('utf-8');
process.stdout.write(dec);
" 2>/dev/null)
elif command -v python3 &>/dev/null; then
  HOST_CONFIG=$(python3 -c "
import sys, base64, subprocess, tempfile, os
iv = base64.b64decode('$ENC_IV')
ct = base64.b64decode('$ENC_CIPHERTEXT')
tag = base64.b64decode('$ENC_TAG')
key = bytes.fromhex('$AES_KEY')
combined = ct + tag
with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
    f.write(combined)
    combined_file = f.name
try:
    result = subprocess.run([
        'openssl', 'enc', '-aes-256-gcm', '-d',
        '-K', key.hex(), '-iv', iv.hex(),
        '-in', combined_file, '-nosalt'
    ], capture_output=True)
    if result.returncode == 0:
        sys.stdout.write(result.stdout.decode('utf-8'))
    else:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        sys.stdout.write(AESGCM(key).decrypt(iv, ct + tag, None).decode('utf-8'))
finally:
    os.unlink(combined_file)
" 2>/dev/null)
else
  err "Neither node nor python3 found. Install one and re-run."
  exit 1
fi

if [ -z "$HOST_CONFIG" ]; then
  err "Decryption produced empty output"
  exit 1
fi

info "Config decrypted successfully"

# Extract fields
SA_KEY_JSON=$(echo "$HOST_CONFIG" | jq -r '.sa_key')
IMAGE_NAME=$(echo "$HOST_CONFIG" | jq -r '.IMAGE_NAME // "magic-bracket-worker"')
GHCR_USER=$(echo "$HOST_CONFIG" | jq -r '.GHCR_USER')
GHCR_TOKEN=$(echo "$HOST_CONFIG" | jq -r '.GHCR_TOKEN')
PROJECT_ID=$(echo "$HOST_CONFIG" | jq -r '.GOOGLE_CLOUD_PROJECT // "magic-bracket-simulator"')
[ "$IMAGE_NAME" = "null" ] && IMAGE_NAME="magic-bracket-worker"

# Derive simulation image
SIMULATION_IMAGE="${IMAGE_NAME%worker}simulation"

# ═══════════════════════════════════════════════════════════════════════
# STEP 5: Setting up workspace
# ═══════════════════════════════════════════════════════════════════════
step 5 "Setting up workspace"

GITHUB_RAW="https://raw.githubusercontent.com/TytaniumDev/MagicBracketSimulator/main"

if $IN_REPO; then
  info "Using repo directory: $WORKER_DIR"
else
  mkdir -p "$WORKER_DIR"
  info "Workspace: $WORKER_DIR"

  # Download compose files
  detail "Downloading compose files from GitHub..."
  curl -fsSL "$GITHUB_RAW/worker/docker-compose.yml" -o "$WORKER_DIR/docker-compose.yml"
  curl -fsSL "$GITHUB_RAW/worker/docker-compose.watchtower.yml" -o "$WORKER_DIR/docker-compose.watchtower.yml"
  info "Compose files downloaded"
fi

# Write sa.json
if [ -n "$SA_KEY_JSON" ] && [ "$SA_KEY_JSON" != "null" ] && [ "$SA_KEY_JSON" != "{}" ]; then
  echo "$SA_KEY_JSON" > "$WORKER_DIR/sa.json"
  chmod 644 "$WORKER_DIR/sa.json"
  info "sa.json written"
else
  warn "No service account key in config (sa.json will be empty)"
  echo "{}" > "$WORKER_DIR/sa.json"
  chmod 644 "$WORKER_DIR/sa.json"
fi

# Write .env
cat > "$WORKER_DIR/.env" <<EOF
# Auto-generated by setup-worker.sh — do not edit manually.
# Re-run setup-worker.sh to update.

SA_KEY_PATH=./sa.json
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
IMAGE_NAME=$IMAGE_NAME
SIMULATION_IMAGE=${SIMULATION_IMAGE}:latest
GHCR_USER=$GHCR_USER
GHCR_TOKEN=$GHCR_TOKEN
EOF

WORKER_NAME=$(hostname)
echo "WORKER_NAME=$WORKER_NAME" >> "$WORKER_DIR/.env"

if [ -n "$WORKER_ID" ]; then
  echo "WORKER_ID=$WORKER_ID" >> "$WORKER_DIR/.env"
fi

# Owner email
if [ -t 0 ]; then
  echo ""
  detail "Optional: enter your Google account email so you can control this"
  detail "worker from the frontend UI (leave blank to skip)."
  echo ""
  read -r -p "  Owner email: " OWNER_EMAIL
  if [ -n "$OWNER_EMAIL" ]; then
    echo "WORKER_OWNER_EMAIL=$OWNER_EMAIL" >> "$WORKER_DIR/.env"
  fi
fi

chmod 600 "$WORKER_DIR/.env"
info ".env written"

# Docker config (credential helper workaround)
DOCKER_CONFIG_DIR="$WORKER_DIR/.docker-login-config"
mkdir -p "$DOCKER_CONFIG_DIR"
if [ -f "${HOME}/.docker/config.json" ]; then
  jq 'del(.credsStore, .credHelpers)' "${HOME}/.docker/config.json" > "$DOCKER_CONFIG_DIR/config.json" 2>/dev/null || cp "${HOME}/.docker/config.json" "$DOCKER_CONFIG_DIR/config.json"
fi
if [ -d "${HOME}/.docker/contexts" ]; then
  cp -R "${HOME}/.docker/contexts" "$DOCKER_CONFIG_DIR/" 2>/dev/null || true
fi
export DOCKER_CONFIG="$DOCKER_CONFIG_DIR"

# Detect Docker socket GID
DOCKER_SOCK_GID=$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine stat -c '%g' /var/run/docker.sock 2>/dev/null || echo "0")
echo "DOCKER_SOCK_GID=$DOCKER_SOCK_GID" >> "$WORKER_DIR/.env"
info "Docker socket GID: $DOCKER_SOCK_GID"

# ═══════════════════════════════════════════════════════════════════════
# STEP 6: Preparing Docker
# ═══════════════════════════════════════════════════════════════════════
step 6 "Preparing Docker"

# Stop existing containers
detail "Stopping existing containers..."
cd "$WORKER_DIR"
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml down 2>/dev/null || true
docker rm -f magic-bracket-worker watchtower 2>/dev/null || true
info "Existing containers stopped"

# GHCR login with retry
detail "Logging into GHCR..."
login_attempts=0
login_success=false
while [ $login_attempts -lt 3 ]; do
  login_output=$(echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin 2>&1) && {
    login_success=true
    break
  }
  login_attempts=$((login_attempts + 1))
  if [ $login_attempts -lt 3 ]; then
    warn "Login attempt $login_attempts failed, retrying in ${login_attempts}s..."
    sleep $login_attempts
  fi
done
if ! $login_success; then
  err "Failed to log into GHCR after 3 attempts"
  echo "$login_output"
  exit 1
fi
echo "$login_output" | grep -v "Your credentials are stored unencrypted" | grep -v "Configure a credential helper" || true
info "GHCR login successful"

# Restore default DOCKER_CONFIG so CLI plugins (docker compose, buildx) are found.
# The override was only needed for login to bypass credential helpers.
unset DOCKER_CONFIG

# ═══════════════════════════════════════════════════════════════════════
# STEP 7: Pulling images
# ═══════════════════════════════════════════════════════════════════════
step 7 "Pulling images"

# Retry wrapper
pull_with_retry() {
  local cmd="$1"
  local name="$2"
  local attempts=0
  while [ $attempts -lt 3 ]; do
    if eval "$cmd"; then
      return 0
    fi
    attempts=$((attempts + 1))
    if [ $attempts -lt 3 ]; then
      local delay=$((attempts * 5))
      warn "Pull failed for $name, retrying in ${delay}s... (attempt $((attempts+1))/3)"
      sleep $delay
    fi
  done
  return 1
}

# Worker image
detail "Pulling worker image..."
cd "$WORKER_DIR"
pull_with_retry "$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml pull worker" "worker" || {
  err "Failed to pull worker image after 3 attempts"
  exit 1
}
info "Worker image pulled"

# Simulation image
detail "Pulling simulation image: ${SIMULATION_IMAGE}:latest..."
pull_with_retry "docker pull ${SIMULATION_IMAGE}:latest" "simulation" || {
  warn "Failed to pull simulation image. Worker will attempt to pull on startup."
}
info "Images ready"

# ═══════════════════════════════════════════════════════════════════════
# STEP 8: Starting worker
# ═══════════════════════════════════════════════════════════════════════
step 8 "Starting worker"

cd "$WORKER_DIR"
$COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml up -d

# Mount verification
sleep 3
detail "Verifying container mounts..."
SA_CHECK=$(docker exec magic-bracket-worker test -f /secrets/sa.json && echo "ok" || echo "fail")
if [ "$SA_CHECK" != "ok" ]; then
  err "/secrets/sa.json is not mounted correctly inside the container."
  detail "Run: docker inspect magic-bracket-worker --format={{json .Mounts}}"
  exit 1
fi
info "Mount verification passed"

# Health check polling
detail "Waiting for worker health check..."
health_timeout=60
while [ $health_timeout -gt 0 ]; do
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' magic-bracket-worker 2>/dev/null || echo "unknown")
  case "$HEALTH" in
    healthy)
      info "Worker is healthy"
      break
      ;;
    unhealthy)
      warn "Worker reported unhealthy — check logs for details"
      break
      ;;
    *)
      sleep 2
      health_timeout=$((health_timeout - 2))
      ;;
  esac
done
if [ $health_timeout -le 0 ]; then
  warn "Health check timed out (worker may still be starting)"
fi

# ═══════════════════════════════════════════════════════════════════════
# Success banner
# ═══════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}  ╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}  ║        Setup complete!               ║${RESET}"
echo -e "${BOLD}${GREEN}  ╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${CYAN}Useful commands:${RESET}"
echo -e "  ${DIM}View worker logs:${RESET}"
echo "    cd $WORKER_DIR && $COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml logs -f worker"
echo ""
echo -e "  ${DIM}View watchtower logs:${RESET}"
echo "    cd $WORKER_DIR && $COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml logs -f watchtower"
echo ""
echo -e "  ${DIM}Restart worker:${RESET}"
echo "    cd $WORKER_DIR && $COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml restart worker"
echo ""
echo -e "  ${DIM}Stop everything:${RESET}"
echo "    cd $WORKER_DIR && $COMPOSE_CMD -f docker-compose.yml -f docker-compose.watchtower.yml down"
echo ""
