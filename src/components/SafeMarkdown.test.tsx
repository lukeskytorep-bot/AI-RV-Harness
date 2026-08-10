import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SafeMarkdown } from "./SafeMarkdown";

describe("SafeMarkdown", () => {
  it("renders common Markdown and GFM tables", () => {
    const html = renderToStaticMarkup(<SafeMarkdown content={'## Heading\n\n**bold** and *italic*\n\n- item\n\n| A | B |\n|---|---|\n| 1 | 2 |'} />);
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<table>");
  });

  it("preserves fenced ASCII as code and never executes raw HTML", () => {
    const html = renderToStaticMarkup(<SafeMarkdown content={'```text\n+---+\n| X |\n+---+\n```\n\n<script>alert(1)</script>'} />);
    expect(html).toContain("<pre><code class=\"language-text\"");
    expect(html).toContain("+---+");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not load remote images from model output", () => {
    const html = renderToStaticMarkup(<SafeMarkdown content="![secret](https://example.com/tracker.png)" />);
    expect(html).not.toContain("<img");
    expect(html).toContain("[image: secret]");
  });
});
