import { totalTokens, type TokenUsage } from "@agent-tel/shared";

/** 950 → "950", 48_200 → "48.2k", 1_240_000 → "1.24M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  return `${(n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
}

/** Multi-line tooltip text with the full breakdown behind a token total. */
export function usageTooltip(u: TokenUsage): string {
  const fmt = (n: number) => n.toLocaleString();
  return [
    `${fmt(totalTokens(u))} tokens (input + output + cache writes)`,
    `  input: ${fmt(u.input)}`,
    `  output: ${fmt(u.output)}`,
    `  cache writes: ${fmt(u.cacheWrite)}`,
    `  cache reads (not counted): ${fmt(u.cacheRead)}`,
  ].join("\n");
}

/** "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5",
 * "claude-sonnet-5" → "Sonnet 5". Anything unrecognized is returned as-is. */
export function modelDisplayName(model: string): string {
  const match = model.match(/^claude-([a-z]+)((?:-\d+)+?)(?:-\d{8})?$/);
  if (!match) return model;
  const family = match[1].charAt(0).toUpperCase() + match[1].slice(1);
  const version = match[2].slice(1).split("-").join(".");
  return `${family} ${version}`;
}
