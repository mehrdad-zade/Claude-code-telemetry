#!/usr/bin/env bash
# Double-click launcher for macOS: opens Terminal and runs agent-tel's run.sh.
# Copy it anywhere (Desktop, Dock, ...). If you move the repo, update the
# path below.
AGENT_TEL_DIR="/Users/zade/Downloads/github.com/GitHub/agent-tel"

# Run from inside the repo, this file finds it on its own.
if [[ ! -f "$AGENT_TEL_DIR/run.sh" ]]; then
  AGENT_TEL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
fi
if [[ ! -f "$AGENT_TEL_DIR/run.sh" ]]; then
  echo "Can't find agent-tel's run.sh. Edit AGENT_TEL_DIR at the top of:"
  echo "  $0"
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

exec bash "$AGENT_TEL_DIR/run.sh" "$@"
