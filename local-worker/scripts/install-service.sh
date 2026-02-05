#!/bin/bash
# Install the worker as a macOS LaunchAgent service

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PLIST_FILE="$WORKER_DIR/com.magicbracket.worker.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$LAUNCH_AGENTS_DIR/com.magicbracket.worker.plist"

echo "Installing Magic Bracket Worker as a LaunchAgent service..."

# Ensure LaunchAgents directory exists
mkdir -p "$LAUNCH_AGENTS_DIR"

# Copy plist file
cp "$PLIST_FILE" "$TARGET_PLIST"

# Load the service
launchctl load "$TARGET_PLIST" 2>/dev/null || launchctl load -w "$TARGET_PLIST"

echo "✓ Worker service installed and started"
echo ""
echo "To manage the service:"
echo "  Start:   launchctl start com.magicbracket.worker"
echo "  Stop:    launchctl stop com.magicbracket.worker"
echo "  Status:  launchctl list | grep magicbracket"
echo "  Logs:    tail -f $WORKER_DIR/worker.log"
echo "  Errors:  tail -f $WORKER_DIR/worker.error.log"
echo ""
echo "To uninstall:"
echo "  launchctl unload $TARGET_PLIST && rm $TARGET_PLIST"
