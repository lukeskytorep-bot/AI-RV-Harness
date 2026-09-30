import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { getCopy } from "../../i18n";
import { createDefaultSettings } from "../../startupDefaults";
import { TargetsScreen } from "./index";

describe("TargetsScreen", () => {
  it("renders the Targets feature through its public entry point without repository access", () => {
    const copy = getCopy("en");
    const html = renderToStaticMarkup(
      <TargetsScreen copy={copy} settings={createDefaultSettings()} repository={null} />,
    );

    expect(html).toContain(copy.targets);
    expect(html).toContain(copy.trainingTargets);
    expect(html).toContain(copy.myTargets);
    expect(html).toContain("My Telepathic Targets");
  });
});
