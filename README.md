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

## What you see

- **Sidebar.** Live sessions, plus history grouped by project. It can be collapsed. Each session shows its **final validation** and the **total tokens** for the entire session, e.g. "✅ 86% final · 662k tok". Both numbers cover all agents and the full transcript. Hover for the interval, the met/partial/unmet counts and the exact token count; the path and last prompt are in the tooltip. Live sessions refresh every 15s, and history entries refresh whenever their transcript changes.
- **Header.** Tokens used today, this week and this month, next to your plan's limit percentages. See [Token usage](#token-usage).
- **Visualization.** One row per instruction, laid out as **Instruction → Activity → Response**. The left column shows the time, the turn's token total and its **validation score**:
  - **Instruction.** Your prompt. It gets a **📋 Plan** badge when the prompt was sent in plan mode, or when the agent presented a plan in that turn. Click the badge to open the plan in the log.
  - **Activity.** One box sums up all the work in the turn. When sub-agents helped, coloured dots show how many agents took part. Click the box for the full breakdown (reasoning, each tool, file edits, errors, hand-offs), with **one section per agent**. Each item jumps to the log.
  - **Response.** The agent's final reply. Token counts on each box are broken down by model.
  - **Validation score.** An estimate of whether the instruction was actually delivered. Hover its **ⓘ** to see the per-requirement breakdown. See [Validation](#validation).
- **Log.** The full event feed for the selected agent, grouped by turn. The **▾** button in its header minimizes it to a bar at the bottom of the screen, giving the Visualization the full height. **▴** restores it, and so does clicking any item that jumps to the log:
  - Prompts, reasoning, tool calls with their results, and file diffs.
  - Plans presented in plan mode, shown as readable cards with their approval status.
  - Tools get readable layouts instead of raw JSON. Browser automation shows as steps ("left_click (85, 96) — Opens the session") with screenshots inline. `AskUserQuestion` shows its questions and options, `Agent` its sub-agent and prompt, and todo lists as checklists. Every other tool's input appears as a key/value list, and JSON results are pretty-printed.

## Validation

Each turn is scored for how well what was asked matches what was done. Each turn's score appears in the row's left column. The session's **final validation** appears next to the Visualization heading:

```
Final validation 84% · 90% CI 72–100 · 7 met / 0 partial / 0 unmet · 1 redone · confidence medium
```

The final validation is the session's **end state**. Requirements from every scored turn (and approved plan) are taken in order. When a later turn re-addresses an earlier requirement (a correction, a fix, or a repeat), the earlier attempt is *superseded* and only the latest attempt counts. A later requirement counts as re-addressing an earlier one when they share at least 40% of their key terms, or share a file or identifier plus 20% of their terms. So a bug you reported and the agent then fixed ends the session as met.

Hover the summary's **ⓘ** to see:
- the final stats: score, interval, met/partial/unmet counts, how many attempts were superseded, *first-pass accuracy* (every attempt as originally scored), turns scored and vote confidence;
- the table of voters, the signal each one looks at, and its weight.

The scoring is a **local, deterministic heuristic**. No model or API is called, nothing leaves your machine, and the same transcript always gets the same score. It runs in the browser and recomputes as new events stream in. A turn shows *validating…* until the agent's final reply lands, then it's scored.

### How a turn is scored

1. **Requirements.** Your prompt is split into requirements: sentences, bullets, and compound instructions such as "add X and then update Y".
   - Each requirement gets key terms, explicit artifacts (file paths, `code`, "quoted" text, URLs), and an intent: *change*, *run*, *question* or *other*.
   - A bug report ("X doesn't show") is treated as a request to fix it.
   - Pasted terminal output and stack traces are ignored.
   - A bare "yes, go ahead" inherits the previous prompt's requirements.
   - Bare slash commands such as `/login` aren't scored.
2. **Plan requirements (plan mode).** If you approved a plan in the turn, its steps become a second set of requirements.
   - Steps come from the bullets, numbered steps, table rows and **bold file headings** in the plan's work sections. Context, Verification, Reuse and Risks sections are skipped.
   - Plan steps are judged only on the work done **after** you approved the plan.
   - The plan text and its file in `~/.claude/plans/` never count as evidence.
   - Your instruction and the plan count equally in the turn score, and the panel shows both sub-scores.
   - A plan approved in one turn also applies when the next prompt is just "go ahead".
3. **Voters.** Seven independent voters each give every requirement a probability from 0 to 1, or abstain when they have no evidence:

   | Voter | Looks at | Weight |
   |---|---|---|
   | Coverage | Requirement terms found in tool calls and edits that **succeeded** | 0.25 |
   | Action fit | Did the activity match the intent? A *change* needs a successful edit to a relevant file. A *run* needs a command that succeeded. A *question* needs a substantive answer | 0.20 |
   | Tool outcomes | Tool errors that were never fixed by a later successful retry | 0.15 |
   | Response claim | The reply claims completion ("added", "tests pass"), or admits a problem ("couldn't", "TODO", "still failing") | 0.15 |
   | Verification | Tests, build or typecheck ran **after** the last edit, and passed | 0.10 |
   | Reasoning | Thinking or narration addressed the requirement (abstains when no thinking text was recorded) | 0.05 |
   | Follow-up | Your **next** message: a correction ("still broken", "didn't work") counts strongly against; approval or moving on counts for | 0.10 |

4. **Aggregation.**
   - A requirement's **score** is the weighted mean of the voters that didn't abstain. It is ✅ met at 70% or above, 🟡 partial from 40%, and ❌ unmet below 40%.
   - **Confidence** is how much the voters agree (1 minus the weighted standard deviation) × √(the share of voting weight that had evidence). It's labelled High, Med or Low.
   - The turn **accuracy %** is the mean requirement score.
   - **Session (final validation).** Superseded attempts are dropped; the final validation is the mean score of what's left. The range is a **90% Wilson interval** on the share of requirements met, with partial counting as half. A session with only a few requirements gets a wide range.

Hover a turn's **ⓘ** for a table with one row per requirement. Each row shows the requirement's verdict, its score, and the Coverage, Action fit, Tool outcomes, Response claim and Verification votes. Hover a cell for the voter's reason. The Reasoning and Follow-up votes appear in the score cell's tooltip. When the turn had a plan, the table splits into instruction and plan groups, and a link opens the plan in the log. The weights live in `VOTER_WEIGHTS` in `packages/shared/src/validation.ts`.

**Limits.** This measures whether the work *touched what you asked about and ran cleanly*. It does not understand whether the result is what you meant. Large turns that edit many files tend to score high on coverage. Your own follow-up message is the strongest corrective signal, so the latest turn's score can change once you reply.

## Where the data comes from and what is saved

agent-tel is **read-only**. Everything it shows is derived on the fly from files Claude Code already writes under your home directory.

### What it reads

| Source | What is read | Used for |
|---|---|---|
| `~/.claude/sessions/*.json` | Claude Code's live-session registry: pid, session id, cwd. A pid liveness check runs every 3s | The **Live** list |
| `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | The main transcript, one JSON object per line: prompts (with `origin` and `permissionMode`), assistant text, thinking, `tool_use` / `tool_result` blocks, model and token `usage` | The Visualization, the log, token counts, **validation**, history |
| `~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-*.jsonl` | Sub-agent transcripts, in the same format | Per-agent Activity boxes and the agent tree |
| `~/.claude/projects/*/…` (all projects) | `usage` on assistant messages, deduped by message id | The header's today / week / month token totals |
| `~/.claude.json` | The `/status` plan-usage data that Claude Code caches there | The header's plan-limit percentages |

`<encoded-cwd>` is the project path with every non-alphanumeric character replaced by `-`, which is how Claude Code names these directories.

**Plan mode** has no separate source. It is read from the same transcripts:
- the `permissionMode: "plan"` field on prompt lines;
- the `ExitPlanMode` tool call, which carries the full plan and its `planFilePath`;
- that call's tool result, which says whether you approved it (including any edits you made) or rejected it (with your feedback).

agent-tel shows the plan text recorded in the transcript. It does not read `~/.claude/plans/` itself.

### What it saves

**Nothing.** There is no database, no cache file and no browser storage:
- **Sidebar stats.** `GET /api/sessions/:id/stats` replays the session's full transcripts and scores them with the same shared code the browser uses. The result is cached **in memory** and recomputed only when a transcript file's size or modification time changes, and at most every 10s for a live session. It is never written to disk.
- **Server.** Keeps a bounded in-memory ring buffer of recent events per live agent (500 events), so a newly opened tab gets an instant snapshot. Ended sessions are dropped from memory after 5 minutes, and history is re-read from disk on demand.
- **Browser.** Keeps the selected session's events in memory, up to 3000 per session. Turns, token breakdowns and **validation scores are recomputed** from those events and are never stored.
- **Only filesystem side effect.** It creates `~/.claude/sessions/` if it doesn't exist yet, so the watcher has a directory to watch.
- **Network.** It makes no outbound calls and binds to `127.0.0.1` only. Closing agent-tel discards everything; restarting it rebuilds the same view from `~/.claude/`.

## How it works

- **`packages/shared`.** The event model shared by the server and the browser (`events.ts`), plus the pure logic both sides use:
  - plan-mode parsing (`plan.ts`);
  - the validation scorer and whole-session scoring (`validation.ts`). The browser's live view and the server's sidebar stats both use it, so they always score a session the same way.
- **`packages/server`.** Express and WebSocket on `127.0.0.1`.
  - Discovers live sessions and tails each transcript and its sub-agent transcripts.
  - `normalize/normalizer.ts` is the **only** code that knows the raw JSONL shape. It turns raw lines into normalized events: `thinking`, `text`, `tool_call`, `tool_result`, `file_edit`, `agent_spawn`, and so on.
  - Streams events to the browser and serves history replay and usage totals from the same files.
- **`packages/web`.** React and Vite.
  - Builds turn rows (`lib/turnGroups.ts`), the activity breakdowns, and the per-turn validation from the event stream.
  - Renders the Visualization, the log and the header.

### Token usage

The header shows tokens used today, this week and this month. Periods are calendar-based in local time, and "tokens" means input + output + cache writes, summed from the on-disk transcripts. Next to them are your plan's 5-hour session, weekly and monthly extra-usage percentages. Those percentages come from the copy of `/status` data that Claude Code caches in `~/.claude.json`; agent-tel never fetches them. They're only as fresh as the last time Claude Code refreshed them, so run `/status` to update.

## Configuration and tests

- `AGENT_TEL_PORT` changes the port (default `4317`).
- `AGENT_TEL_DEBUG=1` turns on verbose server logging.
- `npm test` runs the server's vitest suite, including the normalizer and validation tests.
