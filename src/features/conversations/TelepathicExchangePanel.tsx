import { useTelepathicExecution, telepathicExecutionStore } from "../../components/useTelepathicExecution";
import type { TelepathicLocalExecution } from "../../telepathicExchange/executionPresentation";
import { useTelepathicHistory } from "../../components/useTelepathicHistory";
import { telepathicStatusLabel } from "../../telepathicExchange/historyStatus";
import { TelepathicSetupStep } from "../../components/TelepathicSetupStep";
import { useTelepathicSetupConfirmation } from "../../components/useTelepathicSetupConfirmation";
import { telepathicStageLabel } from "../../telepathicExchange/stageLabels";
import { TelepathicHistory } from "../../components/TelepathicHistory";
import { TelepathicTranscript } from "../../components/TelepathicTranscript";
import { TelepathicMetrics } from "../../components/TelepathicMetrics";
import { legacyEvents } from "../../telepathicExchange/transcript";
import { setTelepathicArchived } from "../../telepathicExchange/archive";
import { saveTelepathicDocument } from "../../exports/telepathy";
import { LEAD_INSTRUCTION_VERSION } from "../../telepathicExchange/leadGuidance";
import { freezeTelepathicTrainingLearning } from "../../telepathicExchange/trainingLearning";
import { saveHumanTelepathicSharing, saveHumanLeadGuidance, saveHumanGuidanceResponse } from "../../telepathicExchange/engine";
import { Check, CircleStop, Eye, LockKeyhole, Play, RadioTower, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { listEligibleViewerIdentities, preferredViewerIdentityId, viewerIdentityLabel, type EligibleViewerIdentity } from "../../aiCenter/viewerIdentitySelection";
import { storeTargetArtifact } from "../../artifacts/native";
import { aiIsBeDisplayName, humanIsBeDisplayName } from "../../domain/isBeIdentity";
import { resolveSessionLanguage } from "../../domain/localization";
import { isWorkspaceCompatible } from "../../domain/workspaceKind";
import type { getCopy } from "../../i18n";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import { isTauriRuntime } from "../../storage";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";
import {
  advanceTelepathicConversationSeries,
  cancelCurrentTelepathicRoundBeforeReveal,
  confirmHumanTelepathicTransmission,
  createTelepathicSeriesState,
  allowRetryForUncertainTelepathicCall,
  resumeBlockedTelepathicSeries,
  runTelepathicFinalReflections,
  saveHumanTelepathicFirstBlind,
  saveHumanTelepathicReflection,
  saveHumanTelepathicTarget,
  sealHumanTelepathicBlind,
  type TelepathicExchangeEngineDependencies,
} from "../../telepathicExchange/engine";
import { planTelepathicSeries } from "../../telepathicExchange/planner";
import {
  buildTelepathicConversationView,
  loadTelepathicConversationView,
  runTelepathicConversationUiAction,
  type TelepathicConversationSeriesView,
} from "../../telepathicExchange/conversationView";
import { resolveTelepathicAiRouteFromRepository } from "../../telepathicExchange/providerGateway";
import type {
  TelepathicParticipant,
  TelepathicSenderPolicy,
  TelepathicSeriesConfig,
  TelepathicSeriesState,
  TelepathicTargetAsset,
  TelepathicTopic,
} from "../../telepathicExchange/types";

interface TelepathicExchangePanelProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  profiles: Profile[];
  workspaces: Workspace[];
  onBusyChange?: (busy: boolean) => void;
}

type RouteSelections = Record<string, { workspaceId: string; identityId: string }>;

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

function humanParticipantId(seriesId: string): string {
  return `${seriesId}:human`;
}

function targetStorageId(seriesId: string, roundNumber: number): string {
  const safe = seriesId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 82);
  return `${safe}_r${roundNumber}`;
}

export function TelepathicExchangePanel({ copy, settings, profile, workspace, repository, profiles, workspaces, onBusyChange }: TelepathicExchangePanelProps) {
  const pl = settings.interfaceLanguage === "pl";
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const [eligibleByProfile, setEligibleByProfile] = useState<Record<string, EligibleViewerIdentity[]>>({});
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [routeSelections, setRouteSelections] = useState<RouteSelections>({});
  const [senderKind, setSenderKind] = useState<"human_only" | "fixed_ai">("human_only");
  const stopController = useRef<AbortController | null>(null);
  const [individualGuidance,setIndividualGuidance]=useState<Record<string,string>>({});
  const [guidanceText,setGuidanceText]=useState("");
  const [guidanceRecipients,setGuidanceRecipients]=useState<string[]>([]);
  const [finishedRecipients,setFinishedRecipients]=useState<string[]>([]);
  const [fixedAiProfileId, setFixedAiProfileId] = useState("");
  const [roundCount, setRoundCount] = useState(3);
  const [topic, setTopic] = useState<TelepathicTopic>("any");
  const [discloseTopic, setDiscloseTopic] = useState(false);
  const [activeSeries, setActiveSeries] = useState<TelepathicConversationSeriesView | null>(null);
  const history = useTelepathicHistory(repository, "conversation_exchange", workspace.id);
  const detailGeneration = useRef(0);
  useEffect(() => () => { detailGeneration.current++; }, [repository, workspace.id, profiles, language]);
  const [busy, setBusy] = useState(false);
  const [execution, setExecution] = useState<TelepathicLocalExecution | null>(null);
  const { presentation, callPresentation, unavailable } = useTelepathicExecution(repository, activeSeries, activeSeries?.recoveryCalls ?? [], execution, async (seriesId, isCurrent) => {
    if (!repository) return;
    const view = await loadTelepathicConversationView(repository, seriesId);
    if (isCurrent() && view && currentView.current.activeId === seriesId) setActiveSeries(view);
  });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setActiveSeries(null); setViewRoundId(null); }, [repository, workspace.id]);
  const [targetText, setTargetText] = useState("");
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [targetImageDescription, setTargetImageDescription] = useState("");
  const [firstBlind, setFirstBlind] = useState("");
  const [secondBlind, setSecondBlind] = useState("");
  const [reflection, setReflection] = useState("");
  const [viewRoundId, setViewRoundId] = useState<string | null>(null);
  const runGuardRef = useRef(false);
  const executionEpoch = useRef(0);
  useEffect(() => () => { executionEpoch.current++; stopController.current?.abort(); }, [workspace.id, repository]);

  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  useEffect(()=>()=>stopController.current?.abort(),[]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const epoch = ++detailGeneration.current;
      const [configs, models, page] = await Promise.all([repository.listProviderConfigs(), repository.listProviderModels(), history.reset()]);
      const entries = await Promise.all(profiles.map(async (item) => [item.id, await listEligibleViewerIdentities({ repository, profileId: item.id, language, providerConfigs: configs, models })] as const));
      if (cancelled) return;
      setEligibleByProfile(Object.fromEntries(entries));
      if (!page) return;
      const recent = await history.recentActive(page);
      if (cancelled || epoch !== detailGeneration.current) return;
      const recentView = recent ? await loadTelepathicConversationView(repository, recent.seriesId) : null;
      if (!cancelled && epoch === detailGeneration.current) {
        setActiveSeries(recentView);
        setViewRoundId(recentView?.rounds[Math.min(recentView.currentRoundIndex, Math.max(0, recentView.rounds.length - 1))]?.assignment.roundId ?? null);
      }
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [repository, workspace.id, profiles, language]);

  const activeId = activeSeries?.config.seriesId;
  const currentView = useRef({ activeId, workspaceId: workspace.id });
  currentView.current = { activeId, workspaceId: workspace.id };
  useEffect(() => {
    if (!busy || !repository || !activeId) return;
    let cancelled = false, reading = false;
    const workspaceId = workspace.id;
    const timer = window.setInterval(() => {
      if (reading) return;
      reading = true;
      void loadTelepathicConversationView(repository, activeId).then(view => {
        if (cancelled || !view || currentView.current.activeId !== activeId || currentView.current.workspaceId !== workspaceId) return;
        setActiveSeries(view);
        // Polling never changes the round selected by the reader.
      }).catch(() => undefined).finally(() => { reading = false; });
    }, 500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [busy, repository, activeId, workspace.id]);

  const compatibleWorkspaces = useMemo(() => workspaces.filter((item) => !item.archivedAt && isWorkspaceCompatible(item, "conversation")), [workspaces]);

  const setProfileSelected = (profileId: string, selected: boolean) => {
    if (busy || setup.participantsConfirmed) return;
    setError(null);
    setSelectedProfileIds((current) => selected ? [...current, profileId] : current.filter((id) => id !== profileId));
    if (!selected) {
      setRouteSelections((current) => { const next = { ...current }; delete next[profileId]; return next; });
      if (fixedAiProfileId === profileId) setFixedAiProfileId("");
      return;
    }
    const owned = compatibleWorkspaces.filter((item) => item.profileId === profileId);
    const identities = eligibleByProfile[profileId] ?? [];
    setRouteSelections((current) => ({
      ...current,
      [profileId]: {
        workspaceId: owned.length === 1 ? owned[0].id : "",
        identityId: identities.length === 1 ? identities[0].identity.id : preferredViewerIdentityId(identities, profiles.find((item) => item.id === profileId)?.defaultViewerModelId),
      },
    }));
  };

  const selectedAiParticipants = useMemo(() => selectedProfileIds.map((profileId) => {
    const selectedProfile = profiles.find((item) => item.id === profileId);
    const route = routeSelections[profileId];
    const workspaceForAi = compatibleWorkspaces.find((item) => item.id === route?.workspaceId && item.profileId === profileId);
    const eligible = (eligibleByProfile[profileId] ?? []).find((item) => item.identity.id === route?.identityId);
    if (!selectedProfile || !workspaceForAi || !eligible) return null;
    return { profile: selectedProfile, workspace: workspaceForAi, eligible };
  }).filter((item): item is { profile: Profile; workspace: Workspace; eligible: EligibleViewerIdentity } => Boolean(item)), [selectedProfileIds, profiles, routeSelections, compatibleWorkspaces, eligibleByProfile]);

  const participantsValid = Boolean(repository && profile && selectedProfileIds.length >= 1 && selectedAiParticipants.length === selectedProfileIds.length);
  const leadValid = senderKind === "human_only" || selectedAiParticipants.some(item => item.profile.id === fixedAiProfileId);
  const setup = useTelepathicSetupConfirmation(
    JSON.stringify({ selectedProfileIds, selectedAiParticipants, profile, workspace, language }), participantsValid,
    JSON.stringify({ senderKind, fixedAiProfileId }), leadValid, repository);
  const editParticipants = () => { setup.editParticipants(); setFixedAiProfileId(""); };
  const setupComplete = participantsValid && setup.leadConfirmed;

  const previewConfig = useMemo((): TelepathicSeriesConfig | null => {
    if (!setupComplete || !profile) return null;
    const seriesId = "preview";
    const humanId = humanParticipantId(seriesId);
    const participants: TelepathicParticipant[] = [
      { id: humanId, kind: "human", displayName: humanIsBeDisplayName(profile) },
      ...selectedAiParticipants.map(({ profile: aiProfile, workspace: aiWorkspace, eligible }) => ({
        id: `ai:${aiProfile.id}`,
        kind: "ai" as const,
        displayName: aiIsBeDisplayName(aiProfile),
        ai: {
          profileId: aiProfile.id,
          profileName: aiIsBeDisplayName(aiProfile),
          workspaceId: aiWorkspace.id,
          aiIdentityId: eligible.identity.id,
          providerConfigId: eligible.providerConfig.id,
          credentialId: eligible.providerConfig.credentialId,
          credentialFingerprint: eligible.identity.credentialFingerprint,
          modelId: eligible.model.modelId,
          route: eligible.model.route,
        },
      })),
    ];
    const senderPolicy: TelepathicSenderPolicy = senderKind === "human_only"
      ? { kind: "human_only", humanParticipantId: humanId }
      : senderKind === "fixed_ai"
        ? { kind: "fixed_ai", participantId: `ai:${fixedAiProfileId}` }
        : { kind: "human_only", humanParticipantId:humanId };
    return { schemaVersion: 1, seriesId, seriesWorkspaceId: workspace.id, mode: "conversation_exchange",protocolVersion:"fixed_lead_v1",leadInstructionVersion:LEAD_INSTRUCTION_VERSION,maxGuidanceCycles:3, language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, senderPolicy };
  }, [setupComplete, profile, selectedAiParticipants, senderKind, fixedAiProfileId, workspace.id, language, roundCount, topic, discloseTopic]);

  const schedule = useMemo(() => previewConfig ? planTelepathicSeries(previewConfig).rounds.map((round) => ({ ...round, sender: previewConfig.participants.find((item) => item.id === round.senderParticipantId)?.displayName ?? round.senderParticipantId })) : [], [previewConfig]);

  const engineDeps = (): TelepathicExchangeEngineDependencies => {
    if (!repository) throw new Error("Repository is not ready.");
    return {
      store: telepathicExecutionStore(repository, (seriesId, callIds) => {
        setExecution(current => current?.seriesId === seriesId ? { ...current, preexistingCallIds: callIds } : current);
      }),
      signal:stopController.current?.signal,
      resolveRoute: async (participant) => {
        if (!participant.ai) throw new Error("AI route snapshot is missing.");
        const liveProfile = profiles.find((item) => item.id === participant.ai!.profileId) ?? null;
        const model = (await repository.listProviderModels(participant.ai.providerConfigId)).find((item) => item.modelId === participant.ai!.modelId && item.route === participant.ai!.route) ?? null;
        if (!liveProfile || !model) throw new Error("Telepathic participant Profile or model route is no longer available.");
        return resolveTelepathicAiRouteFromRepository({ repository, participant, requestedSettings: profileGenerationDefaults(liveProfile, model) });
      },
    };
  };

  const execute = async (task: () => Promise<TelepathicSeriesState>, recoverySeriesId = activeSeries?.config.seriesId): Promise<boolean> => {
    if (runGuardRef.current) return false;
    if (recoverySeriesId === activeSeries?.config.seriesId && unavailable) return false;
    detailGeneration.current++;
    runGuardRef.current = true;
    const epoch = executionEpoch.current;
    stopController.current = new AbortController();
    onBusyChange?.(true);
    setBusy(true);
    setExecution(recoverySeriesId ? { seriesId: recoverySeriesId, preexistingCallIds: activeSeries?.recoveryCalls.map(call => call.id) ?? [] } : null);
    setError(null);
    try {
      const next = await runTelepathicConversationUiAction(task);
      if (epoch !== executionEpoch.current) return false;
      setActiveSeries(next);
      await history.reset();
      if (epoch !== executionEpoch.current) return false;
      const nextVisible = next.rounds[Math.min(next.currentRoundIndex, Math.max(0, next.rounds.length - 1))];
      setViewRoundId(nextVisible?.assignment.roundId ?? null);
      return true;
    } catch (cause) {
      if (epoch !== executionEpoch.current) return false;
      setError(cause instanceof Error ? cause.message : String(cause));
      if (repository && recoverySeriesId) {
        try {
          const persisted = await loadTelepathicConversationView(repository, recoverySeriesId);
          if (persisted && epoch === executionEpoch.current) {
            setActiveSeries(persisted);
            await history.reset();
            const persistedVisible = persisted.rounds[Math.min(persisted.currentRoundIndex, Math.max(0, persisted.rounds.length - 1))];
            setViewRoundId(persistedVisible?.assignment.roundId ?? null);
          }
        } catch {
          // Keep the original operation error visible. Manual Refresh remains available.
        }
      }
      return false;
    } finally {
      runGuardRef.current = false;
      stopController.current = null;
      setExecution(null);
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const startSeries = async () => {
    if (!repository || !profile || !setupComplete || busy) return;
    const seriesId = `telepathic-series-${crypto.randomUUID()}`;
    const humanId = humanParticipantId(seriesId);
    const participants: TelepathicParticipant[] = [
      { id: humanId, kind: "human", displayName: humanIsBeDisplayName(profile) },
      ...selectedAiParticipants.map(({ profile: aiProfile, workspace: aiWorkspace, eligible }) => ({
        id: `ai:${aiProfile.id}`,
        kind: "ai" as const,
        displayName: aiIsBeDisplayName(aiProfile),
        ai: {
          profileId: aiProfile.id,
          profileName: aiIsBeDisplayName(aiProfile),
          workspaceId: aiWorkspace.id,
          aiIdentityId: eligible.identity.id,
          providerConfigId: eligible.providerConfig.id,
          credentialId: eligible.providerConfig.credentialId,
          credentialFingerprint: eligible.identity.credentialFingerprint,
          modelId: eligible.model.modelId,
          route: eligible.model.route,
        },
      })),
    ];
    const senderPolicy: TelepathicSenderPolicy = senderKind === "human_only"
      ? { kind: "human_only", humanParticipantId: humanId }
      : senderKind === "fixed_ai"
        ? { kind: "fixed_ai", participantId: `ai:${fixedAiProfileId}` }
        : { kind: "human_only", humanParticipantId:humanId };
    const config: TelepathicSeriesConfig = { schemaVersion: 1, seriesId, seriesWorkspaceId: workspace.id, mode: "conversation_exchange",protocolVersion:"fixed_lead_v1",leadInstructionVersion:LEAD_INSTRUCTION_VERSION,maxGuidanceCycles:3, language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, senderPolicy };
    await execute(async () => {
      const frozen=await freezeTelepathicTrainingLearning({repository,config});
      const initial = createTelepathicSeriesState(frozen);
      await repository.saveTelepathicSeries(initial);
      setActiveSeries(buildTelepathicConversationView(initial));
      setViewRoundId(initial.rounds[0]?.assignment.roundId ?? null);
      return advanceTelepathicConversationSeries(engineDeps(), seriesId);
    }, seriesId);
  };

  const refreshSeries = async () => {
    if (!repository || !activeSeries) return;
    const loaded = await loadTelepathicConversationView(repository, activeSeries.config.seriesId);
    if (loaded) setActiveSeries(loaded);
  };

  const step = activeSeries?.archivedAt ? { kind: "none" as const } : activeSeries?.humanStep ?? { kind: "none" as const };
  const currentRound = activeSeries?.rounds[activeSeries.currentRoundIndex] ?? null;
  const human = activeSeries?.config.participants.find((item) => item.kind === "human") ?? null;
  const humanIsSender = Boolean(currentRound && human && currentRound.assignment.senderParticipantId === human.id);
  const unresolvedCalls = activeSeries?.recoveryCalls ?? [];
  const unresolvedFinalReflectionCalls = unresolvedCalls.filter((call) => call.callStage === "series_reflection" || call.roundId === "series-complete");

  const saveTarget = async () => {
    if (!activeSeries || !targetText.trim()) return;
    const saved = await execute(async () => {
      let assets: TelepathicTargetAsset[] = [];
      if (targetImage) {
        if (!isTauriRuntime()) throw new Error(pl ? "Obrazy celu są dostępne w aplikacji desktopowej." : "Target images are available in the desktop app.");
        const stored = await storeTargetArtifact(targetStorageId(activeSeries.config.seriesId, currentRound?.assignment.roundNumber ?? 1), targetImage);
        assets = [{ artifactId: stored.artifactId, kind: "image", originalFileName: stored.originalFileName, mimeType: stored.mimeType, size: stored.size, sha256: stored.sha256, path: stored.path, ...(targetImageDescription.trim() ? { shortDescription: targetImageDescription.trim() } : {}) }];
      }
      return saveHumanTelepathicTarget(engineDeps(), activeSeries.config.seriesId, { content: targetText.trim(), assets });
    });
    if (saved) { setTargetText(""); setTargetImage(null); setTargetImageDescription(""); }
  };

  const afterHumanAction = async (action: () => Promise<TelepathicSeriesState>, autoAdvance = false) => {
  if (!activeSeries) return;
    await execute(async () => {
      const state = await action();
      if (!autoAdvance) return state;
      return advanceTelepathicConversationSeries(engineDeps(), state.config.seriesId);
    });
  };

  const openSeries = async (seriesId: string) => {
    if (!repository || busy) return;
    const epoch = ++detailGeneration.current;
    try {
      const series = await loadTelepathicConversationView(repository, seriesId);
      if (epoch !== detailGeneration.current) return;
      if (!series || series.config.seriesWorkspaceId !== workspace.id) throw new Error("Exchange not found in this Workspace.");
      setActiveSeries(series);
      const visible = series.rounds[Math.min(series.currentRoundIndex, Math.max(0, series.rounds.length - 1))];
      setViewRoundId(visible?.assignment.roundId ?? null); setError(null);
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


  if (!repository || !profile) return <div className="panel telepathic-exchange-panel"><p>{pl ? "Repozytorium lub Profil nie jest gotowy." : "Repository or Profile is not ready."}</p></div>;

  const historyPanel = <TelepathicHistory sessionKind="exchange" pl={pl} busy={busy} items={history.items.map(item=>({id:item.seriesId,name:`${pl?"Wymiana":"Exchange"} · ${item.roundCount}`,status:telepathicStatusLabel(item.status,pl),updatedAt:item.updatedAt,archivedAt:item.archivedAt}))}
    loading={history.loading} error={history.error} hasMore={Boolean(history.nextCursor)} onLoadMore={()=>void history.loadMore()} onRetry={()=>void retryHistory()}
    onOpen={id=>{if(!busy)void openSeries(id);}}
    onSave={id=>void execute(async()=>{const state=await repository.getTelepathicSeries(id);if(!state)throw new Error("Series not found.");await saveTelepathicDocument(state);return state;})}
    onArchive={(id,archived)=>void execute(()=>setTelepathicArchived(repository,id,archived)).then(async success=>{if(success){detailGeneration.current++;setActiveSeries(null);await history.reset();}})}/>;

  if (!activeSeries) return <div className="telepathic-with-history"><div className="telepathic-exchange-stack">
    {history.items.length > 0 && <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><RefreshCw size={18} /><span><strong>{pl ? "Zapisane wymiany" : "Saved exchanges"}</strong><small>{pl ? "Otwórz dowolną wcześniejszą serię, także wstrzymaną lub zablokowaną." : "Open any earlier series, including paused or blocked exchanges."}</small></span></div></div>

    </section>}
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><RadioTower size={18} /><span><strong>{pl ? "Wymiana telepatyczna" : "Telepathic exchange"}</strong><small>{pl ? "Skonfiguruj uczestników i harmonogram przed startem." : "Configure participants and the schedule before starting."}</small></span></div></div>
      <fieldset className="telepathic-setup-fields" disabled={busy || unavailable}><div className="telepathic-config-grid">
        <label><span>{pl ? "Liczba rund" : "Rounds"}</span><input type="number" min={1} max={20} value={roundCount} onChange={(event) => setRoundCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        <label><span>{pl ? "Temat" : "Topic"}</span><select value={topic} onChange={(event) => setTopic(event.target.value as TelepathicTopic)}>{TOPICS.map((item) => <option key={item} value={item}>{topicLabel(item, pl)}</option>)}</select></label>

        <label className="telepathic-check"><input type="checkbox" checked={discloseTopic} onChange={(event) => setDiscloseTopic(event.target.checked)} /><span>{pl ? "Pokaż temat odbiorcom" : "Disclose topic to receivers"}</span></label>
      </div></fieldset>

    </section>

    <TelepathicSetupStep step={1} pl={pl} valid={participantsValid} confirmed={setup.participantsConfirmed} busy={busy} onConfirm={() => { setFixedAiProfileId(""); setup.confirmParticipants(); }} onEdit={editParticipants}>
      <div className="telepathic-section-heading"><div><Users size={18} /><span><strong>{pl ? "Uczestnicy AI" : "AI participants"}</strong><small>{pl ? "Każdy AI używa własnego Profilu, Workspace i trasy Viewera." : "Each AI uses its own Profile, Workspace, and Viewer route."}</small></span></div></div>
      <p>{pl ? "Uczestniczysz jako człowiek" : "You participate as a human"}: {profile ? humanIsBeDisplayName(profile) : "—"}</p>
      <div className="telepathic-profile-list">{profiles.map((item) => {
        const selected = selectedProfileIds.includes(item.id);
        const owned = compatibleWorkspaces.filter((candidate) => candidate.profileId === item.id);
        const eligible = eligibleByProfile[item.id] ?? [];
        const route = routeSelections[item.id] ?? { workspaceId: "", identityId: "" };
        return <article className="telepathic-profile-row" key={item.id}>
          <label className="telepathic-profile-toggle"><input type="checkbox" checked={selected} disabled={!owned.length || !eligible.length} onChange={(event) => setProfileSelected(item.id, event.target.checked)} /><span><strong>{aiIsBeDisplayName(item)}</strong><small>{!owned.length ? (pl ? "Brak Conversation Workspace" : "No Conversation Workspace") : !eligible.length ? (pl ? "Brak dostępnej tożsamości Viewera" : "No available Viewer identity") : `${owned.length} Workspace · ${eligible.length} route`}</small></span></label>
          {selected && <div className="telepathic-route-grid"><label><span>Workspace</span><select value={route.workspaceId} onChange={(event) => setRouteSelections((current) => ({ ...current, [item.id]: { ...route, workspaceId: event.target.value } }))}><option value="">{owned.length > 1 ? (pl ? "Wybierz Workspace" : "Select Workspace") : "—"}</option>{owned.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label><span>{pl ? "Tożsamość / trasa" : "Identity / route"}</span><select value={route.identityId} onChange={(event) => setRouteSelections((current) => ({ ...current, [item.id]: { ...route, identityId: event.target.value } }))}><option value="">{eligible.length > 1 ? (pl ? "Wybierz trasę" : "Select route") : "—"}</option>{eligible.map((candidate) => <option key={candidate.identity.id} value={candidate.identity.id}>{viewerIdentityLabel(candidate, language)}</option>)}</select></label></div>}
        </article>;
      })}</div>
    </TelepathicSetupStep>
    <TelepathicSetupStep step={2} pl={pl} enabled={setup.participantsConfirmed} valid={leadValid} confirmed={setup.leadConfirmed} busy={busy} onConfirm={setup.confirmLead} onEdit={setup.editLead}>
        <label><span>{pl ? "Prowadzący" : "Lead"}</span><select value={senderKind} onChange={(event) => setSenderKind(event.target.value as typeof senderKind)}><option value="human_only">{pl ? "Tylko człowiek" : "Human only"}</option><option value="fixed_ai">{pl ? "Jeden wybrany AI" : "One selected AI"}</option></select></label>
      {senderKind === "fixed_ai" && <label><span>{pl ? "Stały AI nadawca" : "Fixed AI sender"}</span><select value={fixedAiProfileId} onChange={(event) => setFixedAiProfileId(event.target.value)}><option value="">{pl ? "Wybierz Profil" : "Select Profile"}</option>{selectedAiParticipants.map(({ profile: item }) => <option key={item.id} value={item.id}>{aiIsBeDisplayName(item)}</option>)}</select></label>}
    </TelepathicSetupStep>

    {schedule.length > 0 && <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><Eye size={18} /><span><strong>{pl ? "Harmonogram przed startem" : "Schedule before start"}</strong><small>{pl ? "Plan zostanie zamrożony razem z serią." : "The plan will be frozen with the series."}</small></span></div></div><div className="telepathic-schedule">{schedule.map((item) => <span key={item.roundId}><strong>{pl ? "Runda" : "Round"} {item.roundNumber}</strong> → {item.sender}</span>)}</div></section>}
    {error && <div className="provider-error">{error}</div>}
    <button className="primary-button telepathic-start" disabled={!setupComplete || busy || unavailable} onClick={() => void startSeries()}><Play size={15} />{pl ? "Rozpocznij wymianę" : "Start exchange"}</button>
  </div>{historyPanel}</div>;

  const fallbackVisibleRound = activeSeries.rounds[Math.min(activeSeries.currentRoundIndex, Math.max(0, activeSeries.rounds.length - 1))] ?? null;
  const visibleRound = activeSeries.rounds.find((round) => round.assignment.roundId === viewRoundId) ?? fallbackVisibleRound;
  const revealed = Boolean(visibleRound?.revealedAt);
  const participantName = (id: string) => activeSeries.config.participants.find((item) => item.id === id)?.displayName ?? id;
  const roundResults = revealed && visibleRound ? activeSeries.config.participants.map((item) => {
    const isSender = visibleRound.assignment.senderParticipantId === item.id;
    const blind = visibleRound.blindByParticipant[item.id];
    const review = visibleRound.reflectionsByParticipant[item.id];
    return <article key={item.id}>
      <div className="telepathic-result-head"><strong>{item.displayName}</strong><small>{isSender ? (pl ? "nadawca" : "sender") : (pl ? "odbiorca" : "receiver")}</small></div>
      {!isSender && <p><b>{pl ? "Pierwszy opis" : "First blind"}:</b> {blind?.first || "NO_SUBMISSION"}</p>}
      {!isSender && blind?.second && <p><b>{pl ? "Drugie spojrzenie" : "Second look"}:</b> {blind.second}</p>}
      {review?.reflection !== undefined && <p><b>{pl ? "Refleksja" : "Reflection"}:</b> {review.reflection || "—"}</p>}
      {item.kind === "ai" && review?.shareOthersConsent && <p><b>{pl ? "Cudze odpowiedzi" : "Others’ answers"}:</b> {review.shareOthersConsent === "yes" ? (pl ? "TAK" : "YES") : (pl ? "NIE" : "NO")}</p>}
      {item.kind === "ai" && review?.sharedAnswersComment !== undefined && <p><b>{pl ? "Komentarz po poznaniu odpowiedzi" : "Comment after reading others"}:</b> {review.sharedAnswersComment || "—"}</p>}
    </article>;
  }) : null;

  return <div className="telepathic-with-history"><div className="telepathic-exchange-stack">
    {activeSeries.metrics&&<TelepathicMetrics pl={pl} metrics={activeSeries.metrics}/>}
    {(presentation === "waiting" || presentation === "working" || presentation === "other" || presentation === "checking") && <div role="status" className="telepathic-action-row"><span>{presentation === "waiting" ? (pl ? "Oczekiwanie na odpowiedź" : "Waiting for response") : presentation === "other" ? (pl ? "Praca trwa w innym oknie" : "Work is running in another window") : presentation === "checking" ? (pl ? "Sprawdzanie stanu wykonania" : "Checking execution state") : (pl ? "Praca trwa…" : "Work is running…")}</span>{busy && <button type="button" className="secondary-button" onClick={()=>stopController.current?.abort(new DOMException("Stopped by user","AbortError"))}>{pl?"Zatrzymaj":"Stop"}</button>}</div>}
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-run-head"><div><RadioTower size={18} /><span><strong>{pl ? "Wymiana telepatyczna" : "Telepathic exchange"}</strong><small>{activeSeries.status} · {pl ? "runda" : "round"} {Math.min(activeSeries.currentRoundIndex + 1, activeSeries.rounds.length)}/{activeSeries.rounds.length}</small></span></div><div className="telepathic-run-actions"><button className="secondary-button" disabled={busy} onClick={() => void refreshSeries()}><RefreshCw size={14} />{pl ? "Odśwież" : "Refresh"}</button><button className="secondary-button" disabled={busy || unavailable} onClick={() => { detailGeneration.current++; setActiveSeries(null); setViewRoundId(null); setError(null); }}>{pl ? "Nowa wymiana" : "New exchange"}</button></div></div>
      <div className="telepathic-schedule compact">{activeSeries.plan.rounds.map((item) => { const round = activeSeries.rounds[item.roundNumber - 1]; const selectable = Boolean(round && (round.revealedAt || item.roundNumber <= activeSeries.currentRoundIndex + 1)); return <button type="button" key={item.roundId} disabled={busy || unavailable || !selectable} className={item.roundId === visibleRound?.assignment.roundId ? "active" : ""} onClick={() => setViewRoundId(item.roundId)}><strong>{item.roundNumber}</strong> → {participantName(item.senderParticipantId)}</button>; })}</div>
    </section>

    {visibleRound && <section className="panel telepathic-exchange-panel">
      <div className="telepathic-round-title"><strong>{pl ? "Runda" : "Round"} {visibleRound.assignment.roundNumber}</strong><span>{pl ? "Prowadzący" : "Lead"}: {participantName(visibleRound.assignment.senderParticipantId)}</span><small>{visibleRound.status}</small></div>
      {!revealed && <div className="telepathic-status-grid">{visibleRound.assignment.receiverParticipantIds.map((id) => { const blind = visibleRound.blindByParticipant[id]; return <div key={id}><strong>{participantName(id)}</strong><small>{blind?.status ?? "waiting"}</small></div>; })}</div>}
      {revealed && visibleRound.target && <div className="telepathic-reveal"><div><LockKeyhole size={17} /><strong>Reveal</strong></div><p>{visibleRound.target.content}</p>{visibleRound.target.assets.map((asset) => <small key={asset.artifactId}>▣ {asset.originalFileName}{asset.shortDescription ? ` · ${asset.shortDescription}` : ""}</small>)}</div>}
      <TelepathicTranscript callPresentation={callPresentation} seriesId={activeSeries.config.seriesId} roundId={visibleRound.assignment.roundId} leadId={visibleRound.assignment.senderParticipantId} participants={activeSeries.config.participants} events={activeSeries.transcript ?? legacyEvents(activeSeries)} pl={pl} legacy={activeSeries.legacyTranscript}/>
    </section>}

    {step.kind === "prepare_target" && <section className="panel telepathic-action-box"><h3>{pl ? "Przygotuj i zamroź cel" : "Prepare and lock the target"}</h3><p>{pl?"Kategoria":"Category"}: {topicLabel(activeSeries.config.topic ?? "any",pl)} · {pl?"Obszar":"Area"}: {pl?currentRound?.assignment.targetGeography?.labelPl:currentRound?.assignment.targetGeography?.labelEn}</p><p>{pl ? "Odbiorcy nie zobaczą celu. Najpierw zapisz go i zamroź, a następnie osobno potwierdź przekaz." : "Receivers will not see the target. Save and lock it first, then confirm transmission separately."}</p><textarea rows={6} value={targetText} onChange={(event) => setTargetText(event.target.value)} placeholder={pl ? "Wpisz i opisz cel" : "Enter and describe the target"} /><div className="telepathic-image-row"><label className="secondary-button">{pl ? "Dodaj obraz" : "Add image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isTauriRuntime()} onChange={(event) => setTargetImage(event.target.files?.[0] ?? null)} /></label>{targetImage && <span>▣ {targetImage.name}</span>}</div>{targetImage && <input value={targetImageDescription} onChange={(event) => setTargetImageDescription(event.target.value)} placeholder={pl ? "Krótki opis obrazu dla modeli bez vision" : "Short image description for models without vision"} />}<small>{pl ? "Nie każdy model odczytuje obrazy. Dołącz przynajmniej krótki opis tekstowy." : "Not every model can read images. Please include at least a short text description."}</small><button className="primary-button" disabled={busy || unavailable || !targetText.trim() || Boolean(targetImage && !targetImageDescription.trim())} onClick={() => void saveTarget()}><LockKeyhole size={14} />{pl ? "Zapisz i zamroź cel" : "Save and lock target"}</button></section>}

    {step.kind === "confirm_transmission" && <section className="panel telepathic-action-box"><h3>{pl ? "Cel został zamrożony" : "Target locked"}</h3>{humanIsSender && currentRound?.target && <p>{currentRound.target.content}</p>}<button className="primary-button" disabled={busy || unavailable} onClick={() => void afterHumanAction(() => confirmHumanTelepathicTransmission(engineDeps(), activeSeries.config.seriesId), true)}><RadioTower size={14} />{pl ? "Przekaz gotowy" : "Transmission ready"}</button></section>}

    {step.kind === "blind_first" && <section className="panel telepathic-action-box"><h3>{pl ? "Pierwsze wrażenia" : "First impressions"}</h3><p>{pl ? "Cel został przygotowany i zamrożony. Nie widzisz go jeszcze. Opisz prostymi słowami pierwsze wrażenia. Nie musisz zgadywać ani nazywać celu. Możesz pozostawić rundę w tym stanie i wrócić później albo anulować ją bez Revealu." : "The target has been prepared and locked. You cannot see it yet. Describe your first impressions in simple words. You do not need to guess or name it. You may leave the round here and return later, or cancel it without Reveal."}</p><textarea rows={6} value={firstBlind} onChange={(event) => setFirstBlind(event.target.value)} /><div className="telepathic-action-row"><button className="secondary-button danger-action" disabled={busy || unavailable} onClick={() => void afterHumanAction(() => cancelCurrentTelepathicRoundBeforeReveal(engineDeps(), activeSeries.config.seriesId))}><CircleStop size={14} />{pl ? "Anuluj rundę bez Revealu" : "Cancel round without Reveal"}</button><button className="primary-button" disabled={busy || unavailable || !firstBlind.trim()} onClick={() => void afterHumanAction(() => saveHumanTelepathicFirstBlind(engineDeps(), activeSeries.config.seriesId, firstBlind.trim()), true)}>{pl ? "Zapisz pierwszy opis" : "Save first description"}</button></div></section>}

    {step.kind === "lead_guidance" && <section className="panel telepathic-action-box"><h3>{pl?"Prowadzenie":"Guidance"} · {step.cycle}/3</h3>
      {step.activeIds.map(id=><div key={id}><span>{participantName(id)}</span><label><input type="checkbox" checked={guidanceRecipients.includes(id)} onChange={e=>setGuidanceRecipients(ids=>e.target.checked?[...ids,id]:ids.filter(i=>i!==id))}/>{pl?"Pytanie":"Instruction"}</label><input aria-label={`${pl?"Osobne pytanie":"Individual instruction"} · ${participantName(id)}`} value={individualGuidance[id]??""} onChange={e=>setIndividualGuidance(current=>({...current,[id]:e.target.value}))}/><label><input type="checkbox" checked={finishedRecipients.includes(id)} onChange={e=>setFinishedRecipients(ids=>e.target.checked?[...ids,id]:ids.filter(i=>i!==id))}/>{pl?"Zakończ udział":"Finish guidance"}</label></div>)}
      <textarea aria-label={pl?"Pytanie od prowadzącego":"Instruction from lead"} value={guidanceText} onChange={e=>setGuidanceText(e.target.value)}/>
      <button type="button" className="primary-button" disabled={busy || unavailable} onClick={()=>void afterHumanAction(()=>saveHumanLeadGuidance(engineDeps(),activeSeries.config.seriesId,{cycle:step.cycle,finishRound:false,finishParticipantIds:finishedRecipients.filter(id=>step.activeIds.includes(id)),broadcast:guidanceRecipients.some(id=>!individualGuidance[id]?.trim())?{recipientIds:guidanceRecipients.filter(id=>step.activeIds.includes(id)&&!individualGuidance[id]?.trim()),instruction:guidanceText}:undefined,individual:guidanceRecipients.filter(id=>step.activeIds.includes(id)&&individualGuidance[id]?.trim()).map(participantId=>({participantId,instruction:individualGuidance[participantId]}))}),true)}>{pl?"Wyślij decyzję":"Send decision"}</button>
      <button type="button" className="secondary-button" disabled={busy || unavailable} onClick={()=>void afterHumanAction(()=>saveHumanLeadGuidance(engineDeps(),activeSeries.config.seriesId,{cycle:step.cycle,finishRound:true,finishParticipantIds:[]}),true)}>{pl?"Zakończ pytania i zamknij blind":"Finish guidance and seal blind"}</button>
    </section>}
    {step.kind === "receiver_guidance" && <section className="panel telepathic-action-box"><h3>{pl?"Pytanie od prowadzącego":"Instruction from lead"} · {step.cycle}/3</h3><p>{step.instruction}</p><textarea value={guidanceText} onChange={e=>setGuidanceText(e.target.value)}/><button type="button" className="primary-button" disabled={busy || unavailable||!guidanceText.trim()} onClick={()=>void afterHumanAction(()=>saveHumanGuidanceResponse(engineDeps(),activeSeries.config.seriesId,guidanceText),true)}>{pl?"Zapisz odpowiedź":"Save response"}</button></section>}
    {step.kind === "blind_second" && <section className="panel telepathic-action-box"><h3>{pl ? "Drugie spojrzenie" : "Second look"}</h3><p>{pl ? "Dopisz tylko nowe lub wyraźniejsze wrażenia. To nie jest lista do wypełnienia. Możesz zostawić pole puste, jeśli nie masz dalszych wrażeń." : "Add only new or clearer impressions. This is not a checklist. You may leave the field empty if you have no further impressions."}</p><blockquote>{step.first}</blockquote><textarea rows={5} value={secondBlind} onChange={(event) => setSecondBlind(event.target.value)} /><div className="telepathic-action-row"><button className="secondary-button danger-action" disabled={busy || unavailable} onClick={() => void afterHumanAction(() => cancelCurrentTelepathicRoundBeforeReveal(engineDeps(), activeSeries.config.seriesId))}><CircleStop size={14} />{pl ? "Anuluj rundę bez Revealu" : "Cancel round without Reveal"}</button><button className="primary-button" disabled={busy || unavailable} onClick={() => void afterHumanAction(() => sealHumanTelepathicBlind(engineDeps(), activeSeries.config.seriesId, secondBlind), true)}><Check size={14} />{pl ? "Zamknij opis i przejdź dalej" : "Seal blind and continue"}</button></div></section>}

    {step.kind === "reflection" && <section className="panel telepathic-action-box"><h3>{pl ? "Twoja refleksja po Revealu" : "Your post-Reveal reflection"}</h3><p>{step.role === "receiver" ? (pl ? "Porównaj wcześniejsze słowa z celem. Oddziel zgodności potwierdzone od możliwości dotyczących otoczenia. Nie dopisuj nowych percepcji wstecz." : "Compare your earlier words with the target. Keep confirmed agreement separate from possible surroundings. Do not add new perceptions retroactively.") : (pl ? "Możesz krótko opisać, jak wybierałeś i przedstawiałeś cel." : "You may briefly describe how you chose and presented the target.")}</p><textarea rows={6} value={reflection} onChange={(event) => setReflection(event.target.value)} /><button className="primary-button" disabled={busy || unavailable} onClick={() => void afterHumanAction(() => saveHumanTelepathicReflection(engineDeps(), activeSeries.config.seriesId, reflection), true)}>{pl ? "Zapisz refleksję i kontynuuj" : "Save reflection and continue"}</button></section>}

    {step.kind==="sharing_consent"&&<section className="panel telepathic-action-box"><h3>{pl?"Czy chcesz zobaczyć wypowiedzi innych?":"Would you like to see others' statements?"}</h3>{(["yes","no"] as const).map(consent=><button type="button" className="secondary-button" disabled={busy || unavailable} key={consent} onClick={()=>void afterHumanAction(()=>saveHumanTelepathicSharing(engineDeps(),activeSeries.config.seriesId,consent),true)}>{consent==="yes"?(pl?"Tak":"Yes"):(pl?"Nie":"No")}</button>)}</section>}
    {step.kind==="sharing_comment"&&<section className="panel telepathic-action-box"><h3>{pl?"Komentarz po wymianie":"Comment after sharing"}</h3><p>{step.sharedText}</p><textarea value={guidanceText} onChange={e=>setGuidanceText(e.target.value)}/><button type="button" className="primary-button" disabled={busy || unavailable} onClick={()=>void afterHumanAction(()=>saveHumanTelepathicSharing(engineDeps(),activeSeries.config.seriesId,"yes",guidanceText),true)}>{pl?"Zapisz i kontynuuj":"Save and continue"}</button></section>}
    {(activeSeries.status !== "completed" || Object.keys(activeSeries.finalReflections).length < activeSeries.config.participants.filter(p=>p.kind==="ai").length) && activeSeries.status !== "blocked" && step.kind === "none" && <button className="primary-button telepathic-start" disabled={busy || unavailable||Boolean(activeSeries.archivedAt)||unresolvedCalls.length>0} onClick={() => void execute(() => activeSeries.status==="completed" ? runTelepathicFinalReflections(engineDeps(),activeSeries.config.seriesId) : advanceTelepathicConversationSeries(engineDeps(), activeSeries.config.seriesId))}><Play size={15} />{pl ? "Kontynuuj / Resume" : "Continue / Resume"}</button>}

    {Object.keys(activeSeries.finalReflections).length>0 && <section className="panel telepathic-exchange-panel"><TelepathicTranscript callPresentation={callPresentation} seriesId={activeSeries.config.seriesId} leadId={activeSeries.plan.rounds[0]?.senderParticipantId ?? ""} participants={activeSeries.config.participants} events={activeSeries.transcript ?? []} pl={pl}/></section>}


    {presentation === "recovery" && <section className="panel telepathic-action-box telepathic-blocked-resolution"><h3>{pl ? "Seria zatrzymana" : "Series blocked"}</h3>{activeSeries.repetitionStopped && <p>{pl ? "Wykryto zapętlenie odpowiedzi. Nie przyjęto niepełnego wyniku." : "Response repetition detected. The incomplete output was not accepted."}</p>}<p>{activeSeries.rounds[activeSeries.currentRoundIndex]?.blockedReason ?? (pl ? "Wynik wywołania nie został potwierdzony." : "The provider result was not confirmed.")}</p>{unresolvedCalls.length > 0 ? <><p>{pl ? "Co najmniej jedno wywołanie providera ma niepewny wynik po wysłaniu. Program nie ponowi go sam. Jeżeli świadomie uznasz tę próbę za nieudaną, możesz pozwolić zwykłemu Resume zdecydować, czy pozostała jeszcze bezpieczna próba." : "At least one provider call has an uncertain result after dispatch. The program will not retry it automatically. If you explicitly treat that attempt as failed, normal Resume can decide whether a safe attempt remains."}</p>{unresolvedCalls.map((call) => <div className="telepathic-uncertain-call" key={call.id}><span><strong>{telepathicStageLabel(call.callStage,pl)}</strong><small>{call.participantId} · attempt {call.technicalAttempt} · {call.status}</small></span><button className="secondary-button" disabled={busy || unavailable} onClick={() => void execute(() => allowRetryForUncertainTelepathicCall(engineDeps(), activeSeries.config.seriesId, call.id))}>{call.technicalAttempt<2?(pl ? "Zezwól na ponowienie" : "Allow retry"):(pl?"Rozstrzygnij wyczerpaną próbę":"Resolve exhausted attempt")}</button></div>)}</> : <button className="primary-button" disabled={busy || unavailable} onClick={() => void execute(() => resumeBlockedTelepathicSeries(engineDeps(), activeSeries.config.seriesId))}><Play size={14} />{pl ? "Odblokuj i wznów od checkpointu" : "Unblock and resume from checkpoint"}</button>}</section>}
    {error && <div className="provider-error">{error}</div>}
  </div>{historyPanel}</div>;
}
