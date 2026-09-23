import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function normalizeS2MonitorStreamingWiring(value: string): string {
  return value
    .replace(', ProviderStreamEvent } from "../providers/types";', ' } from "../providers/types";')
    .replace('import type { StreamWorkflowContext } from "../providers/streamPresentation";\n', "")
    .replace('  streamWorkflowContext?: StreamWorkflowContext;\n  onStreamEvent?: (event: ProviderStreamEvent) => void;\n', "")
    .replace('; signal?: AbortSignal; onStreamEvent?: (event: ProviderStreamEvent) => void }) => Promise<ProviderChatResponse>;', ' }) => Promise<ProviderChatResponse>;')
    .replace(', streamWorkflowContext: input.streamWorkflowContext, onStreamEvent: input.onStreamEvent, attempt:', ', attempt:');
}

function aggregateHash(roots: string[], normalizeMonitorStreaming = false): string {
  const files = roots.flatMap((root) => {
    const absolute = path.join(process.cwd(), root);
    if (!fs.existsSync(absolute)) return [];
    if (fs.statSync(absolute).isFile()) return [absolute];
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const item = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(item) : [item];
    });
    return walk(absolute);
  }).sort((a, b) => {
    const left = path.relative(process.cwd(), a).split(path.sep).join("/");
    const right = path.relative(process.cwd(), b).split(path.sep).join("/");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(process.cwd(), file).split(path.sep).join("/");
    const bytes = fs.readFileSync(file);
    const protectedBytes = normalizeMonitorStreaming && relative === "src/monitor/engine.ts"
      ? Buffer.from(normalizeS2MonitorStreamingWiring(bytes.toString("utf8")))
      : bytes;
    hash.update(relative); hash.update("\0"); hash.update(protectedBytes); hash.update("\0");
  }
  return hash.digest("hex");
}

describe("VIEWER-LEARNING-2 boundaries", () => {
  it("orders Training post-Reveal work as Review -> Field Guide Update -> Viewer Notes Reflection", () => {
    const training = source("src/features/training/trainingExecution.ts");
    const review = training.indexOf("runAutomaticPostRevealReview({");
    const fieldGuide = training.indexOf("runFieldGuideUpdate({");
    const viewerNotes = training.indexOf("runViewerNoteReflection({");
    expect(review).toBeGreaterThan(0);
    expect(fieldGuide).toBeGreaterThan(review);
    expect(viewerNotes).toBeGreaterThan(fieldGuide);
  });

  it("never wires Field Guide Update into Research", () => {
    const research = source("src/research/engine.ts");
    expect(research).not.toContain("runFieldGuideUpdate");
    expect(research).not.toContain("fieldGuideUpdate");
  });

  it("allows frozen Field Guide snapshots in Research without any learning write path", () => {
    const builder = source("src/features/research/ResearchBuilder.tsx");
    const policy = source("src/research/fieldGuidePolicy.ts");
    expect(builder).toContain("captureCurrentResearchFieldGuide");
    expect(builder).toContain("listResearchFieldGuideHistory");
    expect(policy).toContain("getExistingFieldGuideBundle");
    expect(`${builder}\n${policy}`).not.toContain("createFieldGuideVersion(");
    expect(`${builder}\n${policy}`).not.toContain("runFieldGuideUpdate(");
  });

  it("keeps Viewer Notes base-version mechanics byte-identical to the accepted VIEWER-LEARNING-1 base", () => {
    // viewerNotes.ts is intentionally superseded by VIEWER-NOTES-FIELD-GUIDE-SEPARATION-1.
    // Keep the independent base-version mechanics frozen instead of pinning the whole Reflection implementation.
    expect(aggregateHash(["src/aiCenter/baseVersion.ts"])).toBe("442f8507a98b004a616c3327209b7317e2c0e9f057d984565c2ddef77aaee9aa");
  });

  it.each([
    ["Monitor", ["src/monitor", "src/features/monitor", "src/resources/systemPrompts.ts"], "87097f8e0db0e4b4da63a382bcb5f73656a50535a854c12d8c5c09c8e33e3f47", true],
    ["protocols", ["src/protocols", "src/resources/protocolRegistry.ts", "src/resources/protocols"], "2a324ad15de07985c968622be28174daa6e74ce4edd1442c03e86c4109211263", false],
  ] as const)("keeps %s byte-identical to the accepted base after normalizing allowed S2 wiring", (_label, roots, expected, normalizeMonitorStreaming) => {
    expect(aggregateHash([...roots], normalizeMonitorStreaming)).toBe(expected);
  });

  it("allows intentional ORP1 Judge resource wiring without changing the Judge prompt or score-freeze contract", () => {
    const judge = source("src/judge/engine.ts");
    const prompt = source("src/judge/prompt.ts");
    expect(judge).toContain('operationKind: "judge"');
    expect(judge).toContain("recordFrozenJudgeResult");
    expect(prompt).toContain("JUDGE");
    expect(judge).not.toContain("field_guide_update");
    expect(judge).not.toContain("viewer_notes_reflection");
  });

  it("allows intentional E1 provider evolution while preserving retry, credential and continuation invariants", () => {
    const native = source("src/providers/native.ts");
    const executor = source("src/providers/requestExecutor.ts");
    const retry = source("src/providers/retry.ts");
    const capability = source("src/providers/openRouterEndpointCapability.ts");

    expect(native).toContain('invoke<NativeChatResponse>("provider_chat"');
    expect(native).toContain('invoke<unknown>("provider_discover_model_endpoints"');
    expect(native).toContain("credentialId: config.credentialId");
    expect(native).not.toContain("credentialSecret");
    expect(executor).toContain("providerChatAttempt");
    expect(executor).toContain("structuredClone(message.continuationState)");
    expect(executor).toContain("resolveOpenRouterRoutingDecision");
    expect(retry).toContain("providerRetryAllowance");
    expect(retry).toContain("context length");
    expect(capability).toContain('"PROVEN_FIT" | "PROVEN_NO" | "UNKNOWN"');
    expect(capability).toContain("ROUTING_SAFETY_MARGIN_RATIO = 0.25");
  });
});
