#!/usr/bin/env bash
# One-command launcher for agent-tel: installs/builds whatever is missing or
# stale, starts the server, and opens the dashboard in a browser — on macOS
# Safari if it's already running, otherwise Chrome (falling back to the default
# browser); elsewhere the default browser.
#
#   ./run.sh         production-style: build web, serve everything on one port
#   ./run.sh --dev   hot-reloading dev servers (npm run dev)
set -euo pipefail

cd "$(dirname "$0")"

MODE="prod"
if [[ "${1:-}" == "--dev" ]]; then MODE="dev"; fi

PORT="${AGENT_TEL_PORT:-4317}"
API_URL="http://127.0.0.1:${PORT}/api/sessions"
if [[ "$MODE" == "dev" ]]; then
  APP_URL="http://localhost:5173"
else
  APP_URL="http://127.0.0.1:${PORT}"
fi

log() { printf '\033[1;34m[agent-tel]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[agent-tel]\033[0m %s\n' "$*" >&2; exit 1; }

# --- prerequisites -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    die "Node.js 20+ is required. Install it with: brew install node"
  fi
  die "Node.js 20+ is required. Install it from https://nodejs.org"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  die "Node.js 20+ is required (found $(node -v)). Upgrade with: brew upgrade node"
fi
command -v npm >/dev/null 2>&1 || die "npm not found (it normally ships with Node.js)."
command -v curl >/dev/null 2>&1 || die "curl not found."

[[ -d "$HOME/.claude" ]] || log "warning: ~/.claude not found — run Claude Code at least once so there's something to show."

# --- dependencies ------------------------------------------------------------
if [[ ! -d node_modules || ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  log "Installing dependencies..."
  npm install
else
  log "Dependencies up to date."
fi

# --- build (prod only) -------------------------------------------------------
if [[ "$MODE" == "prod" ]]; then
  DIST_INDEX="packages/web/dist/index.html"
  if [[ ! -f "$DIST_INDEX" ]] \
    || [[ -n "$(find packages/web/src packages/web/index.html packages/web/vite.config.ts packages/shared/src -newer "$DIST_INDEX" -print -quit 2>/dev/null)" ]]; then
    log "Building web frontend..."
    npm run build
  else
    log "Web build up to date."
  fi
fi

# --- browser -----------------------------------------------------------------
open_browser() {
  case "$(uname -s)" in
    Darwin)
      if pgrep -xq Safari; then
        log "Safari is running — opening $1 in Safari."
        open -a Safari "$1"
      elif open -Ra "Google Chrome" 2>/dev/null; then
        log "Opening $1 in Chrome."
        open -a "Google Chrome" "$1"
      else
        log "Chrome not found — opening $1 in the default browser."
        open "$1"
      fi
      ;;
    MINGW* | MSYS* | CYGWIN*)
      log "Opening $1 in the default browser."
      cmd.exe //c start "" "$1"
      ;;
    *)
      log "Opening $1 in the default browser."
      xdg-open "$1" >/dev/null 2>&1 || log "Open $1 in your browser."
      ;;
  esac
}

# Polls until the app answers, then opens the browser. Runs in the background
# while the server owns the foreground, so Ctrl+C reaches every child process.
open_when_ready() {
  local wait_url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "$wait_url" 2>/dev/null; then
      log "Ready at ${APP_URL} — press Ctrl+C to stop."
      open_browser "$APP_URL"
      return 0
    fi
    sleep 0.5
  done
  log "warning: ${wait_url} didn't answer within 30s — is port ${PORT} taken by something else?"
}

# --- already running? --------------------------------------------------------
if [[ "$MODE" == "prod" ]] && curl -fsS -o /dev/null "$API_URL" 2>/dev/null; then
  log "agent-tel is already running on port ${PORT}."
  open_browser "$APP_URL"
  exit 0
fi

# --- start -------------------------------------------------------------------
if [[ "$MODE" == "dev" ]]; then
  log "Starting dev servers (API :${PORT}, web :5173)..."
  open_when_ready "$APP_URL" &
  exec npm run dev
else
  log "Starting server on port ${PORT}..."
  open_when_ready "$API_URL" &
  exec npx tsx packages/server/src/index.ts
fi
