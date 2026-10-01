import dayjs from "dayjs";
import type { AgentNode } from "@agent-tel/shared";
import { agentLabel } from "../lib/agentColor.js";
import type { AgentStats } from "../lib/agentStats.js";
import { StatusBadge } from "./StatusBadge.js";

/** The "more detail" view for whichever agent box is selected: full tool
 * breakdown, counts, and a time span — everything summarized on the graph
 * node itself, spelled out in full. */
export function AgentDetailPanel({ agent, stats, color }: { agent: AgentNode; stats: AgentStats; color: string }) {
  const span =
    stats.firstTimestamp && stats.lastTimestamp
      ? dayjs(stats.lastTimestamp).from(dayjs(stats.firstTimestamp), true)
      : null;

  return (
    <div className="agent-detail-panel">
      <div className="agent-detail-header">
        <span className="agent-color-dot" style={{ background: color }} />
        <span className="agent-detail-title">{agentLabel(agent)}</span>
        <StatusBadge status={agent.status} />
      </div>

      {agent.description && agent.role === "subagent" && <div className="agent-detail-desc">{agent.description}</div>}

      <div className="agent-detail-stats">
        <div className="stat-pill">
          <span className="stat-value">{stats.thinkingCount}</span>
          <span className="stat-label">thinking</span>
        </div>
        <div className="stat-pill">
          <span className="stat-value">{stats.totalToolCalls}</span>
          <span className="stat-label">tool calls</span>
        </div>
        <div className="stat-pill">
          <span className="stat-value">{stats.fileEditCount}</span>
          <span className="stat-label">files edited</span>
        </div>
        {stats.spawnCount > 0 && (
          <div className="stat-pill">
            <span className="stat-value">{stats.spawnCount}</span>
            <span className="stat-label">sub-agents</span>
          </div>
        )}
        {stats.messageCount > 0 && (
          <div className="stat-pill">
            <span className="stat-value">{stats.messageCount}</span>
            <span className="stat-label">messages sent</span>
          </div>
        )}
        {stats.errorCount > 0 && (
          <div className="stat-pill stat-pill-error">
            <span className="stat-value">{stats.errorCount}</span>
            <span className="stat-label">errors</span>
          </div>
        )}
        {span && (
          <div className="stat-pill">
            <span className="stat-value">{span}</span>
            <span className="stat-label">active span</span>
          </div>
        )}
      </div>

      {stats.toolCounts.length > 0 && (
        <div className="agent-detail-tools">
          {stats.toolCounts.map((t) => (
            <span className="tool-mini-badge" key={t.name}>
              {t.name}×{t.count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
