#!/bin/bash
set -euo pipefail

npm ci
npm ci --prefix api
