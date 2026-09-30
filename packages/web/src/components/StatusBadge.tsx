import type { AgentStatus } from "@agent-tel/shared";

const LABEL: Record<AgentStatus, string> = {
  thinking: "Thinking",
  tool_running: "Running tool",
  idle: "Idle",
  done: "Done",
  unknown: "—",
};

const COLOR: Record<AgentStatus, string> = {
  thinking: "var(--status-thinking)",
  tool_running: "var(--status-tool)",
  idle: "var(--status-idle)",
  done: "var(--status-done)",
  unknown: "var(--status-unknown)",
};

const PULSING: AgentStatus[] = ["thinking", "tool_running"];

export function StatusBadge({ status }: { status: AgentStatus }) {
  const pulsing = PULSING.includes(status);
  return (
    <span className="status-badge" style={{ color: COLOR[status] }}>
      <span className={`status-dot${pulsing ? " pulsing" : ""}`} style={{ background: COLOR[status] }} />
      {LABEL[status]}
    </span>
  );
}
