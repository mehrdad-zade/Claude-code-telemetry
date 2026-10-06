import { describe, expect, it } from "vitest";
import {
  extractRequirements,
  computeSessionStats,
  sessionTokenTotal,
  splitSessionTurns,
  extractPlanRequirements,
  findPlans,
  stem,
  summarizeSession,
  validateTurn,
  wilsonInterval,
  type NormalizedEvent,
  type TurnValidation,
} from "@agent-tel/shared";

let seq = 0;
function base(kind: string) {
  seq++;
  return { id: `e${seq}`, agentId: "s1", sessionId: "s1", timestamp: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`, seq, kind };
}
const thinking = (text: string) => ({ ...base("thinking"), kind: "thinking", text }) as NormalizedEvent;
const reply = (text: string) => ({ ...base("text"), kind: "text", text, isHumanPrompt: false }) as NormalizedEvent;
const call = (id: string, name: string, input: unknown) =>
  ({ ...base("tool_call"), kind: "tool_call", toolUseId: id, name, input }) as NormalizedEvent;
const result = (id: string, isError = false, content: unknown = "ok") =>
  ({ ...base("tool_result"), kind: "tool_result", toolUseId: id, content, isError }) as NormalizedEvent;
const edit = (id: string, path: string, added: string) =>
  ({
    ...base("file_edit"),
    kind: "file_edit",
    toolUseId: id,
    path,
    diffHunks: [{ text: added.split("\n").map((l) => `+${l}`).join("\n"), added: 1, removed: 0 }],
  }) as NormalizedEvent;

function goodLoginTurn(): NormalizedEvent[] {
  return [
    thinking("I need to add a logout button to the header component."),
    call("t1", "Edit", { file_path: "/app/src/Header.tsx", old_string: "x", new_string: "<button>Logout</button>" }),
    result("t1"),
    edit("t1", "/app/src/Header.tsx", 'export function LogoutButton() { return <button onClick={logout}>Logout</button>; }'),
    call("t2", "Bash", { command: "npm test" }),
    result("t2"),
    reply("Added a logout button to `Header.tsx`; it calls logout on click. All tests pass."),
  ];
}

describe("extractRequirements", () => {
  it("splits bullets and compound instructions and classifies intent", () => {
    const reqs = extractRequirements("Please do these:\n- add a logout button to `Header.tsx`\n- run the test suite\n\nWhy is the build slow?");
    expect(reqs.map((r) => r.intent)).toEqual(["change", "run", "question"]);
    expect(reqs[0].artifacts).toContain("header.tsx");
  });

  it("splits 'X and then Y' into two requirements", () => {
    const reqs = extractRequirements("Add a dark mode toggle to settings and then update the README with screenshots");
    expect(reqs).toHaveLength(2);
    expect(reqs[1].terms).toContain(stem("readme"));
  });

  it("keeps a single short prompt as one requirement", () => {
    expect(extractRequirements("fix the flaky websocket reconnect")).toHaveLength(1);
  });
});

describe("validateTurn", () => {
  it("scores a fully delivered change high with high confidence", () => {
    const v = validateTurn({ promptText: "Add a logout button to the header", events: goodLoginTurn(), nextPromptText: "great, thanks! now the footer" });
    expect(v.pending).toBe(false);
    expect(v.accuracy).toBeGreaterThanOrEqual(80);
    expect(v.verdict).toBe("met");
    expect(v.confidenceLevel).toBe("high");
  });

  it("scores unresolved errors plus a failure admission low", () => {
    const events = [
      call("t1", "Bash", { command: "npm run migrate" }),
      result("t1", true, "Error: connection refused"),
      reply("I couldn't run the database migration — the connection was refused. You'll need to start Postgres first."),
    ];
    const v = validateTurn({ promptText: "Run the database migration", events });
    expect(v.accuracy).toBeLessThan(40);
    expect(v.verdict).toBe("unmet");
  });

  it("does not penalize an error that a later retry fixed", () => {
    const events = [
      call("t1", "Edit", { file_path: "/a/config.ts", old_string: "nope" }),
      result("t1", true, "old_string not found"),
      call("t2", "Edit", { file_path: "/a/config.ts", old_string: "port" }),
      result("t2"),
      edit("t2", "/a/config.ts", "export const port = 8080;"),
      reply("Updated the port in config.ts to 8080."),
    ];
    const v = validateTurn({ promptText: "Change the port in config.ts to 8080", events });
    const outcome = v.requirements[0].votes.find((x) => x.voter === "outcome")!;
    expect(outcome.p).toBeGreaterThanOrEqual(0.9);
    expect(v.verdict).toBe("met");
  });

  it("judges a question on its answer", () => {
    const answer =
      "The websocket server keeps a ring buffer per agent and replays it as a snapshot on subscribe. " +
      "After that, every normalized event is broadcast to subscribed clients, so the websocket stream is incremental. " +
      "Reconnects resubscribe and get a fresh snapshot.";
    const v = validateTurn({ promptText: "How does the websocket server replay events on subscribe?", events: [reply(answer)] });
    expect(v.requirements[0].requirement.intent).toBe("question");
    expect(v.verdict).toBe("met");
  });

  it("lowers a turn when the next prompt reports it didn't work", () => {
    const fine = validateTurn({ promptText: "Add a logout button to the header", events: goodLoginTurn(), nextPromptText: "now add a footer" });
    const corrected = validateTurn({
      promptText: "Add a logout button to the header",
      events: goodLoginTurn(),
      nextPromptText: "the logout button doesn't work, clicking it does nothing",
    });
    expect(corrected.accuracy).toBeLessThan(fine.accuracy);
    expect(corrected.requirements[0].votes.find((x) => x.voter === "followUp")!.p).toBeLessThanOrEqual(0.15);
  });

  it("abstains on reasoning when no thinking text was recorded", () => {
    const events = goodLoginTurn().map((e) => (e.kind === "thinking" ? { ...e, text: "" } : e));
    const v = validateTurn({ promptText: "Add a logout button to the header", events });
    expect(v.requirements[0].votes.find((x) => x.voter === "reasoning")!.p).toBeNull();
    expect(v.verdict).toBe("met");
  });

  it("is pending until the agent replies", () => {
    expect(validateTurn({ promptText: "Add a thing", events: [call("t1", "Bash", { command: "ls" })] }).pending).toBe(true);
    expect(validateTurn({ promptText: "Add a thing", events: goodLoginTurn(), inProgress: true }).pending).toBe(true);
  });

  it("inherits the previous prompt's requirements for a bare 'continue'", () => {
    const v = validateTurn({ promptText: "yes go ahead", previousPromptText: "Add a logout button to the header", events: goodLoginTurn() });
    expect(v.requirements[0].requirement.inherited).toBe(true);
    expect(v.verdict).toBe("met");
  });
});

describe("prompt cleanup", () => {
  it("skips bare slash commands but scores a command's arguments", () => {
    expect(validateTurn({ promptText: "<command-name>/login</command-name><command-args></command-args>", events: goodLoginTurn() }).skipped).toBe(true);
    const withArgs = validateTurn({
      promptText: "<command-name>/do</command-name><command-args>Add a logout button to the header</command-args>",
      events: goodLoginTurn(),
    });
    expect(withArgs.skipped).toBeFalsy();
    expect(withArgs.verdict).toBe("met");
  });

  it("ignores pasted terminal output when extracting requirements", () => {
    const reqs = extractRequirements(
      "the dev server doesn't start, I get this:\n$ npm run dev\nadded 1 package, and audited 300 packages in 980ms\n6 vulnerabilities (1 low, 3 moderate)\nError: listen EADDRINUSE :::4317",
    );
    expect(reqs).toHaveLength(1);
    expect(reqs[0].intent).toBe("change");
  });

  it("treats a 'still …' follow-up as a correction", () => {
    const v = validateTurn({ promptText: "Add a logout button to the header", events: goodLoginTurn(), nextPromptText: "still only two boxes showing" });
    expect(v.requirements[0].votes.find((x) => x.voter === "followUp")!.p).toBeLessThanOrEqual(0.35);
  });
});

describe("session statistics", () => {
  it("narrows the Wilson interval as requirements accumulate", () => {
    const [lo1, hi1] = wilsonInterval(4, 5);
    const [lo2, hi2] = wilsonInterval(40, 50);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
    expect(lo2).toBeLessThan(0.8);
    expect(hi2).toBeGreaterThan(0.8);
  });

  it("final validation counts only the latest attempt at a re-addressed requirement", () => {
    const failed = validateTurn({
      promptText: "Add a logout button to the header",
      events: [reply("I couldn't add the logout button — the header component failed to compile.")],
      nextPromptText: "the logout button in the header is still missing, add it",
    });
    const fixed = validateTurn({ promptText: "the logout button in the header is still missing, add it", events: goodLoginTurn() });
    expect(failed.verdict).toBe("unmet");
    const s = summarizeSession([failed, fixed]);
    expect(s.superseded).toBe(1);
    expect(s.requirementCount).toBe(fixed.requirements.length);
    expect(s.accuracy).toBeGreaterThan(s.firstPassAccuracy);
    expect(s.unmet).toBe(0);
  });

  it("pools requirements across scored turns and skips pending ones", () => {
    const good = validateTurn({ promptText: "Add a logout button to the header", events: goodLoginTurn() });
    const pending: TurnValidation = validateTurn({ promptText: "x", events: [] });
    const other = validateTurn({ promptText: "Run the database migration", events: [call("m1", "Bash", { command: "npm run migrate" }), result("m1"), reply("Ran the database migration; all done.")] });
    const s = summarizeSession([good, other, pending]);
    expect(s.turnsScored).toBe(2);
    expect(s.requirementCount).toBe(2);
    expect(s.superseded).toBe(0);
    expect(s.met).toBe(2);
    expect(s.interval[0]).toBeLessThan(s.interval[1]);
  });
});

const PLAN = `# Add logout + session timeout

## Context
Users can't sign out and sessions never expire.

## Changes
**Edit: \`src/Header.tsx\`**
- Add a LogoutButton that calls logout on click

**New: \`src/session/timeout.ts\`**
- Expire idle sessions after 30 minutes

## Verification
- Run npm test
`;

function planCall(id: string, text = PLAN) {
  return call(id, "ExitPlanMode", { plan: text, planFilePath: "/Users/me/.claude/plans/logout.md" });
}

describe("plan mode", () => {
  it("parses a plan's work sections into requirements and skips context/verification", () => {
    const reqs = extractPlanRequirements(PLAN);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.source === "plan" && r.intent === "change")).toBe(true);
    expect(reqs[0].artifacts).toContain("src/header.tsx");
    expect(reqs[1].text).toMatch(/Expire idle sessions/);
  });

  it("reads plan status, the approved text and rejection feedback", () => {
    const approvedText = PLAN.replace("30 minutes", "15 minutes");
    const approved = findPlans([planCall("p1"), result("p1", false, `User has approved your plan.\n\n## Approved Plan:\n${approvedText}`)])[0];
    expect(approved.status).toBe("approved");
    expect(approved.text).toContain("15 minutes");
    expect(approved.title).toBe("Add logout + session timeout");

    const rejected = findPlans([planCall("p2"), result("p2", true, "The user doesn't want to proceed with this tool use. the user said:\nuse 10 minutes instead")])[0];
    expect(rejected.status).toBe("rejected");
    expect(rejected.feedback).toBe("use 10 minutes instead");
    expect(findPlans([planCall("p3")])[0].status).toBe("pending");
  });

  it("adds the approved plan's steps to validation, judged on work after approval", () => {
    const events = [
      call("w1", "Write", { file_path: "/Users/me/.claude/plans/logout.md", content: PLAN }),
      result("w1"),
      planCall("p1"),
      result("p1", false, "User has approved your plan."),
      ...goodLoginTurn(),
    ];
    const v = validateTurn({ promptText: "Add a logout button to the header", events });
    expect(v.plan?.status).toBe("approved");
    const planReqs = v.requirements.filter((r) => r.requirement.source === "plan");
    expect(planReqs).toHaveLength(2);
    // Header step was implemented; the timeout module was never written.
    expect(planReqs[0].verdict).toBe("met");
    expect(planReqs[1].score).toBeLessThan(planReqs[0].score);
    expect(v.planAccuracy).toBeLessThan(v.promptAccuracy!);
    // Instruction and plan count equally.
    expect(Math.abs(v.accuracy - (v.promptAccuracy! + v.planAccuracy!) / 2)).toBeLessThanOrEqual(1);
  });

  it("does not let the plan text or plan file count as evidence", () => {
    const events = [planCall("p1"), result("p1", false, "User has approved your plan."), reply("Plan approved; done.")];
    const v = validateTurn({ promptText: "Add session timeout to src/session/timeout.ts", events });
    const coverage = v.requirements[0].votes.find((x) => x.voter === "coverage")!;
    expect(coverage.p ?? 0).toBeLessThan(0.2);
  });

  it("carries an approved plan into a bare 'go ahead' next turn", () => {
    const plan = findPlans([planCall("p1"), result("p1", false, "User has approved your plan.")])[0];
    const v = validateTurn({ promptText: "go ahead", previousPromptText: "Add a logout button", events: goodLoginTurn(), carriedPlan: plan });
    expect(v.requirements.every((r) => r.requirement.source === "plan")).toBe(true);
    expect(v.plan?.inherited).toBe(true);
  });
});

describe("whole-session scoring", () => {
  const prompt = (text: string, agentId = "s1") => ({ ...base("text"), agentId, kind: "text", text, isHumanPrompt: true }) as NormalizedEvent;

  it("splits turns at human prompts and folds sub-agent work into its time window", () => {
    const p1 = prompt("Add a logout button to the header");
    const sub = { ...reply("sub-agent finding"), agentId: "sub1" } as NormalizedEvent;
    const r1 = reply("Added it.");
    const p2 = prompt("now add a footer");
    const turns = splitSessionTurns([p1, sub, r1, p2, reply("Footer added.")], "s1");
    expect(turns).toHaveLength(2);
    expect(turns[0].events.map((e) => e.id)).toEqual([sub.id, r1.id]);
    expect(turns[1].prompt?.text).toBe("now add a footer");
  });

  it("counts each API message's tokens once across all agents", () => {
    const usage = { input: 10, output: 20, cacheWrite: 5, cacheRead: 1000 };
    const a = { ...reply("a"), messageId: "m1", usage } as NormalizedEvent;
    const b = { ...thinking("b"), messageId: "m1", usage } as NormalizedEvent; // same message, another line
    const c = { ...reply("c"), agentId: "sub1", messageId: "m2", usage } as NormalizedEvent;
    expect(sessionTokenTotal([a, b, c])).toBe(70); // (10+20+5) × 2 messages, cache reads excluded
  });

  it("computes the sidebar stats: final validation + total tokens", () => {
    const events = [prompt("Add a logout button to the header"), ...goodLoginTurn()];
    const stats = computeSessionStats(events, "s1");
    expect(stats.validation?.accuracy).toBeGreaterThanOrEqual(70);
    expect(stats.totalTokens).toBe(0);
    expect(computeSessionStats([prompt("hello")], "s1").validation).toBeNull();
  });
});
