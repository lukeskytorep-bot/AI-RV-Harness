import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("ORP1 operation-resource profile boundaries", () => {
  it("keeps operation semantics centralized instead of duplicating profile constants in workflows", () => {
    const profiles = source("src/providers/operationResourceProfiles.ts");
    expect(profiles).toContain('export type OperationTimeoutClass = "interactive" | "analytical" | "long_reasoning"');
    expect(profiles).toContain('export type StreamPresentation = "live" | "structured-final" | "hidden"');
    expect(profiles).toContain('export type CapacityRoutingPolicy = "default_auto" | "prefer_verified_fit"');
    expect(profiles).toContain('field_guide_update: {');
    expect(profiles).toContain('viewer_notes_reflection: {');
    expect(profiles).not.toContain("300_000");
    expect(profiles).not.toContain("300000");
  });

  it("routes E1 + ORP1 + S1 + S2 through the single I1 effective-envelope decision point", () => {
    const executor = source("src/providers/requestExecutor.ts");
    const integration = source("src/providers/effectiveRequestEnvelope.ts");
    expect(executor).toContain("resolveEffectiveRequestEnvelope");
    expect(executor).not.toContain("resolveOperationResourceProfile");
    expect(executor).not.toContain("resolveOpenRouterRoutingDecision");
    expect(executor).not.toContain("resolveStreamPresentation");
    expect(executor).not.toContain("resolveProviderTimeoutPolicy");
    expect(integration).toContain("resolveOperationResourceProfile");
    expect(integration).toContain('capacityRoutingPolicy === "prefer_verified_fit"');
    expect(integration).toContain("resolveOpenRouterRoutingDecision");
    expect(integration).toContain("resolveStreamPresentation");
    expect(integration).toContain("resolveProviderTimeoutPolicy");
    expect(integration).not.toContain("classifyOpenRouterEndpoint(");
  });

  it("marks Training and Research Viewer work explicitly while leaving normal RV sessions on the default inferred profile", () => {
    const training = source("src/features/training/trainingExecution.ts");
    const research = source("src/research/engine.ts");
    const rvLite = source("src/sessions/rvLiteController.ts");
    const rcp = source("src/sessions/controller.ts");
    expect(training).toContain('operationKind: "training_blind_viewer"');
    expect(research).toContain('operationKind: "research_viewer"');
    expect(rvLite).toContain("operationKind: input.operationKind");
    expect(rcp).toContain("operationKind: input.operationKind");
  });

  it("keeps streamPresentation workflow-aware through the single S2 resolver", () => {
    const profiles = source("src/providers/operationResourceProfiles.ts");
    const resolver = source("src/providers/streamPresentation.ts");
    expect(profiles).toContain("S2 resolves the final presentation centrally with workflow context before transport/UI consumes it.");
    expect(resolver).toContain("resolveStreamPresentation");
    expect(resolver).toContain('workflowContext === "training" || workflowContext === "research"');
    expect(resolver).toContain('presentation = "hidden"');
    expect(resolver).toContain('presentation = "structured-final"');

    const srcRoot = path.join(process.cwd(), "src");
    const consumers: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) { visit(absolute); continue; }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        const relative = path.relative(process.cwd(), absolute).replaceAll("\\", "/");
        if (relative === "src/providers/operationResourceProfiles.ts") continue;
        if (fs.readFileSync(absolute, "utf8").includes(".streamPresentation")) consumers.push(relative);
      }
    };
    visit(srcRoot);
    expect(consumers).toEqual(["src/providers/streamPresentation.ts"]);
  });

  it("keeps the 4096/8192 learning-object floors owned only by the centralized operation-resource policy", () => {
    const profiles = source("src/providers/operationResourceProfiles.ts");
    expect(profiles).toContain("LEARNING_OBJECT_INITIAL_MINIMUM_ALLOWANCE_TOKENS = 4096");
    expect(profiles).toContain("LEARNING_OBJECT_RECOVERY_MINIMUM_ALLOWANCE_TOKENS = 8192");
    expect(profiles).toContain("Math.max(baseAllowance, LEARNING_OBJECT_INITIAL_MINIMUM_ALLOWANCE_TOKENS)");
    expect(profiles).toContain("LEARNING_OBJECT_RECOVERY_MINIMUM_ALLOWANCE_TOKENS");

    for (const relative of [
      "src/features/training/trainingExecution.ts",
      "src/aiCenter/fieldGuideUpdate.ts",
      "src/aiCenter/viewerNotes.ts",
      "src/providers/native.ts",
      "src/providers/openRouterEndpointCapability.ts",
    ]) {
      const contents = source(relative);
      expect(contents).not.toContain("LEARNING_OBJECT_INITIAL_MINIMUM_ALLOWANCE_TOKENS");
      expect(contents).not.toContain("LEARNING_OBJECT_RECOVERY_MINIMUM_ALLOWANCE_TOKENS");
    }
  });

  it("keeps Judge/post-Reveal analytical headroom and uses capacity-bound learning-object budgets", () => {
    const judge = source("src/judge/engine.ts");
    const postReveal = source("src/sessions/postReveal.ts");
    const fieldGuide = source("src/aiCenter/fieldGuideUpdate.ts");
    const viewerNotes = source("src/aiCenter/viewerNotes.ts");
    expect(judge).toContain('operationKind: "judge"');
    expect(postReveal).toContain('operationKind: "post_reveal_viewer"');
    expect(postReveal).toContain('operationKind: "post_reveal_monitor"');
    expect(fieldGuide).toContain('operationKind: "field_guide_update"');
    expect(fieldGuide).toContain("learningObjectCapacityTokens: frozen.capacityTokens");
    expect(viewerNotes).toContain('operationKind: "viewer_notes_reflection"');
    expect(viewerNotes).toContain("learningObjectCapacityTokens: packet.capacityTokens");
  });
});
