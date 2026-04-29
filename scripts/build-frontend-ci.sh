#!/bin/bash
set -euo pipefail

cd frontend
npm ci
npm run build
