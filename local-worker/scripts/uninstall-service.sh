#!/bin/bash
# Uninstall the worker LaunchAgent service

set -e

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$LAUNCH_AGENTS_DIR/com.magicbracket.worker.plist"

echo "Uninstalling Magic Bracket Worker service..."

if [ -f "$TARGET_PLIST" ]; then
    # Stop and unload the service
    launchctl unload "$TARGET_PLIST" 2>/dev/null || true
    # Remove the plist file
    rm "$TARGET_PLIST"
    echo "✓ Worker service uninstalled"
else
    echo "Service not found at $TARGET_PLIST"
    exit 1
fi
