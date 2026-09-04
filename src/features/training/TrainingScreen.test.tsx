import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { TrainingScreen } from "./index";

describe("TrainingScreen", () => {
  it("renders Training through its public feature entry point without repository access", () => {
    const html = renderToStaticMarkup(
      <TrainingScreen
        copy={getCopy("en")}
        settings={createDefaultSettings()}
        profiles={[]}
        workspaces={[]}
        repository={null}
      />,
    );

    expect(html).toContain("AI Training");
    expect(html).toContain("84");
    expect(html).toContain("Viewer Notes");
    expect(html).toContain("Recent training runs");
  });
});
