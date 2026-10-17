import type { getCopy } from "../../i18n";
import type { ProviderModel } from "../../providers/types";

export interface OpenRouterSamplingUiState {
  enabled: boolean;
  topP: string;
  topK: string;
  seed: string;
}

export interface OpenRouterSamplingControlsProps extends OpenRouterSamplingUiState {
  copy: ReturnType<typeof getCopy>;
  model: ProviderModel | null;
  onEnabled: (value: boolean) => void;
  onTopP: (value: string) => void;
  onTopK: (value: string) => void;
  onSeed: (value: string) => void;
}

type CapabilityState = "supported" | "unsupported" | "unknown";

function rawSupportedParameters(model: ProviderModel | null): string[] | null {
  if (!model) return null;
  const raw = model.rawMetadata.supported_parameters;
  return Array.isArray(raw) && raw.every((item) => typeof item === "string") ? raw as string[] : null;
}

function capabilityState(model: ProviderModel | null, parameter: string): CapabilityState {
  if (!model) return "unknown";
  if (model.capabilities.supportedParameters.includes(parameter)) return "supported";
  return rawSupportedParameters(model) ? "unsupported" : "unknown";
}

function capabilityLabel(copy: ReturnType<typeof getCopy>, state: CapabilityState): string {
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
  enabled,
  topP,
  topK,
  seed,
  onEnabled,
  onTopP,
  onTopK,
  onSeed,
}: OpenRouterSamplingControlsProps) {
  const topPState = capabilityState(model, "top_p");
  const topKState = capabilityState(model, "top_k");
  const seedState = capabilityState(model, "seed");
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
          <small>{copy.topPLead}</small>
        </label>
        <label>
          <span>Top K <small className={`sampling-capability ${topKState}`}>{capabilityLabel(copy, topKState)}</small></span>
          <input aria-label="Top K" type="range" min="0" max="200" step="1" value={topKRange} disabled={topKDisabled} onChange={(event) => onTopK(event.target.value)} />
          <input aria-label="Top K value" type="number" min="0" step="1" inputMode="numeric" value={topK} disabled={topKDisabled} placeholder={copy.autoProviderDefault} onChange={(event) => onTopK(event.target.value)} />
          <small>{copy.topKLead}</small>
        </label>
        <label>
          <span>Seed <small className={`sampling-capability ${seedState}`}>{capabilityLabel(copy, seedState)}</small></span>
          <div className="sampling-seed-row">
            <input aria-label="Seed value" type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" inputMode="numeric" value={seed} disabled={seedDisabled} placeholder={copy.autoProviderDefault} onChange={(event) => onSeed(event.target.value)} />
            <button type="button" className="secondary-button" disabled={seedDisabled} onClick={() => onSeed(String(safeRandomSeed()))}>{copy.randomizeSeed}</button>
          </div>
          <small>{copy.seedLead}</small>
        </label>
      </div>
      <small className="sampling-runtime-note">{copy.samplingRuntimeLead}</small>
    </div>
  </details>;
}
