#!/usr/bin/env bash
# Build the pure-Python wheel into web/assets/ for GitHub Pages deployment
# (Pyodide can micropip-install it). Not needed for local play.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m build --wheel --outdir web/assets
echo "wheel -> web/assets/"
