import { describe, expect, it } from "vitest";
import { encodeProjectDir } from "../src/config.js";

describe("encodeProjectDir", () => {
  it("replaces slashes and dots", () => {
    expect(encodeProjectDir("/Users/zade/x.io")).toBe("-Users-zade-x-io");
  });

  it("replaces spaces and other non-alphanumerics like Claude Code does", () => {
    expect(encodeProjectDir("/Users/zade/Downloads/github.com/GitHub/Book Summarizer Agent")).toBe(
      "-Users-zade-Downloads-github-com-GitHub-Book-Summarizer-Agent"
    );
    expect(encodeProjectDir("/tmp/my_proj (v2)")).toBe("-tmp-my-proj--v2-");
  });
});
