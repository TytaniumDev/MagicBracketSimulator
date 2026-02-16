#!/usr/bin/env bash
set -euo pipefail

# setup-swarm-node.sh — Join this machine to an existing Docker Swarm as a worker node.
#
# Uses the Tailscale IP as the advertise address so the manager can reach this
# node over the VPN.  Falls back to asking for an IP if Tailscale is not installed.
#
# Usage:
#   ./scripts/setup-swarm-node.sh --join-token=SWMTKN-... --manager-ip=100.64.0.1
#   ./scripts/setup-swarm-node.sh --join-token=SWMTKN-... --manager-ip=100.64.0.1 --simulation-image=ghcr.io/org/sim:latest

JOIN_TOKEN=""
MANAGER_IP=""
SIMULATION_IMAGE="magic-bracket-simulation:latest"

for arg in "$@"; do
  case $arg in
    --join-token=*) JOIN_TOKEN="${arg#*=}" ;;
    --manager-ip=*) MANAGER_IP="${arg#*=}" ;;
    --simulation-image=*) SIMULATION_IMAGE="${arg#*=}" ;;
    --help|-h)
      echo "Usage: $0 --join-token=TOKEN --manager-ip=IP [--simulation-image=IMAGE]"
      echo ""
      echo "Joins this machine to a Docker Swarm as a worker node."
      echo "Get the join token from the manager: docker swarm join-token worker -q"
      exit 0
      ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [ -z "$JOIN_TOKEN" ] || [ -z "$MANAGER_IP" ]; then
  echo "ERROR: --join-token and --manager-ip are required."
  echo "Run with --help for usage."
  exit 1
fi

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
  echo "To leave the current swarm first: docker swarm leave"
  exit 1
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
  echo "Enter the IP address the manager can reach this node at (e.g. your LAN IP):"
  read -r ADVERTISE_ADDR
  if [ -z "$ADVERTISE_ADDR" ]; then
    echo "ERROR: An advertise address is required."
    exit 1
  fi
fi

# ── Verify connectivity to manager ──────────────────────────────────
echo "Checking connectivity to manager at $MANAGER_IP:2377..."
if ! timeout 5 bash -c "echo > /dev/tcp/$MANAGER_IP/2377" 2>/dev/null; then
  echo "WARNING: Cannot reach $MANAGER_IP:2377. The join may fail."
  echo "Ensure Tailscale is connected or the manager is reachable on your network."
fi

# ── Join swarm ───────────────────────────────────────────────────────
echo ""
echo "Joining Docker Swarm..."
docker swarm join \
  --advertise-addr "$ADVERTISE_ADDR" \
  --token "$JOIN_TOKEN" \
  "$MANAGER_IP:2377"

echo ""
echo "Successfully joined the swarm."

# ── Pull simulation image ────────────────────────────────────────────
echo ""
echo "Pulling simulation image: $SIMULATION_IMAGE..."
docker pull "$SIMULATION_IMAGE" || echo "Warning: Failed to pull image. The manager will need the image available on all nodes."

echo ""
echo "=== Node Setup Complete ==="
echo ""
echo "This node is now a worker in the swarm."
echo "Verify from the manager: docker node ls"
