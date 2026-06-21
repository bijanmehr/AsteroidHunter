#!/usr/bin/env bash
# Serve the repo root locally so the browser game (index.html) can fetch the
# Python core (src/). Open the printed URL to play.
cd "$(dirname "$0")/.." || exit 1
PORT="${1:-8000}"
echo ""
echo "  AsteroidHunter  ->  http://localhost:${PORT}/"
echo "  (Ctrl-C to stop)"
echo ""
exec python3 -m http.server "$PORT"
