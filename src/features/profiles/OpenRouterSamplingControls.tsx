import type { getCopy } from "../../i18n";
import type { ProviderKind, ProviderModel } from "../../providers/types";
import { openRouterSamplingModelCapabilityState, type OpenRouterSamplingModelCapabilityState } from "./openRouterSamplingModelCapability";

export interface OpenRouterSamplingUiState {
  enabled: boolean;
  topP: string;
  topK: string;
  seed: string;
}

export interface OpenRouterSamplingControlsProps extends OpenRouterSamplingUiState {
  copy: ReturnType<typeof getCopy>;
  model: ProviderModel | null;
  providerKind?: ProviderKind;
  onEnabled: (value: boolean) => void;
  onTopP: (value: string) => void;
  onTopK: (value: string) => void;
  onSeed: (value: string) => void;
}

function capabilityLabel(copy: ReturnType<typeof getCopy>, state: OpenRouterSamplingModelCapabilityState): string {
  if (state === "supported") return copy.samplingSupported;
  if (state === "unsupported") return copy.samplingUnsupported;
  return copy.samplingUnknown;
}

function safeRandomSeed(): number {
  const words = new Uint32Array(2);
  globalThis.crypto.getRandomValues(words);
  // 21 high bits + 32 low bits = 53 bits, then clamp to MAX_SAFE_INTEGER.
  const high = words[0] & 0x1fffff;
  return Math.min(high * 0x1_0000_0000 + words[1], Number.MAX_SAFE_INTEGER);
}

export function OpenRouterSamplingControls({
  copy,
  model,
  providerKind,
  enabled,
  topP,
  topK,
  seed,
  onEnabled,
  onTopP,
  onTopK,
  onSeed,
}: OpenRouterSamplingControlsProps) {
  const customOpenAi = providerKind === "custom_openai";
  const mistralDirect = providerKind === "mistral";
  const topPState = customOpenAi || mistralDirect ? "supported" : openRouterSamplingModelCapabilityState(model, "top_p");
  const topKState = customOpenAi || mistralDirect ? "supported" : openRouterSamplingModelCapabilityState(model, "top_k");
  const seedState = customOpenAi || mistralDirect ? "supported" : openRouterSamplingModelCapabilityState(model, "seed");
  const topPDisabled = !enabled || topPState !== "supported";
  const topKDisabled = !enabled || topKState !== "supported";
  const seedDisabled = !enabled || seedState !== "supported";
  const topPRange = topP === "" ? 1 : Math.max(0, Math.min(1, Number(topP) || 0));
  const topKNumber = topK === "" ? 0 : Number(topK);
  const topKRange = Number.isFinite(topKNumber) ? Math.max(0, Math.min(200, topKNumber)) : 0;

  return <details className="openrouter-sampling-controls">
    <summary>{copy.additionalSamplingParameters}<span>{enabled ? copy.samplingEnabled : copy.samplingDisabled}</span></summary>
    <div className="openrouter-sampling-body">
      <label className="sampling-enable-row">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        <span><strong>{copy.enableAdditionalSampling}</strong><small>{copy.additionalSamplingLead}</small></span>
      </label>
      <div className="sampling-parameter-grid">
        <label>
          <span>Top P <small className={`sampling-capability ${topPState}`}>{capabilityLabel(copy, topPState)}</small></span>
          <input aria-label="Top P" type="range" min="0" max="1" step="0.01" value={topPRange} disabled={topPDisabled} onChange={(event) => onTopP(event.target.value)} />
          <input aria-label="Top P value" type="number" min="0" max="1" step="any" inputMode="decimal" value={topP} disabled={topPDisabled} placeholder={copy.autoProviderDefault} onChange={(event) => onTopP(event.target.value)} />
          {enabled && topPState !== "supported" && topP !== "" && <button type="button" className="secondary-button sampling-auto-button" aria-label={`${copy.setSamplingAuto}: Top P`} onClick={() => onTopP("")}>{copy.setSamplingAuto}</button>}
          {topP === "" && <small className="sampling-auto-state">{copy.samplingAutoInactive}</small>}
          <small>{copy.topPLead}</small>
        </label>
        <label>
          <span>Top K <small className={`sampling-capability ${topKState}`}>{capabilityLabel(copy, topKState)}</small></span>
          <input aria-label="Top K" type="range" min="0" max="200" step="1" value={topKRange} disabled={topKDisabled} onChange={(event) => onTopK(event.target.value)} />
          <input aria-label="Top K value" type="number" min="0" step="1" inputMode="numeric" value={topK} disabled={topKDisabled} placeholder={copy.autoProviderDefault} onChange={(event) => onTopK(event.target.value)} />
          {enabled && topKState !== "supported" && topK !== "" && <button type="button" className="secondary-button sampling-auto-button" aria-label={`${copy.setSamplingAuto}: Top K`} onClick={() => onTopK("")}>{copy.setSamplingAuto}</button>}
          {topK === "" && <small className="sampling-auto-state">{copy.samplingAutoInactive}</small>}
          <small>{copy.topKLead}</small>
        </label>
        <label>
          <span>Seed <small className={`sampling-capability ${seedState}`}>{capabilityLabel(copy, seedState)}</small></span>
          <div className="sampling-seed-row">
            <input aria-label="Seed value" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" value={seed} disabled={seedDisabled} placeholder={copy.autoProviderDefault} onChange={(event) => onSeed(event.target.value)} />
            <button type="button" className="secondary-button" disabled={seedDisabled} onClick={() => onSeed(String(safeRandomSeed()))}>{copy.randomizeSeed}</button>
          </div>
          {enabled && seedState !== "supported" && seed !== "" && <button type="button" className="secondary-button sampling-auto-button" aria-label={`${copy.setSamplingAuto}: Seed`} onClick={() => onSeed("")}>{copy.setSamplingAuto}</button>}
          {seed === "" && <small className="sampling-auto-state">{copy.samplingAutoInactive}</small>}
          <small>{copy.seedLead}</small>
        </label>
      </div>
      <small className="sampling-runtime-note">{customOpenAi ? copy.samplingCustomRuntimeLead : mistralDirect ? copy.samplingMistralRuntimeLead : copy.samplingRuntimeLead}</small>
    </div>
  </details>;
}
