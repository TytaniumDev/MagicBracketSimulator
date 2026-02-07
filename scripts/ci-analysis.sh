#!/bin/bash
set -e

# This script is intended to be run from the analysis-service directory
# during CI, but can also be run locally.

echo "Installing Python dependencies with uv..."
uv sync --extra dev

echo "Running pytest..."
uv run pytest
