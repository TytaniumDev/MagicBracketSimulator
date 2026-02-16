#!/bin/bash
# Forge Simulation Engine - Entrypoint Script
# Parses CLI args, validates decks, invokes Forge sim, captures logs to {LOGS_DIR}/{job_id}_game_{n}.txt
set -euo pipefail

# Change to script directory if FORGE_PATH is set, otherwise /app
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${FORGE_PATH:-}" ]]; then
    cd "$FORGE_PATH"
else
    cd /app
fi

# Defaults
SIMULATIONS=5
DECKS=()
JOB_ID=""

# Paths - use env vars if set, otherwise defaults for standalone container
# DECKS_DIR should point to where .dck files live (Forge's commander deck dir)
DECKS_DIR="${DECKS_DIR:-/home/simulator/.forge/decks/commander}"
LOGS_DIR="${LOGS_DIR:-/app/logs}"

# Forge launcher - check FORGE_PATH first, then script dir, then /app
if [[ -n "${FORGE_PATH:-}" ]] && [[ -f "${FORGE_PATH}/forge.sh" ]]; then
    FORGE_LAUNCHER="${FORGE_PATH}/forge.sh"
elif [[ -f "${SCRIPT_DIR}/forge.sh" ]]; then
    FORGE_LAUNCHER="${SCRIPT_DIR}/forge.sh"
else
    FORGE_LAUNCHER="/app/forge.sh"
fi

usage() {
    cat <<EOF >&2
Usage: $0 --decks <d1> <d2> <d3> <d4> [--simulations <n>] --id <job_id>
  --decks       Four deck filenames in ${DECKS_DIR} (e.g. deck_0.dck deck_1.dck deck_2.dck deck_3.dck)
  --simulations Number of games (default: 5)
  --id          Job ID for output logs: {job_id}_game_{n}.txt
EOF
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --decks)
            shift
            if [[ $# -lt 4 ]]; then
                echo "Error: --decks requires exactly 4 deck filenames" >&2
                exit 1
            fi
            DECKS=("$1" "$2" "$3" "$4")
            shift 4
            ;;
        --simulations)
            SIMULATIONS="${2:?Missing value for --simulations}"
            shift 2
            ;;
        --id)
            JOB_ID="${2:?Missing value for --id}"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Error: Unknown option $1" >&2
            usage
            ;;
    esac
done

# Swarm mode: decode deck content from base64 env vars
# When running as a swarm service, decks are delivered via DECK_0_B64..DECK_3_B64
# instead of being mounted as files. This is a no-op when env vars aren't set.
if [[ -n "${DECK_0_B64:-}" ]]; then
  echo "Swarm mode: decoding decks from environment variables" >&2
  mkdir -p "$DECKS_DIR"
  for i in 0 1 2 3; do
    var="DECK_${i}_B64"
    echo "${!var}" | base64 -d > "${DECKS_DIR}/deck_${i}.dck"
  done
  DECKS=("deck_0.dck" "deck_1.dck" "deck_2.dck" "deck_3.dck")
fi

# Validate required args
if [[ ${#DECKS[@]} -ne 4 ]] || [[ -z "$JOB_ID" ]]; then
    echo "Error: Missing required arguments (--decks x4, --id)" >&2
    usage
fi

# Validate all decks exist and have [Main] section
for deck in "${DECKS[@]}"; do
    deck_path="${DECKS_DIR}/${deck}"
    if [[ ! -f "$deck_path" ]]; then
        echo "Error: Deck not found: ${deck_path}" >&2
        exit 1
    fi
    if ! grep -qi '\[main\]' "$deck_path"; then
        echo "Error: Deck missing [Main] section: ${deck}" >&2
        exit 1
    fi
done

# Ensure logs directory exists
mkdir -p "$LOGS_DIR"

echo "Forge Simulation Engine: starting ${SIMULATIONS} game(s) with decks: ${DECKS[*]}" >&2

# Run Forge sim - capture stdout/stderr for log processing
# Do NOT use -q; we need full logs for Analysis Service
# -f Commander; -n number of games
# -c 300 = 5 min timeout per game (optional, helps avoid infinite games)
FORGE_OUTPUT=$(mktemp)
trap "rm -f ${FORGE_OUTPUT}" EXIT

# xvfb-run provides a virtual display for Forge's GUI initialization (GuiDesktop static init)
# Note: Do NOT set java.awt.headless=true as it conflicts with xvfb; we want Java to use the virtual display
set +e
xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" \
    "$FORGE_LAUNCHER" sim \
    -d "${DECKS[0]}" "${DECKS[1]}" "${DECKS[2]}" "${DECKS[3]}" \
    -f Commander \
    -n "$SIMULATIONS" \
    -c 300 \
    >> "$FORGE_OUTPUT" 2>&1
FORGE_EXIT=$?
set -e

# On Forge failure, report last 50 lines of output to stderr for debugging
if [[ $FORGE_EXIT -ne 0 ]] && [[ -s "$FORGE_OUTPUT" ]]; then
    echo "Error: Forge sim exited with code ${FORGE_EXIT}. Last 50 lines of output:" >&2
    tail -50 "$FORGE_OUTPUT" >&2
fi

# Split Forge output into per-game log files
# Forge prints game output; games typically end with winner announcement or "Game Over"
# Split by common delimiters: "Game Over", "wins the game", or "Simulation"
if [[ -s "$FORGE_OUTPUT" ]]; then
    # Use awk to split: treat "Game Over" or "wins the game" as end-of-game markers
    # Forge may output "Player X wins" or "Game Over" - accumulate until game end, then write
    awk -v job_id="$JOB_ID" -v logs_dir="$LOGS_DIR" '
        BEGIN { game_num = 0 }
        /[Gg]ame [Oo]ver|[Ww]ins the game|Simulation complete/ {
            buf = buf $0 "\n"
            if (buf != "") {
                game_num++
                f = logs_dir "/" job_id "_game_" game_num ".txt"
                print buf > f
                close(f)
                buf = ""
            }
            next
        }
        { buf = buf $0 "\n" }
        END {
            if (buf != "") {
                game_num++
                f = logs_dir "/" job_id "_game_" game_num ".txt"
                print buf > f
                close(f)
            }
        }
    ' "$FORGE_OUTPUT" || true

    # Fallback: if no split occurred, write entire output to game_1
    if [[ ! -f "${LOGS_DIR}/${JOB_ID}_game_1.txt" ]] && [[ -s "$FORGE_OUTPUT" ]]; then
        cp "$FORGE_OUTPUT" "${LOGS_DIR}/${JOB_ID}_game_1.txt"
    fi
fi

# Ensure at least one log file exists for successful run
if [[ $FORGE_EXIT -eq 0 ]]; then
    count=$(find "$LOGS_DIR" -maxdepth 1 -name "${JOB_ID}_game_*.txt" 2>/dev/null | wc -l)
    if [[ "$count" -eq 0 ]]; then
        echo "Warning: No log files created; Forge may have produced no output" >&2
    fi
fi

exit $FORGE_EXIT
