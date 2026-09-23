import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");

describe("I1 transport-capability integration boundaries", () => {
  it("keeps one pre-dispatch integration owner in the provider layer", () => {
    const executor = read("src/providers/requestExecutor.ts");
    const integration = read("src/providers/effectiveRequestEnvelope.ts");

    expect(executor).toContain("resolveEffectiveRequestEnvelope");
    expect(executor).not.toContain("createOpenRouterCapacityEnvelope");
    expect(executor).not.toContain("resolveOperationResourceProfile");
    expect(executor).not.toContain("resolveOpenRouterRoutingDecision");
    expect(executor).not.toContain("resolveStreamPresentation");
    expect(executor).not.toContain("resolveProviderTimeoutPolicy");

    expect(integration).toContain("estimateProviderInputTokens");
    expect(integration).toContain("createOpenRouterCapacityEnvelope");
    expect(integration).toContain("resolveOperationResourceProfile");
    expect(integration).toContain("resolveOpenRouterRoutingDecision");
    expect(integration).toContain("resolveStreamPresentation");
    expect(integration).toContain("resolveProviderTimeoutPolicy");
    expect(integration).toContain("reconcileFinalOpenRouterRouting");
    expect(integration).toContain("hardOrderSelectors");
    expect(integration).toContain("openRouterProviderSlugMatches");
    expect(integration).not.toContain("function normalizeOpenRouterEndpointDiscovery");
  });

  it("sizes the finalized logical payload before ORP1/endpoint/presentation dispatch decisions", () => {
    const integration = read("src/providers/effectiveRequestEnvelope.ts");
    const executor = read("src/providers/requestExecutor.ts");

    const estimateAt = integration.indexOf("estimateProviderInputTokens(input.messages)");
    const marginAt = integration.indexOf("createOpenRouterCapacityEnvelope({");
    const profileAt = integration.indexOf("resolveOperationResourceProfile({");
    const endpointAt = integration.indexOf("resolveOpenRouterRoutingDecision({");
    const presentationAt = integration.indexOf("resolveStreamPresentation({");
    const timeoutAt = integration.indexOf("resolveProviderTimeoutPolicy(");
    expect(estimateAt).toBeGreaterThan(-1);
    expect(marginAt).toBeGreaterThan(estimateAt);
    expect(profileAt).toBeGreaterThan(marginAt);
    expect(endpointAt).toBeGreaterThan(profileAt);
    expect(presentationAt).toBeGreaterThan(endpointAt);
    expect(timeoutAt).toBeGreaterThan(presentationAt);

    const cloneAt = executor.indexOf("structuredClone(message.continuationState)");
    const resolveAt = executor.indexOf("const dispatch = await resolveEffectiveRequestEnvelope({");
    const dispatchAt = executor.indexOf("result = await executeProviderRequest({");
    expect(cloneAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(cloneAt);
    expect(dispatchAt).toBeGreaterThan(resolveAt);
  });

  it("keeps the effective envelope compact and free of prompt, credential and continuation payloads", () => {
    const integration = read("src/providers/effectiveRequestEnvelope.ts");
    const interfaceStart = integration.indexOf("export interface EffectiveRequestEnvelope {");
    const interfaceEnd = integration.indexOf("}\n\nexport interface EffectiveDispatchDecision", interfaceStart);
    const contract = integration.slice(interfaceStart, interfaceEnd);
    expect(contract).toContain("estimatedInputTokens");
    expect(contract).toContain("routingSafetyMarginTokens");
    expect(contract).toContain("eligibleProviderRoutes");
    expect(contract).toContain("presentationMode");
    expect(contract).not.toMatch(/messages|prompt|credential|continuation|fieldGuide|viewerNotes|secret/i);
  });

  it("keeps effective request integration owned by provider infrastructure rather than workflow controllers", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const consumers: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) { visit(absolute); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.(?:test|spec)\.tsx?$/.test(entry.name)) continue;
        const text = fs.readFileSync(absolute, "utf8");
        if (text.includes('from "./effectiveRequestEnvelope"') || text.includes('from "../providers/effectiveRequestEnvelope"')) {
          consumers.push(path.relative(process.cwd(), absolute).replaceAll("\\", "/"));
        }
      }
    };
    visit(sourceRoot);
    expect(consumers.sort()).toEqual([
      "src/providers/debug.ts",
      "src/providers/native.ts",
      "src/providers/requestExecutor.ts",
    ]);
  });

  it("keeps endpoint discovery normalization owned only by E1", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const owners: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) { visit(absolute); continue; }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const text = fs.readFileSync(absolute, "utf8");
        if (text.includes("normalizeOpenRouterEndpointDiscovery")) {
          owners.push(path.relative(process.cwd(), absolute).replaceAll("\\", "/"));
        }
      }
    };
    visit(sourceRoot);
    expect(owners).toEqual(["src/providers/openRouterEndpointCapability.ts"]);
  });

  it("keeps transport diagnostics in volatile provider debug metadata instead of the native request body", () => {
    const native = read("src/providers/native.ts");
    const debug = read("src/providers/debug.ts");
    expect(native).toContain("transportEnvelope?: EffectiveRequestEnvelope");
    expect(native).toContain("transport: structuredClone(input.transportEnvelope)");
    expect(debug).toContain("transport?: EffectiveRequestEnvelope");
    const ipcRequestStart = native.indexOf('response = await invoke<NativeChatResponse>("provider_chat", {');
    const ipcRequestEnd = native.indexOf("});\n  } catch", ipcRequestStart);
    expect(native.slice(ipcRequestStart, ipcRequestEnd)).not.toContain("transportEnvelope");
  });
});
