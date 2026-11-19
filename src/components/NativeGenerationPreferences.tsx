import { useEffect, useRef, useState, type FormEvent } from "react";
import { freezeNativeConnection, isOllamaCloudEndpoint } from "../providers/nativeConnectionIdentity";
import { getNativeGenerationSettings, saveNativeGenerationSettings, type NativeGenerationSettings, type NativeGenerationState } from "../providers/nativeGeneration";
import type { NativeConnectionView } from "../providers/nativeDiscovery";
const copy = {
  en: { title: "Native generation preferences (pending)", context: "Requested context", temperature: "Temperature", topP: "Top P", topK: "Top K", seed: "Seed", save: "Save preferences", auto: "Auto — omitted from request", blocked: "Generation blocked: full-input context safety and multi-turn behavior have not been verified for this deployment. Streaming is a later stage.", hint: "These preferences do not activate generation or change any stage's response budget. Model metadata is not verified context allocation. Explicit zero is preserved for sampling.", error: "Cannot load or save native preferences. Refresh discovery and check the values.", saved: "Preferences saved; generation remains blocked." },
  pl: { title: "Ustawienia generowania Native (oczekujące)", context: "Żądany kontekst", temperature: "Temperatura", topP: "Top P", topK: "Top K", seed: "Seed", save: "Zapisz ustawienia", auto: "Auto — pomijane w żądaniu", blocked: "Generowanie zablokowane: dla tego wdrożenia nie potwierdzono zachowania pełnego kontekstu ani rozmowy wieloturowej. Streaming będzie w kolejnym etapie.", hint: "Te ustawienia nie włączają generowania ani nie zmieniają budżetu odpowiedzi żadnego etapu. Metadane modelu nie potwierdzają alokacji kontekstu. Jawne zero samplingu zostaje zachowane.", error: "Nie można odczytać lub zapisać ustawień Native. Odśwież discovery i sprawdź wartości.", saved: "Ustawienia zapisane; generowanie nadal zablokowane." },
};
const keys = ["numCtx", "temperature", "topP", "topK", "seed"] as const;
export function NativeGenerationPreferences({ view, language }: { view: NativeConnectionView; language: "en" | "pl" }) {
  const t = copy[language]; const [state, setState] = useState<NativeGenerationState>(); const [values, setValues] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [saved, setSaved] = useState(false); const lock = useRef(false);
  const binding = freezeNativeConnection(view.connection); const model = view.discovery?.selectedModel;
  const epoch = useRef(0);
  useEffect(() => { const token = ++epoch.current; setState(undefined); setError(false); setSaved(false); if (!model) return;
    void getNativeGenerationSettings(binding, model).then(result => { if (token !== epoch.current) return; setState(result); setValues(Object.fromEntries(keys.map(k => [k, result.draft.settings[k]?.toString() ?? ""]))); }).catch(() => { if (token === epoch.current) setError(true); });
    return () => { ++epoch.current; };
  }, [binding.providerConfigId, binding.connectionRevision, binding.normalizedEndpoint, binding.authMode, model, view.discovery?.capturedAtMs]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (lock.current || !state) return; lock.current = true; setBusy(true); setError(false); setSaved(false); const token = epoch.current;
    try { const settings: NativeGenerationSettings = {}; for (const k of keys) if (values[k]?.trim()) settings[k] = Number(values[k]); const result = await saveNativeGenerationSettings({ ...state.draft, settings }); if (token === epoch.current) { setState(result); setSaved(true); } }
    catch { if (token === epoch.current) setError(true); } finally { lock.current = false; setBusy(false); }
  };
  const cloud = isOllamaCloudEndpoint(view.connection.baseUrl);
  const labels = { numCtx: t.context, temperature: t.temperature, topP: t.topP, topK: t.topK, seed: t.seed };
  return <details><summary>{t.title}</summary>{cloud && <p>{language === "pl" ? "Kontekstem zarządza Ollama Cloud. Dawne num_ctx, jeśli zapisano, trzeba wyczyścić; nie zostanie wysłane ani automatycznie pominięte." : "Ollama Cloud manages context. Clear any previously saved num_ctx; it will not be sent or silently ignored."}</p>}<p>{t.blocked}</p><p>{t.hint}</p><form onSubmit={e => void submit(e)} className="native-generation-preferences">
    {keys.filter(k => k !== "numCtx" || !cloud || Boolean(values.numCtx)).map(k => <label key={k}>{labels[k]}<input type="number" min={k === "numCtx" ? 1 : 0} max={k === "temperature" ? 2 : k === "topP" ? 1 : Number.MAX_SAFE_INTEGER} step={k === "temperature" || k === "topP" ? "any" : 1} placeholder={t.auto} value={values[k] ?? ""} disabled={busy || !state} onChange={e => setValues(previous => ({ ...previous, [k]: e.target.value }))} /></label>)}
    <button type="submit" className="ghost-button" disabled={busy || !state}>{t.save}</button>
    {saved && <p role="status">{t.saved}</p>}{error && <p role="alert">{t.error}</p>}
  </form></details>;
}
