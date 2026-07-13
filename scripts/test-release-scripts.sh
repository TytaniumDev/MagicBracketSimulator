#!/bin/bash
set -euo pipefail
python3 -m unittest discover -s .github/scripts -p '*_test.py' -v