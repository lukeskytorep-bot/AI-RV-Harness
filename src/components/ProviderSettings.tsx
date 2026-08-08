import { Check, KeyRound, Plus, RefreshCw, Server, ShieldCheck, Sparkles, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { getCopy } from "../i18n";
import { addProvider, refreshProviderModels, removeProvider } from "../providers/service";
import { PROVIDER_KINDS, type ProviderConfig, type ProviderKind, type ProviderModel } from "../providers/types";
import { isTauriRuntime } from "../storage";
import type { AppRepository } from "../storage/repository";

type Copy = ReturnType<typeof getCopy>;

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openrouter: "OpenRouter",
  google: "Google Gemini API",
  openai: "OpenAI",
  anthropic: "Anthropic",
  zai: "Z.AI",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  custom_openai: "Custom OpenAI-compatible",
};

export function ProviderSettings({ copy, repository, section = "all" }: { copy: Copy; repository: AppRepository | null; section?: "all" | "providers" | "models" }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const desktop = isTauriRuntime();

  const reload = async () => {
    if (!repository) return;
    const [nextProviders, nextModels] = await Promise.all([
      repository.listProviderConfigs(),
      repository.listProviderModels(),
    ]);
    setProviders(nextProviders);
    setModels(nextModels);
  };

  useEffect(() => {
    void reload();
  }, [repository]);

  const refresh = async (config: ProviderConfig) => {
    if (!repository) return;
    setBusyId(config.id);
    setError(null);
    try {
      await refreshProviderModels(repository, config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const remove = async (config: ProviderConfig) => {
    if (!repository || !window.confirm(copy.removeProviderConfirm)) return;
    setBusyId(config.id);
    setError(null);
    try {
      await removeProvider(repository, config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const add = async (input: { provider: ProviderKind; label: string; apiKey: string; baseUrl?: string }) => {
    if (!repository) return;
    setBusyId("new");
    setError(null);
    try {
      const config = await addProvider(repository, input);
      setDialogOpen(false);
      await refresh(config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      await reload();
      setBusyId(null);
    }
  };

  const modelCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models) counts.set(model.providerConfigId, (counts.get(model.providerConfigId) ?? 0) + 1);
    return counts;
  }, [models]);

  return (
    <>
      {section !== "models" && <section className="panel provider-settings wide-settings-panel">
        <div className="provider-heading">
          <div><span className="heading-orb"><KeyRound size={19} /></span><div><h2>{copy.providersApi}</h2><p>{copy.providersReady}</p></div></div>
          <button className="primary-button" onClick={() => setDialogOpen(true)} disabled={!desktop || !repository || busyId !== null}><Plus size={15} />{copy.addProvider}</button>
        </div>
        {!desktop && <div className="runtime-warning"><ShieldCheck size={16} />{copy.desktopProviderOnly}</div>}
        {error && <div className="provider-error" role="alert">{error}</div>}
        <div className="provider-list">
          {providers.length === 0 ? <p className="provider-empty">{copy.noProviders}</p> : providers.map((config) => (
            <article className="provider-row" key={config.id}>
              <span className="provider-logo"><Server size={18} /></span>
              <div className="provider-identity"><strong>{config.label}</strong><small>{PROVIDER_LABELS[config.provider]} · {config.credentialHint || "••••••••"}</small></div>
              <div className="provider-count"><small>{copy.cachedModels}</small><strong>{modelCount.get(config.id) ?? 0}</strong></div>
              <span className={`connection-state ${config.lastStatus ?? "idle"}`}>
                {config.lastStatus === "ok" ? <Check size={13} /> : <span className="state-dot" />}
                {config.lastStatus === "ok" ? copy.connectionOk : config.lastStatus === "error" ? copy.connectionError : copy.notTested}
              </span>
              <div className="provider-actions">
                <button className="secondary-button" disabled={!desktop || busyId !== null} onClick={() => void refresh(config)} title={copy.testRefresh}>
                  <RefreshCw size={14} className={busyId === config.id ? "spin-icon" : ""} />{busyId === config.id ? copy.refreshing : copy.testRefresh}
                </button>
                <button className="icon-button danger" disabled={!desktop || busyId !== null} onClick={() => void remove(config)} title={copy.removeProvider}><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>}
      {section !== "providers" && <ModelRegistry copy={copy} repository={repository} providers={providers} models={models} onChanged={reload} />}
      {dialogOpen && <AddProviderDialog copy={copy} busy={busyId === "new"} onClose={() => setDialogOpen(false)} onSubmit={add} />}
    </>
  );
}

function ModelRegistry({ copy, repository, providers, models, onChanged }: { copy: Copy; repository: AppRepository | null; providers: ProviderConfig[]; models: ProviderModel[]; onChanged: () => Promise<void> }) {
  const [providerFilter, setProviderFilter] = useState("all");
  const [recommendedOnly, setRecommendedOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const visible = models.filter((model) => (providerFilter === "all" || model.providerConfigId === providerFilter) && (!recommendedOnly || model.recommended) && (!favoritesOnly || model.favorite));
  const toggleFavorite = async (model: ProviderModel) => {
    if (!repository) return;
    await repository.setProviderModelFavorite(model.providerConfigId, model.modelId, !model.favorite);
    await onChanged();
  };
  return (
    <section className="panel model-registry wide-settings-panel">
      <div className="provider-heading registry-heading">
        <div><span className="heading-orb"><Sparkles size={19} /></span><div><h2>{copy.modelRegistry}</h2><p>{copy.modelRegistryLead}</p></div></div>
        <div className="registry-filters">
          <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
            <option value="all">{copy.provider}: all</option>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
          <button className={favoritesOnly ? "filter-toggle active" : "filter-toggle"} onClick={() => setFavoritesOnly((value) => !value)}><Star size={13} fill={favoritesOnly ? "currentColor" : "none"} />{copy.favorites}</button>
          <button className={recommendedOnly ? "filter-toggle active" : "filter-toggle"} onClick={() => setRecommendedOnly((value) => !value)}><Sparkles size={13} />{copy.recommended}</button>
        </div>
      </div>
      {visible.length === 0 ? <p className="provider-empty">{copy.noModels}</p> : (
        <div className="model-table-wrap"><table className="model-table"><thead><tr><th>{copy.models}</th><th>{copy.context}</th><th>{copy.outputLimit}</th><th>{copy.reasoning}</th><th>{copy.temperature}</th></tr></thead><tbody>
          {visible.slice(0, 250).map((model) => <tr key={`${model.providerConfigId}:${model.modelId}`}>
            <td><span className="model-name-line"><button className={`favorite-button${model.favorite ? " active" : ""}`} type="button" title={copy.favoriteModel} aria-label={`${copy.favoriteModel}: ${model.displayName}`} onClick={() => void toggleFavorite(model)}><Star size={13} fill={model.favorite ? "currentColor" : "none"} /></button><strong>{model.displayName}</strong></span><small>{model.modelId}</small>{model.recommended && <span className="micro-tag"><Sparkles size={10} />{copy.recommended}</span>}</td>
            <td>{formatTokens(model.capabilities.contextTokens)}</td>
            <td>{formatTokens(model.capabilities.maxOutputTokens)}</td>
            <td>{model.capabilities.reasoning.efforts.length ? model.capabilities.reasoning.efforts.map((item) => item.toUpperCase()).join(" · ") : model.capabilities.reasoning.supported ? copy.unknown : "—"}</td>
            <td>{model.capabilities.temperature.supported ? `${copy.supported}${model.capabilities.temperature.max !== undefined ? ` ≤ ${model.capabilities.temperature.max}` : ""}` : "—"}</td>
          </tr>)}
        </tbody></table></div>
      )}
    </section>
  );
}

function AddProviderDialog({ copy, busy, onClose, onSubmit }: { copy: Copy; busy: boolean; onClose: () => void; onSubmit: (input: { provider: ProviderKind; label: string; apiKey: string; baseUrl?: string }) => Promise<void> }) {
  const [provider, setProvider] = useState<ProviderKind>("openrouter");
  const [label, setLabel] = useState(PROVIDER_LABELS.openrouter);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const secret = apiKey;
    setApiKey("");
    void onSubmit({ provider, label, apiKey: secret, ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}) });
  };
  const changeProvider = (next: ProviderKind) => {
    setProvider(next);
    setLabel(PROVIDER_LABELS[next]);
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={busy ? undefined : onClose}>
      <section className="modal form-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading"><div><small>{copy.providersApi}</small><h2>{copy.addProvider}</h2><p>{copy.providersReady}</p></div><button className="icon-button" type="button" disabled={busy} onClick={onClose}><X size={19} /></button></div>
        <form onSubmit={submit}>
          <label>{copy.provider}<select value={provider} onChange={(event) => changeProvider(event.target.value as ProviderKind)}>{PROVIDER_KINDS.map((kind) => <option key={kind} value={kind}>{PROVIDER_LABELS[kind]}</option>)}</select></label>
          <label>{copy.providerLabel}<input value={label} onChange={(event) => setLabel(event.target.value)} required /></label>
          {provider === "custom_openai" && <label>{copy.baseUrl}<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" required /></label>}
          <label>{copy.apiKey}<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></label>
          <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>{copy.cancel}</button><button className="primary-button" type="submit" disabled={busy}>{busy ? copy.refreshing : copy.saveAndTest}</button></div>
        </form>
      </section>
    </div>
  );
}

function formatTokens(value?: number): string {
  if (!value) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
