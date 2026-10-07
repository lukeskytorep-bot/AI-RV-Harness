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
  listTelepathicConversationSummaries,
  loadTelepathicConversationView,
  runTelepathicConversationUiAction,
  telepathicConversationSummary,
  type TelepathicConversationSeriesSummary,
  type TelepathicConversationSeriesView,
} from "../../telepathicExchange/conversationView";
import { resolveTelepathicAiRouteFromRepository } from "../../telepathicExchange/providerGateway";
import { preflightTelepathicConversationConfig, type TelepathicConversationConfigPreflight } from "../../telepathicExchange/conversationPreflight";
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
  const [senderKind, setSenderKind] = useState<"rotate" | "human_only" | "fixed_ai">("rotate");
  const [fixedAiProfileId, setFixedAiProfileId] = useState("");
  const [roundCount, setRoundCount] = useState(3);
  const [topic, setTopic] = useState<TelepathicTopic>("any");
  const [discloseTopic, setDiscloseTopic] = useState(false);
  const [activeSeries, setActiveSeries] = useState<TelepathicConversationSeriesView | null>(null);
  const [seriesHistory, setSeriesHistory] = useState<TelepathicConversationSeriesSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetText, setTargetText] = useState("");
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [targetImageDescription, setTargetImageDescription] = useState("");
  const [firstBlind, setFirstBlind] = useState("");
  const [secondBlind, setSecondBlind] = useState("");
  const [reflection, setReflection] = useState("");
  const [viewRoundId, setViewRoundId] = useState<string | null>(null);
  const [configPreflight, setConfigPreflight] = useState<TelepathicConversationConfigPreflight | null>(null);
  const [configPreflightSignature, setConfigPreflightSignature] = useState<string | null>(null);
  const runGuardRef = useRef(false);

  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const [configs, models] = await Promise.all([repository.listProviderConfigs(), repository.listProviderModels()]);
      const entries = await Promise.all(profiles.map(async (item) => [item.id, await listEligibleViewerIdentities({ repository, profileId: item.id, language, providerConfigs: configs, models })] as const));
      if (cancelled) return;
      setEligibleByProfile(Object.fromEntries(entries));
      const history = await listTelepathicConversationSummaries(repository, workspace.id);
      const recent = history[0] ?? null;
      const recentView = recent ? await loadTelepathicConversationView(repository, recent.seriesId) : null;
      if (!cancelled) {
        setSeriesHistory(history);
        setActiveSeries(recentView);
        setViewRoundId(recentView?.rounds[Math.min(recentView.currentRoundIndex, Math.max(0, recentView.rounds.length - 1))]?.assignment.roundId ?? null);
      }
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [repository, workspace.id, profiles, language]);

  const compatibleWorkspaces = useMemo(() => workspaces.filter((item) => !item.archivedAt && isWorkspaceCompatible(item, "conversation")), [workspaces]);

  const setProfileSelected = (profileId: string, selected: boolean) => {
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

  const setupComplete = Boolean(repository && profile && selectedProfileIds.length >= 1 && selectedAiParticipants.length === selectedProfileIds.length && (senderKind !== "fixed_ai" || selectedProfileIds.includes(fixedAiProfileId)));

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
        : { kind: "rotate" };
    return { schemaVersion: 1, seriesId, seriesWorkspaceId: workspace.id, mode: "conversation_exchange", language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, senderPolicy };
  }, [setupComplete, profile, selectedAiParticipants, senderKind, fixedAiProfileId, workspace.id, language, roundCount, topic, discloseTopic]);

  const schedule = useMemo(() => previewConfig ? planTelepathicSeries(previewConfig).rounds.map((round) => ({ ...round, sender: previewConfig.participants.find((item) => item.id === round.senderParticipantId)?.displayName ?? round.senderParticipantId })) : [], [previewConfig]);

  const currentConfigSignature = useMemo(() => JSON.stringify({
    profiles: selectedProfileIds,
    routes: selectedProfileIds.map((profileId) => routeSelections[profileId] ?? null),
    senderKind,
    fixedAiProfileId,
    roundCount,
    topic,
    discloseTopic,
    language,
  }), [selectedProfileIds, routeSelections, senderKind, fixedAiProfileId, roundCount, topic, discloseTopic, language]);

  useEffect(() => {
    if (configPreflightSignature !== currentConfigSignature) setConfigPreflight(null);
  }, [currentConfigSignature, configPreflightSignature]);

  const runConfigurationPreflight = (): TelepathicConversationConfigPreflight | null => {
    if (!previewConfig) return null;
    const modelByParticipantId = Object.fromEntries(selectedAiParticipants.map(({ profile: aiProfile, eligible }) => [`ai:${aiProfile.id}`, eligible.model]));
    const result = preflightTelepathicConversationConfig({ config: previewConfig, modelByParticipantId });
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
        if (!liveProfile || !model) throw new Error("Telepathic participant Profile or model route is no longer available.");
        return resolveTelepathicAiRouteFromRepository({ repository, participant, requestedSettings: profileGenerationDefaults(liveProfile, model) });
      },
    };
  };

  const execute = async (task: () => Promise<TelepathicSeriesState>, recoverySeriesId = activeSeries?.config.seriesId): Promise<boolean> => {
    if (runGuardRef.current) return false;
    runGuardRef.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const next = await runTelepathicConversationUiAction(task);
      setActiveSeries(next);
      const summary = telepathicConversationSummary(next);
      setSeriesHistory((current) => [summary, ...current.filter((item) => item.seriesId !== summary.seriesId)]);
      const nextVisible = next.rounds[Math.min(next.currentRoundIndex, Math.max(0, next.rounds.length - 1))];
      setViewRoundId(nextVisible?.assignment.roundId ?? null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (repository && recoverySeriesId) {
        try {
          const persisted = await loadTelepathicConversationView(repository, recoverySeriesId);
          if (persisted) {
            setActiveSeries(persisted);
            const summary = { seriesId: persisted.config.seriesId, roundCount: persisted.config.roundCount, status: persisted.status, updatedAt: persisted.updatedAt };
            setSeriesHistory((current) => [summary, ...current.filter((item) => item.seriesId !== summary.seriesId)]);
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
      setBusy(false);
      onBusyChange?.(false);
    }
  };

  const startSeries = async () => {
    if (!repository || !profile || !setupComplete) return;
    const preflight = runConfigurationPreflight();
    if (!preflight?.ok) {
      setError(pl ? "Preflight konfiguracji nie przeszedł. Sprawdź budżet kontekstu przed startem." : "Configuration preflight failed. Review the context budget before starting.");
      return;
    }
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
        : { kind: "rotate" };
    const config: TelepathicSeriesConfig = { schemaVersion: 1, seriesId, seriesWorkspaceId: workspace.id, mode: "conversation_exchange", language, participants, roundCount, topic, discloseTopicToReceivers: discloseTopic, senderPolicy };
    const initial = createTelepathicSeriesState(config);
    await execute(async () => {
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

  const step = activeSeries?.humanStep ?? { kind: "none" as const };
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
    if (!repository) return;
    const series = await loadTelepathicConversationView(repository, seriesId);
    if (!series) return;
    setActiveSeries(series);
    const visible = series.rounds[Math.min(series.currentRoundIndex, Math.max(0, series.rounds.length - 1))];
    setViewRoundId(visible?.assignment.roundId ?? null);
    setError(null);
  };

  if (!repository || !profile) return <div className="panel telepathic-exchange-panel"><p>{pl ? "Repozytorium lub Profil nie jest gotowy." : "Repository or Profile is not ready."}</p></div>;

  if (!activeSeries) return <div className="telepathic-exchange-stack">
    {seriesHistory.length > 0 && <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><RefreshCw size={18} /><span><strong>{pl ? "Zapisane wymiany" : "Saved exchanges"}</strong><small>{pl ? "Otwórz dowolną wcześniejszą serię, także wstrzymaną lub zablokowaną." : "Open any earlier series, including paused or blocked exchanges."}</small></span></div></div>
      <div className="telepathic-series-history">{seriesHistory.map((series) => <button type="button" className="secondary-button telepathic-series-history-item" key={series.seriesId} disabled={busy} onClick={() => void openSeries(series.seriesId)}><span><strong>{pl ? "Wymiana" : "Exchange"} · {series.roundCount} {pl ? "rund" : "rounds"}</strong><small>{series.status} · {new Date(series.updatedAt).toLocaleString()}</small></span><span>{pl ? "Otwórz" : "Open"}</span></button>)}</div>
    </section>}
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><RadioTower size={18} /><span><strong>{pl ? "Wymiana telepatyczna" : "Telepathic exchange"}</strong><small>{pl ? "Skonfiguruj uczestników i harmonogram przed startem." : "Configure participants and the schedule before starting."}</small></span></div></div>
      <div className="telepathic-config-grid">
        <label><span>{pl ? "Liczba rund" : "Rounds"}</span><input type="number" min={1} max={20} value={roundCount} onChange={(event) => setRoundCount(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        <label><span>{pl ? "Temat" : "Topic"}</span><select value={topic} onChange={(event) => setTopic(event.target.value as TelepathicTopic)}>{TOPICS.map((item) => <option key={item} value={item}>{topicLabel(item, pl)}</option>)}</select></label>
        <label><span>{pl ? "Nadawca" : "Sender"}</span><select value={senderKind} onChange={(event) => setSenderKind(event.target.value as typeof senderKind)}><option value="rotate">{pl ? "Rotacja człowiek / AI" : "Rotate human / AI"}</option><option value="human_only">{pl ? "Tylko człowiek" : "Human only"}</option><option value="fixed_ai">{pl ? "Jeden wybrany AI" : "One selected AI"}</option></select></label>
        <label className="telepathic-check"><input type="checkbox" checked={discloseTopic} onChange={(event) => setDiscloseTopic(event.target.checked)} /><span>{pl ? "Pokaż temat odbiorcom" : "Disclose topic to receivers"}</span></label>
      </div>
      {senderKind === "fixed_ai" && <label><span>{pl ? "Stały AI nadawca" : "Fixed AI sender"}</span><select value={fixedAiProfileId} onChange={(event) => setFixedAiProfileId(event.target.value)}><option value="">{pl ? "Wybierz Profil" : "Select Profile"}</option>{selectedProfileIds.map((id) => <option key={id} value={id}>{aiIsBeDisplayName(profiles.find((item) => item.id === id)!)}</option>)}</select></label>}
    </section>

    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><Users size={18} /><span><strong>{pl ? "Uczestnicy AI" : "AI participants"}</strong><small>{pl ? "Każdy AI używa własnego Profilu, Workspace i trasy Viewera." : "Each AI uses its own Profile, Workspace, and Viewer route."}</small></span></div></div>
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
    </section>

    {schedule.length > 0 && <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><Eye size={18} /><span><strong>{pl ? "Harmonogram przed startem" : "Schedule before start"}</strong><small>{pl ? "Plan zostanie zamrożony razem z serią." : "The plan will be frozen with the series."}</small></span></div></div><div className="telepathic-schedule">{schedule.map((item) => <span key={item.roundId}><strong>{pl ? "Runda" : "Round"} {item.roundNumber}</strong> → {item.sender}</span>)}</div></section>}
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-section-heading"><div><Eye size={18} /><span><strong>{pl ? "Budżet przed startem" : "Pre-start budget"}</strong><small>{pl ? "Szacunek konfiguracji. Rzeczywisty executor nadal sprawdza każdy konkretny request." : "Configuration estimate. The shared executor still checks every concrete request."}</small></span></div></div>
      <div className="training-actions"><button className="secondary-button" disabled={!setupComplete || busy} onClick={() => runConfigurationPreflight()}>{pl ? "Uruchom preflight" : "Run preflight"}</button></div>
      {configPreflight && configPreflightSignature === currentConfigSignature && <div className="training-preflight telepathic-training-preflight">
        <span><small>{pl ? "Stan" : "Status"}</small><strong>{configPreflight.ok ? "PASS" : "FAIL"}</strong></span>
        <span><small>{pl ? "Szacowane wywołania AI" : "Estimated AI calls"}</small><strong>{configPreflight.estimatedProviderCalls}</strong></span>
        <span><small>{pl ? "Bazowy szacunek kosztu" : "Baseline cost estimate"}</small><strong>{configPreflight.estimatedBaselineCostUsd !== undefined ? `$${configPreflight.estimatedBaselineCostUsd.toFixed(4)}` : (pl ? "brak danych cenowych" : "pricing unavailable")}</strong></span>
        <span><small>{pl ? "Największy szacowany pakiet" : "Largest estimated packet"}</small><strong>{configPreflight.participants.length ? Math.max(...configPreflight.participants.map((item) => item.estimatedTotalTokens)) : 0} tokens</strong></span>
      </div>}
      {configPreflight && <small className="training-preflight-note">{pl ? "To podgląd oparty na reprezentatywnych promptach i aktualnych trasach. Target, Reveal i odpowiedzi modeli powstają później, więc rzeczywisty koszt może być wyższy. Nie zastępuje to kontroli pojemności wykonywanej przez wspólny executor." : "This preview uses representative prompts and the current routes. Targets, Reveals, and model outputs are created later, so actual cost can be higher. It does not replace the shared executor's capacity checks."}</small>}
    </section>
    {error && <div className="provider-error">{error}</div>}
    <button className="primary-button telepathic-start" disabled={!setupComplete || busy || !configPreflight?.ok || configPreflightSignature !== currentConfigSignature} onClick={() => void startSeries()}><Play size={15} />{pl ? "Rozpocznij wymianę" : "Start exchange"}</button>
  </div>;

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

  return <div className="telepathic-exchange-stack">
    <section className="panel telepathic-exchange-panel">
      <div className="telepathic-run-head"><div><RadioTower size={18} /><span><strong>{pl ? "Wymiana telepatyczna" : "Telepathic exchange"}</strong><small>{activeSeries.status} · {pl ? "runda" : "round"} {Math.min(activeSeries.currentRoundIndex + 1, activeSeries.rounds.length)}/{activeSeries.rounds.length}</small></span></div><div className="telepathic-run-actions"><button className="secondary-button" disabled={busy} onClick={() => void refreshSeries()}><RefreshCw size={14} />{pl ? "Odśwież" : "Refresh"}</button><button className="secondary-button" disabled={busy} onClick={() => { setActiveSeries(null); setViewRoundId(null); setError(null); }}>{pl ? "Nowa wymiana" : "New exchange"}</button></div></div>
      <div className="telepathic-schedule compact">{activeSeries.plan.rounds.map((item) => { const round = activeSeries.rounds[item.roundNumber - 1]; const selectable = Boolean(round && (round.revealedAt || item.roundNumber <= activeSeries.currentRoundIndex + 1)); return <button type="button" key={item.roundId} disabled={busy || !selectable} className={item.roundId === visibleRound?.assignment.roundId ? "active" : ""} onClick={() => setViewRoundId(item.roundId)}><strong>{item.roundNumber}</strong> → {participantName(item.senderParticipantId)}</button>; })}</div>
    </section>

    {visibleRound && <section className="panel telepathic-exchange-panel">
      <div className="telepathic-round-title"><strong>{pl ? "Runda" : "Round"} {visibleRound.assignment.roundNumber}</strong><span>{pl ? "Nadawca" : "Sender"}: {participantName(visibleRound.assignment.senderParticipantId)}</span><small>{visibleRound.status}</small></div>
      {!revealed && <div className="telepathic-status-grid">{visibleRound.assignment.receiverParticipantIds.map((id) => { const blind = visibleRound.blindByParticipant[id]; return <div key={id}><strong>{participantName(id)}</strong><small>{blind?.status ?? "waiting"}</small></div>; })}</div>}
      {revealed && visibleRound.target && <div className="telepathic-reveal"><div><LockKeyhole size={17} /><strong>Reveal</strong></div><p>{visibleRound.target.content}</p>{visibleRound.target.assets.map((asset) => <small key={asset.artifactId}>▣ {asset.originalFileName}{asset.shortDescription ? ` · ${asset.shortDescription}` : ""}</small>)}</div>}
      {revealed && <div className="telepathic-results">{roundResults}</div>}
    </section>}

    {step.kind === "prepare_target" && <section className="panel telepathic-action-box"><h3>{pl ? "Przygotuj i zamroź cel" : "Prepare and lock the target"}</h3><p>{pl ? "Odbiorcy nie zobaczą celu. Najpierw zapisz go i zamroź, a następnie osobno potwierdź przekaz." : "Receivers will not see the target. Save and lock it first, then confirm transmission separately."}</p><textarea rows={6} value={targetText} onChange={(event) => setTargetText(event.target.value)} placeholder={pl ? "Wpisz i opisz cel" : "Enter and describe the target"} /><div className="telepathic-image-row"><label className="secondary-button">{pl ? "Dodaj obraz" : "Add image"}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isTauriRuntime()} onChange={(event) => setTargetImage(event.target.files?.[0] ?? null)} /></label>{targetImage && <span>▣ {targetImage.name}</span>}</div>{targetImage && <input value={targetImageDescription} onChange={(event) => setTargetImageDescription(event.target.value)} placeholder={pl ? "Krótki opis obrazu dla modeli bez vision" : "Short image description for models without vision"} />}<small>{pl ? "Nie każdy model odczytuje obrazy. Dołącz przynajmniej krótki opis tekstowy." : "Not every model can read images. Please include at least a short text description."}</small><button className="primary-button" disabled={busy || !targetText.trim() || Boolean(targetImage && !targetImageDescription.trim())} onClick={() => void saveTarget()}><LockKeyhole size={14} />{pl ? "Zapisz i zamroź cel" : "Save and lock target"}</button></section>}

    {step.kind === "confirm_transmission" && <section className="panel telepathic-action-box"><h3>{pl ? "Cel został zamrożony" : "Target locked"}</h3>{humanIsSender && currentRound?.target && <p>{currentRound.target.content}</p>}<button className="primary-button" disabled={busy} onClick={() => void afterHumanAction(() => confirmHumanTelepathicTransmission(engineDeps(), activeSeries.config.seriesId), true)}><RadioTower size={14} />{pl ? "Przekaz gotowy" : "Transmission ready"}</button></section>}

    {step.kind === "blind_first" && <section className="panel telepathic-action-box"><h3>{pl ? "Pierwsze wrażenia" : "First impressions"}</h3><p>{pl ? "Cel został przygotowany i zamrożony. Nie widzisz go jeszcze. Opisz prostymi słowami pierwsze wrażenia. Nie musisz zgadywać ani nazywać celu. Możesz pozostawić rundę w tym stanie i wrócić później albo anulować ją bez Revealu." : "The target has been prepared and locked. You cannot see it yet. Describe your first impressions in simple words. You do not need to guess or name it. You may leave the round here and return later, or cancel it without Reveal."}</p><textarea rows={6} value={firstBlind} onChange={(event) => setFirstBlind(event.target.value)} /><div className="telepathic-action-row"><button className="secondary-button danger-action" disabled={busy} onClick={() => void afterHumanAction(() => cancelCurrentTelepathicRoundBeforeReveal(engineDeps(), activeSeries.config.seriesId))}><CircleStop size={14} />{pl ? "Anuluj rundę bez Revealu" : "Cancel round without Reveal"}</button><button className="primary-button" disabled={busy || !firstBlind.trim()} onClick={() => void afterHumanAction(() => saveHumanTelepathicFirstBlind(engineDeps(), activeSeries.config.seriesId, firstBlind.trim()))}>{pl ? "Zapisz pierwszy opis" : "Save first description"}</button></div></section>}

    {step.kind === "blind_second" && <section className="panel telepathic-action-box"><h3>{pl ? "Drugie spojrzenie" : "Second look"}</h3><p>{pl ? "Dopisz tylko nowe lub wyraźniejsze wrażenia. To nie jest lista do wypełnienia. Możesz zostawić pole puste, jeśli nie masz dalszych wrażeń." : "Add only new or clearer impressions. This is not a checklist. You may leave the field empty if you have no further impressions."}</p><blockquote>{step.first}</blockquote><textarea rows={5} value={secondBlind} onChange={(event) => setSecondBlind(event.target.value)} /><div className="telepathic-action-row"><button className="secondary-button danger-action" disabled={busy} onClick={() => void afterHumanAction(() => cancelCurrentTelepathicRoundBeforeReveal(engineDeps(), activeSeries.config.seriesId))}><CircleStop size={14} />{pl ? "Anuluj rundę bez Revealu" : "Cancel round without Reveal"}</button><button className="primary-button" disabled={busy} onClick={() => void afterHumanAction(() => sealHumanTelepathicBlind(engineDeps(), activeSeries.config.seriesId, secondBlind), true)}><Check size={14} />{pl ? "Zamknij opis i przejdź dalej" : "Seal blind and continue"}</button></div></section>}

    {step.kind === "reflection" && <section className="panel telepathic-action-box"><h3>{pl ? "Twoja refleksja po Revealu" : "Your post-Reveal reflection"}</h3><p>{step.role === "receiver" ? (pl ? "Porównaj wcześniejsze słowa z celem. Oddziel zgodności potwierdzone od możliwości dotyczących otoczenia. Nie dopisuj nowych percepcji wstecz." : "Compare your earlier words with the target. Keep confirmed agreement separate from possible surroundings. Do not add new perceptions retroactively.") : (pl ? "Możesz krótko opisać, jak wybierałeś i przedstawiałeś cel." : "You may briefly describe how you chose and presented the target.")}</p><textarea rows={6} value={reflection} onChange={(event) => setReflection(event.target.value)} /><button className="primary-button" disabled={busy} onClick={() => void afterHumanAction(() => saveHumanTelepathicReflection(engineDeps(), activeSeries.config.seriesId, reflection), true)}>{pl ? "Zapisz refleksję i kontynuuj" : "Save reflection and continue"}</button></section>}

    {activeSeries.status !== "completed" && activeSeries.status !== "blocked" && step.kind === "none" && <button className="primary-button telepathic-start" disabled={busy} onClick={() => void execute(() => advanceTelepathicConversationSeries(engineDeps(), activeSeries.config.seriesId))}><Play size={15} />{pl ? "Kontynuuj / Resume" : "Continue / Resume"}</button>}

    {activeSeries.status === "completed" && <section className="panel telepathic-exchange-panel"><div className="telepathic-section-heading"><div><Check size={18} /><span><strong>{pl ? "Seria zakończona" : "Series complete"}</strong><small>{pl ? "Możesz teraz poprosić każde AI o końcową refleksję z całej serii." : "Each AI can now receive its own series record and write a final reflection."}</small></span></div></div>{unresolvedFinalReflectionCalls.length > 0 && <div className="telepathic-blocked-resolution"><p>{pl ? "Końcowa refleksja ma niepewny wynik po wysłaniu. Rundy pozostają zakończone i program nie ponowi requestu bez Twojej decyzji." : "A final-reflection call has an uncertain delivery outcome. All rounds remain complete and the app will not retry it without your decision."}</p>{unresolvedFinalReflectionCalls.map((call) => <div className="telepathic-uncertain-call" key={call.id}><span><strong>{call.callStage}</strong><small>{participantName(call.participantId)} · attempt {call.technicalAttempt} · {call.status}</small></span><button className="secondary-button" disabled={busy} onClick={() => void execute(() => allowRetryForUncertainTelepathicCall(engineDeps(), activeSeries.config.seriesId, call.id))}>{pl ? "Uznaj próbę za nieudaną" : "Treat attempt as failed"}</button></div>)}</div>}<button className="primary-button" disabled={busy || unresolvedFinalReflectionCalls.length > 0} onClick={() => void execute(() => runTelepathicFinalReflections(engineDeps(), activeSeries.config.seriesId))}>{pl ? "Utwórz końcowe refleksje AI" : "Generate final AI reflections"}</button>{Object.entries(activeSeries.finalReflections).map(([id, text]) => <article className="telepathic-final-reflection" key={id}><strong>{participantName(id)}</strong><p>{text}</p></article>)}</section>}

    {activeSeries.status === "blocked" && <section className="panel telepathic-action-box telepathic-blocked-resolution"><h3>{pl ? "Seria zatrzymana" : "Series blocked"}</h3><p>{visibleRound?.blockedReason ?? (pl ? "Operacja została zatrzymana." : "The operation was stopped.")}</p>{unresolvedCalls.length > 0 ? <><p>{pl ? "Co najmniej jedno wywołanie providera ma niepewny wynik po wysłaniu. Program nie ponowi go sam. Jeżeli świadomie uznasz tę próbę za nieudaną, możesz pozwolić zwykłemu Resume zdecydować, czy pozostała jeszcze bezpieczna próba." : "At least one provider call has an uncertain result after dispatch. The program will not retry it automatically. If you explicitly treat that attempt as failed, normal Resume can decide whether a safe attempt remains."}</p>{unresolvedCalls.map((call) => <div className="telepathic-uncertain-call" key={call.id}><span><strong>{call.callStage}</strong><small>{call.participantId} · attempt {call.technicalAttempt} · {call.status}</small></span><button className="secondary-button" disabled={busy} onClick={() => void execute(() => allowRetryForUncertainTelepathicCall(engineDeps(), activeSeries.config.seriesId, call.id))}>{pl ? "Uznaj próbę za nieudaną" : "Treat attempt as failed"}</button></div>)}</> : <button className="primary-button" disabled={busy} onClick={() => void execute(() => resumeBlockedTelepathicSeries(engineDeps(), activeSeries.config.seriesId))}><Play size={14} />{pl ? "Odblokuj i wznów od checkpointu" : "Unblock and resume from checkpoint"}</button>}</section>}
    {error && <div className="provider-error">{error}</div>}
  </div>;
}
