#!/bin/bash
# Forge Simulation Engine - Entrypoint Script
# Parses CLI args, merges decks, invokes Forge sim, captures logs to /app/logs/{job_id}_game_{n}.txt
set -euo pipefail

cd /app

# Defaults
SIMULATIONS=5
USER_DECK=""
OPPONENTS=()
JOB_ID=""

# Paths
DECKS_DIR="/app/decks"
PRECONS_DIR="/app/res/precons"
# Forge looks for Commander decks in ~/.forge/decks/commander/ when -f Commander is set
# The -D flag should override this, but in practice it doesn't for format-specific modes
# So we copy decks to Forge's default Commander deck path
RUN_DECKS_DIR="/home/forge/.forge/decks/commander"
LOGS_DIR="/app/logs"
FORGE_LAUNCHER="/app/forge.sh"

usage() {
    cat <<EOF >&2
Usage: $0 --user-deck <filename> --opponents <name1> <name2> <name3> [--simulations <n>] --id <job_id>
  --user-deck   Filename of user's deck in ${DECKS_DIR} (e.g. my_deck.dck)
  --opponents   Three opponent deck names from precons (e.g. "Lorehold Legacies" "Elven Council" "Prismari Performance")
  --simulations Number of games (default: 5)
  --id          Job ID for output logs: {job_id}_game_{n}.txt
EOF
    exit 1
}

# Parse arguments (simple loop - handles --opponents with 3 following args)
while [[ $# -gt 0 ]]; do
    case "$1" in
        --user-deck)
            USER_DECK="${2:?Missing value for --user-deck}"
            shift 2
            ;;
        --opponents)
            shift
            if [[ $# -lt 3 ]]; then
                echo "Error: --opponents requires exactly 3 deck names" >&2
                exit 1
            fi
            OPPONENTS=("$1" "$2" "$3")
            shift 3
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

# Validate required args
if [[ -z "$USER_DECK" ]] || [[ ${#OPPONENTS[@]} -ne 3 ]] || [[ -z "$JOB_ID" ]]; then
    echo "Error: Missing required arguments (--user-deck, --opponents x3, --id)" >&2
    usage
fi

# Resolve opponent filename (try exact, then with .dck)
resolve_opponent() {
    local name="$1"
    if [[ -f "${PRECONS_DIR}/${name}" ]]; then
        echo "${name}"
        return
    fi
    if [[ -f "${PRECONS_DIR}/${name}.dck" ]]; then
        echo "${name}.dck"
        return
    fi
    echo "Error: Opponent deck not found: ${name} (checked ${PRECONS_DIR}/)" >&2
    exit 1
}

# Validate user deck exists
USER_DECK_PATH="${DECKS_DIR}/${USER_DECK}"
if [[ ! -f "$USER_DECK_PATH" ]]; then
    echo "Error: User deck not found: ${USER_DECK_PATH}" >&2
    exit 1
fi

# Ensure [Main] in deck for basic validation (case-insensitive: [Main], [main], etc.)
if ! grep -qi '\[main\]' "$USER_DECK_PATH"; then
    echo "Error: User deck missing [Main] section: ${USER_DECK}" >&2
    exit 1
fi

# Create ephemeral merged deck directory
rm -rf "${RUN_DECKS_DIR}"
mkdir -p "${RUN_DECKS_DIR}"

# Copy user deck (preserve filename as-is for -d)
cp "$USER_DECK_PATH" "${RUN_DECKS_DIR}/"

# Resolve and copy opponent decks
DECK_LIST=("$USER_DECK")
for opp in "${OPPONENTS[@]}"; do
    opp_file=$(resolve_opponent "$opp")
    cp "${PRECONS_DIR}/${opp_file}" "${RUN_DECKS_DIR}/"
    # Use the actual filename in /app/run/decks (might be "Buckle Up.dck" etc)
    DECK_LIST+=("$opp_file")
done

# Build -d argument list (quote names with spaces for shell)
# We pass deck filenames as they appear in RUN_DECKS_DIR
deck_args=()
for d in "${DECK_LIST[@]}"; do
    deck_args+=("$d")
done

# Ensure logs directory exists
mkdir -p "$LOGS_DIR"

echo "Forge Simulation Engine: starting ${SIMULATIONS} game(s) with ${USER_DECK} vs ${OPPONENTS[*]}" >&2

# Run Forge sim - capture stdout/stderr for log processing
# Do NOT use -q; we need full logs for Analysis Service
# -D overrides deck path; -f Commander; -n number of games
# -c 300 = 5 min timeout per game (optional, helps avoid infinite games)
FORGE_OUTPUT=$(mktemp)
trap "rm -f ${FORGE_OUTPUT}" EXIT

# xvfb-run provides a virtual display for Forge's GUI initialization (GuiDesktop static init)
# Note: Do NOT set java.awt.headless=true as it conflicts with xvfb; we want Java to use the virtual display
set +e
xvfb-run --auto-servernum --server-args="-screen 0 1024x768x24" \
    "$FORGE_LAUNCHER" sim \
    -d "${deck_args[0]}" "${deck_args[1]}" "${deck_args[2]}" "${deck_args[3]}" \
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
