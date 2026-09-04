import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { ResearchScreen } from "./index";

describe("ResearchScreen", () => {
  it("renders Research through its public feature entry point without repository access", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <ResearchScreen
        copy={copy}
        settings={createDefaultSettings()}
        profiles={[]}
        workspaces={[]}
        repository={null}
      />,
    );

    expect(html).toContain(copy.research);
    expect(html).toContain(copy.researchLead);
    expect(html).toContain("Allowlist packets");
    expect(html).toContain("Config → immutable");
    expect(html).toContain("Freeze → unblind");
  });
});
