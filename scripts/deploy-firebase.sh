#!/bin/bash
set -euo pipefail

npx firebase-tools@latest deploy --only hosting,firestore --force
