// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { getCopy } from "../../i18n";
import {
  buildResearchSamplingDesignFromForm,
  ResearchSamplingDesignControls,
  researchSamplingFormFromRequested,
  type ResearchSamplingFormState,
} from "./ResearchSamplingDesignControls";
import { researchSamplingConfigurationCount } from "../../research/samplingDesign";

function Harness({ initial, language = "en" }: { initial: ResearchSamplingFormState; language?: "en" | "pl" }) {
  const [form, setForm] = useState(initial);
  return <ResearchSamplingDesignControls copy={getCopy(language)} form={form} onChange={setForm} targetCount={10} repetitions={2} viewerCallsPerSession={6} judgeCount={1} />;
}

describe("Research Sampling configurations UI", () => {
  it("uses profile values as fixed defaults, preserves Auto, and requires at least one compared axis", () => {
    const form = researchSamplingFormFromRequested({ topP: 0.9, topK: 0, seed: 123 });
    expect(form.topP).toEqual(expect.objectContaining({ mode: "fixed", fixed: "0.9" }));
    expect(form.topK.fixed).toBe("0");
    expect(form.seed.fixed).toBe("123");
    expect(() => buildResearchSamplingDesignFromForm(form)).toThrow(/at least one varied axis/i);
    const auto = researchSamplingFormFromRequested({});
    expect(auto.topP.fixed).toBe("");
    expect(auto.topK.fixed).toBe("");
    expect(auto.seed.fixed).toBe("");
  });

  it("accepts Polish decimal input in separate top_p fields and builds the full Cartesian design", () => {
    const form = researchSamplingFormFromRequested({ topK: 20 });
    form.topP = { mode: "varied", fixed: "", values: ["0,7", "0,8", "0,9"] };
    form.topK = { mode: "varied", fixed: "20", values: ["20", "40"] };
    form.seed = { mode: "varied", fixed: "", values: ["123", "456"] };
    const design = buildResearchSamplingDesignFromForm(form);
    expect(design.topP).toEqual({ mode: "varied", values: [0.7, 0.8, 0.9] });
    expect(researchSamplingConfigurationCount(design)).toBe(12);
  });

  it("renders fixed/compared controls, live counts and a visually limited preview", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      const initial = researchSamplingFormFromRequested({ topK: 0, seed: 42 });
      initial.topP = { mode: "varied", fixed: "", values: ["0.7", "0.8", "0.9"] };
      initial.topK = { mode: "varied", fixed: "0", values: ["0", "40"] };
      initial.seed = { mode: "varied", fixed: "42", values: ["42", "43"] };
      await act(async () => root.render(<Harness initial={initial} />));
      expect(host.textContent).toContain("12 Configurations");
      expect(host.textContent).toContain("240");
      expect(host.textContent).toContain("1440");
      expect(host.querySelectorAll(".research-sampling-preview-pills span")).toHaveLength(12);
      expect(host.textContent).toContain("top_k=0");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it("keeps invalid UI state visible instead of silently normalizing duplicates", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      const initial = researchSamplingFormFromRequested({});
      initial.topP = { mode: "varied", fixed: "", values: ["0.9", "0.90"] };
      await act(async () => root.render(<Harness initial={initial} language="pl" />));
      expect(host.querySelector('[data-testid="sampling-design-error"]')?.textContent).toMatch(/duplicate/i);
      expect(host.textContent).toContain("Konfiguracje samplingu");
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
