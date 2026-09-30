import { describe, expect, it } from "vitest";
import { AgentTree } from "../src/normalize/agentTree.js";
import type { LiveSession, NormalizedEvent } from "@agent-tel/shared";

const session: LiveSession = {
  pid: 1,
  sessionId: "session-1",
  cwd: "/tmp/project",
  name: "project",
  status: "busy",
  startedAt: Date.now(),
  updatedAt: Date.now(),
};

function evt(partial: Partial<NormalizedEvent> & Pick<NormalizedEvent, "kind">): NormalizedEvent {
  return {
    id: "e1",
    agentId: "session-1",
    sessionId: "session-1",
    timestamp: new Date().toISOString(),
    seq: 0,
    ...partial,
  } as NormalizedEvent;
}

describe("AgentTree", () => {
  it("creates a main agent node and updates its status from events", () => {
    const tree = new AgentTree();
    tree.ensureMainAgent(session);

    tree.applyEvent(evt({ kind: "thinking", text: "hmm" } as any));
    expect(tree.getAgent("session-1")?.status).toBe("thinking");

    tree.applyEvent(evt({ kind: "tool_call", toolUseId: "t1", name: "Bash", input: {} } as any));
    expect(tree.getAgent("session-1")?.status).toBe("tool_running");
  });

  it("materializes a child node and parent link on agent_spawn", () => {
    const tree = new AgentTree();
    tree.ensureMainAgent(session);

    tree.applyEvent(
      evt({
        kind: "agent_spawn",
        parentAgentId: "session-1",
        childAgentId: "child-1",
        toolUseId: "toolu_1",
        subagentType: "Explore",
        description: "look around",
      } as any)
    );

    const child = tree.getAgent("child-1");
    expect(child).toMatchObject({
      agentId: "child-1",
      parentAgentId: "session-1",
      role: "subagent",
      subagentType: "Explore",
    });

    const tree_ = tree.getTree("session-1");
    expect(tree_.map((n) => n.agentId).sort()).toEqual(["child-1", "session-1"]);
  });
});
