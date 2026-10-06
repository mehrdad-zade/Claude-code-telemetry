import { describe, expect, it } from "vitest";
import { Normalizer } from "../src/normalize/normalizer.js";

function ctx(agentId = "session-1", seq = 0) {
  return { sessionId: "session-1", agentId, seq };
}

describe("Normalizer", () => {
  it("emits thinking, text and tool_call events from an assistant line", () => {
    const normalizer = new Normalizer();
    const raw = {
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        content: [
          { type: "thinking", thinking: "considering options" },
          { type: "text", text: "Here's the plan" },
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } },
        ],
      },
    };

    const events = normalizer.normalizeLine(raw, ctx());

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ kind: "thinking", text: "considering options" });
    expect(events[1]).toMatchObject({ kind: "text", text: "Here's the plan", isHumanPrompt: false });
    expect(events[2]).toMatchObject({ kind: "tool_call", name: "Bash", toolUseId: "toolu_1" });
  });

  it("tags every event with the API message id but attaches usage only to the first", () => {
    const normalizer = new Normalizer();
    const raw = {
      type: "assistant",
      timestamp: "2026-01-01T00:00:00.000Z",
      message: {
        id: "msg_1",
        model: "claude-opus-5-5",
        usage: { input_tokens: 5, output_tokens: 40, cache_creation_input_tokens: 100, cache_read_input_tokens: 9000 },
        content: [
          { type: "text", text: "a" },
          { type: "tool_use", id: "toolu_9", name: "Bash", input: { command: "ls" } },
        ],
      },
    };

    const events = normalizer.normalizeLine(raw, ctx());
    expect(events.map((e) => e.messageId)).toEqual(["msg_1", "msg_1"]);
    expect(events[0].usage).toEqual({ input: 5, output: 40, cacheWrite: 100, cacheRead: 9000 });
    expect(events[0].model).toBe("claude-opus-5-5");
    expect(events[1].usage).toBeUndefined();
    expect(events[1].model).toBeUndefined();
  });

  it("still emits a thinking event when the thinking text is empty (redacted summary)", () => {
    // Some reasoning-effort/model configurations write a thinking block with
    // no readable summary, just an empty string + a verification signature.
    // Dropping it would silently undercount the agent's real reasoning
    // steps in the process view.
    const normalizer = new Normalizer();
    const raw = {
      type: "assistant",
      timestamp: "t",
      message: { content: [{ type: "thinking", thinking: "", signature: "abc" }] },
    };

    const events = normalizer.normalizeLine(raw, ctx());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "thinking", text: "" });
  });

  it("marks a human-authored user line as isHumanPrompt", () => {
    const normalizer = new Normalizer();
    const raw = {
      type: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      origin: { kind: "human" },
      message: { content: "please fix the bug" },
    };

    const [event] = normalizer.normalizeLine(raw, ctx());
    expect(event).toMatchObject({ kind: "text", text: "please fix the bug", isHumanPrompt: true });
  });

  it("pairs an Edit tool_call with its tool_result into a file_edit diff", () => {
    const normalizer = new Normalizer();
    const call = {
      type: "assistant",
      timestamp: "t",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_edit",
            name: "Edit",
            input: { file_path: "/tmp/a.txt", old_string: "foo", new_string: "bar" },
          },
        ],
      },
    };
    const result = {
      type: "user",
      timestamp: "t",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_edit", content: "ok", is_error: false }],
      },
    };

    normalizer.normalizeLine(call, ctx("a", 0));
    const events = normalizer.normalizeLine(result, ctx("a", 1));

    const fileEdit = events.find((e) => e.kind === "file_edit");
    expect(fileEdit).toBeTruthy();
    if (fileEdit?.kind === "file_edit") {
      expect(fileEdit.path).toBe("/tmp/a.txt");
      expect(fileEdit.diffHunks[0].text).toContain("-foo");
      expect(fileEdit.diffHunks[0].text).toContain("+bar");
    }
  });

  it("resolves an Agent spawn from the tool_result's embedded agentId", () => {
    const normalizer = new Normalizer();
    const call = {
      type: "assistant",
      timestamp: "t",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_agent",
            name: "Agent",
            input: { description: "explore repo", subagent_type: "Explore", prompt: "look around" },
          },
        ],
      },
    };
    const result = {
      type: "user",
      timestamp: "t",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_agent",
            content: [{ type: "text", text: "Async agent launched.\nagentId: abc123def456\n" }],
            is_error: false,
          },
        ],
      },
    };

    normalizer.normalizeLine(call, ctx("main", 0));
    const events = normalizer.normalizeLine(result, ctx("main", 1));

    const spawn = events.find((e) => e.kind === "agent_spawn");
    expect(spawn).toMatchObject({
      kind: "agent_spawn",
      parentAgentId: "main",
      childAgentId: "abc123def456",
      subagentType: "Explore",
    });
  });

  it("never throws on an unknown or malformed line, and passes it through", () => {
    const normalizer = new Normalizer();
    expect(() => normalizer.normalizeLine({ type: "some-future-type", weird: true }, ctx())).not.toThrow();
    const [event] = normalizer.normalizeLine({ type: "some-future-type" }, ctx());
    expect(event.kind).toBe("raw");

    expect(() => normalizer.normalizeLine(null, ctx())).not.toThrow();
    expect(() => normalizer.normalizeLine("not an object", ctx())).not.toThrow();
  });

  it("gives every event a unique id even when two share the same source block", () => {
    // Regression test: an Agent tool_use produces both a tool_call and an
    // agent_spawn_pending event from the SAME content block, and its
    // tool_result produces both a tool_result and an agent_spawn event from
    // the same block — these must never share an id (it breaks React keys
    // and client-side de-duplication).
    const normalizer = new Normalizer();
    const call = {
      type: "assistant",
      timestamp: "t",
      message: {
        content: [{ type: "tool_use", id: "toolu_agent", name: "Agent", input: { subagent_type: "Explore" } }],
      },
    };
    const result = {
      type: "user",
      timestamp: "t",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_agent",
            content: [{ type: "text", text: "agentId: abc123def456\n" }],
            is_error: false,
          },
        ],
      },
    };

    const callEvents = normalizer.normalizeLine(call, ctx("main", 0));
    const resultEvents = normalizer.normalizeLine(result, ctx("main", 1));
    const allIds = [...callEvents, ...resultEvents].map((e) => e.id);

    expect(callEvents.map((e) => e.kind)).toEqual(["tool_call", "agent_spawn_pending"]);
    expect(resultEvents.map((e) => e.kind)).toEqual(["tool_result", "agent_spawn"]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("gives a file_edit event its own id, distinct from its tool_result", () => {
    const normalizer = new Normalizer();
    const call = {
      type: "assistant",
      timestamp: "t",
      message: {
        content: [
          { type: "tool_use", id: "toolu_edit", name: "Edit", input: { file_path: "/tmp/a.txt", old_string: "a", new_string: "b" } },
        ],
      },
    };
    const result = {
      type: "user",
      timestamp: "t",
      message: {
        content: [{ type: "tool_result", tool_use_id: "toolu_edit", content: "ok", is_error: false }],
      },
    };

    normalizer.normalizeLine(call, ctx("a", 0));
    const events = normalizer.normalizeLine(result, ctx("a", 1));
    const ids = events.map((e) => e.id);

    expect(events.map((e) => e.kind)).toEqual(["tool_result", "file_edit"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("tags system lines with their subtype for lightweight status handling", () => {
    const normalizer = new Normalizer();
    const [event] = normalizer.normalizeLine({ type: "system", subtype: "turn_duration", timestamp: "t" }, ctx());
    expect(event).toMatchObject({ kind: "raw", rawType: "system:turn_duration" });
  });
  it("records the permission mode on human prompts", () => {
    const normalizer = new Normalizer();
    const [event] = normalizer.normalizeLine(
      { type: "user", timestamp: "2026-01-01T00:00:00.000Z", permissionMode: "plan", origin: { kind: "human" }, message: { role: "user", content: "plan a refactor" } },
      ctx(),
    );
    expect(event).toMatchObject({ kind: "text", isHumanPrompt: true, permissionMode: "plan" });
  });
});
