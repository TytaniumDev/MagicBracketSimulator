#!/usr/bin/env bash
set -euo pipefail

# init-swarm-manager.sh — Initialize this machine as a Docker Swarm manager.
#
# Uses the Tailscale IP as the advertise address so worker nodes on different
# networks can join via the VPN.  Falls back to asking for an IP if Tailscale
# is not installed.
#
# Usage:
#   ./scripts/init-swarm-manager.sh
#   ./scripts/init-swarm-manager.sh --simulation-image ghcr.io/org/magic-bracket-simulation:latest

SIMULATION_IMAGE="magic-bracket-simulation:latest"

for arg in "$@"; do
  case $arg in
    --simulation-image=*) SIMULATION_IMAGE="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 [--simulation-image=IMAGE]"
      echo ""
      echo "Initializes a Docker Swarm on this machine (manager node)."
      echo "Requires Docker and optionally Tailscale for cross-network nodes."
      exit 0
      ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ── Preflight ─────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required. Install it first."
  exit 1
fi
if ! docker info &>/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running."
  exit 1
fi

# Check if already in a swarm
SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "$SWARM_STATE" = "active" ]; then
  echo "This machine is already part of a Docker Swarm."
  echo ""
  echo "Current nodes:"
  docker node ls
  echo ""
  echo "Worker join token:"
  docker swarm join-token worker -q
  echo ""
  echo "To add a worker node, run on the worker machine:"
  MANAGER_IP=$(docker info --format '{{.Swarm.NodeAddr}}' 2>/dev/null || echo "<manager-ip>")
  TOKEN=$(docker swarm join-token worker -q)
  echo "  ./scripts/setup-swarm-node.sh --join-token=$TOKEN --manager-ip=$MANAGER_IP"
  exit 0
fi

# ── Determine advertise address ──────────────────────────────────────
ADVERTISE_ADDR=""

if command -v tailscale &>/dev/null; then
  TS_IP=$(tailscale ip -4 2>/dev/null || true)
  if [ -n "$TS_IP" ]; then
    echo "Tailscale IP detected: $TS_IP"
    ADVERTISE_ADDR="$TS_IP"
  fi
fi

if [ -z "$ADVERTISE_ADDR" ]; then
  echo "Tailscale not found or not connected."
  echo "Enter the IP address to advertise to worker nodes (e.g. your LAN IP):"
  read -r ADVERTISE_ADDR
  if [ -z "$ADVERTISE_ADDR" ]; then
    echo "ERROR: An advertise address is required."
    exit 1
  fi
fi

# ── Initialize swarm ─────────────────────────────────────────────────
echo ""
echo "Initializing Docker Swarm with advertise-addr=$ADVERTISE_ADDR..."
docker swarm init --advertise-addr "$ADVERTISE_ADDR"

echo ""
echo "Swarm initialized successfully."
echo ""

# ── Pull simulation image ────────────────────────────────────────────
echo "Pulling simulation image: $SIMULATION_IMAGE..."
docker pull "$SIMULATION_IMAGE" || echo "Warning: Failed to pull image. Ensure it's available locally."

# ── Print join instructions ──────────────────────────────────────────
echo ""
echo "=== Swarm Manager Ready ==="
echo ""
TOKEN=$(docker swarm join-token worker -q)
echo "Worker join token: $TOKEN"
echo ""
echo "To add worker nodes, run on each worker machine:"
echo "  ./scripts/setup-swarm-node.sh --join-token=$TOKEN --manager-ip=$ADVERTISE_ADDR"
echo ""
echo "To verify nodes:"
echo "  docker node ls"
