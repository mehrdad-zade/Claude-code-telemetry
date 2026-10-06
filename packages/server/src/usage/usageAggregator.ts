import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  ZERO_USAGE,
  addUsage,
  type PlanLimits,
  type PlanWindow,
  type TokenUsage,
  type UsageSummary,
} from "@agent-tel/shared";
import { config } from "../config.js";
import { toTokenUsage } from "../normalize/normalizer.js";

interface MessageUsage {
  timestampMs: number;
  usage: TokenUsage;
}

interface FileCacheEntry {
  size: number;
  mtimeMs: number;
  messages: Map<string, MessageUsage>;
}

/** Calendar windows in local time: today since midnight, this week since
 * Monday, this month since the 1st. */
export function windowStarts(now: Date): { day: number; week: number; month: number } {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (day.getDay() + 6) % 7;
  const week = new Date(day.getFullYear(), day.getMonth(), day.getDate() - daysSinceMonday);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return { day: day.getTime(), week: week.getTime(), month: month.getTime() };
}

/** Streams one transcript and collects per-API-message usage. One message is
 * written as several lines (one per content block) that repeat the same
 * usage, so they're keyed by message id — the last line seen wins. */
async function readFileUsage(filePath: string): Promise<Map<string, MessageUsage>> {
  const messages = new Map<string, MessageUsage>();
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      // Cheap pre-filter: skip the vast majority of lines without parsing.
      if (!line.includes('"usage"')) continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj?.type !== "assistant") continue;
      const usage = toTokenUsage(obj.message?.usage);
      const timestampMs = Date.parse(obj.timestamp ?? "");
      if (!usage || Number.isNaN(timestampMs)) continue;
      const key = String(obj.message?.id ?? obj.uuid ?? `${filePath}:${messages.size}`);
      messages.set(key, { timestampMs, usage });
    }
  } finally {
    rl.close();
  }
  return messages;
}

async function listTranscriptFiles(projectsDir: string, sinceMs: number): Promise<Array<{ file: string; stat: fs.Stats }>> {
  const out: Array<{ file: string; stat: fs.Stats }> = [];

  async function consider(file: string) {
    try {
      const stat = await fs.promises.stat(file);
      if (stat.isFile() && stat.mtimeMs >= sinceMs) out.push({ file, stat });
    } catch {
      // vanished between readdir and stat — ignore
    }
  }

  let projectDirs: string[];
  try {
    projectDirs = await fs.promises.readdir(projectsDir);
  } catch {
    return out;
  }

  for (const project of projectDirs) {
    const projectPath = path.join(projectsDir, project);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(projectPath, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        await consider(entryPath);
      } else if (entry.isDirectory()) {
        // <sessionId>/subagents/agent-*.jsonl
        const subDir = path.join(entryPath, "subagents");
        let subFiles: string[];
        try {
          subFiles = await fs.promises.readdir(subDir);
        } catch {
          continue;
        }
        for (const sub of subFiles) {
          if (sub.endsWith(".jsonl")) await consider(path.join(subDir, sub));
        }
      }
    }
  }
  return out;
}

function asPercent(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
}

function formatMoney(minor: number, decimals: number, currency: string): string {
  const amount = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(decimals)} ${currency}`;
  }
}

/** Reads the plan utilization Claude Code itself cached the last time it
 * fetched `/status` data (in ~/.claude.json). agent-tel never fetches this
 * itself — it makes no outbound calls. The schema is undocumented, so every
 * field is optional and any surprise just yields null / a missing window. */
export async function readPlanLimits(claudeJsonPath: string = config.claudeJsonPath): Promise<PlanLimits | null> {
  let cached: any;
  try {
    const raw = JSON.parse(await fs.promises.readFile(claudeJsonPath, "utf8"));
    cached = raw?.cachedUsageUtilization;
  } catch {
    return null;
  }
  if (!cached || typeof cached !== "object") return null;

  const util = cached.utilization ?? {};
  const limits: any[] = Array.isArray(util.limits) ? util.limits : [];
  const byGroup = (group: string) => limits.find((l) => l?.group === group);

  function window(limit: any, fallback: any, label: string): PlanWindow | undefined {
    const percent = asPercent(limit?.percent) ?? asPercent(fallback?.utilization);
    if (percent === undefined) return undefined;
    const resetsAt = limit?.resets_at ?? fallback?.resets_at ?? undefined;
    return { percent, label, resetsAt: typeof resetsAt === "string" ? resetsAt : undefined };
  }

  const plan: PlanLimits = {
    fetchedAtMs: typeof cached.fetchedAtMs === "number" ? cached.fetchedAtMs : 0,
    session: window(byGroup("session"), util.five_hour, "5h session"),
    weekly: window(byGroup("weekly"), util.seven_day, "weekly"),
  };

  const extra = util.extra_usage;
  const extraPercent = asPercent(extra?.utilization);
  if (extra && extraPercent !== undefined) {
    const decimals = typeof extra.decimal_places === "number" ? extra.decimal_places : 2;
    const currency = typeof extra.currency === "string" ? extra.currency : "USD";
    const used = typeof extra.used_credits === "number" ? extra.used_credits : 0;
    const limit = typeof extra.monthly_limit === "number" ? extra.monthly_limit : null;
    const detail =
      limit !== null ? `${formatMoney(used, decimals, currency)} / ${formatMoney(limit, decimals, currency)}` : undefined;
    plan.monthly = {
      percent: extraPercent,
      label: "monthly extra usage",
      detail: extra.is_enabled === false ? `${detail ?? ""} (off)`.trim() : detail,
    };
  }

  if (!plan.session && !plan.weekly && !plan.monthly) return null;
  return plan;
}

/** Totals token usage across every transcript (main + sub-agents, all
 * projects) for today / this week / this month. Per-file results are cached
 * by (size, mtime) so repeat calls only re-read files that changed. */
export class UsageAggregator {
  private fileCache = new Map<string, FileCacheEntry>();
  private inFlight: Promise<UsageSummary> | null = null;

  constructor(
    private readonly projectsDir: string = config.projectsDir,
    private readonly claudeJsonPath: string = config.claudeJsonPath
  ) {}

  /** Concurrent callers share one scan rather than racing on the cache. */
  summarize(now: Date = new Date()): Promise<UsageSummary> {
    this.inFlight ??= this.compute(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async compute(now: Date): Promise<UsageSummary> {
    const starts = windowStarts(now);
    const since = Math.min(starts.week, starts.month);
    const files = await listTranscriptFiles(this.projectsDir, since);

    const seen = new Set<string>();
    for (const { file, stat } of files) {
      seen.add(file);
      const cached = this.fileCache.get(file);
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) continue;
      try {
        const messages = await readFileUsage(file);
        this.fileCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, messages });
      } catch {
        this.fileCache.delete(file);
      }
    }
    for (const file of this.fileCache.keys()) {
      if (!seen.has(file)) this.fileCache.delete(file);
    }

    // Dedupe across files too (a resumed/forked session can repeat lines).
    const all = new Map<string, MessageUsage>();
    for (const entry of this.fileCache.values()) {
      for (const [id, msg] of entry.messages) all.set(id, msg);
    }

    let today = ZERO_USAGE;
    let week = ZERO_USAGE;
    let month = ZERO_USAGE;
    for (const { timestampMs, usage } of all.values()) {
      if (timestampMs >= starts.day) today = addUsage(today, usage);
      if (timestampMs >= starts.week) week = addUsage(week, usage);
      if (timestampMs >= starts.month) month = addUsage(month, usage);
    }

    return { today, week, month, plan: await readPlanLimits(this.claudeJsonPath) };
  }
}
