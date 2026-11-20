import { useEffect, useRef, useState } from "react";
import { runCloudConformance, type CloudConformanceReport } from "../providers/cloudConformance";
import type { ProviderConfig, ProviderModel } from "../providers/types";
import type { AppRepository } from "../storage/repository";
import { saveTextFile } from "../storage/native";
const words = {
  pl: { title: "Test wieloturowości Ollama Cloud", lead: "Ten test wykona najwyżej dwa krótkie wywołania na https://ollama.com/api/chat z zapisanym kluczem. Mogą być płatne. Każde ma limit 4096 tokenów odpowiedzi, bez automatycznego ponawiania. Test używa wyłącznie losowego znacznika, bez danych sesji.", warning: "Poprawne odtworzenie znacznika nie dowodzi zachowania pełnego kontekstu ani odrzucania zbyt długiego wejścia. Tryby automatyczne pozostają zablokowane.", model: "Dokładny model", run: "Uruchom test (do 2 wywołań)", stop: "STOP", close: "Zamknij", export: "Zapisz raport JSON", missing: "Najpierw odśwież listę modeli tego połączenia.", observed: "Zaobserwowano odtworzenie znacznika w drugiej turze.", not_observed: "Nie zaobserwowano wymaganego wyniku. Nie oznacza to dowodu braku obsługi wielu tur.", cancelled: "Test zatrzymany. Nie wysłano kolejnego wywołania; rozpoczęte żądanie mogło zostać naliczone.", failed: "Test nie został ukończony. Zapisz raport i sprawdź połączenie.", changed: "Połączenie, klucz lub zapisane metadane modelu zmieniły się. Test zatrzymano.", working: "Test trwa…", turns: "Zapisane etapy", saveError: "Nie udało się zapisać raportu. Spróbuj ponownie." },
  en: { title: "Ollama Cloud multi-turn test", lead: "This test makes at most two short calls to https://ollama.com/api/chat using the saved key. Calls may be billed. Each has a 4096-token response budget and no automatic retry. Only a random marker is sent; no session data is used.", warning: "Recalling the marker does not prove full-context preservation or rejection of oversized input. Automatic modes remain blocked.", model: "Exact model", run: "Run test (up to 2 calls)", stop: "STOP", close: "Close", export: "Save JSON report", missing: "Refresh this connection's model list first.", observed: "Marker recall was observed in the second turn.", not_observed: "The required result was not observed. This does not prove a lack of multi-turn support.", cancelled: "Test stopped. No subsequent call was sent; an already started request may have been billed.", failed: "The test did not complete. Save the report and check the connection.", changed: "The connection, key or cached model metadata changed. The test stopped.", working: "Testing…", turns: "Recorded stages", saveError: "The report could not be saved. Try again." },
};
export function CloudConformanceDialog({ config, models, repository, language, onClose }: { config: ProviderConfig; models: ProviderModel[]; repository: AppRepository; language: "pl" | "en"; onClose(): void }) {
  const t = words[language];
  const available = models.filter(m => m.providerConfigId === config.id && m.provider === "ollama_cloud");
  const [modelId, setModelId] = useState(available[0]?.modelId ?? "");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<CloudConformanceReport>();
  const [saveError, setSaveError] = useState(false);
  const [runError, setRunError] = useState(false);
  const controller = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const run = async () => {
    if (controller.current || !modelId || config.provider !== "ollama_cloud") return;
    const active = new AbortController(); controller.current = active; setBusy(true); setReport(undefined); setSaveError(false); setRunError(false);
    try {
      const result = await runCloudConformance({ repository, providerConfigId: config.id, modelId, signal: active.signal });
      if (mounted.current) setReport(result);
    } catch { if (mounted.current) setRunError(true); } finally { controller.current = null; if (mounted.current) setBusy(false); }
  };
  const save = async () => {
    if (!report) return;
    setSaveError(false);
    try { await saveTextFile(t.export, `ollama-cloud-conformance-${report.id}.json`, JSON.stringify(report, null, 2)); }
    catch { setSaveError(true); }
  };
  const resultText = report?.outcome === "two_turn_recall_observed" ? t.observed : report?.outcome === "not_observed" ? t.not_observed : report?.outcome === "cancelled" ? t.cancelled : report?.outcome === "connection_changed" ? t.changed : t.failed;
  return <div className="modal-backdrop"><section className="modal form-modal" role="dialog" aria-modal="true" aria-label={t.title}>
    <h2>{t.title}</h2><p>{t.lead}</p><p className="runtime-warning">{t.warning}</p>
    <label>{t.model}<select value={modelId} disabled={busy} onChange={e => { setModelId(e.target.value); setReport(undefined); setSaveError(false); setRunError(false); }}>{available.map(m => <option key={m.modelId} value={m.modelId}>{m.modelId}</option>)}</select></label>
    {!available.length && <p>{t.missing}</p>}
    {busy && <p role="status">{t.working}</p>}
    {report && <div role="status"><p>{resultText}</p><p>{t.turns}: {report.turns.length}/2</p></div>}
    {runError && <p role="alert">{t.failed}</p>}
    {saveError && <p role="alert">{t.saveError}</p>}
    <div className="modal-actions">
      <button className="secondary-button" disabled={busy} onClick={onClose}>{t.close}</button>
      {report && <button className="secondary-button" disabled={busy} onClick={() => void save()}>{t.export}</button>}
      {busy ? <button className="stop-button" onClick={() => controller.current?.abort()}>{t.stop}</button> : <button className="primary-button" disabled={!modelId || !available.some(m => m.modelId === modelId)} onClick={() => void run()}>{t.run}</button>}
    </div>
  </section></div>;
}
