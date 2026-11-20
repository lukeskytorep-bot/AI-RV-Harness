import { activateOllamaCloud } from "../providers/native";
import { NativeGenerationPreferences } from "./NativeGenerationPreferences";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTauriRuntime } from "../storage";
import { freezeNativeConnection, normalizeNativeConnectionEndpoint, OLLAMA_CLOUD_BASE, isOllamaCloudEndpoint } from "../providers/nativeConnectionIdentity";
import { discoverNativeConnection, listNativeConnections, saveNativeConnection, type NativeConnectionView } from "../providers/nativeDiscovery";

const words = {
  en: { title: "Ollama Cloud", pending: "Configuration and discovery only. Generation is not available yet.", add: "Add Ollama Cloud", edit: "Edit connection", refresh: "Refresh discovery", label: "Connection name", url: "Native server base URL", urlHint: "Enter the base before /api (not /v1). Use HTTPS, or HTTP on localhost/127.0.0.1/[::1].", auth: "Authentication", none: "None (local server)", bearer: "Bearer (HTTPS proxy)", key: "API key", keyHint: "Leave blank to reuse the saved key. Switching from None requires a new key.", model: "Exact model identifier", modelHint: "Optional before the first discovery. Select an exact model from the saved list afterwards.", save: "Test and save", cancel: "Cancel", target: "Test destination", warning: "Bearer mode sends the entered or saved key to this address. None sends no credentials. Only successful discovery saves the changes.", missing: "The selected model is absent from the server list. Its identifier is retained.", unknown: "Model details are unavailable; capabilities remain unknown.", context: "Declared model context (not verified allocation)", desktop: "Available in the desktop application.", version: "Server version", unknownVersion: "Unknown", cloudService: "Hosted Ollama Cloud API", cloudWarning: "The entered or saved key will be sent to Ollama Cloud to verify access and list models. The access test reads account balance metadata without saving it. No text is generated.", cloudHint: "Direct cloud API: no local Ollama installation. A Bearer API key is required. Use the exact model name from discovery; do not append a local cloud alias.", digest: "Model digest", captured: "Discovery time", empty: "No native connections configured.", provenance: "Model metadata", failed: "Native discovery failed. Check the server and authentication." },
  pl: { title: "Ollama Cloud", pending: "Tylko konfiguracja i discovery. Generowanie nie jest jeszcze dostępne.", add: "Dodaj Ollama Cloud", edit: "Edytuj połączenie", refresh: "Odśwież discovery", label: "Nazwa połączenia", url: "Adres bazowy serwera Native", urlHint: "Podaj bazę przed /api (bez /v1). Użyj HTTPS lub HTTP na localhost/127.0.0.1/[::1].", auth: "Uwierzytelnianie", none: "Brak (serwer lokalny)", bearer: "Bearer (proxy HTTPS)", key: "Klucz API", keyHint: "Pozostaw puste, aby użyć zapisanego klucza. Zmiana z Brak wymaga nowego klucza.", model: "Dokładny identyfikator modelu", modelHint: "Opcjonalny przed pierwszym discovery. Następnie wybierz dokładny model z zapisanej listy.", save: "Przetestuj i zapisz", cancel: "Anuluj", target: "Adres docelowy testu", warning: "Tryb Bearer wyśle podany lub zapisany klucz na ten adres. Tryb Brak nie wysyła poświadczeń. Zmiany zapiszą się dopiero po udanym discovery.", missing: "Wybranego modelu nie ma na liście serwera. Jego identyfikator został zachowany.", unknown: "Szczegóły modelu są niedostępne; możliwości pozostają nieznane.", context: "Deklarowany kontekst modelu (bez potwierdzenia alokacji)", desktop: "Dostępne w aplikacji desktopowej.", version: "Wersja serwera", unknownVersion: "Nieznana", cloudService: "API usługi Ollama Cloud", cloudWarning: "Podany lub zapisany klucz zostanie wysłany do Ollama Cloud, aby sprawdzić dostęp i pobrać modele. Test dostępu odczyta metadane salda konta bez ich zapisywania. Nie generuje tekstu.", cloudHint: "Bezpośrednie API chmury: lokalna instalacja Ollama nie jest potrzebna. Wymagany jest klucz Bearer. Użyj dokładnej nazwy modelu z discovery, bez dopisywania lokalnego aliasu cloud.", digest: "Digest modelu", captured: "Czas discovery", empty: "Nie skonfigurowano połączeń Native.", provenance: "Metadane modelu", failed: "Discovery Native nie powiodło się. Sprawdź serwer i uwierzytelnianie." },
};
export function NativeConnectionSettings({ language = "en", onActivated }: { language?: "en" | "pl"; onActivated?(id: string): Promise<void> }) {
  const t = words[language]; const desktop = isTauriRuntime();
  const [views, setViews] = useState<NativeConnectionView[]>([]);
  const [editing, setEditing] = useState<NativeConnectionView | "new" | null>(null);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState<string>();
  const reload = async () => { const result = await listNativeConnections(); setViews(Array.isArray(result) ? result : []); };
  useEffect(() => { if (desktop) void reload().catch(() => setError(t.failed)); }, [desktop, t.failed]);
  const refresh = async (view: NativeConnectionView, model = view.discovery?.selectedModel) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(undefined);
    try { await discoverNativeConnection(freezeNativeConnection(view.connection), model); await reload(); }
    catch { setError(t.failed); } finally { lock.current = false; setBusy(false); }
  };
  return <section className="panel provider-settings wide-settings-panel">
    <div className="provider-heading"><div><div><h2>{t.title}</h2><p>{language === "pl" ? "Zapisane konta Cloud można udostępnić w profilach. Sterowanie thinking zależy od wybranego modelu; Auto używa jego ustawień domyślnych." : "Saved Cloud accounts can be activated for profiles. Thinking controls depend on the selected model; Auto uses its default."}</p></div></div><button className="primary-button" disabled={!desktop || busy} onClick={() => setEditing("new")}>{t.add}</button></div>
    {!desktop && <p>{t.desktop}</p>}
    {error && <p role="alert" className="provider-error">{error}</p>}
    {views.length === 0 && <p>{t.empty}</p>}
    {views.map(view => { const { connection: c, discovery: d } = view; const selected = d?.models.find(m => m.name === d.selectedModel); return <article key={c.id} className="provider-card">
      <h3>{c.label}</h3><p style={{ overflowWrap: "anywhere" }}>{c.baseUrl} · {c.authMode}</p>
      <button className="ghost-button" disabled={busy} onClick={() => setEditing(view)}>{t.edit}</button>
      <button className="ghost-button" disabled={busy} onClick={() => void refresh(view)}>{t.refresh}</button>
      {onActivated && isOllamaCloudEndpoint(c.baseUrl) && c.authMode === "bearer" && <button className="secondary-button" disabled={busy} onClick={() => { if (lock.current) return; lock.current = true; setBusy(true); setError(undefined); void activateOllamaCloud(freezeNativeConnection(c)).then(onActivated).catch(() => setError(t.failed)).finally(() => {lock.current = false; setBusy(false);}); }}>{language === "pl" ? "Udostępnij w profilach" : "Activate for profiles"}</button>}
      {d && <><p>{isOllamaCloudEndpoint(c.baseUrl) ? t.cloudService : `${t.version}: ${d.serverVersion ?? t.unknownVersion}`} · {t.captured}: {new Date(d.capturedAtMs).toLocaleString(language)}</p>
        <label>{t.model}<select disabled={busy} value={d.selectedModel ?? ""} onChange={e => void refresh(view, e.target.value || undefined)}><option value="">—</option>{d.selectedModel && !d.selectedAvailable && <option value={d.selectedModel}>{d.selectedModel}</option>}{d.models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}</select></label>
        {d.selectedModel && !d.selectedAvailable && <p role="status">{t.missing}</p>}
        {selected?.digest && <p style={{ overflowWrap: "anywhere" }}>{t.digest}: {selected.digest}</p>}
        {d.detailsUnavailable && <p>{t.unknown}</p>}
        {d.details?.declaredContextTokens != null && <p>{t.context}: {d.details.declaredContextTokens}</p>}
        {d.selectedAvailable && d.selectedModel && <NativeGenerationPreferences view={view} language={language} />}
        {d.details && <details><summary>{t.provenance}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(d.details, null, 2)}</pre></details>}
      </>}
    </article>; })}
    {editing && <NativeEditor key={editing === "new" ? "new" : editing.connection.id} view={editing === "new" ? undefined : editing} language={language} onCancel={() => setEditing(null)} onSaved={async () => { await reload(); setEditing(null); }} onUncertain={reload} />}
  </section>;
}
function NativeEditor({ view, language, onCancel, onSaved, onUncertain }: { view?: NativeConnectionView; language: "en" | "pl"; onCancel(): void; onSaved(): Promise<void>; onUncertain(): Promise<void> }) {
  const t = words[language]; const c = view?.connection;
  const [label, setLabel] = useState(c?.label ?? "Ollama Cloud"); const [url, setUrl] = useState(c?.baseUrl ?? OLLAMA_CLOUD_BASE);
  const cloud = !c || isOllamaCloudEndpoint(url);
  const [auth, setAuth] = useState<"none" | "bearer">(c && !isOllamaCloudEndpoint(c.baseUrl) ? c.authMode : "bearer"); const [key, setKey] = useState("");
  const [model, setModel] = useState(view?.discovery?.selectedModel ?? ""); const [busy, setBusy] = useState(false); const lock = useRef(false); const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => { e.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); setError(undefined);
    try { await saveNativeConnection({ expected: c ? freezeNativeConnection(c) : undefined, label, baseUrl: normalizeNativeConnectionEndpoint(url), authMode: cloud ? "bearer" : auth, apiKey: (cloud || auth === "bearer") && key ? key : undefined, selectedModel: model || undefined }); setKey(""); await onSaved(); }
    catch { setError(t.failed); await onUncertain().catch(() => {}); } finally { lock.current = false; setBusy(false); }
  };
  return <div className="modal-backdrop"><div className="modal form-modal" role="dialog" aria-modal="true" aria-label={c ? t.edit : t.add}><form style={{ overflowY: "auto" }} onSubmit={e => void submit(e)}>
    <h3>{c ? t.edit : t.add}</h3>{cloud && <p>{t.cloudHint}</p>}
    <label>{t.label}<input required value={label} disabled={busy} onChange={e => setLabel(e.target.value)} /></label>
    <label>{t.url}<input required type="url" value={url} readOnly={!c || isOllamaCloudEndpoint(c.baseUrl)} disabled={busy} onChange={e => setUrl(e.target.value)} /><small>{cloud ? t.cloudService : t.urlHint}</small></label>
    {cloud ? <p>{t.auth}: Bearer</p> : <label>{t.auth}<select value={auth} disabled={busy} onChange={e => { setAuth(e.target.value as "none" | "bearer"); setKey(""); }}><option value="none">{t.none}</option><option value="bearer">{t.bearer}</option></select></label>}
    {(cloud || auth === "bearer") && <label>{t.key}<input type="password" autoComplete="new-password" value={key} disabled={busy} required={c?.authMode !== "bearer"} onChange={e => setKey(e.target.value)} /><small>{t.keyHint}</small></label>}
    <label>{t.model}<input value={model} disabled={busy} onChange={e => setModel(e.target.value)} /><small>{t.modelHint}</small></label>
    <p style={{ overflowWrap: "anywhere" }}>{t.target}: <strong>{url}</strong></p><p>{cloud ? t.cloudWarning : t.warning}</p>
    {error && <p role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" className="ghost-button" disabled={busy} onClick={onCancel}>{t.cancel}</button><button className="primary-button" disabled={busy} type="submit">{t.save}</button></div>
  </form></div></div>;
}
