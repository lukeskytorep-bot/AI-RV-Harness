import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function SafeMarkdown({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>,
          // Remote Markdown images could make an unsolicited network request.
          // Uploaded/managed images use the application's dedicated artifact UI.
          img: ({ alt }) => <span className="markdown-image-placeholder">[image: {alt || "untitled"}]</span>,
          input: (props) => <input {...props} disabled />,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
