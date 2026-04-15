#!/bin/bash
set -euo pipefail

REPO_LOWER=$(echo "${GITHUB_REPOSITORY}" | tr '[:upper:]' '[:lower:]')
echo "WORKER_IMAGE=ghcr.io/${REPO_LOWER}/worker" >> "$GITHUB_ENV"
echo "SIMULATION_IMAGE=ghcr.io/${REPO_LOWER}/simulation" >> "$GITHUB_ENV"
echo "IMAGE_NAME=ghcr.io/${REPO_LOWER}/worker" >> "$GITHUB_ENV"