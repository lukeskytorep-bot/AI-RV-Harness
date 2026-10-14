import { TelepathicSeriesActions } from "../../components/TelepathicSeriesActions";
import { useTelepathicExecution, telepathicExecutionStore } from "../../components/useTelepathicExecution";
import type { TelepathicLocalExecution } from "../../telepathicExchange/executionPresentation";
import { useTelepathicHistory } from "../../components/useTelepathicHistory";
import { TelepathicSetupStep } from "../../components/TelepathicSetupStep";
import { useTelepathicSetupConfirmation } from "../../components/useTelepathicSetupConfirmation";
import { telepathicStageLabel } from "../../telepathicExchange/stageLabels";
import { visibleTranscript } from "../../telepathicExchange/transcript";
import { TelepathicHistory } from "../../components/TelepathicHistory";
import { TelepathicTranscript } from "../../components/TelepathicTranscript";
import { TelepathicMetrics } from "../../components/TelepathicMetrics";
import { telepathicRuntimeMetrics } from "../../telepathicExchange/runtimeMetrics";
import { setTelepathicArchived } from "../../telepathicExchange/archive";
import { saveTelepathicDocument } from "../../exports/telepathy";
import { LEAD_INSTRUCTION_VERSION } from "../../telepathicExchange/leadGuidance";
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
  endTelepathicSeries,
  runNextTelepathicAiRound,
  runTelepathicFinalReflections,
  unresolvedTelepathicProviderCalls,
  type TelepathicExchangeEngineDependencies,
} from "../../telepathicExchange/engine";
import { planTelepathicSeries } from "../../telepathicExchange/planner";
import { resolveTelepathicAiRouteFromRepository } from "../../telepathicExchange/providerGateway";
import { createTelepathicAiTrainingSeries } from "../../telepathicExchange/training";
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
    ready: ["Gotowy", "Ready"], running: ["W trakcie", "Running"], paused: ["Wstrzymany", "Paused"], completed: ["Zakończony", "Completed"], cancelled: ["Zakończony bez wznowienia", "Ended without resume"], blocked: ["Zablokowany", "Blocked"],
  };
  return labels[status][pl ? 0 : 1];
}

export function TelepathicTrainingPanel({ settings, profiles, workspaces, repository, onBusyChange }: Props) {
  const pl = settings.interfaceLanguage === "pl";
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const [eligibleByProfile, setEligibleByProfile] = useState<Record<string, EligibleViewerIdentity[]>>({});
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [identitySelections, setIdentitySelections] = useState<IdentitySelections>({});
  const [leadProfileId,setLeadProfileId] = useState("");
  const stopController = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);
  const [roundCount, setRoundCount] = useState(3);
  const [topic, setTopic] = useState<TelepathicTopic>("any");
  const [discloseTopic, setDiscloseTopic] = useState(false);
  const [activeSeries, setActiveSeries] = useState<TelepathicSeriesState | null>(null);
  const history = useTelepathicHistory(repository, "ai_ai_training");
  const detailGeneration = useRef(0);
  useEffect(() => () => { detailGeneration.current++; }, [repository, profiles, language]);
  const [busy, setBusy] = useState(false);
  const [execution, setExecution] = useState<TelepathicLocalExecution | null>(null);
  const { presentation, callPresentation, unavailable } = useTelepathicExecution(repository, activeSeries, activeSeries ? unresolvedTelepathicProviderCalls(activeSeries) : [], execution, async (seriesId, isCurrent) => {
    if (!repository) return;
    const state = await repository.getTelepathicSeries(seriesId);
    if (isCurrent() && state && activeSeriesIdRef.current === seriesId) applyActiveSeries(state, viewRoundId);
  });
  const [error, setError] = useState<string | null>(null);
  const [viewRoundId, setViewRoundId] = useState<string | null>(null);
  const runGuard = useRef(false);
  const pauseRequested = useRef(false);
  const showRecoveryActions = Boolean(activeSeries && !activeSeries.archivedAt && activeSeries.status !== "cancelled" && (activeSeries.status === "paused" || activeSeries.status === "blocked" || activeSeries.status === "completed" && Object.keys(activeSeries.finalReflections).length < activeSeries.config.participants.filter(p => p.kind === "ai").length));
  const stopSeries = () => { if (!busy || stopping) return; pauseRequested.current = true; setStopping(true); stopController.current?.abort(new DOMException("Stopped by user", "AbortError")); };
  const resumeSeries = () => { if (!activeSeries || busy || unavailable || unresolvedTelepathicProviderCalls(activeSeries).length) return; void runRemaining(); };
  const endSeries = () => { if (!activeSeries || busy || unavailable) return; void withBusy(() => endTelepathicSeries(engineDeps(), activeSeries.config.seriesId), activeSeries.config.seriesId); };

  const activeSeriesIdRef = useRef<string | null>(null);
  const refreshGenerationRef = useRef(0);

  useEffect(() => () => { stopController.current?.abort(new DOMException("Telepathic view closed", "AbortError")); onBusyChange?.(false); }, [onBusyChange]);

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

  const refreshHistory = history.reset;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const epoch = ++detailGeneration.current;
      const [configs, models, page] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listProviderModels(),
        history.reset(),
      ]);
      const entries = await Promise.all(profiles.map(async (profile) => [profile.id, await listEligibleViewerIdentities({ repository, profileId: profile.id, language, providerConfigs: configs, models })] as const));
      if (cancelled) return;
      setEligibleByProfile(Object.fromEntries(entries));
      if (!page) return;
      const recent = await history.recentActive(page);
      if (cancelled || epoch !== detailGeneration.current) return;
      const state = recent ? await repository.getTelepathicSeries(recent.seriesId) : null;
      if (!cancelled && epoch === detailGeneration.current) applyActiveSeries(state);

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
  const setup = useTelepathicSetupConfirmation(
    JSON.stringify({ selectedProfileIds, selected, language }), configReady,
    leadProfileId, selectedProfileIds.includes(leadProfileId) && selected.some(item => item.profile.id === leadProfileId), repository);
  const editParticipants = () => { setup.editParticipants(); setLeadProfileId(""); };
  const previewConfig = useMemo<TelepathicSeriesConfig | null>(() => {
    if (!configReady || !setup.leadConfirmed) return null;
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
    return { schemaVersion: 1, seriesId: "preview", seriesWorkspaceId, mode: "ai_ai_training", language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, protocolVersion:"fixed_lead_v1",leadInstructionVersion:LEAD_INSTRUCTION_VERSION,maxGuidanceCycles:3,senderPolicy: { kind: "fixed_ai",participantId: `ai:${leadProfileId}` } };
  }, [configReady, selected, language, roundCount, topic, discloseTopic,leadProfileId,setup.leadConfirmed]);

  const schedule = useMemo(() => previewConfig ? planTelepathicSeries(previewConfig).rounds.map((round) => ({ ...round, sender: previewConfig.participants.find((item) => item.id === round.senderParticipantId)?.displayName ?? round.senderParticipantId })) : [], [previewConfig]);

  const engineDeps = (): TelepathicExchangeEngineDependencies => {
    if (!repository) throw new Error("Repository is not ready.");
    return {
      store: telepathicExecutionStore(repository, (seriesId, callIds) => {
        setExecution(current => current?.seriesId === seriesId ? { ...current, preexistingCallIds: callIds } : current);
      }),
      signal: stopController.current?.signal,
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
    applyResult = true,
  ): Promise<TelepathicSeriesState | null> => {
    if (runGuard.current) return null;
    if (recoverySeriesId === activeSeries?.config.seriesId && unavailable) return null;
    detailGeneration.current++;
    runGuard.current = true;
    stopController.current = new AbortController();
    setStopping(false);
    onBusyChange?.(true);
    setBusy(true);
    setExecution(recoverySeriesId ? { seriesId: recoverySeriesId, preexistingCallIds: activeSeries?.providerCalls.map(call => call.id) ?? [] } : null);
    setError(null);
    try {
      const state = await task();
      if (state && applyResult) applyActiveSeries(state);
      await refreshHistory();
      return state ?? null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      const seriesId = recoverySeriesId ?? activeSeriesIdRef.current;
      if (repository && seriesId && applyResult) {
        const persisted = await repository.getTelepathicSeries(seriesId).catch(() => null);
        if (persisted) applyActiveSeries(persisted);
      }
      await refreshHistory().catch(() => undefined);
      return null;
    } finally {
      runGuard.current = false;
      stopController.current = null;
      setStopping(false);
      setExecution(null);
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const startTraining = async () => {
    if (!repository || !previewConfig || !setup.leadConfirmed || busy) return;
    const seriesId = `telepathic-training-${crypto.randomUUID()}`;
    const config: TelepathicSeriesConfig = { ...structuredClone(previewConfig), seriesId, participants: previewConfig.participants.map((item) => ({ ...structuredClone(item), id: `ai:${item.ai!.profileId}` })) };
    pauseRequested.current = false;
    await withBusy(async () => {
      let current = await createTelepathicAiTrainingSeries({ repository, config });
      applyActiveSeries(current, current.rounds[0]?.assignment.roundId ?? null);
      while (current.status !== "completed" && current.status !== "cancelled") {
        stopController.current?.signal.throwIfAborted();
        current = await runNextTelepathicAiRound(engineDeps(), current.config.seriesId);
        applyActiveSeries(current);
        if (pauseRequested.current && current.status !== "completed") break;
      }
      return current;
    }, seriesId);
  };

  const runRemaining = async () => {
    if (!activeSeries || !repository || activeSeries.archivedAt) return;
    pauseRequested.current = false;
    await withBusy(async () => {
      let current = await repository.getTelepathicSeries(activeSeries.config.seriesId);
      if (!current) throw new Error("Telepathic Training series not found.");
      if (current.status === "blocked") current = await resumeBlockedTelepathicSeries(engineDeps(), current.config.seriesId);
      while (current.status !== "completed" && current.status !== "cancelled") {
        stopController.current?.signal.throwIfAborted();
        if (current.status === "blocked") throw new Error(pl ? "Trening jest zablokowany i wymaga rozstrzygnięcia operatora." : "Training is blocked and requires operator resolution.");
        current = await runNextTelepathicAiRound(engineDeps(), current.config.seriesId);
        applyActiveSeries(current);
        if (pauseRequested.current && current.status !== "completed") break;
      }
      if (current.status === "completed" && Object.keys(current.finalReflections).length < current.config.participants.filter(p=>p.kind==="ai").length) current=await runTelepathicFinalReflections(engineDeps(),current.config.seriesId);
      return current;
    }, activeSeries.config.seriesId);
  };

  const openSeries = async (seriesId: string) => {
    if (!repository || busy) return;
    const epoch = ++detailGeneration.current;
    try {
      const state = await repository.getTelepathicSeries(seriesId);
      if (epoch !== detailGeneration.current) return;
      if (!state || state.config.mode !== "ai_ai_training") throw new Error("Training series not found.");
      applyActiveSeries(state); setError(null);
    } catch (cause) { if (epoch === detailGeneration.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const retryHistory = async () => {
    const chooseInitial = history.items.length === 0 && !activeSeries;
    const epoch = detailGeneration.current;
    try {
      const page = await history.retry();
      if (!chooseInitial || !page || epoch !== detailGeneration.current) return;
      const recent = await history.recentActive(page);
      if (recent && epoch === detailGeneration.current) await openSeries(recent.seriesId);
    } catch (cause) { if (epoch === detailGeneration.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };


  const recoverBlocked = async () => {
    if (!activeSeries || activeSeries.archivedAt) return;
    await withBusy(() => resumeBlockedTelepathicSeries(engineDeps(), activeSeries.config.seriesId), activeSeries.config.seriesId);
  };

  const resolveUncertain = async (callId: string) => {
    if (!activeSeries || activeSeries.archivedAt) return;
    await withBusy(() => allowRetryForUncertainTelepathicCall(engineDeps(), activeSeries.config.seriesId, callId), activeSeries.config.seriesId);
  };

  const runFinal = async () => {
    if (!activeSeries || activeSeries.archivedAt) return;
    await withBusy(() => runTelepathicFinalReflections(engineDeps(), activeSeries.config.seriesId), activeSeries.config.seriesId);
  };

  const selectProfile = (profileId: string, checked: boolean) => {
    if (busy || setup.participantsConfirmed) return;
    setSelectedProfileIds((current) => checked ? (current.includes(profileId) ? current : [...current, profileId].slice(0, 6)) : current.filter((id) => id !== profileId));
    if (!checked) {
      setIdentitySelections((current) => { const next = { ...current }; delete next[profileId]; return next; });
      return;
    }
    const eligible = eligibleByProfile[profileId] ?? [];
    setIdentitySelections((current) => ({ ...current, [profileId]: eligible.length === 1 ? eligible[0].identity.id : preferredViewerIdentityId(eligible, profiles.find((item) => item.id === profileId)?.defaultViewerModelId) }));
  };

  const currentViewRound = activeSeries?.rounds.find((round) => round.assignment.roundId === viewRoundId) ?? activeSeries?.rounds[Math.min(activeSeries.currentRoundIndex, Math.max(0, activeSeries.rounds.length - 1))] ?? null;
  const unresolved = activeSeries && !activeSeries.archivedAt ? unresolvedTelepathicProviderCalls(activeSeries) : [];
  const unresolvedFinal = unresolved.filter((call) => call.callStage === "series_reflection" || call.roundId === "series-complete");

  if (!repository) return <section className="panel"><p>{pl ? "Repozytorium nie jest gotowe." : "Repository is not ready."}</p></section>;

  return <div className="telepathic-with-history"><div className="telepathic-exchange-stack telepathic-training-stack">
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><GraduationCap size={18} /><span><strong>{pl ? "Trening telepatyczny AI–AI" : "AI–AI Telepathic Training"}</strong><small>{pl ? "2–6 Profili AI. Każda runda ma świeży kontekst; Field Guide i Viewer Notes są zamrożone i tylko do odczytu." : "2–6 AI Profiles. Every round starts fresh; Field Guide and Viewer Notes are frozen and read-only."}</small></span></div></div>
    </section>

    {!activeSeries && <>


      <TelepathicSetupStep step={1} pl={pl} valid={configReady} confirmed={setup.participantsConfirmed} busy={busy} onConfirm={() => { setLeadProfileId(""); setup.confirmParticipants(); }} onEdit={editParticipants}><div className="telepathic-section-heading"><div><Users size={18} /><span><strong>{pl ? "Uczestnicy AI" : "AI participants"}</strong><small>{pl ? "Wybierz od 2 do 6 różnych Profili AI. Każdy używa własnego RV Workspace i własnej trasy Viewera." : "Choose 2 to 6 distinct AI Profiles. Each uses its own RV Workspace and Viewer route."}</small></span></div></div><div className="telepathic-profile-list">{profiles.map((profile) => {
        const workspace = resolveTechnicalWorkspaceForProfile(workspaces, profile.id);
        const eligible = eligibleByProfile[profile.id] ?? [];
        const checked = selectedProfileIds.includes(profile.id);
        const selectedIdentity = identitySelections[profile.id] ?? "";
        return <article className="telepathic-profile-row" key={profile.id}><label className="telepathic-profile-toggle"><input type="checkbox" checked={checked} disabled={busy || unavailable || !workspace || !eligible.length || (!checked && selectedProfileIds.length >= 6)} onChange={(event) => selectProfile(profile.id, event.target.checked)} /><span><strong>{aiIsBeDisplayName(profile)}</strong><small>{!workspace ? (pl ? "Brak aktywnego RV Workspace" : "No active RV Workspace") : !eligible.length ? (pl ? "Brak dostępnej tożsamości Viewera" : "No available Viewer identity") : `${workspace.name} · ${eligible.length} route`}</small></span></label>{checked && <label><span>{pl ? "Tożsamość / trasa" : "Identity / route"}</span><select value={selectedIdentity} onChange={(event) => setIdentitySelections((current) => ({ ...current, [profile.id]: event.target.value }))}><option value="">{pl ? "Wybierz trasę" : "Select route"}</option>{eligible.map((item) => <option value={item.identity.id} key={item.identity.id}>{viewerIdentityLabel(item, language)}</option>)}</select></label>}</article>;
      })}</div></TelepathicSetupStep>

      <TelepathicSetupStep step={2} pl={pl} enabled={setup.participantsConfirmed} valid={selected.some(item => item.profile.id === leadProfileId)} confirmed={setup.leadConfirmed} busy={busy} onConfirm={setup.confirmLead} onEdit={setup.editLead}>
        <label><span>{pl ? "Wybierz prowadzącego" : "Select lead"}</span><select value={leadProfileId} onChange={event => setLeadProfileId(event.target.value)}>
          <option value="">{pl ? "Wybierz prowadzącego" : "Select lead"}</option>{selected.map(item => <option key={item.profile.id} value={item.profile.id}>{aiIsBeDisplayName(item.profile)}</option>)}
        </select></label>
      </TelepathicSetupStep>
      <section className="panel telepathic-exchange-panel"><fieldset className="telepathic-setup-fields" disabled={busy || unavailable}><div className="telepathic-config-grid"><label><span>{pl ? "Liczba rund" : "Rounds"}</span><input type="number" min={1} max={50} value={roundCount} onChange={(event) => setRoundCount(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))} /></label><label><span>{pl ? "Temat" : "Topic"}</span><select value={topic} onChange={(event) => setTopic(event.target.value as TelepathicTopic)}>{TOPICS.map((item) => <option value={item} key={item}>{topicLabel(item, pl)}</option>)}</select></label><label className="telepathic-check"><input type="checkbox" checked={discloseTopic} onChange={(event) => setDiscloseTopic(event.target.checked)} /><span>{pl ? "Pokaż temat odbiorcom" : "Disclose topic to receivers"}</span></label></div></fieldset>{schedule.length > 0 && <div className="telepathic-schedule"><strong>{pl ? "Harmonogram" : "Schedule"}</strong>{schedule.map((round) => <span key={round.roundId}>{pl ? "Runda" : "Round"} {round.roundNumber}: {round.sender}</span>)}</div>}<div className="training-actions">
        <button className="primary-button" disabled={!previewConfig || busy} onClick={() => void startTraining()}><Play size={15} />{pl ? "Rozpocznij trening telepatyczny" : "Start telepathic training"}</button>
      </div>
      {!configReady && <div className="training-requirement-note"><span>{pl ? "Wybierz 2–6 Profili z poprawnym RV Workspace i trasą Viewera." : "Select 2–6 Profiles with a valid RV Workspace and Viewer route."}</span></div>}</section>
    </>}

    {activeSeries && <>
      <TelepathicMetrics metrics={telepathicRuntimeMetrics(activeSeries)} pl={pl} actions={<TelepathicSeriesActions pl={pl} busy={busy} stopping={stopping} unavailable={unavailable} recovery={showRecoveryActions} uncertain={unresolved.length > 0} onStop={stopSeries} onResume={resumeSeries} onEnd={endSeries}/>}/>
      <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><GraduationCap size={18} /><span><strong>{pl ? "Aktywny trening" : "Active training"}</strong><small>{stateLabel(activeSeries.status, pl)} · {activeSeries.currentRoundIndex}/{activeSeries.rounds.length} {pl ? "ukończonych rund" : "rounds completed"}</small></span></div><button className="secondary-button" disabled={busy || unavailable} onClick={() => { detailGeneration.current++; applyActiveSeries(null); setError(null); }}>{pl ? "Nowy trening" : "New training"}</button></div><div className="telepathic-status-grid"><span><small>{pl ? "Uczestnicy" : "Participants"}</small><strong>{activeSeries.config.participants.map((item) => item.displayName).join(" · ")}</strong></span><span><small>{pl ? "Temat" : "Topic"}</small><strong>{topicLabel(activeSeries.config.topic, pl)} · {activeSeries.config.discloseTopicToReceivers ? (pl ? "jawny" : "visible") : (pl ? "ukryty" : "hidden")}</strong></span><span><small>Viewer Learning</small><strong>{pl ? "zamrożony · tylko odczyt" : "frozen · read-only"}</strong><small>{activeSeries.config.participants.map((item) => `${item.displayName}: FG ${item.fieldGuide ? `v${item.fieldGuide.version}` : "—"} · VN ${item.viewerNotes ? `v${item.viewerNotes.version}` : "—"}`).join(" | ")}</small></span></div><div className="training-actions">{busy ? <><span>{presentation === "waiting" ? (pl ? "Oczekiwanie na odpowiedź" : "Waiting for response") : (pl ? "Trening działa…" : "Training is running…")}</span></> : unavailable ? <span role="status">{presentation === "other" ? (pl ? "Praca trwa w innym oknie" : "Work is running in another window") : (pl ? "Sprawdzanie stanu wykonania" : "Checking execution state")}</span> : activeSeries.archivedAt ? <span>{pl ? "Zarchiwizowano · tylko odczyt. Przywróć trening w Settings → Data → Archive, aby kontynuować." : "Archived · read-only. Restore the training in Settings → Data → Archive to continue."}</span> : <>{!showRecoveryActions && activeSeries.status !== "cancelled" && <button className="primary-button" disabled={(activeSeries.status === "completed" && Object.keys(activeSeries.finalReflections).length >= activeSeries.config.participants.filter(p=>p.kind==="ai").length) || activeSeries.status === "blocked" || unresolved.length > 0 || Boolean(activeSeries.archivedAt)} onClick={() => void runRemaining()}><Play size={15} />{pl ? "Uruchom / kontynuuj" : "Run / continue"}</button>}{!showRecoveryActions && presentation === "recovery" && activeSeries.status === "blocked" && unresolved.length === 0 && <button className="secondary-button" onClick={() => void recoverBlocked()}>{pl ? "Odblokuj i wznów z checkpointu" : "Unblock and resume from checkpoint"}</button>}</>}</div>{presentation === "recovery" && activeSeries.providerCalls.at(-1)?.finishReason === "repetition_runaway" && <p>{pl ? "Wykryto zapętlenie odpowiedzi. Nie przyjęto niepełnego wyniku." : "Response repetition detected. The incomplete output was not accepted."}</p>}{presentation === "recovery" && activeSeries.rounds[activeSeries.currentRoundIndex]?.blockedReason && <div className="training-requirement-note"><span>{activeSeries.rounds[activeSeries.currentRoundIndex]?.blockedReason}</span></div>}</section>

      {presentation === "recovery" && unresolved.length > 0 && <section className="panel telepathic-exchange-panel"><strong>{pl ? "Niepewne wywołania providera" : "Uncertain provider calls"}</strong><p>{pl ? "Nie zostaną ponowione automatycznie. Dostawca mógł już przetworzyć wiadomość. Ponowienie może oznaczać dodatkowy koszt; limit dwóch prób nadal obowiązuje." : "They will not be retried automatically. If you explicitly treat an attempt as failed, the normal two-attempt limit still applies."}</p><div className="telepathic-series-history">{unresolved.map((call) => <button type="button" className="secondary-button telepathic-series-history-item" key={call.id} disabled={busy || unavailable} onClick={() => void resolveUncertain(call.id)}><span><strong>{telepathicStageLabel(call.callStage,pl)} · {activeSeries.config.participants.find(p=>p.id===call.participantId)?.displayName??call.participantId}</strong><small>{call.roundId} · attempt {call.technicalAttempt}</small></span><span>{call.technicalAttempt<2 ? (pl ? "Zezwól na ponowienie" : "Allow retry") : (pl?"Rozstrzygnij wyczerpaną próbę":"Resolve exhausted attempt")}</span></button>)}</div></section>}

      <section className="panel telepathic-exchange-panel"><div className="telepathic-round-tabs">{activeSeries.rounds.map((round) => <button type="button" key={round.assignment.roundId} className={currentViewRound?.assignment.roundId === round.assignment.roundId ? "active" : ""} onClick={() => setViewRoundId(round.assignment.roundId)}>{pl ? "Runda" : "Round"} {round.assignment.roundNumber}<small>{round.status}</small></button>)}</div>{currentViewRound && <TelepathicTranscript callPresentation={callPresentation} seriesId={activeSeries.config.seriesId} roundId={currentViewRound.assignment.roundId} leadId={currentViewRound.assignment.senderParticipantId} participants={activeSeries.config.participants} events={visibleTranscript(activeSeries)} pl={pl} legacy={!activeSeries.transcript}/>}</section>

      {Object.keys(activeSeries.finalReflections).length>0&&<section className="panel telepathic-exchange-panel"><strong>{pl?"Końcowe refleksje serii":"Final series reflections"}</strong><TelepathicTranscript callPresentation={callPresentation} seriesId={activeSeries.config.seriesId} leadId={activeSeries.plan.rounds[0]?.senderParticipantId??""} participants={activeSeries.config.participants} events={visibleTranscript(activeSeries)} pl={pl}/></section>}

    </>}

    {error && <div className="error-banner">{error}</div>}
  </div><TelepathicHistory pl={pl} busy={busy} items={history.items.map(item=>({id:item.seriesId,name:item.participantNames.join(" · "),status:stateLabel(item.status,pl),updatedAt:item.updatedAt,archivedAt:item.archivedAt}))}
    loading={history.loading} error={history.error} hasMore={Boolean(history.nextCursor)} onLoadMore={()=>void history.loadMore()} onRetry={()=>void retryHistory()}
    onOpen={id=>void openSeries(id)} onSave={id=>void withBusy(async()=>{const state=await repository.getTelepathicSeries(id);if(state) await saveTelepathicDocument(state);})}
    onArchive={(id,archived)=>void withBusy(()=>setTelepathicArchived(repository,id,archived),id,false).then(state=>{if(state){history.remove(id);if(activeSeriesIdRef.current===id)applyActiveSeries(null);}})}/></div>;
}
