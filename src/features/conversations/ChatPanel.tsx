import { approveChatResponseRetry, chatResponseNeedsResolution, chatResponseOperationState, endChatResponse } from "../../chat/responseRecovery";
import { CircleStop, Play, Archive, ArrowRight, Crosshair, Download, FileCheck2, KeyRound, LockKeyhole, MessageCircle, Paperclip, Pencil, Plus, RadioTower, ShieldCheck, Sparkles, Waves, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { prepareViewerNotesForSession, viewerNotesSystemBlock } from "../../aiCenter/viewerNotes";
import { listEligibleViewerIdentities, preferredViewerIdentityId, requireWorkspaceViewerRoute, viewerIdentityLabel, type EligibleViewerIdentity } from "../../aiCenter/viewerIdentitySelection";
import { prepareFieldGuideForSession, viewerSystemPromptSnapshotFromFieldGuide } from "../../aiCenter/fieldGuide";
import { chooseAndImportAttachments } from "../../attachments/native";
import { ChatMessageList } from "../../chat/ChatMessageList";
import { useAppDialogs } from "../../components/AppDialogProvider";
import { estimateContextBudget } from "../../chat/contextBudget";
import { ConversationContinuationBreakError, estimateConversationContinuationMemoryBytes } from "../../chat/continuationMemory";
import { buildChatProviderMessages, retryChatTurn, sendChatTurn } from "../../chat/engine";
import { buildChatMarkdownExport } from "../../chat/export";
import { chatOutputTokens } from "../../chat/outputPolicy";
import { clearPendingChatTurn, loadPendingChatTurn, savePendingChatTurn, type PendingChatTurn } from "../../chat/pendingTurn";
import { conversationViewerContextKey, defaultConversationViewerLearningEnabled, loadConversationViewerLearningPreference, loadExistingConversationViewerLearningSnapshot, saveConversationViewerLearningPreference, type ConversationViewerLearningSnapshot } from "../../chat/viewerLearning";
import { resolveSessionLanguage } from "../../domain/localization";
import { getCopy } from "../../i18n";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderImageInput, ProviderModel, ProviderStreamEvent } from "../../providers/types";
import { getFullRcp, getRvLite, getTelepathicProtocol } from "../../resources/protocolRegistry";
import { buildEffectiveViewerPrompt, localizedViewerEditablePrompt, stripKnownLockedBaseVocabulary } from "../../resources/systemPrompts";
import { createImportedWorkspaceSource, estimateTextTokens } from "../../sources/service";
import type { WorkspaceSource } from "../../sources/types";
import { AsyncRunGuard } from "../../sessions/runGuard";
import { saveTextFile } from "../../storage/native";
import { autosizeConversationComposer } from "./composerSizing";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, ChatMessage, ChatMode, ChatThread, Profile, Workspace } from "../../types";

export interface ChatPanelProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
  fixedMode?: ChatMode;
  onBusyChange?: (busy: boolean) => void;
}

export function ChatPanel({ copy, settings, profile, workspace, repository, fixedMode, onBusyChange }: ChatPanelProps) {
  const [mode, setMode] = useState<ChatMode>(fixedMode ?? "conversation");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [savedThreadTitle, setSavedThreadTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [viewerIdentities, setViewerIdentities] = useState<EligibleViewerIdentity[]>([]);
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [chatImages, setChatImages] = useState<ProviderImageInput[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  const [viewerIdentityId, setViewerIdentityId] = useState("");
  const [viewerRouteReadyKey, setViewerRouteReadyKey] = useState<string | null>(null);
  const [viewerLearningEnabled, setViewerLearningEnabled] = useState(false);
  const [viewerLearningSnapshot, setViewerLearningSnapshot] = useState<ConversationViewerLearningSnapshot | null>(null);
  const [input, setInput] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [manualProtocol, setManualProtocol] = useState<"none" | "rcp" | "lite-core" | "lite-extended" | "telepathic">("none");
  const [manualViewerNotesEnabled, setManualViewerNotesEnabled] = useState(true);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [responseOwnership, setResponseOwnership] = useState<"idle" | "other" | "unknown">("idle");
  const responseAbort = useRef<AbortController | null>(null);
  const responseEpoch = useRef(0);
  useEffect(() => () => { responseEpoch.current++; responseAbort.current?.abort(new DOMException("Conversation view closed", "AbortError")); }, [workspace.id, repository]);
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingChatTurn | null>(null);
  const [continuationFallback, setContinuationFallback] = useState<"send" | "retry" | null>(null);
  const operationGuardRef = useRef(new AsyncRunGuard());
  const dialogs = useAppDialogs();
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const selectedIdentity = viewerIdentities.find((item) => item.identity.id === viewerIdentityId) ?? null;
  const activeProvider = selectedIdentity?.providerConfig ?? null;
  const selectedModel = selectedIdentity?.model ?? null;
  const viewerRouteKey = `${workspace.id}:${profile?.id ?? "missing"}`;
  const viewerRouteReady = viewerRouteReadyKey === viewerRouteKey && workspace.profileId === profile?.id;

  useEffect(() => { onBusyChange?.(sending); return () => onBusyChange?.(false); }, [sending, onBusyChange]);

  useEffect(() => {
    if (fixedMode) setMode(fixedMode);
  }, [fixedMode]);

  useEffect(() => {
    let cancelled = false;
    setViewerRouteReadyKey(null);
    setViewerIdentityId("");
    setViewerIdentities([]);
    void (async () => {
      if (!repository || !profile || workspace.profileId !== profile.id) return;
      const [configs, nextSources] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listWorkspaceSources(workspace.id),
      ]);
      if (cancelled) return;
      setProviderConfigs(configs);
      const nextModels = await repository.listProviderModels();
      const eligible = await listEligibleViewerIdentities({ repository, profileId: profile.id, language, providerConfigs: configs, models: nextModels });
      if (cancelled) return;
      setModels(nextModels);
      setViewerIdentities(eligible);
      setSources(nextSources);
      setChatImages([]);
      setChatImageNames([]);
      setViewerIdentityId(preferredViewerIdentityId(eligible, profile.defaultViewerModelId));
      setViewerRouteReadyKey(`${workspace.id}:${profile.id}`);
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [repository, workspace.id, profile?.id, profile?.defaultViewerModelId, language]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository || mode !== "conversation" || !selectedIdentity) {
        if (!cancelled) { setViewerLearningSnapshot(null); setViewerLearningEnabled(false); }
        return;
      }
      const snapshot = await loadExistingConversationViewerLearningSnapshot({ repository, identity: selectedIdentity, language });
      if (cancelled) return;
      setViewerLearningSnapshot(snapshot);
      const saved = threadId ? loadConversationViewerLearningPreference(threadId) : undefined;
      setViewerLearningEnabled(defaultConversationViewerLearningEnabled({ saved, packageAvailable: Boolean(snapshot), trained: selectedIdentity.trained }));
    })().catch((cause) => { if (!cancelled) { setViewerLearningSnapshot(null); setViewerLearningEnabled(false); setError(cause instanceof Error ? cause.message : String(cause)); } });
    return () => { cancelled = true; };
  }, [repository, mode, threadId, selectedIdentity?.identity.id, selectedIdentity?.trained, language]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setActiveSourceIds([]);
    setThreadId(null);
    void (async () => {
      if (!repository) return;
      let available = await repository.listChatThreads(workspace.id, mode);
      const thread = available[0] ?? await repository.createChatThread(
        workspace.id,
        mode,
        mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`,
      );
      if (!available.length) available = [thread];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(thread.id),
        repository.listActiveChatSourceIds(thread.id),
        repository.touchChatThread(thread.id),
      ]);
      if (cancelled) return;
      setThreads(available);
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
      setError(null);
    })().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [repository, workspace.id, mode, copy.conversation, copy.manualRv]);

  useEffect(() => {
    if (selectedModel && (!selectedModel.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image"))) {
      setChatImages([]);
      setChatImageNames([]);
    }
  }, [selectedModel?.modelId]);

  useEffect(() => {
    setPendingRetry(threadId ? loadPendingChatTurn(threadId, messages) : null);
  }, [threadId, messages]);

  useEffect(() => {
    setContinuationFallback(null);
  }, [threadId, mode]);

  const selectedSources = sources.filter((source) => activeSourceIds.includes(source.id));
  const configuredOutputTokens = mode === "conversation" ? settings.conversationMaxOutputTokens : settings.rvSessionMaxOutputTokens;
  const effectiveMaxOutputTokens = chatOutputTokens(mode, configuredOutputTokens, selectedModel);
  const attachedProtocol = mode === "manual_rv" && manualProtocol !== "none"
    ? manualProtocol === "rcp"
      ? getFullRcp(language).content
      : manualProtocol === "telepathic"
        ? getTelepathicProtocol(language).content
        : getRvLite(language, manualProtocol === "lite-core" ? "core" : "extended").content
    : undefined;
  const rvSystemPrompt = mode === "manual_rv" ? buildEffectiveViewerPrompt(language, stripKnownLockedBaseVocabulary(localizedViewerEditablePrompt(profile?.defaultViewerSystemPrompt, language))) : undefined;
  const previewMessages = buildChatProviderMessages({ mode, language, history: messages, content: input.trim(), rvSystemPrompt, attachedProtocol, sources: selectedSources, images: chatImages, ...(mode === "conversation" && viewerLearningEnabled && viewerLearningSnapshot ? { viewerLearning: viewerLearningSnapshot } : {}) });
  const inMemoryContinuationBytes = mode === "conversation" && threadId ? estimateConversationContinuationMemoryBytes(threadId) : 0;
  const contextBudget = estimateContextBudget(previewMessages, selectedModel?.capabilities.contextTokens, effectiveMaxOutputTokens, {
    additionalContinuationStateBytes: inMemoryContinuationBytes,
  });
  const contextExceeded = contextBudget.exceeded;

  const resizeComposer = useCallback(() => {
    if (composerTextareaRef.current) autosizeConversationComposer(composerTextareaRef.current);
  }, []);

  useLayoutEffect(() => {
    resizeComposer();
  }, [input, resizeComposer]);

  useEffect(() => {
    window.addEventListener("resize", resizeComposer);
    return () => window.removeEventListener("resize", resizeComposer);
  }, [resizeComposer]);

  const openThread = async (nextThreadId: string) => {
    if (!repository || sending || nextThreadId === threadId) return;
    const thread = threads.find((item) => item.id === nextThreadId);
    if (!thread) return;
    setError(null);
    try {
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(thread.id),
        repository.listActiveChatSourceIds(thread.id),
        repository.touchChatThread(thread.id),
      ]);
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
      setThreads(await repository.listChatThreads(workspace.id, mode));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createNewThread = async () => {
    if (!repository || sending) return;
    const baseTitle = mode === "conversation" ? copy.conversation : copy.manualRv;
    const suggestedTitle = `${baseTitle} ${threads.length + 1}`;
    const requestedTitle = await dialogs.prompt({
      title: mode === "conversation" ? (settings.interfaceLanguage === "pl" ? "Nowa rozmowa" : "New conversation") : "Manual RV",
      description: mode === "conversation" ? (settings.interfaceLanguage === "pl" ? "Podaj nazwę nowej rozmowy." : "Enter a name for the new conversation.") : (settings.interfaceLanguage === "pl" ? "Podaj nazwę nowej sesji Manual RV." : "Enter a name for the new Manual RV session."),
      initialValue: suggestedTitle,
      inputLabel: mode === "conversation" ? (settings.interfaceLanguage === "pl" ? "Nazwa rozmowy" : "Conversation name") : "Manual RV",
      inputRequired: true,
      confirmLabel: copy.create,
      cancelLabel: copy.cancel,
    });
    if (requestedTitle === null || !requestedTitle.trim()) return;
    setError(null);
    try {
      const thread = await repository.createChatThread(workspace.id, mode, requestedTitle.trim());
      setThreads(await repository.listChatThreads(workspace.id, mode));
      setThreadId(thread.id);
      setThreadTitle(thread.title);
      setSavedThreadTitle(thread.title);
      setMessages([]);
      setActiveSourceIds([]);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const archiveCurrentThread = async () => {
    if (!repository || !threadId || sending) return;
    const confirmed = await dialogs.confirm({ title: `${copy.dialogArchive}: ${savedThreadTitle}`, description: copy.archiveChatConfirm, confirmLabel: copy.dialogArchive, cancelLabel: copy.cancel, severity: "warning" });
    if (!confirmed) return;
    setError(null);
    try {
      await repository.archiveChatThread(threadId);
      let remaining = await repository.listChatThreads(workspace.id, mode);
      const next = remaining[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`);
      if (!remaining.length) remaining = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(next.id),
        repository.listActiveChatSourceIds(next.id),
        repository.touchChatThread(next.id),
      ]);
      setThreads(remaining);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const toggleSource = async (sourceId: string) => {
    if (!repository || !threadId) return;
    const active = !activeSourceIds.includes(sourceId);
    await repository.setChatSourceActive(threadId, sourceId, active);
    setActiveSourceIds((current) => active ? [...new Set([...current, sourceId])] : current.filter((id) => id !== sourceId));
  };

  const attachFiles = async () => {
    if (!repository || !threadId || sending || attachmentBusy) return;
    setAttachmentBusy(true);
    setError(null);
    try {
      const attachments = await chooseAndImportAttachments(settings.interfaceLanguage === "pl" ? "Dołącz dokumenty lub obrazy" : "Attach documents or images");
      const createdSourceIds: string[] = [];
      const nextImages: ProviderImageInput[] = [];
      const nextImageNames: string[] = [];
      const rejectedImages: string[] = [];
      for (const attachment of attachments) {
        if (attachment.kind === "document") {
          const source = await createImportedWorkspaceSource(repository, workspace.id, attachment);
          createdSourceIds.push(source.id);
          continue;
        }
        if (!selectedModel?.capabilities.supportsVision || !selectedModel.capabilities.inputModalities.includes("image")) {
          rejectedImages.push(attachment.displayName);
          continue;
        }
        nextImages.push({ mimeType: attachment.mimeType, dataBase64: attachment.dataBase64 });
        nextImageNames.push(attachment.displayName);
      }
      for (const sourceId of createdSourceIds) {
        await repository.setChatSourceActive(threadId, sourceId, true);
      }
      if (createdSourceIds.length) {
        setSources(await repository.listWorkspaceSources(workspace.id));
        setActiveSourceIds((current) => [...new Set([...current, ...createdSourceIds])]);
      }
      setChatImages((current) => [...current, ...nextImages].slice(0, 8));
      setChatImageNames((current) => [...current, ...nextImageNames].slice(0, 8));
      if (rejectedImages.length) {
        setError(`${copy.modelNoVision}\n${settings.interfaceLanguage === "pl" ? "Nieprzesłane pliki" : "Files not sent"}: ${rejectedImages.join(", ")}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setAttachmentBusy(false);
    }
  };

  const removeSource = async (source: WorkspaceSource) => {
    if (!repository) return;
    const confirmed = await dialogs.confirm({ title: copy.removeSource, description: source.displayName, confirmLabel: copy.dialogDelete, cancelLabel: copy.cancel, severity: "destructive" });
    if (!confirmed) return;
    await repository.deleteWorkspaceSource(source.id);
    setSources((current) => current.filter((item) => item.id !== source.id));
    setActiveSourceIds((current) => current.filter((id) => id !== source.id));
  };

  const removeChatImage = (index: number) => {
    setChatImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setChatImageNames((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };


  const finishResponseUi = async (responseThreadId: string, executionEpoch: number, controller: AbortController) => {
    try {
      const storedMessages = await repository!.listChatMessages(responseThreadId);
      if (executionEpoch !== responseEpoch.current) return;
      if (!loadPendingChatTurn(responseThreadId, storedMessages)) {
        clearPendingChatTurn(responseThreadId);
        setPendingRetry(null);
      }
      setMessages(storedMessages);
      setThreads(await repository!.listChatThreads(workspace.id, mode));
    } catch (cause) {
      if (executionEpoch === responseEpoch.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!controller.signal.aborted) controller.abort(new DOMException("Response settled", "AbortError"));
      if (responseAbort.current === controller) responseAbort.current = null;
      setStreamingAssistant("");
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
    }
  };

  const handleVisibleStreamEvent = (event: ProviderStreamEvent) => {
    if (responseAbort.current?.signal.aborted) return;
    if (event.event === "started") {
      setStreamingAssistant("");
      return;
    }
    if (event.event === "contentDelta") setStreamingAssistant((current) => current + event.data.content);
  };

  const send = async (allowTextOnlyContinuation = false) => {
    const content = input.trim();
    if (!repository || !threadId || !profile || !selectedIdentity || !activeProvider || !selectedModel || !content || sending || !viewerRouteReady || !operationGuardRef.current.tryAcquire()) return;
    setSending(true);
    const executionEpoch = responseEpoch.current;
    const responseController = new AbortController();
    responseAbort.current = responseController;
    setStopping(false);
    onBusyChange?.(true);
    try {
      await requireWorkspaceViewerRoute({ repository, workspace, profile, identityId: selectedIdentity.identity.id, providerConfig: activeProvider, model: selectedModel });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    setInput("");
    setStreamingAssistant("");
    setError(null);
    if (!allowTextOnlyContinuation) setContinuationFallback(null);
    let effectiveRvSystemPrompt = rvSystemPrompt;
    try {
      if (mode === "manual_rv" && profile) {
        if (!selectedIdentity) throw new Error(settings.interfaceLanguage === "pl" ? "Wybrana tożsamość Viewera nie jest dostępna." : "The selected Viewer identity is unavailable.");
        const fieldGuide = await prepareFieldGuideForSession({ repository, profile, providerConfig: activeProvider, model: selectedModel, language, aiIdentityId: selectedIdentity.identity.id });
        const promptSnapshot = await viewerSystemPromptSnapshotFromFieldGuide(fieldGuide);
        effectiveRvSystemPrompt = promptSnapshot.content;
        if (manualViewerNotesEnabled) {
          const snapshot = await prepareViewerNotesForSession({ repository, profileId: profile.id, providerConfig: activeProvider, model: selectedModel, enabled: true, aiIdentityId: selectedIdentity.identity.id });
          const notesBlock = viewerNotesSystemBlock(snapshot, language);
          if (notesBlock) effectiveRvSystemPrompt = [effectiveRvSystemPrompt, notesBlock].filter(Boolean).join("\n\n");
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInput(content);
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    let frozenViewerLearning: ConversationViewerLearningSnapshot | undefined;
    try {
      if (mode === "conversation" && viewerLearningEnabled && selectedIdentity) {
        const snapshot = await loadExistingConversationViewerLearningSnapshot({ repository, identity: selectedIdentity, language });
        if (!snapshot) throw new Error(settings.interfaceLanguage === "pl" ? "Pakiet Viewer Learning tej tożsamości nie jest obecnie dostępny." : "This Viewer identity's Viewer Learning package is not currently available.");
        frozenViewerLearning = snapshot;
        setViewerLearningSnapshot(snapshot);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInput(content);
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    const frozenConversationContextKey = mode === "conversation" && selectedIdentity
      ? conversationViewerContextKey(selectedIdentity.identity.id, selectedModel.route, frozenViewerLearning)
      : undefined;
    const pending: PendingChatTurn = {
      threadId,
      mode,
      language,
      providerConfigId: activeProvider.id,
      modelId: selectedModel.modelId,
      modelRoute: selectedModel.route,
      aiIdentityId: selectedIdentity?.identity.id,
      ...(frozenViewerLearning ? { viewerLearning: frozenViewerLearning } : {}),
      ...(frozenConversationContextKey ? { conversationContextKey: frozenConversationContextKey } : {}),
      content,
      requestedSettings: { ...profileGenerationDefaults(profile, selectedModel), maxOutputTokens: effectiveMaxOutputTokens },
      ...(effectiveRvSystemPrompt ? { rvSystemPrompt: effectiveRvSystemPrompt } : {}),
      ...(attachedProtocol ? { attachedProtocol } : {}),
      sourceIds: selectedSources.map((source) => source.id),
      images: chatImages,
      imageNames: chatImageNames,
      imageMimeTypes: chatImages.map((image) => image.mimeType),
      createdAt: new Date().toISOString(),
    };
    try {
      await sendChatTurn({
        onUserPrepared: user => {
          savePendingChatTurn(pending);
          if (executionEpoch === responseEpoch.current) {
            setPendingRetry(pending);
            setMessages(current => [...current, user]);
          }
        },
        repository,
        threadId,
        mode,
        language,
        providerConfig: activeProvider,
        model: selectedModel,
        content,
        requestedSettings: { ...profileGenerationDefaults(profile, selectedModel), maxOutputTokens: effectiveMaxOutputTokens },
        ...(effectiveRvSystemPrompt ? { rvSystemPrompt: effectiveRvSystemPrompt } : {}),
        sources: selectedSources,
        images: chatImages,
        imageNames: chatImageNames,
        ...(frozenViewerLearning ? { viewerLearning: frozenViewerLearning } : {}),
        ...(frozenConversationContextKey ? { conversationContextKey: frozenConversationContextKey } : {}),
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
        ...(attachedProtocol ? { attachedProtocol } : {}),
        signal: responseController.signal,
        onStreamEvent: event => { if (!responseController.signal.aborted) handleVisibleStreamEvent(event); },
        allowTextOnlyContinuation,
      });
      clearPendingChatTurn(threadId);
      setPendingRetry(null);
      setContinuationFallback(null);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) {
      if (responseController.signal.aborted && (cause instanceof DOMException && cause.name === "AbortError" || (cause as { details?: { code?: string } })?.details?.code === "cancelled")) { setError(null); }
      else if (cause instanceof ConversationContinuationBreakError && mode === "conversation") {
        setInput(content);
        setContinuationFallback("send");
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      await finishResponseUi(threadId, executionEpoch, responseController);
    }
  };

  const retryPendingResponse = async (allowTextOnlyContinuation = false, allowRetryWithoutImages = false) => {
    if (!repository || !profile || !pendingRetry || sending || !viewerRouteReady || pendingRetry.threadId !== threadId || !operationGuardRef.current.tryAcquire()) return;
    setSending(true);
    const executionEpoch = responseEpoch.current;
    const responseController = new AbortController();
    responseAbort.current = responseController;
    setStopping(false);
    onBusyChange?.(true);
    if (!pendingRetry.aiIdentityId) {
      setError(settings.interfaceLanguage === "pl" ? "Tego starszego zapisu ponowienia nie można bezpiecznie powiązać z bieżącą tożsamością Viewera. Wyślij wiadomość ponownie jako nową turę." : "This legacy retry record cannot be safely bound to the current Viewer identity. Send the message again as a new turn.");
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    const providerConfig = providerConfigs.find((item) => item.id === pendingRetry.providerConfigId);
    const model = models.find((item) => item.providerConfigId === pendingRetry.providerConfigId && item.modelId === pendingRetry.modelId && (!pendingRetry.modelRoute || item.route === pendingRetry.modelRoute));
    if (!providerConfig || !model) {
      setError(settings.interfaceLanguage === "pl" ? "Zapisany model lub połączenie nie jest obecnie dostępne. Przywróć je, aby ponowić odpowiedź." : "The saved model or connection is currently unavailable. Restore it to retry the response.");
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    try {
      await requireWorkspaceViewerRoute({ repository, workspace, profile, identityId: pendingRetry.aiIdentityId, providerConfig, model });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      responseAbort.current = null;
      setStopping(false);
      setSending(false);
      operationGuardRef.current.release();
      onBusyChange?.(false);
      return;
    }
    setStreamingAssistant("");
    const retryLostImages = pendingRetry.imageNames.length > 0 && pendingRetry.images.length === 0;
    setError(retryLostImages
      ? (settings.interfaceLanguage === "pl" ? "Po restarcie obraz nie jest przechowywany. Ta próba ponowi odpowiedź bez obrazu; aby wysłać obraz ponownie, utwórz nową turę i dołącz go ponownie." : "Image bytes are not stored across restarts. This retry will run without the image; to send it again, create a new turn and attach it again.")
      : null);
    if (!allowTextOnlyContinuation) setContinuationFallback(null);
    try {
      await retryChatTurn({
        repository,
        threadId: pendingRetry.threadId,
        mode: pendingRetry.mode,
        language: pendingRetry.language,
        providerConfig,
        model,
        requestedSettings: pendingRetry.requestedSettings,
        ...(pendingRetry.rvSystemPrompt ? { rvSystemPrompt: pendingRetry.rvSystemPrompt } : {}),
        ...(pendingRetry.attachedProtocol ? { attachedProtocol: pendingRetry.attachedProtocol } : {}),
        sources: sources.filter((source) => pendingRetry.sourceIds.includes(source.id)),
        images: pendingRetry.images,
        imageNames: pendingRetry.imageNames,
        imageMimeTypes: pendingRetry.imageMimeTypes,
        allowRetryWithoutImages,
        ...(pendingRetry.viewerLearning ? { viewerLearning: pendingRetry.viewerLearning } : {}),
        ...(pendingRetry.conversationContextKey ? { conversationContextKey: pendingRetry.conversationContextKey } : {}),
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
        signal: responseController.signal,
        onStreamEvent: event => { if (!responseController.signal.aborted) handleVisibleStreamEvent(event); },
        allowTextOnlyContinuation,
      });
      clearPendingChatTurn(pendingRetry.threadId);
      setPendingRetry(null);
      setContinuationFallback(null);
    } catch (cause) {
      if (responseController.signal.aborted && (cause instanceof DOMException && cause.name === "AbortError" || (cause as { details?: { code?: string } })?.details?.code === "cancelled")) { setError(null); }
      else if (cause instanceof ConversationContinuationBreakError && mode === "conversation") {
        setContinuationFallback("retry");
        setError(null);
      } else {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      await finishResponseUi(pendingRetry.threadId, executionEpoch, responseController);
    }
  };

  const retryNeedsImageApproval = Boolean(pendingRetry?.imageNames.length && !pendingRetry.images.length);
  const responseOtherOwner = responseOwnership !== "idle";
  useEffect(() => {
    if (!threadId || sending) return;
    let disposed = false;
    const check = async () => { const owner = await chatResponseOperationState(threadId); if (!disposed) setResponseOwnership(owner); };
    void check();
    const timer = setInterval(() => { void check(); }, 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [threadId, sending]);
  const responseNeedsResolution = chatResponseNeedsResolution(messages.at(-1));
  const stopResponse = () => {
    if (!responseAbort.current || stopping) return;
    setStopping(true);
    responseAbort.current.abort(new DOMException("Stopped by user", "AbortError"));
  };
  const endResponse = async () => {
    if (!repository || !threadId || sending || !operationGuardRef.current.tryAcquire()) return;
    try {
      await endChatResponse(repository, threadId);
      clearPendingChatTurn(threadId);
      setPendingRetry(null);
      setContinuationFallback(null);
      setError(null);
      setMessages(await repository.listChatMessages(threadId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operationGuardRef.current.release(); }
  };
  const approveRetry = async () => {
    if (!repository || !threadId || sending || !operationGuardRef.current.tryAcquire()) return;
    try {
      await approveChatResponseRetry(repository, threadId);
      setMessages(await repository.listChatMessages(threadId));
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { operationGuardRef.current.release(); }
  };

  const renameThread = async () => {
    if (!repository || !threadId || !threadTitle.trim() || threadTitle.trim() === savedThreadTitle) return;
    try {
      await repository.renameChatThread(threadId, threadTitle);
      setThreadTitle(threadTitle.trim());
      setSavedThreadTitle(threadTitle.trim());
      setThreads(await repository.listChatThreads(workspace.id, mode));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const exportCurrentThread = async () => {
    const thread = threads.find((item) => item.id === threadId);
    if (!thread || sending) return;
    setError(null);
    try {
      const exported = buildChatMarkdownExport({
        language: settings.interfaceLanguage,
        mode,
        thread,
        workspace,
        profile,
        messages,
        ...(selectedModel?.modelId ? { modelId: selectedModel.modelId } : {}),
      });
      await saveTextFile(settings.interfaceLanguage === "pl" ? "Zapisz rozmowę" : "Save conversation", exported.fileName, exported.content);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  return (
    <section className="chat-surface">
      <div className="chat-hierarchy">
        <span className="hierarchy-workspace"><RadioTower size={15} /><span><small>{copy.workspace}</small><strong>{workspace.name}</strong></span></span>
      </div>
      <div className="chat-toolbar">
        {!fixedMode && <div className="segmented large-segmented">
          <button disabled={sending} className={mode === "conversation" ? "active" : ""} onClick={() => setMode("conversation")}><MessageCircle size={16} />{copy.conversation}</button>
          <button disabled={sending} className={mode === "manual_rv" ? "active" : ""} onClick={() => setMode("manual_rv")}><Crosshair size={16} />{copy.manualRv}</button>
        </div>}
        <div className="conversation-switcher">
          <label><span>{mode === "conversation" ? copy.chatThreads : copy.manualRv}</span><select value={threadId ?? ""} disabled={!threadId || sending} onChange={(event) => void openThread(event.target.value)}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></label>
          <button className="secondary-button" disabled={!repository || sending} onClick={() => void createNewThread()}><Plus size={13} />{copy.newChat}</button>
          <button className="secondary-button danger-action" disabled={!threadId || sending} title={copy.archiveChat} onClick={() => void archiveCurrentThread()}><Archive size={13} />{copy.archiveChat}</button>
          <details className="hierarchy-menu conversation-menu">
            <summary aria-label={copy.renameThread} title={copy.renameThread}>•••</summary>
            <div className="hierarchy-menu-popover">
              <label><span>{copy.threadTitle}</span><input value={threadTitle} maxLength={160} onChange={(event) => setThreadTitle(event.target.value)} /></label>
              <button className="secondary-button" disabled={!threadTitle.trim() || threadTitle.trim() === savedThreadTitle} onClick={() => void renameThread()}><Pencil size={13} />{copy.renameThread}</button>
              <button className="secondary-button" disabled={!threadId || sending} onClick={() => void exportCurrentThread()}><Download size={13} />{settings.interfaceLanguage === "pl" ? "Zapisz rozmowę (.md)" : "Save conversation (.md)"}</button>
            </div>
          </details>
        </div>
        <div className="chat-response-actions">
          {sending || !pendingRetry ? <button type="button" className="stop-button compact-stop-button" disabled={!sending || stopping} onClick={stopResponse} title={settings.interfaceLanguage === "pl" ? "Zatrzymuje teraz i zachowuje postęp. Wznowienie wymaga Twojej decyzji; niepewne wywołanie trzeba najpierw rozstrzygnąć." : "Stops now and saves progress. Resume requires your action; an uncertain call must be resolved first."}><CircleStop size={15} />{stopping ? (settings.interfaceLanguage === "pl" ? "Zatrzymywanie…" : "Stopping…") : "Stop"}</button> : <>
            <span role="status">{responseOwnership === "other" ? (settings.interfaceLanguage === "pl" ? "Praca w innym oknie" : "Work in another window") : responseOwnership === "unknown" ? (settings.interfaceLanguage === "pl" ? "Sprawdzanie właściciela" : "Checking ownership") : (settings.interfaceLanguage === "pl" ? "Zatrzymano" : "Stopped")}</span>
            <button type="button" className="secondary-button compact-response-button" disabled={responseOtherOwner || !viewerRouteReady || responseNeedsResolution || retryNeedsImageApproval || Boolean(continuationFallback)} onClick={() => void retryPendingResponse()} title={responseNeedsResolution ? (settings.interfaceLanguage === "pl" ? "Najpierw rozstrzygnij niepewne wywołanie." : "Resolve the uncertain call first.") : undefined}><Play size={15} />{settings.interfaceLanguage === "pl" ? "Wznów" : "Resume"}</button>
            <button type="button" className="secondary-button compact-response-button" disabled={responseOtherOwner} onClick={() => void endResponse()} title={settings.interfaceLanguage === "pl" ? "Kończy tę odpowiedź bez wznowienia. Zapisane wyniki pozostaną." : "Ends this response without resuming it. Saved results are retained."}><CircleStop size={15} />{settings.interfaceLanguage === "pl" ? "Zakończ" : "End"}</button>
          </>}
        </div>
        <span className={mode === "conversation" ? "context-badge conversation" : "context-badge blind"}>
          {mode === "conversation" ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
          {mode === "conversation" ? copy.systemActive : copy.viewerSystemActive}
        </span>
      </div>
      <div className="chat-model-bar">
        <span><KeyRound size={14} />{activeProvider?.label ?? copy.credentialPending}</span>
        <select value={viewerIdentityId} onChange={(event) => setViewerIdentityId(event.target.value)} disabled={!viewerRouteReady || !viewerIdentities.length || sending}>
          <option value="">{viewerIdentities.length ? copy.selectModel : (settings.interfaceLanguage === "pl" ? "Brak tożsamości Viewera" : "No Viewer identity")}</option>
          {viewerIdentities.map((item) => <option key={item.identity.id} value={item.identity.id}>{viewerIdentityLabel(item, settings.interfaceLanguage)}</option>)}
        </select>
        {!viewerIdentities.length && <small>{settings.interfaceLanguage === "pl" ? "Dodaj model Viewera w Profilu lub rozpocznij Training. Conversation nie tworzy nowej tożsamości automatycznie." : "Add a Viewer model in Profile or start Training. Conversation does not create a new identity automatically."}</small>}
        {mode === "conversation" && <label className="manual-notes-toggle" title={settings.interfaceLanguage === "pl" ? "Dołącz read-only Field Guide i Viewer Notes dokładnie wybranej tożsamości." : "Attach the exact selected identity's read-only Field Guide and Viewer Notes."}><span>{settings.interfaceLanguage === "pl" ? "Użyj Viewer Learning" : "Use Viewer Learning"}</span><input type="checkbox" checked={viewerLearningEnabled} disabled={sending || !viewerLearningSnapshot} onChange={(event) => { const enabled = event.target.checked; setViewerLearningEnabled(enabled); if (threadId) saveConversationViewerLearningPreference(threadId, enabled); }} /></label>}
        <span className={`chat-context-meter ${contextBudget.level}`} title={contextBudget.contextLimit === undefined
          ? `${copy.estimatedContext}: ~${contextBudget.estimatedInputTokens.toLocaleString()} + ${contextBudget.reservedOutputTokens.toLocaleString()} output tokens`
          : `${copy.estimatedContext}: ~${contextBudget.estimatedInputTokens.toLocaleString()} + ${contextBudget.reservedOutputTokens.toLocaleString()} output; ${contextBudget.remainingTokens?.toLocaleString()} remaining of ${contextBudget.contextLimit.toLocaleString()}`}>
          {contextBudget.percent === undefined
            ? (settings.interfaceLanguage === "pl" ? "Limit kontekstu niedostępny" : "Context limit unavailable")
            : `${copy.estimatedContext}: ${contextBudget.percent}%`}
        </span>
        {mode === "manual_rv" && <><label className="manual-protocol-select"><span>{settings.interfaceLanguage === "pl" ? "Dołącz protokół" : "Attach protocol"}</span><select value={manualProtocol} onChange={(event) => setManualProtocol(event.target.value as typeof manualProtocol)} disabled={sending}><option value="none">{settings.interfaceLanguage === "pl" ? "Bez dodatkowego protokołu" : "No additional protocol"}</option><option value="rcp">Full RCP 1.5a</option><option value="lite-core">RV Lite Core 1.1.0</option><option value="lite-extended">RV Lite Extended 1.1.0</option><option value="telepathic">{settings.interfaceLanguage === "pl" ? "Protokół Telepatyczny 1.1" : "Telepathic Protocol 1.1"}</option></select></label><label className="manual-notes-toggle" title={settings.interfaceLanguage === "pl" ? "Dołącz aktualne Viewer Notes tej instancji AI do Manual RV." : "Attach this AI identity's current Viewer Notes to Manual RV."}><span>Viewer Notes</span><input type="checkbox" checked={manualViewerNotesEnabled} onChange={(event) => setManualViewerNotesEnabled(event.target.checked)} disabled={sending} /></label></>}
      </div>
      <div className="context-banner">
        <span className={mode === "conversation" ? "banner-icon violet" : "banner-icon cyan"}>{mode === "conversation" ? <MessageCircle size={22} /> : <ShieldCheck size={22} />}</span>
        <div><strong>{mode === "conversation" ? copy.conversationTitle : copy.manualTitle}</strong><p>{mode === "conversation" ? copy.conversationDesc : copy.manualDesc}</p></div>
      </div>
      <details className="chat-sources"><summary><span><FileCheck2 size={14} />{copy.workspaceSources}</span><small>{copy.activeSources}: {activeSourceIds.length} · {copy.estimatedContext}: ~{contextBudget.estimatedInputTokens.toLocaleString()} tokens</small></summary><div className="chat-source-body">{sources.length ? <div className="chat-source-list">{sources.map((source) => <label key={source.id}><input type="checkbox" checked={activeSourceIds.includes(source.id)} onChange={() => void toggleSource(source.id)} /><span><strong>{source.displayName}</strong><small>{source.sourceType.toUpperCase()} · ~{estimateTextTokens(source.content).toLocaleString()} tokens</small></span><button type="button" className="icon-button danger" title={copy.removeSource} onClick={(event) => { event.preventDefault(); void removeSource(source); }}><X size={13} /></button></label>)}</div> : <p>{copy.noSources}</p>}{contextExceeded && <div className="source-context-error">{copy.contextExceeded}</div>}</div></details>
      <ChatMessageList
        language={settings.interfaceLanguage}
        mode={mode}
        threadCreatedAt={threads.find((thread) => thread.id === threadId && thread.mode === mode)?.createdAt}
        messages={messages}
        profile={profile}
        streamingAssistant={streamingAssistant}
        sending={sending}
        sendingLabel={copy.sending}
        emptyState={<div className="chat-empty"><div className="empty-orbit"><Waves size={32} /></div><h3>{copy.cleanBoundary}</h3><p>{activeProvider ? copy.noChatMessages : copy.providerNeeded}</p></div>}
      />
      {error && <div className="provider-error chat-error">{error}</div>}
      {continuationFallback && <div className="chat-retry-panel"><span>{settings.interfaceLanguage === "pl" ? "Natywna ciągłość providera nie pasuje już do bieżącego połączenia lub modelu. Możesz świadomie kontynuować tylko z historią tekstową." : "Provider-native continuity no longer matches the current connection or model. You can explicitly continue with text history only."}</span><button className="secondary-button" disabled={sending || responseOtherOwner || !viewerRouteReady || responseNeedsResolution} onClick={() => void (continuationFallback === "retry" ? retryPendingResponse(true) : send(true))}>{settings.interfaceLanguage === "pl" ? "Kontynuuj tylko tekstowo" : "Continue text-only"}</button></div>}
      {!sending && pendingRetry && retryNeedsImageApproval && <div className="chat-retry-panel"><span>{settings.interfaceLanguage === "pl" ? "Po restarcie obraz nie jest przechowywany. Możesz jawnie wznowić bez obrazu albo zakończyć tę odpowiedź i dołączyć obraz w nowej wiadomości." : "Images are not stored across restarts. Explicitly resume without the image, or end this response and attach it in a new message."}</span><button type="button" className="secondary-button" disabled={responseOtherOwner || responseNeedsResolution || !viewerRouteReady} onClick={() => void retryPendingResponse(Boolean(continuationFallback), true)}>{settings.interfaceLanguage === "pl" ? "Wznów bez obrazu" : "Resume without image"}</button></div>}
      {!sending && pendingRetry && responseNeedsResolution && <div className="chat-retry-panel"><span>{settings.interfaceLanguage === "pl" ? "Wywołanie mogło dotrzeć do providera. Ponowienie może naliczyć kolejny koszt." : "The call may have reached the provider. Retrying may incur another charge."}</span><button type="button" className="secondary-button" disabled={responseOtherOwner} onClick={() => void approveRetry()}>{settings.interfaceLanguage === "pl" ? "Zezwól na ponowienie" : "Allow retry"}</button></div>}
      {(selectedSources.length > 0 || chatImageNames.length > 0) && <div className="attachment-chips">{selectedSources.map((source) => <button type="button" key={source.id} title={copy.removeSource} onClick={() => void toggleSource(source.id)}><FileCheck2 size={12} /><span>{source.displayName} · {source.sourceType.toUpperCase()} · {settings.interfaceLanguage === "pl" ? "aktywne" : "active"} · ~{estimateTextTokens(source.content).toLocaleString()} tokens</span><X size={11} /></button>)}{chatImageNames.map((name, index) => <button type="button" key={`${name}-${index}`} onClick={() => removeChatImage(index)}><span>{name} · IMAGE · {settings.interfaceLanguage === "pl" ? "następna tura" : "next turn"} · ~2,048 tokens</span><X size={11} /></button>)}</div>}
      <div className="composer">
        <textarea ref={composerTextareaRef} rows={2} placeholder={copy.messagePlaceholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={!viewerRouteReady || !selectedModel || sending || Boolean(pendingRetry)} />
        <div className="composer-actions"><button type="button" className="composer-attachment-button" title={settings.interfaceLanguage === "pl" ? "Dołącz dokumenty lub obrazy" : "Attach documents or images"} disabled={!viewerRouteReady || !repository || !threadId || sending || attachmentBusy || Boolean(pendingRetry)} onClick={() => void attachFiles()}><Paperclip size={17} /></button><button disabled={!viewerRouteReady || !selectedModel || !input.trim() || sending || contextExceeded || Boolean(pendingRetry)} onClick={() => void send()}>{sending ? copy.sending : copy.send}<ArrowRight size={15} /></button></div>
      </div>
    </section>
  );
}

