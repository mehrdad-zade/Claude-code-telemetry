import type { DiffHunk } from "@agent-tel/shared";

function classifyLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) return "diff-meta";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-remove";
  return "diff-context";
}

export function DiffView({ path, diffHunks }: { path: string; diffHunks: DiffHunk[] }) {
  return (
    <div className="event-block diff-view">
      <div className="event-label">edited {path}</div>
      {diffHunks.map((hunk, i) => (
        <pre className="diff-hunk" key={i}>
          {hunk.text
            .split("\n")
            .filter((l) => l.length > 0)
            .map((line, j) => (
              <div key={j} className={classifyLine(line)}>
                {line}
              </div>
            ))}
        </pre>
      ))}
    </div>
  );
}
