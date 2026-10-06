// Local, deterministic "did the agent do what was asked?" scorer.
//
// No model calls: each human prompt is split into requirements, and a small
// ensemble of independent heuristic voters (coverage, action fit, tool
// outcomes, the response's own claims, verification runs, reasoning, and the
// user's next message) each vote a probability that the requirement was met.
// The weighted mean is the score; how much the voters agree — and how many of
// them had evidence to vote at all — is the confidence. Pure functions over
// NormalizedEvents, so it runs live in the browser and in server tests alike.

import { totalTokens, type NormalizedEvent, type TextEvent, type TokenUsage, type ToolCallEvent, type ToolResultEvent } from "./events.js";
import { PLAN_TOOL_NAME, findPlans, isPlanFilePath, type PlanInfo, type PlanStatus } from "./plan.js";

export type RequirementIntent = "change" | "run" | "question" | "other";
export type Verdict = "met" | "partial" | "unmet";
export type ConfidenceLevel = "high" | "medium" | "low";

export type VoterName =
  | "coverage"
  | "actionFit"
  | "outcome"
  | "responseClaim"
  | "verification"
  | "reasoning"
  | "followUp";

/** Relative say each voter gets. Tune here. */
export const VOTER_WEIGHTS: Record<VoterName, number> = {
  coverage: 0.25,
  actionFit: 0.2,
  outcome: 0.15,
  responseClaim: 0.15,
  verification: 0.1,
  reasoning: 0.05,
  followUp: 0.1,
};

export const VOTER_LABELS: Record<VoterName, string> = {
  coverage: "Coverage",
  actionFit: "Action fit",
  outcome: "Tool outcomes",
  responseClaim: "Response claim",
  verification: "Verification",
  reasoning: "Reasoning",
  followUp: "Follow-up",
};

/** What each voter looks at, in one line — shown in the UI's voter table. */
export const VOTER_SIGNALS: Record<VoterName, string> = {
  coverage: "Requirement terms found in tool calls and edits that succeeded",
  actionFit: "Activity matches the intent: a change needs a relevant edit, a run needs a successful command, a question needs a real answer",
  outcome: "No tool errors left unresolved by a later successful retry",
  responseClaim: "The reply claims completion, or admits a failure / TODO",
  verification: "Tests, build or typecheck ran after the last edit and passed",
  reasoning: "Thinking or narration addressed the requirement",
  followUp: "Your next message: a correction counts against, approval or moving on counts for",
};

const MET_THRESHOLD = 0.7;
const PARTIAL_THRESHOLD = 0.4;
const MAX_REQUIREMENTS = 8;
const MAX_PLAN_REQUIREMENTS = 15;

export interface Requirement {
  text: string;
  intent: RequirementIntent;
  /** Stemmed content words. */
  terms: string[];
  /** Explicit file paths, `code`, "quoted" strings, URLs (lowercased). */
  artifacts: string[];
  /** True when the prompt was a bare "continue"/"yes" and these were
   * inherited from the previous prompt (or the previous turn's plan). */
  inherited?: boolean;
  /** Where the requirement came from: your instruction, or the plan you
   * approved in plan mode. */
  source: "prompt" | "plan";
}

export interface VoterResult {
  voter: VoterName;
  /** Probability the requirement was met, or null when the voter abstains. */
  p: number | null;
  reason: string;
}

export interface EvidenceRef {
  agentId: string;
  eventId: string;
  label: string;
}

export interface RequirementVerdict {
  requirement: Requirement;
  score: number;
  verdict: Verdict;
  confidence: number;
  votes: VoterResult[];
  evidence: EvidenceRef[];
}

export interface TurnValidation {
  /** No response yet (turn still running, or interrupted before replying). */
  pending: boolean;
  /** Not a task to judge: a bare slash command (/login, /model) or its output. */
  skipped?: boolean;
  requirements: RequirementVerdict[];
  /** 0–100. */
  accuracy: number;
  verdict: Verdict;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  /** 0–100 over the instruction's own requirements. */
  promptAccuracy?: number;
  /** 0–100 over the approved plan's requirements, when there is one. */
  planAccuracy?: number;
  /** The plan presented in this turn (the approved one if any). */
  plan?: { eventId: string; agentId: string; title: string; status: PlanStatus; inherited?: boolean };
}

export interface SessionValidation {
  turnsScored: number;
  /** Requirements in the final tally (each one's latest attempt). */
  requirementCount: number;
  met: number;
  partial: number;
  unmet: number;
  /** 0–100: the session's final validation — mean score of every
   * requirement's latest attempt, after later turns redo or fix earlier ones. */
  accuracy: number;
  /** 0–100: mean over every attempt as first scored, before any redo. */
  firstPassAccuracy: number;
  /** Earlier requirements replaced by a later turn that re-addressed them. */
  superseded: number;
  /** 90% Wilson interval (0–100) on the share of requirements met. */
  interval: [number, number];
  confidence: number;
  confidenceLevel: ConfidenceLevel;
}

export interface ValidateTurnInput {
  promptText?: string;
  /** Every event in the turn — main agent and any sub-agents. */
  events: NormalizedEvent[];
  /** The user's next prompt, if any — the strongest real-world signal. */
  nextPromptText?: string;
  /** Used when this prompt is a bare continuation ("yes", "go on"). */
  previousPromptText?: string;
  /** The turn is still running (live session, latest row). */
  inProgress?: boolean;
  /** An approved plan from the previous turn, applied when this prompt is a
   * bare continuation ("go ahead") — implementation spilling over turns. */
  carriedPlan?: PlanInfo;
}

// ---------------------------------------------------------------------------
// Text utilities

const STOPWORDS = new Set(
  `a an the and or but if then else so to of in on at by for with from into onto over under about as is are was were be been being
  am do does did done doing have has had having it its this that these those there here i me my mine we us our you your yours he she
  they them their what which who whom whose when where why how all any both each few more most other some such no nor not only own same
  than too very can could will would shall should may might must just also please pls want wanted need needs like make sure ok okay
  let lets get got give us via etc thing things something stuff way really actually now currently still able use using used one two new
  i'd i'm i've you're it's don't dont can't cant won't wont`.split(/\s+/).filter(Boolean),
);

export function stem(word: string): string {
  let w = word;
  for (const suffix of ["ations", "ation", "ings", "ing", "ies", "ers", "er", "ed", "es", "ly", "s"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      if (suffix === "ies") w = w.slice(0, -3) + "y";
      else if (suffix.startsWith("ation")) w = w.slice(0, -suffix.length) + "at";
      else w = w.slice(0, -suffix.length);
      break;
    }
  }
  // "migrate"/"migration"/"migrated" -> "migrat"
  return w.length > 4 && w.endsWith("e") ? w.slice(0, -1) : w;
}

function contentTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z0-9']*/g) ?? [];
  return words.filter((w) => w.length > 2 && !STOPWORDS.has(w)).map(stem);
}

function termSet(text: string): Set<string> {
  return new Set(contentTerms(text));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function stringify(value: unknown, max: number): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, max);
  try {
    return JSON.stringify(value).slice(0, max);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Requirement extraction

const CHANGE_VERBS =
  /\b(add|adds|adding|create|creating|build|implement|fix|fixing|update|change|modify|remove|delete|rename|refactor|replace|move|write|make|generate|introduce|support|convert|migrate|extract|split|merge|improve|clean|set ?up|wire|hook|display|show|render|style|expand|collapse|enable|disable|allow|prevent|validate)\b/i;
const RUN_VERBS = /\b(run|test|execute|deploy|install|start|launch|commit|push|publish|benchmark|lint|typecheck|compile)\b/i;
const QUESTION_START = /^(what|why|how|where|when|which|who|is|are|does|can you (explain|tell)|explain|describe|tell me|show me how|walk me through)\b/i;

/** "X doesn't show", "nothing is running", "getting an error" — a bug report
 * is an implicit request to fix it. */
const PROBLEM_REPORT =
  /\b(doesn'?t|does not|isn'?t|is not|aren'?t|are not|won'?t|can'?t|cannot|not (?:showing|shown|working|clickable|visible|loading|rendering|updating)|nothing (?:is|happens|shows)|none of|no (?:details?|data|output)|only (?:shows?|showing)|broken|error|crash(?:es|ed)?|fails?|failing|empty|missing|wrong)\b/i;

function classifyIntent(clause: string): RequirementIntent {
  if (QUESTION_START.test(clause.trim()) && !PROBLEM_REPORT.test(clause)) return "question";
  if (CHANGE_VERBS.test(clause) || PROBLEM_REPORT.test(clause)) return "change";
  if (RUN_VERBS.test(clause)) return "run";
  if (/\?\s*$/.test(clause)) return "question";
  return "other";
}

function extractArtifacts(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) found.add(m[1].trim().toLowerCase());
  for (const m of text.matchAll(/"([^"\n]{3,60})"/g)) found.add(m[1].trim().toLowerCase());
  for (const m of text.matchAll(/https?:\/\/[^\s)]+/g)) found.add(m[0].toLowerCase());
  for (const m of text.matchAll(/(?:[\w.-]+\/)+[\w.-]+|\b[\w-]+\.(?:tsx?|jsx?|py|md|json|css|scss|html|go|rs|java|rb|sh|ya?ml|toml|sql|swift|kt)\b/g)) {
    if (!m[0].startsWith("http")) found.add(m[0].toLowerCase());
  }
  return [...found];
}

function cleanPrompt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "");
}

/** Pasted terminal output, stack traces and log lines are context for the
 * request, not requirements in their own right. */
const LOG_LINE =
  /^(?:\$|>|#|at\s|npm (?:warn|err|notice)|warn|error:|info\b|debug\b|\[[\w:. -]+\]|\d+ (?:packages?|vulnerabilit)|added \d+ packages?|run `npm|to address|found \d+)|[\w.-]+@[\w.-]+:\S*\s*\w*\$|^\S+:\d+(?::\d+)?\b/i;

function isLogLine(line: string): boolean {
  if (LOG_LINE.test(line)) return true;
  const letters = (line.match(/[a-z]/gi) ?? []).length;
  return line.length > 20 && letters / line.length < 0.45;
}

function splitClauses(text: string): string[] {
  const clauses: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) clauses.push(...paragraph.join(" ").split(/(?<=[.!?])\s+/));
    paragraph = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line && isLogLine(line)) {
      flush();
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      flush();
      clauses.push(bullet[1]);
    } else paragraph.push(line);
  }
  flush();

  // Split compound instructions ("add X and then wire Y", "fix A; test B").
  const parts: string[] = [];
  for (const clause of clauses) {
    for (const piece of clause.split(/;|\b(?:and then|and also|then also|then|also|plus)\b/i)) {
      const sub = piece.split(/,?\s+and\s+/i);
      // Only split on a bare "and" when every side reads as its own instruction.
      if (sub.length > 1 && sub.every((s) => contentTerms(s).length >= 2 && (CHANGE_VERBS.test(s) || RUN_VERBS.test(s)))) {
        parts.push(...sub);
      } else parts.push(piece);
    }
  }

  // Fold fragments with too little content into the previous clause.
  const merged: string[] = [];
  for (const p of parts.map((s) => s.trim()).filter((s) => s && !isLogLine(s))) {
    if (merged.length && contentTerms(p).length < 2) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  if (merged.length > MAX_REQUIREMENTS) {
    const tail = merged.splice(MAX_REQUIREMENTS - 1).join(" ");
    merged.push(tail);
  }
  return merged;
}

export function extractRequirements(promptText: string | undefined): Requirement[] {
  if (!promptText?.trim()) return [];
  const artifactsAll = extractArtifacts(promptText);
  const cleaned = cleanPrompt(promptText);
  const clauses = splitClauses(cleaned);
  const reqs = clauses
    .map((text) => {
      const artifacts = artifactsAll.filter((a) => text.toLowerCase().includes(a));
      return {
        text,
        intent: classifyIntent(text),
        terms: [...new Set(contentTerms(text))],
        artifacts: artifacts.length ? artifacts : extractArtifacts(text),
        source: "prompt" as const,
      };
    })
    .filter((r) => r.terms.length > 0 || r.artifacts.length > 0);
  if (reqs.length === 0) {
    const text = cleaned.trim() || promptText.trim();
    return [{ text, intent: classifyIntent(text), terms: [], artifacts: [], source: "prompt" }];
  }
  return reqs;
}

/** Plan sections that explain or verify rather than commit to work. */
const SKIP_PLAN_SECTION =
  /\b(context|background|why|motivation|problem|reuse|reusing|existing|verification|verify|testing|test plan|how to test|notes?|risks?|alternatives?|out of scope|non-goals?|open questions?|summary|overview|assumptions?|references?)\b/i;
const KEEP_PLAN_SECTION = /\b(changes?|implementation|steps?|files?|approach|tasks?|work)\b/i;

/** Turns an approved plan into requirements: each top-level bullet, numbered
 * step, table row, or **bold lead** (with the bullets under it) in the
 * sections that commit to work. Context/verification/reuse sections are
 * skipped. Falls back to sentence splitting for a plan with no structure. */
export function extractPlanRequirements(planText: string): Requirement[] {
  const items: string[] = [];
  let skip = false;
  let inFence = false;
  let current: string | null = null;
  let currentIsLead = false;
  let prevWasRow = false;
  const push = () => {
    if (current) items.push(current);
    current = null;
    currentIsLead = false;
  };

  for (const raw of planText.split("\n")) {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = raw.match(/^\s*#{1,6}\s+(.*)$/);
    if (heading) {
      push();
      skip = SKIP_PLAN_SECTION.test(heading[1]) && !KEEP_PLAN_SECTION.test(heading[1]);
      prevWasRow = false;
      continue;
    }
    const line = raw.trim();
    if (skip || !line) {
      if (!line) prevWasRow = false;
      continue;
    }
    if (/^\|.*\|$/.test(line)) {
      // First row of a table is its header; separator rows carry nothing.
      const isHeader = !prevWasRow;
      prevWasRow = true;
      if (isHeader || /^\|[\s:|-]+\|$/.test(line)) continue;
      push();
      items.push(line.split("|").map((c) => c.trim()).filter(Boolean).join(" — "));
      continue;
    }
    prevWasRow = false;
    const indent = raw.length - raw.trimStart().length;
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (!bullet && /^\*\*[^*]+\*\*/.test(line)) {
      push();
      current = line;
      currentIsLead = true;
    } else if (bullet) {
      if (current && (currentIsLead || indent > 0)) current += `; ${bullet[1]}`;
      else {
        push();
        current = bullet[1];
      }
    } else if (current && currentIsLead) {
      current += ` ${line}`;
    }
  }
  push();

  if (items.length === 0) return extractRequirements(planText).map((r) => ({ ...r, source: "plan" as const }));

  return items
    .map((item): Requirement => {
      const text = item.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
      const intent = classifyIntent(text);
      return {
        text,
        intent: intent === "run" ? "run" : "change",
        terms: [...new Set(contentTerms(text.replace(/`[^`]*`/g, " ")))],
        artifacts: extractArtifacts(item),
        source: "plan",
      };
    })
    .filter((r) => r.terms.length >= 2 || r.artifacts.length > 0)
    .slice(0, MAX_PLAN_REQUIREMENTS);
}

// ---------------------------------------------------------------------------
// Evidence

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const VERIFY_CMD =
  /\b(test|tests|vitest|jest|pytest|mocha|tsc|typecheck|type-check|build|lint|eslint|cargo (?:test|build|check)|go (?:test|build|vet)|mvn|gradle|make)\b/i;

interface Action {
  call: ToolCallEvent;
  result?: ToolResultEvent;
  text: string;
  terms: Set<string>;
  index: number;
}

interface TurnEvidence {
  actions: Action[];
  edits: Array<{ agentId: string; eventId: string; path: string; text: string; terms: Set<string>; index: number }>;
  responseText: string;
  responseEvent?: NormalizedEvent;
  responseSentences: string[];
  reasoningText: string;
  reasoningTerms: Set<string>;
}

function targetKey(call: ToolCallEvent): string {
  const input = (call.input ?? {}) as Record<string, unknown>;
  const target =
    (input.file_path as string) ??
    (input.notebook_path as string) ??
    (input.path as string) ??
    (typeof input.command === "string" ? input.command.trim().split(/\s+/).slice(0, 2).join(" ") : undefined) ??
    (input.pattern as string) ??
    (input.url as string) ??
    "";
  return `${call.name}:${target}`;
}

function planTarget(call: ToolCallEvent): string | undefined {
  const input = (call.input ?? {}) as Record<string, unknown>;
  return typeof input.file_path === "string" ? input.file_path : undefined;
}

function gatherEvidence(events: NormalizedEvent[]): TurnEvidence {
  const results = new Map<string, ToolResultEvent>();
  for (const e of events) if (e.kind === "tool_result") results.set(e.toolUseId, e);

  const actions: Action[] = [];
  const edits: TurnEvidence["edits"] = [];
  const reasoning: string[] = [];
  let responseEvent: NormalizedEvent | undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "text" && !e.isHumanPrompt && e.text.trim()) {
      responseEvent = e;
      break;
    }
  }

  events.forEach((e, index) => {
    // The plan itself and its scratch file aren't evidence of doing the work
    // — counting them would let a plan "cover" its own requirements.
    if (e.kind === "tool_call" && (e.name === PLAN_TOOL_NAME || isPlanFilePath(planTarget(e)))) return;
    if (e.kind === "file_edit" && isPlanFilePath(e.path)) return;
    if (e.kind === "tool_call") {
      const text = `${e.name} ${stringify(e.input, 4000)}`;
      actions.push({ call: e, result: results.get(e.toolUseId), text: text.toLowerCase(), terms: termSet(text), index });
    } else if (e.kind === "file_edit") {
      const added = e.diffHunks
        .flatMap((h) => h.text.split("\n"))
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
        .join("\n")
        .slice(0, 6000);
      const text = `${e.path} ${added}`;
      edits.push({ agentId: e.agentId, eventId: e.id, path: e.path, text: text.toLowerCase(), terms: termSet(text), index });
    } else if (e.kind === "thinking" && e.text) {
      reasoning.push(e.text);
    } else if (e.kind === "text" && !e.isHumanPrompt && e !== responseEvent && e.text) {
      reasoning.push(e.text);
    }
  });

  const responseText = responseEvent && responseEvent.kind === "text" ? responseEvent.text : "";
  const reasoningText = reasoning.join("\n");
  return {
    actions,
    edits,
    responseText,
    responseEvent,
    responseSentences: responseText.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim()),
    reasoningText,
    reasoningTerms: termSet(reasoningText),
  };
}

/** Share of a requirement's terms/artifacts found in a body of evidence
 * (artifacts count double). */
function overlap(req: Requirement, terms: Set<string>, rawLower: string): number {
  let hit = 0;
  let total = 0;
  for (const t of req.terms) {
    total += 1;
    if (terms.has(t)) hit += 1;
  }
  for (const a of req.artifacts) {
    total += 2;
    const base = a.includes("/") ? a.split("/").filter(Boolean).pop()! : a;
    if (rawLower.includes(a) || rawLower.includes(base)) hit += 2;
  }
  return total === 0 ? 0 : hit / total;
}

function isLinked(req: Requirement, terms: Set<string>, rawLower: string): boolean {
  if (req.artifacts.some((a) => rawLower.includes(a.includes("/") ? a.split("/").filter(Boolean).pop()! : a))) return true;
  const hits = req.terms.filter((t) => terms.has(t)).length;
  return hits >= (req.terms.length <= 2 ? 1 : 2);
}

function succeeded(a: Action): boolean {
  return !!a.result && !a.result.isError;
}

/** Errors with no later success on the same tool + target. */
function unresolvedErrors(actions: Action[]): { unresolved: Action[]; resolved: number } {
  const unresolved: Action[] = [];
  let resolved = 0;
  actions.forEach((a, i) => {
    if (!a.result?.isError) return;
    const key = targetKey(a.call);
    const fixed = actions.slice(i + 1).some((b) => succeeded(b) && (targetKey(b.call) === key || b.call.name === a.call.name));
    if (fixed) resolved++;
    else unresolved.push(a);
  });
  return { unresolved, resolved };
}

// ---------------------------------------------------------------------------
// Voters

const FAILURE =
  /\b(couldn'?t|could not|can'?t|cannot|unable to|wasn'?t able|not able|failed|fails|failing|still (?:fail|broken|not|doesn'?t|isn'?t)|didn'?t (?:work|manage|get)|not (?:yet )?(?:implemented|working|done|finished|complete)|todo|skipped|left out|blocked|you(?:'ll| will) need to|remaining work|not sure (?:if|whether|why))\b/i;
const COMPLETION =
  /\b(done|added|adds|created|implemented|fixed|updated|removed|deleted|renamed|refactored|wrote|written|built|wired|replaced|moved|completed|now (?:shows|works|supports|has|renders|displays|handles|returns)|all (?:\d+ )?tests? pass|tests? pass(?:es|ing)?|passing|verified|ready)\b/i;
const CORRECTION =
  /(^\s*still\b|\b(?:none of|is only showing|only shows?|no (?:details?|data|change)s?|not (?:showing|shown|clickable|visible|displayed|rendering|updating|fixed)|nothing is)\b|\b(didn'?t work|doesn'?t work|does not work|not working|isn'?t working|still (?:not|broken|fails?|failing|doesn'?t|isn'?t|shows|getting|seeing|the same)|wrong|not what i|broken|getting (?:an? )?error|crash(?:es|ed)?|revert|undo|that'?s not|doesn'?t (?:show|appear|render|load)|nothing (?:happens|changed)|same (?:issue|problem|error)|try again|again)\b)/i;
const APPROVAL = /\b(thanks|thank you|great|perfect|works|working now|nice|looks good|lgtm|awesome|excellent|love it)\b/i;

interface VoterContext {
  req: Requirement;
  ev: TurnEvidence;
  linkedActions: Action[];
  linkedEdits: TurnEvidence["edits"];
  nextPromptText?: string;
  turnTerms: Set<string>;
}

function voteCoverage({ req, ev }: VoterContext): VoterResult {
  if (req.terms.length === 0 && req.artifacts.length === 0) return { voter: "coverage", p: null, reason: "Prompt has no concrete terms to look for." };
  if (ev.actions.length === 0 && ev.edits.length === 0) {
    if (req.intent === "question" || req.intent === "other") return { voter: "coverage", p: null, reason: "No actions taken (none needed for a question)." };
    return { voter: "coverage", p: 0.05, reason: "No tool actions or edits at all." };
  }
  // Only work that landed counts — a failed attempt isn't coverage.
  const landed = ev.actions.filter((a) => !a.result?.isError);
  const raw = [...landed.map((a) => a.text), ...ev.edits.map((e) => e.text)].join("\n");
  const terms = new Set<string>();
  for (const a of landed) for (const t of a.terms) terms.add(t);
  for (const e of ev.edits) for (const t of e.terms) terms.add(t);
  const ratio = overlap(req, terms, raw);
  return { voter: "coverage", p: clamp01(ratio / 0.8), reason: `${Math.round(ratio * 100)}% of the requirement's terms appear in successful actions/edits.` };
}

function voteActionFit({ req, ev, linkedActions, linkedEdits }: VoterContext): VoterResult {
  const editCalls = ev.actions.filter((a) => EDIT_TOOLS.has(a.call.name) && succeeded(a));
  const anyEdits = ev.edits.length > 0 || editCalls.length > 0;
  const linkedEditCount = linkedEdits.length + linkedActions.filter((a) => EDIT_TOOLS.has(a.call.name) && succeeded(a)).length;
  switch (req.intent) {
    case "change": {
      if (linkedEditCount > 0) return { voter: "actionFit", p: 1, reason: `${linkedEditCount} successful edit(s) related to this requirement.` };
      if (anyEdits) return { voter: "actionFit", p: 0.6, reason: "Files were edited, but none clearly relate to this requirement." };
      const bash = linkedActions.filter((a) => a.call.name === "Bash" && succeeded(a));
      if (bash.length) return { voter: "actionFit", p: 0.55, reason: "No file edits; related shell commands succeeded." };
      return { voter: "actionFit", p: 0.1, reason: "A change was requested but no files were edited." };
    }
    case "run": {
      const runs = ev.actions.filter((a) => a.call.name === "Bash");
      const related = runs.filter((a) => linkedActions.includes(a) || VERIFY_CMD.test(a.text));
      const pool = related.length ? related : runs;
      if (pool.length === 0) return { voter: "actionFit", p: 0.1, reason: "Asked to run something but no commands were run." };
      const last = pool[pool.length - 1];
      return succeeded(last)
        ? { voter: "actionFit", p: related.length ? 1 : 0.7, reason: "The relevant command ran and succeeded." }
        : { voter: "actionFit", p: 0.3, reason: "The last relevant command failed." };
    }
    case "question": {
      const len = ev.responseText.length;
      const ratio = overlap(req, termSet(ev.responseText), ev.responseText.toLowerCase());
      if (len >= 200 && ratio >= 0.3) return { voter: "actionFit", p: 1, reason: "A substantive answer that addresses the question." };
      if (len >= 40) return { voter: "actionFit", p: 0.6, reason: "Answered, but briefly or only loosely on-topic." };
      return { voter: "actionFit", p: 0.2, reason: "No substantive answer." };
    }
    default:
      return ev.responseText.length >= 40
        ? { voter: "actionFit", p: anyEdits || ev.actions.length ? 0.75 : 0.6, reason: "Responded to a non-specific instruction." }
        : { voter: "actionFit", p: 0.3, reason: "Little response to the instruction." };
  }
}

function voteOutcome({ ev, linkedActions }: VoterContext): VoterResult {
  const pool = linkedActions.length ? linkedActions : ev.actions;
  if (pool.length === 0) return { voter: "outcome", p: null, reason: "No tool calls to judge." };
  const { unresolved, resolved } = unresolvedErrors(pool);
  if (unresolved.length > 0) {
    const p = clamp01(1 - Math.max(0.35 * unresolved.length, unresolved.length / pool.length));
    return { voter: "outcome", p, reason: `${unresolved.length} tool error(s) never resolved.` };
  }
  if (resolved > 0) return { voter: "outcome", p: 0.9, reason: `${resolved} error(s) hit, then fixed by a later successful call.` };
  return { voter: "outcome", p: 1, reason: "Every related tool call succeeded." };
}

function voteResponseClaim({ req, ev }: VoterContext): VoterResult {
  if (!ev.responseText.trim()) return { voter: "responseClaim", p: 0, reason: "No final response." };
  const reqSentences = ev.responseSentences.filter((s) => isLinked(req, termSet(s), s.toLowerCase()));
  const failingHere = reqSentences.some((s) => FAILURE.test(s));
  const failingElsewhere = !failingHere && ev.responseSentences.some((s) => FAILURE.test(s));
  const completion = (reqSentences.length ? reqSentences : ev.responseSentences).some((s) => COMPLETION.test(s));
  const ratio = overlap(req, termSet(ev.responseText), ev.responseText.toLowerCase());

  if (failingHere) return { voter: "responseClaim", p: completion ? 0.3 : 0.1, reason: "The response says this part failed or isn't finished." };
  let p = req.intent === "question" ? 0.4 + 0.6 * clamp01(ratio / 0.5) : 0.45 + (completion ? 0.3 : 0) + 0.25 * clamp01(ratio / 0.5);
  if (failingElsewhere) p -= 0.15;
  const reason = completion
    ? `Claims completion and mentions ${Math.round(ratio * 100)}% of the requirement's terms.`
    : `Mentions ${Math.round(ratio * 100)}% of the requirement's terms, without a clear completion claim.`;
  return { voter: "responseClaim", p: clamp01(p), reason: failingElsewhere ? `${reason} Reports a problem elsewhere.` : reason };
}

function voteVerification({ req, ev }: VoterContext): VoterResult {
  if (req.intent !== "change") return { voter: "verification", p: null, reason: "Not a code change." };
  const editIdx = Math.max(
    -1,
    ...ev.edits.map((e) => e.index),
    ...ev.actions.filter((a) => EDIT_TOOLS.has(a.call.name)).map((a) => a.index),
  );
  if (editIdx < 0) return { voter: "verification", p: null, reason: "No edits to verify." };
  const checks = ev.actions.filter((a) => a.index > editIdx && a.call.name === "Bash" && VERIFY_CMD.test(a.text));
  if (checks.length === 0) return { voter: "verification", p: null, reason: "No tests/build/typecheck ran after the last edit." };
  const last = checks[checks.length - 1];
  if (!last.result) return { voter: "verification", p: null, reason: "Verification is still running." };
  return succeeded(last)
    ? { voter: "verification", p: 1, reason: "Tests/build ran after the last edit and passed." }
    : { voter: "verification", p: 0.2, reason: "Tests/build ran after the last edit and failed." };
}

function voteReasoning({ req, ev }: VoterContext): VoterResult {
  if (!ev.reasoningText.trim()) return { voter: "reasoning", p: null, reason: "No reasoning text was recorded." };
  if (req.terms.length === 0 && req.artifacts.length === 0) return { voter: "reasoning", p: null, reason: "Nothing concrete to match." };
  const ratio = overlap(req, ev.reasoningTerms, ev.reasoningText.toLowerCase());
  return { voter: "reasoning", p: clamp01(0.3 + 0.7 * clamp01(ratio / 0.4)), reason: `Reasoning touches ${Math.round(ratio * 100)}% of the requirement's terms.` };
}

function voteFollowUp({ req, nextPromptText, turnTerms }: VoterContext): VoterResult {
  if (!nextPromptText?.trim()) return { voter: "followUp", p: null, reason: "No later message from you yet." };
  const next = cleanPrompt(nextPromptText);
  const nextTerms = termSet(next);
  const aboutThis = req.terms.some((t) => nextTerms.has(t));
  const aboutTurn = [...nextTerms].some((t) => turnTerms.has(t));
  if (CORRECTION.test(next)) {
    if (aboutThis) return { voter: "followUp", p: 0.1, reason: "Your next message reports a problem with this." };
    return { voter: "followUp", p: aboutTurn ? 0.25 : 0.35, reason: "Your next message reports a problem (likely with this turn)." };
  }
  if (APPROVAL.test(next)) return { voter: "followUp", p: 0.95, reason: "Your next message approves the result." };
  return { voter: "followUp", p: 0.75, reason: "You moved on without reporting a problem." };
}

const VOTERS = [voteCoverage, voteActionFit, voteOutcome, voteResponseClaim, voteVerification, voteReasoning, voteFollowUp];

// ---------------------------------------------------------------------------
// Aggregation

function verdictFor(score: number): Verdict {
  if (score >= MET_THRESHOLD) return "met";
  if (score >= PARTIAL_THRESHOLD) return "partial";
  return "unmet";
}

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

/** Weighted mean of the non-abstaining votes; confidence = agreement
 * (1 − weighted std-dev, normalised to the 0.5 max) × √(share of weight
 * that voted). */
export function aggregateVotes(votes: VoterResult[]): { score: number; confidence: number } {
  const cast = votes.filter((v): v is VoterResult & { p: number } => v.p !== null);
  const totalWeight = votes.reduce((s, v) => s + VOTER_WEIGHTS[v.voter], 0);
  const w = cast.reduce((s, v) => s + VOTER_WEIGHTS[v.voter], 0);
  if (w === 0) return { score: 0, confidence: 0 };
  const mean = cast.reduce((s, v) => s + VOTER_WEIGHTS[v.voter] * v.p, 0) / w;
  const variance = cast.reduce((s, v) => s + VOTER_WEIGHTS[v.voter] * (v.p - mean) ** 2, 0) / w;
  const agreement = 1 - Math.min(1, Math.sqrt(variance) / 0.5);
  return { score: mean, confidence: agreement * Math.sqrt(w / totalWeight) };
}

function evidenceFor(ctx: VoterContext): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  for (const e of ctx.linkedEdits.slice(0, 3)) refs.push({ agentId: e.agentId, eventId: e.eventId, label: `📝 ${e.path.split("/").pop()}` });
  for (const a of ctx.linkedActions.filter((a) => !EDIT_TOOLS.has(a.call.name)).slice(0, 3)) {
    refs.push({ agentId: a.call.agentId, eventId: a.call.id, label: `${a.result?.isError ? "❌" : "🔧"} ${a.call.name}` });
  }
  const r = ctx.ev.responseEvent;
  if (r) refs.push({ agentId: r.agentId, eventId: r.id, label: "💬 response" });
  return refs;
}

/** Words that, on their own, just mean "carry on with what you proposed". */
const CONTINUATION = new Set(
  ["yes", "yeah", "yep", "sure", "ahead", "continue", "proceed", "keep", "going", "sound", "good", "approv", "lgtm", "fine", "great", "thank", "thanks", "right"].map(stem),
);

const PENDING: TurnValidation = { pending: true, requirements: [], accuracy: 0, verdict: "unmet", confidence: 0, confidenceLevel: "low" };

const SKIPPED: TurnValidation = { ...PENDING, pending: false, skipped: true };

/** Slash commands arrive as `<command-name>/x</command-name>…<command-args>…`;
 * only their arguments (if any) are a request. Returns null for a bare
 * command or local command output, which aren't tasks. */
function effectivePrompt(text: string | undefined): string | undefined | null {
  if (!text) return text;
  if (/<local-command-(?:stdout|stderr|caveat)>/.test(text)) return null;
  if (/<command-name>/.test(text)) {
    const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    return args ? args : null;
  }
  return text;
}

export function validateTurn(input: ValidateTurnInput): TurnValidation {
  const promptText = effectivePrompt(input.promptText);
  if (promptText === null) return SKIPPED;
  const neighbour = (t?: string) => effectivePrompt(t) ?? undefined;
  input = { ...input, promptText, nextPromptText: neighbour(input.nextPromptText), previousPromptText: neighbour(input.previousPromptText) };
  const ev = gatherEvidence(input.events);
  if (!ev.responseText.trim() || input.inProgress) return PENDING;

  let requirements = extractRequirements(input.promptText);
  const substantive = contentTerms(cleanPrompt(input.promptText ?? "")).filter((t) => !CONTINUATION.has(t));
  const isBareContinuation = substantive.length < 2 && requirements.every((r) => r.artifacts.length === 0);
  if (isBareContinuation && input.previousPromptText) {
    const inherited = extractRequirements(input.previousPromptText).map((r) => ({ ...r, inherited: true }));
    if (inherited.some((r) => r.terms.length)) requirements = inherited;
  }
  if (requirements.length === 0) requirements = [{ text: "(session start)", intent: "other", terms: [], artifacts: [], source: "prompt" }];

  // Plan mode: the approved plan becomes a second set of requirements, judged
  // only on the work done after it was approved.
  const plans = findPlans(input.events);
  const approved = [...plans].reverse().find((p) => p.status === "approved");
  const carried = !approved && isBareContinuation ? input.carriedPlan : undefined;
  const activePlan = approved ?? carried;
  const shownPlan = activePlan ?? plans[plans.length - 1];
  const planReqs = activePlan
    ? extractPlanRequirements(activePlan.text).map((r) => (carried ? { ...r, inherited: true } : r))
    : [];
  const planIdx = approved ? input.events.findIndex((e) => e.id === approved.eventId) : -1;
  const planEv = planIdx >= 0 ? gatherEvidence(input.events.slice(planIdx + 1)) : ev;
  // "go ahead" after a plan: the plan *is* the request.
  if (planReqs.length && carried) requirements = [];

  const turnTerms = new Set<string>();
  for (const a of ev.actions) for (const t of a.terms) turnTerms.add(t);
  for (const t of termSet(ev.responseText)) turnTerms.add(t);

  const judge = (req: Requirement, ev: TurnEvidence): RequirementVerdict => {
    const ctx: VoterContext = {
      req,
      ev,
      linkedActions: ev.actions.filter((a) => isLinked(req, a.terms, a.text)),
      linkedEdits: ev.edits.filter((e) => isLinked(req, e.terms, e.text)),
      nextPromptText: input.nextPromptText,
      turnTerms,
    };
    const votes = VOTERS.map((v) => v(ctx));
    const { score, confidence } = aggregateVotes(votes);
    return { requirement: req, score, verdict: verdictFor(score), confidence, votes, evidence: evidenceFor(ctx) };
  };

  const promptVerdicts = requirements.map((r) => judge(r, ev));
  const planVerdicts = planReqs.map((r) => judge(r, planEv));
  const avg = (vs: RequirementVerdict[], key: "score" | "confidence") => vs.reduce((s, v) => s + v[key], 0) / vs.length;

  // With a plan, the instruction and the plan count equally — otherwise a
  // 15-step plan would drown out what you actually asked for.
  const groups = [promptVerdicts, planVerdicts].filter((g) => g.length > 0);
  const mean = groups.reduce((s, g) => s + avg(g, "score"), 0) / groups.length;
  const confidence = groups.reduce((s, g) => s + avg(g, "confidence"), 0) / groups.length;
  return {
    pending: false,
    requirements: [...promptVerdicts, ...planVerdicts],
    accuracy: Math.round(mean * 100),
    verdict: verdictFor(mean),
    confidence,
    confidenceLevel: confidenceLevel(confidence),
    promptAccuracy: promptVerdicts.length ? Math.round(avg(promptVerdicts, "score") * 100) : undefined,
    planAccuracy: planVerdicts.length ? Math.round(avg(planVerdicts, "score") * 100) : undefined,
    plan: shownPlan
      ? { eventId: shownPlan.eventId, agentId: shownPlan.agentId, title: shownPlan.title, status: shownPlan.status, inherited: !!carried }
      : undefined,
  };
}

/** 90% Wilson score interval for `successes` out of `n`. */
export function wilsonInterval(successes: number, n: number, z = 1.645): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [clamp01(center - half), clamp01(center + half)];
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const inter = a.filter((t) => setB.has(t)).length;
  return inter / (a.length + b.length - inter);
}

/** A later requirement re-addresses an earlier one when they ask for the
 * same thing: a large share of the same terms, or a shared file/identifier
 * plus some shared terms. Corrections ("the logout button still doesn't
 * work") and repeats both qualify. */
function readdresses(later: Requirement, earlier: Requirement): boolean {
  const sim = jaccard(later.terms, earlier.terms);
  if (sim >= 0.4) return true;
  return sim >= 0.2 && later.artifacts.some((a) => earlier.artifacts.includes(a));
}

/** The session's final validation. Requirements are taken in turn order;
 * when a later turn re-addresses an earlier requirement, the earlier attempt
 * is superseded and only the latest one counts — so a bug reported and then
 * fixed ends the session as met, and a fix that later regressed ends as the
 * regression. Pending and skipped turns don't count. */
export function summarizeSession(turns: TurnValidation[]): SessionValidation {
  const scored = turns.filter((t) => !t.pending && !t.skipped);
  const byTurn = scored.map((t) => t.requirements);
  const all = byTurn.flat();
  let superseded = 0;
  const final: RequirementVerdict[] = [];
  byTurn.forEach((reqs, i) => {
    for (const r of reqs) {
      const redone = byTurn.slice(i + 1).some((later) => later.some((l) => readdresses(l.requirement, r.requirement)));
      if (redone) superseded++;
      else final.push(r);
    }
  });

  const met = final.filter((r) => r.verdict === "met").length;
  const partial = final.filter((r) => r.verdict === "partial").length;
  const n = final.length;
  const [lo, hi] = wilsonInterval(met + 0.5 * partial, n);
  const confidence = n ? final.reduce((s, r) => s + r.confidence, 0) / n : 0;
  const mean = (rs: RequirementVerdict[]) => (rs.length ? Math.round((rs.reduce((s, r) => s + r.score, 0) / rs.length) * 100) : 0);
  return {
    turnsScored: scored.length,
    requirementCount: n,
    met,
    partial,
    unmet: n - met - partial,
    accuracy: mean(final),
    firstPassAccuracy: mean(all),
    superseded,
    interval: [Math.round(lo * 100), Math.round(hi * 100)],
    confidence,
    confidenceLevel: confidenceLevel(confidence),
  };
}

// ---------------------------------------------------------------------------
// Whole sessions — shared by the browser (live view) and the server (sidebar
// stats), so both score a session exactly the same way.

export interface SessionTurn {
  prompt?: TextEvent;
  /** Every event in the turn — main agent plus sub-agent work in its time
   * window — sorted by time. */
  events: NormalizedEvent[];
}

const byTime = (a: NormalizedEvent, b: NormalizedEvent) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

/** Splits a session into turns at each human prompt to the main agent.
 * Sub-agent events go to the main turn whose time window contains them —
 * agents spawned in the turn, agents resumed later via SendMessage, and
 * nested sub-agents alike. Events before the first prompt form a leading turn. */
export function splitSessionTurns(events: NormalizedEvent[], mainAgentId: string): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let current: SessionTurn | null = null;
  for (const e of events) {
    if (e.agentId !== mainAgentId) continue;
    if (e.kind === "text" && e.isHumanPrompt) {
      current = { prompt: e, events: [] };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { events: [] };
      turns.push(current);
    }
    current.events.push(e);
  }
  if (turns.length === 0) return turns;

  const starts = turns.map((t) => t.prompt?.timestamp ?? t.events[0]?.timestamp ?? "");
  for (const e of events) {
    if (e.agentId === mainAgentId) continue;
    let idx = 0;
    while (idx + 1 < starts.length && starts[idx + 1] && e.timestamp >= starts[idx + 1]) idx++;
    turns[idx].events.push(e);
  }
  for (const t of turns) t.events.sort(byTime);
  return turns;
}

/** The latest turn is still running if its last meaningful event isn't the
 * assistant's reply (a tool call/result or thinking came after it). */
function turnInProgress(events: NormalizedEvent[]): boolean {
  const last = [...events].reverse().find((e) => e.kind !== "raw" && e.kind !== "lifecycle");
  return !last || !(last.kind === "text" && !last.isHumanPrompt);
}

/** Validates every turn with its neighbours' context: the next prompt (the
 * follow-up signal), the previous prompt (for bare "go ahead"s), and the
 * previous turn's approved plan. */
export function validateTurns(turns: SessionTurn[], opts: { lastTurnLive?: boolean } = {}): TurnValidation[] {
  const approvedPlan = turns.map((t) => [...findPlans(t.events)].reverse().find((p) => p.status === "approved"));
  return turns.map((turn, i) =>
    validateTurn({
      promptText: turn.prompt?.text,
      events: turn.events,
      nextPromptText: turns[i + 1]?.prompt?.text,
      previousPromptText: turns[i - 1]?.prompt?.text,
      carriedPlan: approvedPlan[i - 1],
      inProgress:
        i === turns.length - 1 &&
        (opts.lastTurnLive ?? true) &&
        // Judged on the main agent's own events — a background sub-agent
        // still logging after the reply doesn't keep the turn open.
        turnInProgress(turn.events.filter((e) => e.agentId === (turn.prompt?.agentId ?? turn.events[0]?.agentId))),
    }),
  );
}

/** Tokens used across the whole session (all agents): input + output +
 * cache writes, each API message counted once. */
export function sessionTokenTotal(events: NormalizedEvent[]): number {
  const byMessage = new Map<string, TokenUsage>();
  events.forEach((e, i) => {
    if (e.usage) byMessage.set(e.messageId ?? `${e.id}:${i}`, e.usage);
  });
  let total = 0;
  for (const u of byMessage.values()) total += totalTokens(u);
  return total;
}

/** What the sidebar shows for a session. */
export interface SessionStats {
  sessionId: string;
  /** The session's final validation, or null when no turn has been scored yet. */
  validation: SessionValidation | null;
  totalTokens: number;
}

export function computeSessionStats(events: NormalizedEvent[], sessionId: string): SessionStats {
  const turns = validateTurns(splitSessionTurns(events, sessionId));
  const summary = summarizeSession(turns);
  return { sessionId, validation: summary.requirementCount > 0 ? summary : null, totalTokens: sessionTokenTotal(events) };
}
