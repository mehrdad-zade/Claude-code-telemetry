import type { AgentNode, LiveSession, NormalizedEvent, ProjectHistoryEntry, UsageSummary } from "@agent-tel/shared";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  sessions: () => getJson<LiveSession[]>("/api/sessions"),
  projects: () => getJson<ProjectHistoryEntry[]>("/api/projects"),
  usage: () => getJson<UsageSummary>("/api/usage"),
  tree: (sessionId: string) => getJson<AgentNode[]>(`/api/sessions/${sessionId}/tree`),
  history: (sessionId: string, encodedCwd?: string) => {
    const qs = encodedCwd ? `?encodedCwd=${encodeURIComponent(encodedCwd)}` : "";
    return getJson<{ agents: AgentNode[]; events: NormalizedEvent[] }>(
      `/api/sessions/${sessionId}/history${qs}`
    );
  },
};
