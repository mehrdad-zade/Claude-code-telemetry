# agent-tel

A local, real-time dashboard for everything Claude Code is doing on your Mac: every active
session, every sub-agent it spawns, their raw thinking/tool calls/file edits as they happen, and
the hand-offs between agents — plus scrollback/replay of past sessions.

It works entirely by reading Claude Code's own on-disk state under `~/.claude/` (session
registry + per-session JSONL transcripts). No Claude Code plugin, API key, or network access is
required, and this tool makes **no outbound network calls** — it binds to `127.0.0.1` only,
since transcripts can contain file contents/secrets from any of your projects.

## Requirements

- Node.js 20+
- Claude Code already installed and used at least once (so `~/.claude/` exists)

## Run it

Quickest way — one command that installs dependencies and builds if needed, starts the server,
and opens the dashboard (in Safari if it's already running, otherwise Chrome):

```bash
./run.sh          # single process on http://127.0.0.1:4317
./run.sh --dev    # hot-reloading dev servers, opens http://localhost:5173
```

Or manually:

```bash
npm install
npm run dev
```

This starts two things: the backend on `http://127.0.0.1:4317` (API + WebSocket only — no page to
show) and the frontend dev server on **http://localhost:5173** (proxying `/api` and `/ws` to the
backend).

**Open http://localhost:5173 in your browser — not 4317.** Port 4317 has no HTML to serve until
you run `npm run build`, so opening it directly in dev mode shows Express's "Cannot GET /".

Once you're on the right port, any Claude Code session you have running elsewhere on the same Mac
should show up in the "Live" tab within a few seconds.

For a single-process production-style run:

```bash
npm run build   # builds the web frontend
npm start       # serves the API + built frontend on one port (4317)
```

## How it works

- `packages/shared` — event/data types shared by the server and the web client.
- `packages/server` — discovers live sessions (`~/.claude/sessions/*.json` + a liveness check),
  tails each session's transcript and any sub-agent transcripts it spawns
  (`~/.claude/projects/<project>/<sessionId>/subagents/agent-*.jsonl`), normalizes raw lines into
  a stable event model, and streams them to the browser over WebSocket. Also serves scrollback
  history straight from the same on-disk transcripts.
- `packages/web` — a React + React Flow dashboard: an agent graph (spawn/message edges animate
  as they happen) plus a raw live feed (thinking, tool calls + results, file diffs) for whichever
  agent is selected, with play/scrub replay controls for past sessions.

The header shows tokens used today / this week / this month (calendar, local time; input +
output + cache writes, summed from the on-disk transcripts) next to your plan's 5-hour session,
weekly, and monthly extra-usage percentages. Those percentages come from the copy of `/status`
data that Claude Code itself caches in `~/.claude.json` — agent-tel never fetches them — so they're
as fresh as the last time Claude Code refreshed them (run `/status` to update).

See `AGENT_TEL_PORT` env var to change the port (default `4317`). Set `AGENT_TEL_DEBUG=1` for
verbose server logging.
