import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders agent/user text as GitHub-flavored Markdown (headings, lists,
 * code fences, tables). Raw HTML in the text is not rendered. */
export const Markdown = memo(function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
