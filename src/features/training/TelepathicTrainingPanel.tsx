import { CircleStop, GraduationCap, Play, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { aiIsBeDisplayName } from "../../domain/isBeIdentity";
import { resolveSessionLanguage } from "../../domain/localization";
import { listEligibleViewerIdentities, preferredViewerIdentityId, viewerIdentityLabel, type EligibleViewerIdentity } from "../../aiCenter/viewerIdentitySelection";
import { resolveTechnicalWorkspaceForProfile } from "../../application/technicalWorkspace";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import type { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import {
  allowRetryForUncertainTelepathicCall,
  resumeBlockedTelepathicSeries,
  runNextTelepathicAiRound,
  runTelepathicFinalReflections,
  unresolvedTelepathicProviderCalls,
  type TelepathicExchangeEngineDependencies,
} from "../../telepathicExchange/engine";
import { planTelepathicSeries } from "../../telepathicExchange/planner";
import { resolveTelepathicAiRouteFromRepository } from "../../telepathicExchange/providerGateway";
import { createTelepathicAiTrainingSeries } from "../../telepathicExchange/training";
import { preflightTelepathicTrainingConfig, type TelepathicTrainingConfigPreflight } from "../../telepathicExchange/trainingPreflight";
import type { TelepathicParticipant, TelepathicSeriesConfig, TelepathicSeriesState, TelepathicTopic } from "../../telepathicExchange/types";

interface Props {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profiles: Profile[];
  workspaces: Workspace[];
  repository: AppRepository | null;
  onBusyChange?: (busy: boolean) => void;
}

type IdentitySelections = Record<string, string>;
const TOPICS: TelepathicTopic[] = ["location", "structure_or_object", "human_or_machine_activity", "event", "person", "any"];

function topicLabel(topic: TelepathicTopic, pl: boolean): string {
  const labels: Record<TelepathicTopic, [string, string]> = {
    location: ["Lokalizacja", "Location"],
    structure_or_object: ["Struktura / obiekt", "Structure / object"],
    human_or_machine_activity: ["Aktywność człowieka / maszyny", "Human / machine activity"],
    event: ["Zdarzenie", "Event"],
    person: ["Człowiek", "Person"],
    any: ["Dowolny", "Any"],
  };
  return labels[topic][pl ? 0 : 1];
}

function stateLabel(status: TelepathicSeriesState["status"], pl: boolean): string {
  const labels: Record<TelepathicSeriesState["status"], [string, string]> = {
    ready: ["Gotowy", "Ready"], running: ["W trakcie", "Running"], paused: ["Wstrzymany", "Paused"], completed: ["Zakończony", "Completed"], cancelled: ["Anulowany", "Cancelled"], blocked: ["Zablokowany", "Blocked"],
  };
  return labels[status][pl ? 0 : 1];
}

export function TelepathicTrainingPanel({ settings, profiles, workspaces, repository, onBusyChange }: Props) {
  const pl = settings.interfaceLanguage === "pl";
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const [eligibleByProfile, setEligibleByProfile] = useState<Record<string, EligibleViewerIdentity[]>>({});
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [identitySelections, setIdentitySelections] = useState<IdentitySelections>({});
  const [roundCount, setRoundCount] = useState(3);
  const [topic, setTopic] = useState<TelepathicTopic>("any");
  const [discloseTopic, setDiscloseTopic] = useState(false);
  const [activeSeries, setActiveSeries] = useState<TelepathicSeriesState | null>(null);
  const [history, setHistory] = useState<TelepathicSeriesState[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewRoundId, setViewRoundId] = useState<string | null>(null);
  const [configPreflight, setConfigPreflight] = useState<TelepathicTrainingConfigPreflight | null>(null);
  const [configPreflightSignature, setConfigPreflightSignature] = useState<string | null>(null);
  const runGuard = useRef(false);
  const pauseRequested = useRef(false);
  const activeSeriesIdRef = useRef<string | null>(null);
  const refreshGenerationRef = useRef(0);

  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  const applyActiveSeries = (state: TelepathicSeriesState | null, roundId?: string | null) => {
    refreshGenerationRef.current += 1;
    activeSeriesIdRef.current = state?.config.seriesId ?? null;
    setActiveSeries(state ? structuredClone(state) : null);
    if (!state) {
      setViewRoundId(null);
      return;
    }
    setViewRoundId(roundId ?? state.rounds[Math.min(state.currentRoundIndex, Math.max(0, state.rounds.length - 1))]?.assignment.roundId ?? null);
  };

  const refreshHistory = async () => {
    if (!repository) return;
    const all = await repository.listTelepathicSeries();
    setHistory(all.filter((item) => item.config.mode === "ai_ai_training").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const [configs, models, all] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listProviderModels(),
        repository.listTelepathicSeries(),
      ]);
      const entries = await Promise.all(profiles.map(async (profile) => [profile.id, await listEligibleViewerIdentities({ repository, profileId: profile.id, language, providerConfigs: configs, models })] as const));
      if (cancelled) return;
      setEligibleByProfile(Object.fromEntries(entries));
      const trainingHistory = all.filter((item) => item.config.mode === "ai_ai_training").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setHistory(trainingHistory);
      const recent = trainingHistory[0] ?? null;
      applyActiveSeries(recent ? structuredClone(recent) : null);
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [repository, profiles, language]);

  useEffect(() => {
    if (!busy || !repository || !activeSeries) return;
    const seriesId = activeSeries.config.seriesId;
    const id = window.setInterval(() => {
      const generation = refreshGenerationRef.current;
      void repository.getTelepathicSeries(seriesId).then((state) => {
        if (!state) return;
        if (activeSeriesIdRef.current !== seriesId) return;
        if (refreshGenerationRef.current !== generation) return;
        applyActiveSeries(state, viewRoundId);
      }).catch(() => undefined);
    }, 750);
    return () => window.clearInterval(id);
  }, [busy, repository, activeSeries?.config.seriesId, viewRoundId]);

  const selected = useMemo(() => selectedProfileIds.map((profileId) => {
    const profile = profiles.find((item) => item.id === profileId);
    const workspace = resolveTechnicalWorkspaceForProfile(workspaces, profileId);
    const identityId = identitySelections[profileId];
    const eligible = (eligibleByProfile[profileId] ?? []).find((item) => item.identity.id === identityId);
    return profile && workspace && eligible ? { profile, workspace, eligible } : null;
  }).filter((item): item is { profile: Profile; workspace: Workspace; eligible: EligibleViewerIdentity } => Boolean(item)), [selectedProfileIds, profiles, workspaces, identitySelections, eligibleByProfile]);

  const configReady = selectedProfileIds.length >= 2 && selectedProfileIds.length <= 6 && selected.length === selectedProfileIds.length;
  const previewConfig = useMemo<TelepathicSeriesConfig | null>(() => {
    if (!configReady) return null;
    const seriesWorkspaceId = selected[0]?.workspace.id;
    if (!seriesWorkspaceId) return null;
    const participants: TelepathicParticipant[] = selected.map(({ profile, workspace, eligible }) => ({
      id: `ai:${profile.id}`,
      kind: "ai",
      displayName: aiIsBeDisplayName(profile),
      ai: {
        profileId: profile.id,
        profileName: aiIsBeDisplayName(profile),
        workspaceId: workspace.id,
        aiIdentityId: eligible.identity.id,
        providerConfigId: eligible.providerConfig.id,
        credentialId: eligible.providerConfig.credentialId,
        credentialFingerprint: eligible.identity.credentialFingerprint,
        modelId: eligible.model.modelId,
        route: eligible.model.route,
      },
    }));
    return { schemaVersion: 1, seriesId: "preview", seriesWorkspaceId, mode: "ai_ai_training", language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, senderPolicy: { kind: "rotate" } };
  }, [configReady, selected, language, roundCount, topic, discloseTopic]);

  const schedule = useMemo(() => previewConfig ? planTelepathicSeries(previewConfig).rounds.map((round) => ({ ...round, sender: previewConfig.participants.find((item) => item.id === round.senderParticipantId)?.displayName ?? round.senderParticipantId })) : [], [previewConfig]);

  const currentConfigSignature = useMemo(() => JSON.stringify({
    profiles: selectedProfileIds,
    identities: selectedProfileIds.map((profileId) => identitySelections[profileId] ?? ""),
    roundCount,
    topic,
    discloseTopic,
    language,
  }), [selectedProfileIds, identitySelections, roundCount, topic, discloseTopic, language]);

  useEffect(() => {
    if (configPreflightSignature !== currentConfigSignature) setConfigPreflight(null);
  }, [currentConfigSignature, configPreflightSignature]);

  const runConfigurationPreflight = async (): Promise<TelepathicTrainingConfigPreflight | null> => {
    if (!repository || !previewConfig) return null;
    const modelByParticipantId = Object.fromEntries(selected.map(({ profile, eligible }) => [`ai:${profile.id}`, eligible.model]));
    const result = await preflightTelepathicTrainingConfig({
      repository,
      config: previewConfig,
      modelByParticipantId,
    });
    setConfigPreflight(result);
    setConfigPreflightSignature(currentConfigSignature);
    return result;
  };

  const engineDeps = (): TelepathicExchangeEngineDependencies => {
    if (!repository) throw new Error("Repository is not ready.");
    return {
      store: repository,
      resolveRoute: async (participant) => {
        if (!participant.ai) throw new Error("AI route snapshot is missing.");
        const liveProfile = profiles.find((item) => item.id === participant.ai!.profileId) ?? null;
        const model = (await repository.listProviderModels(participant.ai.providerConfigId)).find((item) => item.modelId === participant.ai!.modelId && item.route === participant.ai!.route) ?? null;
        if (!liveProfile || !model) throw new Error("Telepathic Training participant Profile or model route is no longer available.");
        return resolveTelepathicAiRouteFromRepository({ repository, participant, requestedSettings: profileGenerationDefaults(liveProfile, model) });
      },
    };
  };

  const withBusy = async (
    task: () => Promise<TelepathicSeriesState | void>,
    recoverySeriesId?: string,
  ): Promise<TelepathicSeriesState | null> => {
    if (runGuard.current) return null;
    runGuard.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const state = await task();
      if (state) applyActiveSeries(state);
      await refreshHistory();
      return state ?? null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      const seriesId = recoverySeriesId ?? activeSeriesIdRef.current;
      if (repository && seriesId) {
        const persisted = await repository.getTelepathicSeries(seriesId).catch(() => null);
        if (persisted) applyActiveSeries(persisted);
      }
      await refreshHistory().catch(() => undefined);
      return null;
    } finally {
      runGuard.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const startTraining = async () => {
    if (!repository || !previewConfig) return;
    const freshPreflight = await runConfigurationPreflight();
    if (!freshPreflight?.ok) {
      setError(pl ? "Preflight konfiguracji nie przeszedł. Sprawdź budżet kontekstu przed startem." : "Configuration preflight failed. Review the context budget before starting.");
      return;
    }
    const seriesId = `telepathic-training-${crypto.randomUUID()}`;
    const config: TelepathicSeriesConfig = { ...structuredClone(previewConfig), seriesId, participants: previewConfig.participants.map((item) => ({ ...structuredClone(item), id: `ai:${item.ai!.profileId}` })) };
    pauseRequested.current = false;
    await withBusy(async () => {
      let current = await createTelepathicAiTrainingSeries({ repository, config });
      applyActiveSeries(current, current.rounds[0]?.assignment.roundId ?? null);
      while (current.status !== "completed" && current.status !== "cancelled") {
        current = await runNextTelepathicAiRound(engineDeps(), current.config.seriesId);
        applyActiveSeries(current);
        if (pauseRequested.current && current.status !== "completed") break;
      }
      return current;
    }, seriesId);
  };

  const runRemaining = async () => {
    if (!activeSeries || !repository) return;
    pauseRequested.current = false;
    await withBusy(async () => {
      let current = await repository.getTelepathicSeries(activeSeries.config.seriesId);
      if (!current) throw new Error("Telepathic Training series not found.");
      while (current.status !== "completed" && current.status !== "cancelled") {
        if (current.status === "blocked") throw new Error(pl ? "Trening jest zablokowany i wymaga rozstrzygnięcia operatora." : "Training is blocked and requires operator resolution.");
        current = await runNextTelepathicAiRound(engineDeps(), current.config.seriesId);
        applyActiveSeries(current);
        if (pauseRequested.current && current.status !== "completed") break;
      }
      return current;
    }, activeSeries.config.seriesId);
  };

  const openSeries = async (seriesId: string) => {
    if (!repository || busy) return;
    const state = await repository.getTelepathicSeries(seriesId);
    if (!state || state.config.mode !== "ai_ai_training") return;
    applyActiveSeries(state);
    setError(null);
  };

  const recoverBlocked = async () => {
    if (!activeSeries) return;
    await withBusy(() => resumeBlockedTelepathicSeries(engineDeps(), activeSeries.config.seriesId), activeSeries.config.seriesId);
  };

  const resolveUncertain = async (callId: string) => {
    if (!activeSeries) return;
    await withBusy(() => allowRetryForUncertainTelepathicCall(engineDeps(), activeSeries.config.seriesId, callId), activeSeries.config.seriesId);
  };

  const runFinal = async () => {
    if (!activeSeries) return;
    await withBusy(() => runTelepathicFinalReflections(engineDeps(), activeSeries.config.seriesId), activeSeries.config.seriesId);
  };

  const selectProfile = (profileId: string, checked: boolean) => {
    if (busy) return;
    setSelectedProfileIds((current) => checked ? (current.includes(profileId) ? current : [...current, profileId].slice(0, 6)) : current.filter((id) => id !== profileId));
    if (!checked) {
      setIdentitySelections((current) => { const next = { ...current }; delete next[profileId]; return next; });
      return;
    }
    const eligible = eligibleByProfile[profileId] ?? [];
    setIdentitySelections((current) => ({ ...current, [profileId]: eligible.length === 1 ? eligible[0].identity.id : preferredViewerIdentityId(eligible, profiles.find((item) => item.id === profileId)?.defaultViewerModelId) }));
  };

  const currentViewRound = activeSeries?.rounds.find((round) => round.assignment.roundId === viewRoundId) ?? activeSeries?.rounds[Math.min(activeSeries.currentRoundIndex, Math.max(0, activeSeries.rounds.length - 1))] ?? null;
  const unresolved = activeSeries ? unresolvedTelepathicProviderCalls(activeSeries) : [];
  const unresolvedFinal = unresolved.filter((call) => call.callStage === "series_reflection" || call.roundId === "series-complete");

  if (!repository) return <section className="panel"><p>{pl ? "Repozytorium nie jest gotowe." : "Repository is not ready."}</p></section>;

  return <div className="telepathic-exchange-stack telepathic-training-stack">
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><GraduationCap size={18} /><span><strong>{pl ? "Trening telepatyczny AI–AI" : "AI–AI Telepathic Training"}</strong><small>{pl ? "2–6 Profili AI. Każda runda ma świeży kontekst; Field Guide i Viewer Notes są zamrożone i tylko do odczytu." : "2–6 AI Profiles. Every round starts fresh; Field Guide and Viewer Notes are frozen and read-only."}</small></span></div></div>
    </section>

    {!activeSeries && <>
      {history.length > 0 && <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><RefreshCw size={18} /><span><strong>{pl ? "Zapisane treningi telepatyczne" : "Saved telepathic training"}</strong><small>{pl ? "Otwórz zakończoną, wstrzymaną lub zablokowaną serię." : "Open a completed, paused, or blocked series."}</small></span></div></div><div className="telepathic-series-history">{history.map((item) => <button type="button" className="secondary-button telepathic-series-history-item" key={item.config.seriesId} onClick={() => void openSeries(item.config.seriesId)}><span><strong>{item.config.participants.map((participant) => participant.displayName).join(" · ")}</strong><small>{stateLabel(item.status, pl)} · {item.config.roundCount} {pl ? "rund" : "rounds"} · {new Date(item.updatedAt).toLocaleString()}</small></span><span>{pl ? "Otwórz" : "Open"}</span></button>)}</div></section>}

      <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><Users size={18} /><span><strong>{pl ? "Uczestnicy" : "Participants"}</strong><small>{pl ? "Wybierz od 2 do 6 różnych Profili AI. Każdy używa własnego RV Workspace i własnej trasy Viewera." : "Choose 2 to 6 distinct AI Profiles. Each uses its own RV Workspace and Viewer route."}</small></span></div></div><div className="telepathic-profile-list">{profiles.map((profile) => {
        const workspace = resolveTechnicalWorkspaceForProfile(workspaces, profile.id);
        const eligible = eligibleByProfile[profile.id] ?? [];
        const checked = selectedProfileIds.includes(profile.id);
        const selectedIdentity = identitySelections[profile.id] ?? "";
        return <article className="telepathic-profile-row" key={profile.id}><label className="telepathic-profile-toggle"><input type="checkbox" checked={checked} disabled={busy || !workspace || !eligible.length || (!checked && selectedProfileIds.length >= 6)} onChange={(event) => selectProfile(profile.id, event.target.checked)} /><span><strong>{aiIsBeDisplayName(profile)}</strong><small>{!workspace ? (pl ? "Brak aktywnego RV Workspace" : "No active RV Workspace") : !eligible.length ? (pl ? "Brak dostępnej tożsamości Viewera" : "No available Viewer identity") : `${workspace.name} · ${eligible.length} route`}</small></span></label>{checked && <label><span>{pl ? "Tożsamość / trasa" : "Identity / route"}</span><select value={selectedIdentity} onChange={(event) => setIdentitySelections((current) => ({ ...current, [profile.id]: event.target.value }))}><option value="">{pl ? "Wybierz trasę" : "Select route"}</option>{eligible.map((item) => <option value={item.identity.id} key={item.identity.id}>{viewerIdentityLabel(item, language)}</option>)}</select></label>}</article>;
      })}</div></section>

      <section className="panel telepathic-exchange-panel"><div className="telepathic-config-grid"><label><span>{pl ? "Liczba rund" : "Rounds"}</span><input type="number" min={1} max={50} value={roundCount} onChange={(event) => setRoundCount(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))} /></label><label><span>{pl ? "Temat" : "Topic"}</span><select value={topic} onChange={(event) => setTopic(event.target.value as TelepathicTopic)}>{TOPICS.map((item) => <option value={item} key={item}>{topicLabel(item, pl)}</option>)}</select></label><label className="telepathic-check"><input type="checkbox" checked={discloseTopic} onChange={(event) => setDiscloseTopic(event.target.checked)} /><span>{pl ? "Pokaż temat odbiorcom" : "Disclose topic to receivers"}</span></label></div>{schedule.length > 0 && <div className="telepathic-schedule"><strong>{pl ? "Harmonogram" : "Schedule"}</strong>{schedule.map((round) => <span key={round.roundId}>{pl ? "Runda" : "Round"} {round.roundNumber}: {round.sender}</span>)}</div>}<div className="training-actions">
        <button className="secondary-button" disabled={!configReady || busy} onClick={() => void runConfigurationPreflight()}>{pl ? "Uruchom preflight" : "Run preflight"}</button>
        <button className="primary-button" disabled={!configReady || busy || !configPreflight?.ok || configPreflightSignature !== currentConfigSignature} onClick={() => void startTraining()}><Play size={15} />{pl ? "Rozpocznij trening telepatyczny" : "Start telepathic training"}</button>
      </div>
      {configPreflight && configPreflightSignature === currentConfigSignature && <div className="training-preflight telepathic-training-preflight">
        <span><small>{pl ? "Stan" : "Status"}</small><strong>{configPreflight.ok ? (pl ? "PASS" : "PASS") : (pl ? "FAIL" : "FAIL")}</strong></span>
        <span><small>{pl ? "Szacowane wywołania AI" : "Estimated AI calls"}</small><strong>{configPreflight.estimatedProviderCalls}</strong></span>
        <span><small>{pl ? "Bazowy szacunek kosztu" : "Baseline cost estimate"}</small><strong>{configPreflight.estimatedBaselineCostUsd !== undefined ? `$${configPreflight.estimatedBaselineCostUsd.toFixed(4)}` : (pl ? "brak danych cenowych" : "pricing unavailable")}</strong></span>
        <span><small>{pl ? "Największy szacowany pakiet" : "Largest estimated packet"}</small><strong>{Math.max(...configPreflight.participants.map((item) => item.estimatedTotalTokens))} tokens</strong></span>
      </div>}
      {configPreflight && <small className="training-preflight-note">{pl ? "To szacunek konfiguracji oparty na aktualnym zamrożonym Viewer Learning i reprezentatywnych promptach. Target, Reveal i odpowiedzi modeli powstają później, więc rzeczywisty koszt może być wyższy. Silnik nadal wykonuje właściwe kontrole przed wywołaniami i końcową refleksją." : "This is a configuration estimate based on the current frozen Viewer Learning and representative prompts. Targets, Reveals, and model outputs are created later, so actual cost can be higher. The engine still performs authoritative checks before calls and final reflection."}</small>}
      {!configReady && <div className="training-requirement-note"><span>{pl ? "Wybierz 2–6 Profili z poprawnym RV Workspace i trasą Viewera." : "Select 2–6 Profiles with a valid RV Workspace and Viewer route."}</span></div>}</section>
    </>}

    {activeSeries && <>
      <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><GraduationCap size={18} /><span><strong>{pl ? "Aktywny trening" : "Active training"}</strong><small>{stateLabel(activeSeries.status, pl)} · {activeSeries.currentRoundIndex}/{activeSeries.rounds.length} {pl ? "ukończonych rund" : "rounds completed"}</small></span></div><button className="secondary-button" disabled={busy} onClick={() => { applyActiveSeries(null); setError(null); }}>{pl ? "Nowy trening" : "New training"}</button></div><div className="telepathic-status-grid"><span><small>{pl ? "Uczestnicy" : "Participants"}</small><strong>{activeSeries.config.participants.map((item) => item.displayName).join(" · ")}</strong></span><span><small>{pl ? "Temat" : "Topic"}</small><strong>{topicLabel(activeSeries.config.topic, pl)} · {activeSeries.config.discloseTopicToReceivers ? (pl ? "jawny" : "visible") : (pl ? "ukryty" : "hidden")}</strong></span><span><small>Viewer Learning</small><strong>{pl ? "zamrożony · tylko odczyt" : "frozen · read-only"}</strong><small>{activeSeries.config.participants.map((item) => `${item.displayName}: FG ${item.fieldGuide ? `v${item.fieldGuide.version}` : "—"} · VN ${item.viewerNotes ? `v${item.viewerNotes.version}` : "—"}`).join(" | ")}</small></span></div><div className="training-actions">{busy ? <><button className="secondary-button" onClick={() => { pauseRequested.current = true; }}><CircleStop size={15} />{pl ? "Pauza po bieżącej rundzie" : "Pause after current round"}</button><span>{pl ? "Trening działa…" : "Training is running…"}</span></> : <><button className="primary-button" disabled={activeSeries.status === "completed" || activeSeries.status === "cancelled" || activeSeries.status === "blocked"} onClick={() => void runRemaining()}><Play size={15} />{pl ? "Uruchom / kontynuuj" : "Run / continue"}</button>{activeSeries.status === "blocked" && unresolved.length === 0 && <button className="secondary-button" onClick={() => void recoverBlocked()}>{pl ? "Odblokuj i wznów z checkpointu" : "Unblock and resume from checkpoint"}</button>}{activeSeries.status === "completed" && Object.keys(activeSeries.finalReflections).length < activeSeries.config.participants.length && unresolvedFinal.length === 0 && <button className="secondary-button" onClick={() => void runFinal()}>{pl ? "Końcowe refleksje AI" : "AI final reflections"}</button>}</>}</div>{activeSeries.status === "blocked" && currentViewRound?.blockedReason && <div className="training-requirement-note"><span>{currentViewRound.blockedReason}</span></div>}</section>

      {unresolved.length > 0 && <section className="panel telepathic-exchange-panel"><strong>{pl ? "Niepewne wywołania providera" : "Uncertain provider calls"}</strong><p>{pl ? "Nie zostaną ponowione automatycznie. Jeżeli świadomie uznasz próbę za nieudaną, normalny limit dwóch prób nadal obowiązuje." : "They will not be retried automatically. If you explicitly treat an attempt as failed, the normal two-attempt limit still applies."}</p><div className="telepathic-series-history">{unresolved.map((call) => <button type="button" className="secondary-button telepathic-series-history-item" key={call.id} disabled={busy} onClick={() => void resolveUncertain(call.id)}><span><strong>{call.callStage} · {call.participantId}</strong><small>{call.roundId} · attempt {call.technicalAttempt}</small></span><span>{pl ? "Uznaj za nieudaną" : "Treat as failed"}</span></button>)}</div></section>}

      <section className="panel telepathic-exchange-panel"><div className="telepathic-round-tabs">{activeSeries.rounds.map((round) => <button type="button" key={round.assignment.roundId} className={currentViewRound?.assignment.roundId === round.assignment.roundId ? "active" : ""} onClick={() => setViewRoundId(round.assignment.roundId)}>{pl ? "Runda" : "Round"} {round.assignment.roundNumber}<small>{round.status}</small></button>)}</div>{currentViewRound && <div className="telepathic-operator-view"><div className="telepathic-status-grid"><span><small>{pl ? "Nadawca" : "Sender"}</small><strong>{activeSeries.config.participants.find((item) => item.id === currentViewRound.assignment.senderParticipantId)?.displayName ?? currentViewRound.assignment.senderParticipantId}</strong></span><span><small>{pl ? "Stan celu" : "Target state"}</small><strong>{currentViewRound.target?.status ?? (pl ? "oczekuje" : "pending")}</strong></span><span><small>Reveal</small><strong>{currentViewRound.revealedAt ? (pl ? "ujawniony" : "revealed") : (pl ? "oczekuje" : "pending")}</strong></span></div>{currentViewRound.target && <article className="telepathic-stage-card"><strong>{pl ? "Cel operatora" : "Operator target view"}</strong><p>{currentViewRound.target.content}</p>{currentViewRound.target.assets.length > 0 && <small>{currentViewRound.target.assets.map((asset) => asset.originalFileName).join(", ")}</small>}</article>}<div className="telepathic-stage-list">{activeSeries.config.participants.map((participant) => { const isSender = currentViewRound.assignment.senderParticipantId === participant.id; const blind = currentViewRound.blindByParticipant[participant.id]; const reflection = currentViewRound.reflectionsByParticipant[participant.id]; return <article className="telepathic-stage-card" key={participant.id}><strong>{participant.displayName} · {isSender ? (pl ? "nadawca" : "sender") : (pl ? "odbiorca" : "receiver")}</strong>{!isSender && <small>{blind?.status ?? "waiting"}</small>}{blind?.first && <p><b>{pl ? "Pierwszy opis:" : "First:"}</b> {blind.first}</p>}{blind?.second && <p><b>{pl ? "Drugie spojrzenie:" : "Second look:"}</b> {blind.second}</p>}{reflection?.reflection && <p><b>{pl ? "Refleksja:" : "Reflection:"}</b> {reflection.reflection}</p>}{reflection?.shareOthersConsent && <small>{pl ? "Cudze odpowiedzi:" : "Others' answers:"} {reflection.shareOthersConsent}</small>}{reflection?.sharedAnswersComment && <p><b>{pl ? "Komentarz po wymianie:" : "Post-sharing comment:"}</b> {reflection.sharedAnswersComment}</p>}</article>; })}</div></div>}</section>

      {activeSeries.status === "completed" && Object.keys(activeSeries.finalReflections).length > 0 && <section className="panel telepathic-exchange-panel"><strong>{pl ? "Końcowe refleksje serii" : "Final series reflections"}</strong><div className="telepathic-stage-list">{activeSeries.config.participants.map((participant) => activeSeries.finalReflections[participant.id] ? <article className="telepathic-stage-card" key={participant.id}><strong>{participant.displayName}</strong><p>{activeSeries.finalReflections[participant.id]}</p></article> : null)}</div></section>}
    </>}

    {error && <div className="error-banner">{error}</div>}
  </div>;
}
