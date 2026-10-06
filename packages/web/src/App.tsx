import { useEffect, useState } from "react";
import type { LiveSession, ProjectHistoryEntry, UsageSummary } from "@agent-tel/shared";
import { api } from "./api/client.js";
import { useWebSocket } from "./api/useWebSocket.js";
import { useStore } from "./state/store.js";
import { SessionList } from "./components/SessionList.js";
import { SessionView } from "./components/SessionView.js";
import { UsagePanel } from "./components/UsagePanel.js";

export function App() {
  const roster = useStore((s) => s.roster);
  const projects = useStore((s) => s.projects);
  const sessions = useStore((s) => s.sessions);
  const selectedSessionId = useStore((s) => s.selectedSessionId);
  const selectedAgentId = useStore((s) => s.selectedAgentId);
  const setRoster = useStore((s) => s.setRoster);
  const setProjects = useStore((s) => s.setProjects);
  const selectSession = useStore((s) => s.selectSession);
  const selectAgent = useStore((s) => s.selectAgent);
  const loadReplay = useStore((s) => s.loadReplay);

  const { subscribe, unsubscribe } = useWebSocket();
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  useEffect(() => {
    api.sessions().then(setRoster).catch(() => {});
    api.projects().then(setProjects).catch(() => {});
    api.usage().then(setUsage).catch(() => {});
    const refresh = setInterval(() => {
      api.projects().then(setProjects).catch(() => {});
    }, 15000);
    const refreshUsage = setInterval(() => {
      api.usage().then(setUsage).catch(() => {});
    }, 30000);
    return () => {
      clearInterval(refresh);
      clearInterval(refreshUsage);
    };
  }, [setRoster, setProjects]);

  function handleSelectLive(session: LiveSession) {
    if (selectedSessionId && selectedSessionId !== session.sessionId) unsubscribe(selectedSessionId);
    selectSession(session.sessionId);
    subscribe(session.sessionId);
  }

  async function handleSelectReplay(entry: ProjectHistoryEntry) {
    if (selectedSessionId) unsubscribe(selectedSessionId);
    selectSession(entry.sessionId);
    try {
      const { agents, events } = await api.history(entry.sessionId, entry.encodedCwd);
      loadReplay(entry.sessionId, agents, events);
    } catch (err) {
      console.error("failed to load session history", err);
    }
  }

  const activeSession = selectedSessionId ? sessions[selectedSessionId] : undefined;

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">agent-tel</span>
        <span className="app-subtitle">Claude Code, in real time</span>
        <UsagePanel usage={usage} />
      </header>
      <div className="app-body">
        <SessionList
          roster={roster}
          projects={projects}
          selectedSessionId={selectedSessionId}
          onSelectLive={handleSelectLive}
          onSelectReplay={handleSelectReplay}
        />
        <main className="app-main">
          {selectedSessionId && activeSession ? (
            <SessionView
              sessionId={selectedSessionId}
              session={activeSession}
              selectedAgentId={selectedAgentId}
              onSelectAgent={selectAgent}
            />
          ) : (
            <div className="empty-hint app-empty">Select a session to see what it's doing.</div>
          )}
        </main>
      </div>
    </div>
  );
}
