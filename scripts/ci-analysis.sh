#!/bin/bash
set -e

# This script is intended to be run from the analysis-service directory
# during CI, but can also be run locally.
# Referenced in AGENTS.md as the SSOT for Analysis Service testing.

echo "Installing Python dependencies with uv..."
uv sync --extra dev

echo "Running pytest..."
uv run pytest
