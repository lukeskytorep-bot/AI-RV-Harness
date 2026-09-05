import { Archive, ArrowRight, ChevronRight, Crosshair, Download, FileCheck2, KeyRound, LockKeyhole, MessageCircle, Paperclip, Pencil, Plus, RadioTower, ShieldCheck, Sparkles, Waves, X } from "lucide-react";
import { useEffect, useState } from "react";

import { prepareViewerNotesForSession, viewerNotesSystemBlock } from "../../aiCenter/viewerNotes";
import { chooseAndImportAttachments } from "../../attachments/native";
import { ChatMessageList } from "../../chat/ChatMessageList";
import { estimateContextBudget } from "../../chat/contextBudget";
import { buildChatProviderMessages, retryChatTurn, sendChatTurn } from "../../chat/engine";
import { buildChatMarkdownExport } from "../../chat/export";
import { clampChatOutputTokens, defaultChatOutputTokens, loadChatOutputTokens, saveChatOutputTokens } from "../../chat/outputPreference";
import { clearPendingChatTurn, loadPendingChatTurn, savePendingChatTurn, type PendingChatTurn } from "../../chat/pendingTurn";
import { resolveSessionLanguage } from "../../domain/localization";
import { getCopy } from "../../i18n";
import { resolveViewerDefault } from "../../profileModelDefaults";
import { profileGenerationDefaults } from "../../profileViewerDefaults";
import type { ProviderConfig, ProviderImageInput, ProviderModel } from "../../providers/types";
import { getFullRcp, getRvLite, getTelepathicProtocol } from "../../resources/protocolRegistry";
import { buildEffectiveViewerPrompt, localizedViewerEditablePrompt } from "../../resources/systemPrompts";
import { createImportedWorkspaceSource, estimateTextTokens } from "../../sources/service";
import type { WorkspaceSource } from "../../sources/types";
import { saveTextFile } from "../../storage/native";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, ChatMessage, ChatMode, ChatThread, ChatThreadGroup, Profile, Workspace } from "../../types";

export interface ChatPanelProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
}

export function ChatPanel({ copy, settings, profile, workspace, repository }: ChatPanelProps) {
  const [mode, setMode] = useState<ChatMode>("conversation");
  const [threadGroups, setThreadGroups] = useState<ChatThreadGroup[]>([]);
  const [threadGroupId, setThreadGroupId] = useState<string | null>(null);
  const [threadGroupTitle, setThreadGroupTitle] = useState("");
  const [savedThreadGroupTitle, setSavedThreadGroupTitle] = useState("");
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadTitle, setThreadTitle] = useState("");
  const [savedThreadTitle, setSavedThreadTitle] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [sources, setSources] = useState<WorkspaceSource[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const [chatImages, setChatImages] = useState<ProviderImageInput[]>([]);
  const [chatImageNames, setChatImageNames] = useState<string[]>([]);
  const [modelId, setModelId] = useState("");
  const [input, setInput] = useState("");
  const [manualProtocol, setManualProtocol] = useState<"none" | "rcp" | "lite-core" | "lite-extended" | "telepathic">("none");
  const [manualViewerNotesEnabled, setManualViewerNotesEnabled] = useState(true);
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(settings.defaultMaxOutputTokens));
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<PendingChatTurn | null>(null);
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const activeProvider = providerConfigs.find((item) => item.credentialId === profile?.credentialId) ?? null;
  const selectedModel = models.find((item) => item.modelId === modelId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!repository) return;
      const [configs, nextSources] = await Promise.all([
        repository.listProviderConfigs(),
        repository.listWorkspaceSources(workspace.id),
      ]);
      if (cancelled) return;
      setProviderConfigs(configs);
      const bound = configs.find((item) => item.credentialId === profile?.credentialId);
      const nextModels = bound ? await repository.listProviderModels(bound.id) : [];
      if (cancelled) return;
      setModels(nextModels);
      setSources(nextSources);
      setChatImages([]);
      setChatImageNames([]);
      setModelId(resolveViewerDefault(profile, bound ?? null, nextModels));
      setError(null);
    })();
    return () => { cancelled = true; };
  }, [repository, workspace.id, profile?.credentialId, profile?.defaultViewerModelId]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setActiveSourceIds([]);
    setThreadGroups([]);
    setThreadGroupId(null);
    setThreadId(null);
    void (async () => {
      if (!repository) return;
      let groups = await repository.listChatThreadGroups(workspace.id, mode);
      const group = groups[0] ?? await repository.createChatThreadGroup(workspace.id, mode, "Thread 1");
      if (!groups.length) groups = [group];
      const allThreads = await repository.listChatThreads(workspace.id, mode);
      let available = allThreads.filter((item) => item.threadGroupId === group.id);
      const thread = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      if (!available.length) available = [thread];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(thread.id),
        repository.listActiveChatSourceIds(thread.id),
        repository.touchChatThread(thread.id),
      ]);
      if (cancelled) return;
      setThreadGroups(groups);
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
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
    if (!selectedModel) return;
    const fallback = defaultChatOutputTokens(settings.defaultMaxOutputTokens, selectedModel.capabilities.maxOutputTokens);
    const next = threadId ? loadChatOutputTokens(threadId, fallback, selectedModel.capabilities.maxOutputTokens) : fallback;
    setMaxOutputTokens(String(next));
  }, [threadId, selectedModel?.modelId, selectedModel?.capabilities.maxOutputTokens, settings.defaultMaxOutputTokens]);

  useEffect(() => {
    setPendingRetry(threadId ? loadPendingChatTurn(threadId, messages) : null);
  }, [threadId, messages]);

  const selectedSources = sources.filter((source) => activeSourceIds.includes(source.id));
  const effectiveMaxOutputTokens = (() => {
    const parsed = Number(maxOutputTokens);
    const fallback = defaultChatOutputTokens(settings.defaultMaxOutputTokens, selectedModel?.capabilities.maxOutputTokens);
    return Number.isInteger(parsed) && parsed > 0 ? clampChatOutputTokens(parsed, selectedModel?.capabilities.maxOutputTokens) : fallback;
  })();
  const attachedProtocol = mode === "manual_rv" && manualProtocol !== "none"
    ? manualProtocol === "rcp"
      ? getFullRcp(language).content
      : manualProtocol === "telepathic"
        ? getTelepathicProtocol(language).content
        : getRvLite(language, manualProtocol === "lite-core" ? "core" : "extended").content
    : undefined;
  const rvSystemPrompt = mode === "manual_rv" ? buildEffectiveViewerPrompt(language, localizedViewerEditablePrompt(profile?.defaultViewerSystemPrompt, language)) : undefined;
  const previewMessages = buildChatProviderMessages({ mode, language, history: messages, content: input.trim(), rvSystemPrompt, attachedProtocol, sources: selectedSources, images: chatImages });
  const contextBudget = estimateContextBudget(previewMessages, selectedModel?.capabilities.contextTokens, effectiveMaxOutputTokens);
  const contextExceeded = contextBudget.exceeded;

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
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const openThreadGroup = async (nextGroupId: string) => {
    if (!repository || sending || nextGroupId === threadGroupId) return;
    const group = threadGroups.find((item) => item.id === nextGroupId);
    if (!group) return;
    setError(null);
    try {
      let available = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === group.id);
      const next = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      if (!available.length) available = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([
        repository.listChatMessages(next.id),
        repository.listActiveChatSourceIds(next.id),
        repository.touchChatThread(next.id),
      ]);
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
      setThreads(available);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createNewThreadGroup = async () => {
    if (!repository || sending) return;
    setError(null);
    try {
      const group = await repository.createChatThreadGroup(workspace.id, mode, `Thread ${threadGroups.length + 1}`);
      const conversation = await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, group.id);
      setThreadGroups(await repository.listChatThreadGroups(workspace.id, mode));
      setThreadGroupId(group.id);
      setThreadGroupTitle(group.title);
      setSavedThreadGroupTitle(group.title);
      setThreads([conversation]);
      setThreadId(conversation.id);
      setThreadTitle(conversation.title);
      setSavedThreadTitle(conversation.title);
      setMessages([]);
      setActiveSourceIds([]);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const createNewThread = async () => {
    if (!repository || sending) return;
    const baseTitle = mode === "conversation" ? copy.conversation : copy.manualRv;
    const suggestedTitle = `${baseTitle} ${threads.length + 1}`;
    const requestedTitle = window.prompt(settings.interfaceLanguage === "pl" ? "Podaj nazwę nowej konwersacji:" : "Enter a name for the new conversation:", suggestedTitle);
    if (requestedTitle === null || !requestedTitle.trim()) return;
    setError(null);
    try {
      if (!threadGroupId) return;
      const thread = await repository.createChatThread(workspace.id, mode, requestedTitle.trim(), threadGroupId);
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
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
    if (!repository || !threadId || sending || !window.confirm(`${copy.archiveChatConfirm}\n\n${savedThreadTitle}`)) return;
    setError(null);
    try {
      await repository.archiveChatThread(threadId);
      let remaining = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId);
      const next = remaining[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, threadGroupId ?? undefined);
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
    if (!repository || !window.confirm(`${copy.removeSource}: ${source.displayName}?`)) return;
    await repository.deleteWorkspaceSource(source.id);
    setSources((current) => current.filter((item) => item.id !== source.id));
    setActiveSourceIds((current) => current.filter((id) => id !== source.id));
  };

  const removeChatImage = (index: number) => {
    setChatImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setChatImageNames((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const commitMaxOutputTokens = () => {
    const next = threadId
      ? saveChatOutputTokens(threadId, effectiveMaxOutputTokens, selectedModel?.capabilities.maxOutputTokens)
      : effectiveMaxOutputTokens;
    setMaxOutputTokens(String(next));
  };

  const send = async () => {
    const content = input.trim();
    if (!repository || !threadId || !activeProvider || !selectedModel || !content || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    let effectiveRvSystemPrompt = rvSystemPrompt;
    try {
      if (mode === "manual_rv" && manualViewerNotesEnabled && profile) {
        const snapshot = await prepareViewerNotesForSession({ repository, profileId: profile.id, providerConfig: activeProvider, model: selectedModel, enabled: true });
        const notesBlock = viewerNotesSystemBlock(snapshot, language);
        if (notesBlock) effectiveRvSystemPrompt = [rvSystemPrompt, notesBlock].filter(Boolean).join("\n\n");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInput(content);
      setSending(false);
      return;
    }
    const pending: PendingChatTurn = {
      threadId,
      mode,
      language,
      providerConfigId: activeProvider.id,
      modelId: selectedModel.modelId,
      content,
      requestedSettings: { ...profileGenerationDefaults(profile, selectedModel), maxOutputTokens: effectiveMaxOutputTokens },
      ...(effectiveRvSystemPrompt ? { rvSystemPrompt: effectiveRvSystemPrompt } : {}),
      ...(attachedProtocol ? { attachedProtocol } : {}),
      sourceIds: selectedSources.map((source) => source.id),
      images: chatImages,
      imageNames: chatImageNames,
      createdAt: new Date().toISOString(),
    };
    savePendingChatTurn(pending);
    setPendingRetry(pending);
    setMessages((current) => [...current, { id: "pending-user", threadId, role: "user", content, createdAt: new Date().toISOString() }]);
    try {
      await sendChatTurn({
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
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
        ...(attachedProtocol ? { attachedProtocol } : {}),
      });
      clearPendingChatTurn(threadId);
      setPendingRetry(null);
      setChatImages([]);
      setChatImageNames([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      const storedMessages = await repository.listChatMessages(threadId);
      if (storedMessages.at(-1)?.role !== "user") {
        clearPendingChatTurn(threadId);
        setPendingRetry(null);
      }
      setMessages(storedMessages);
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
      setSending(false);
    }
  };

  const retryPendingResponse = async () => {
    if (!repository || !pendingRetry || sending) return;
    const providerConfig = providerConfigs.find((item) => item.id === pendingRetry.providerConfigId);
    const model = models.find((item) => item.providerConfigId === pendingRetry.providerConfigId && item.modelId === pendingRetry.modelId);
    if (!providerConfig || !model) {
      setError(settings.interfaceLanguage === "pl" ? "Zapisany model lub połączenie nie jest obecnie dostępne. Przywróć je, aby ponowić odpowiedź." : "The saved model or connection is currently unavailable. Restore it to retry the response.");
      return;
    }
    setSending(true);
    setError(null);
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
        maxRetries: settings.maxRetries,
        timeoutMs: settings.requestTimeoutMs,
      });
      clearPendingChatTurn(pendingRetry.threadId);
      setPendingRetry(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setMessages(await repository.listChatMessages(pendingRetry.threadId));
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
      setSending(false);
    }
  };

  const renameThread = async () => {
    if (!repository || !threadId || !threadTitle.trim() || threadTitle.trim() === savedThreadTitle) return;
    try {
      await repository.renameChatThread(threadId, threadTitle);
      setThreadTitle(threadTitle.trim());
      setSavedThreadTitle(threadTitle.trim());
      setThreads((await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === threadGroupId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const renameThreadGroup = async () => {
    if (!repository || !threadGroupId || !threadGroupTitle.trim() || threadGroupTitle.trim() === savedThreadGroupTitle) return;
    try {
      await repository.renameChatThreadGroup(threadGroupId, threadGroupTitle);
      setThreadGroupTitle(threadGroupTitle.trim());
      setSavedThreadGroupTitle(threadGroupTitle.trim());
      setThreadGroups(await repository.listChatThreadGroups(workspace.id, mode));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const archiveCurrentThreadGroup = async () => {
    if (!repository || !threadGroupId || sending || !window.confirm(`${copy.archiveThreadConfirm}\n\n${savedThreadGroupTitle}`)) return;
    setError(null);
    try {
      await repository.archiveChatThreadGroup(threadGroupId);
      let groups = await repository.listChatThreadGroups(workspace.id, mode);
      const nextGroup = groups[0] ?? await repository.createChatThreadGroup(workspace.id, mode, "Thread 1");
      if (!groups.length) groups = [nextGroup];
      let available = (await repository.listChatThreads(workspace.id, mode)).filter((item) => item.threadGroupId === nextGroup.id);
      const next = available[0] ?? await repository.createChatThread(workspace.id, mode, mode === "conversation" ? `${copy.conversation} 1` : `${copy.manualRv} 1`, nextGroup.id);
      if (!available.length) available = [next];
      const [nextMessages, nextActiveSources] = await Promise.all([repository.listChatMessages(next.id), repository.listActiveChatSourceIds(next.id)]);
      setThreadGroups(groups);
      setThreadGroupId(nextGroup.id);
      setThreadGroupTitle(nextGroup.title);
      setSavedThreadGroupTitle(nextGroup.title);
      setThreads(available);
      setThreadId(next.id);
      setThreadTitle(next.title);
      setSavedThreadTitle(next.title);
      setMessages(nextMessages);
      setActiveSourceIds(nextActiveSources);
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
        <ChevronRight size={15} />
        <label className="hierarchy-thread"><span>{copy.threadGroups}</span><select value={threadGroupId ?? ""} disabled={!threadGroupId || sending} onChange={(event) => void openThreadGroup(event.target.value)}>{threadGroups.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}</select></label>
        <button className="icon-button hierarchy-add" type="button" title={copy.newThread} disabled={!repository || sending} onClick={() => void createNewThreadGroup()}><Plus size={15} /></button>
        <details className="hierarchy-menu">
          <summary aria-label={copy.renameThreadGroup} title={copy.renameThreadGroup}>•••</summary>
          <div className="hierarchy-menu-popover">
            <label><span>{copy.threadGroupTitle}</span><input value={threadGroupTitle} maxLength={160} onChange={(event) => setThreadGroupTitle(event.target.value)} /></label>
            <button className="secondary-button" disabled={!threadGroupTitle.trim() || threadGroupTitle.trim() === savedThreadGroupTitle} onClick={() => void renameThreadGroup()}><Pencil size={13} />{copy.renameThreadGroup}</button>
            <button className="secondary-button danger-action" disabled={!threadGroupId || sending} onClick={() => void archiveCurrentThreadGroup()}><Archive size={13} />{copy.archiveThreadGroup}</button>
          </div>
        </details>
      </div>
      <div className="chat-toolbar">
        <div className="segmented large-segmented">
          <button disabled={sending} className={mode === "conversation" ? "active" : ""} onClick={() => setMode("conversation")}><MessageCircle size={16} />{copy.conversation}</button>
          <button disabled={sending} className={mode === "manual_rv" ? "active" : ""} onClick={() => setMode("manual_rv")}><Crosshair size={16} />{copy.manualRv}</button>
        </div>
        <div className="conversation-switcher">
          <label><span>{copy.chatThreads}</span><select value={threadId ?? ""} disabled={!threadId || sending} onChange={(event) => void openThread(event.target.value)}>{threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></label>
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
        <span className={mode === "conversation" ? "context-badge conversation" : "context-badge blind"}>
          {mode === "conversation" ? <Sparkles size={14} /> : <LockKeyhole size={14} />}
          {mode === "conversation" ? copy.systemActive : copy.viewerSystemActive}
        </span>
      </div>
      <div className="chat-model-bar">
        <span><KeyRound size={14} />{activeProvider?.label ?? copy.credentialPending}</span>
        <select value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={!activeProvider || !models.length || sending}>
          <option value="">{models.length ? copy.selectModel : copy.noCachedModels}</option>
          {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.recommended ? "★ " : ""}{model.displayName}</option>)}
        </select>
        <label className="chat-output-limit"><span>{copy.maxOutputTokens}</span><input type="number" min={1} max={selectedModel?.capabilities.maxOutputTokens ?? 262144} value={maxOutputTokens} disabled={!selectedModel || sending} onChange={(event) => setMaxOutputTokens(event.target.value)} onBlur={commitMaxOutputTokens} /></label>
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
        sending={sending}
        sendingLabel={copy.sending}
        emptyState={<div className="chat-empty"><div className="empty-orbit"><Waves size={32} /></div><h3>{copy.cleanBoundary}</h3><p>{activeProvider ? copy.noChatMessages : copy.providerNeeded}</p></div>}
      />
      {error && <div className="provider-error chat-error">{error}</div>}
      {pendingRetry && <div className="chat-retry-panel"><span>{settings.interfaceLanguage === "pl" ? "Ostatnia wiadomość nie otrzymała odpowiedzi AI." : "The last message did not receive an AI response."}</span><button className="secondary-button" disabled={sending} onClick={() => void retryPendingResponse()}>{settings.interfaceLanguage === "pl" ? "Ponów odpowiedź" : "Retry response"}</button></div>}
      {(selectedSources.length > 0 || chatImageNames.length > 0) && <div className="attachment-chips">{selectedSources.map((source) => <button type="button" key={source.id} title={copy.removeSource} onClick={() => void toggleSource(source.id)}><FileCheck2 size={12} /><span>{source.displayName} · {source.sourceType.toUpperCase()} · {settings.interfaceLanguage === "pl" ? "aktywne" : "active"} · ~{estimateTextTokens(source.content).toLocaleString()} tokens</span><X size={11} /></button>)}{chatImageNames.map((name, index) => <button type="button" key={`${name}-${index}`} onClick={() => removeChatImage(index)}><span>{name} · IMAGE · {settings.interfaceLanguage === "pl" ? "następna tura" : "next turn"} · ~2,048 tokens</span><X size={11} /></button>)}</div>}
      <div className="composer">
        <textarea rows={2} placeholder={copy.messagePlaceholder} value={input} onChange={(event) => setInput(event.target.value)} disabled={!selectedModel || sending || Boolean(pendingRetry)} />
        <div className="composer-actions"><button type="button" className="composer-attachment-button" title={settings.interfaceLanguage === "pl" ? "Dołącz dokumenty lub obrazy" : "Attach documents or images"} disabled={!repository || !threadId || sending || attachmentBusy || Boolean(pendingRetry)} onClick={() => void attachFiles()}><Paperclip size={17} /></button><button disabled={!selectedModel || !input.trim() || sending || contextExceeded || Boolean(pendingRetry)} onClick={() => void send()}>{sending ? copy.sending : copy.send}<ArrowRight size={15} /></button></div>
      </div>
    </section>
  );
}

