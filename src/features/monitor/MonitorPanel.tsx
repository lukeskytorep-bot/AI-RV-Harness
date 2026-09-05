import { useEffect, useState, type ReactNode } from "react";
import { BrainCircuit, Check, LockKeyhole, MonitorCog, ShieldCheck } from "lucide-react";

import { EmptyState } from "../../components/EmptyState";
import { SafeMarkdown } from "../../components/SafeMarkdown";
import { resolveSessionLanguage } from "../../domain/localization";
import { exportMonitorRun } from "../../exports/monitor";
import type { getCopy } from "../../i18n";
import type { MonitorInterventionRecord, MonitorRunRecord } from "../../monitor/types";
import {
  buildEffectiveMonitorPrompt,
  factoryMonitorEditablePrompt,
  localizedMonitorEditablePrompt,
  lockedActivityDefinition,
  lockedMonitorExecution,
} from "../../resources/systemPrompts";
import { isTauriRuntime } from "../../storage";
import type { AppRepository } from "../../storage/repository";
import type { AppSettings, Profile, Workspace } from "../../types";

export interface MonitorPanelProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  profile: Profile | null;
  workspace: Workspace;
  repository: AppRepository | null;
}

export function MonitorPanel({ copy, settings, profile, workspace, repository }: MonitorPanelProps) {
  const [runs, setRuns] = useState<MonitorRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [interventions, setInterventions] = useState<MonitorInterventionRecord[]>([]);
  const [exportingRun, setExportingRun] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const language = resolveSessionLanguage(settings.interfaceLanguage, settings.sessionLanguage);
  const [editablePrompt, setEditablePrompt] = useState(localizedMonitorEditablePrompt(profile?.defaultMonitorSystemPrompt, language));
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  useEffect(() => {
    setEditablePrompt(localizedMonitorEditablePrompt(profile?.defaultMonitorSystemPrompt, language));
    setPromptSaved(false);
    setPromptError(null);
  }, [language, profile?.defaultMonitorSystemPrompt, profile?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!repository) {
      setRuns([]);
      setSelectedRunId(null);
      return () => { cancelled = true; };
    }
    void Promise.all([
      repository.listMonitorRuns(workspace.id),
      repository.listRvSessions(workspace.id),
      repository.listResearchProjects(workspace.id),
    ]).then(([items, sessions, projects]) => {
      if (cancelled) return;
      const sessionById = new Map(sessions.map((session) => [session.id, session]));
      const researchById = new Map(projects.map((project) => [project.id, project]));
      const visible = items.filter((run) => {
        const researchId = sessionById.get(run.sessionId)?.researchProjectId;
        return !researchId || researchById.get(researchId)?.state === "Complete";
      });
      setRuns(visible);
      setSelectedRunId((current) => current && visible.some((item) => item.id === current) ? current : visible[0]?.id ?? null);
    }).catch((cause) => {
      if (!cancelled) setExportError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [repository, workspace.id]);

  useEffect(() => {
    let cancelled = false;
    if (!repository || !selectedRunId) {
      setInterventions([]);
      return () => { cancelled = true; };
    }
    void repository.listMonitorInterventions(selectedRunId).then((items) => {
      if (!cancelled) setInterventions(items);
    }).catch((cause) => {
      if (!cancelled) setExportError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [repository, selectedRunId]);

  const selected = runs.find((run) => run.id === selectedRunId) ?? null;

  const savePrompt = async () => {
    if (!repository || !profile) return;
    setPromptError(null);
    try {
      await repository.setProfileAiConfiguration(profile.id, {
        credentialId: profile.credentialId,
        credentialProvider: profile.credentialProvider,
        defaultViewerModelId: profile.defaultViewerModelId,
        defaultViewerReasoningEffort: profile.defaultViewerReasoningEffort,
        defaultViewerTemperature: profile.defaultViewerTemperature,
        defaultViewerSystemPrompt: profile.defaultViewerSystemPrompt,
        defaultMonitorSystemPrompt: editablePrompt.trim() || factoryMonitorEditablePrompt(language),
        defaultMonitorProviderConfigId: profile.defaultMonitorProviderConfigId,
        defaultMonitorModelId: profile.defaultMonitorModelId,
        defaultJudgeProviderConfigId: profile.defaultJudgeProviderConfigId,
        defaultJudgeModelId: profile.defaultJudgeModelId,
      });
      setPromptSaved(true);
    } catch (cause) {
      setPromptError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const exportSelected = async () => {
    if (!repository || !selected || exportingRun || !isTauriRuntime()) return;
    setExportingRun(true);
    setExportError(null);
    setExportPath(null);
    try {
      setExportPath(await exportMonitorRun(repository, workspace.id, selected, interventions));
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportingRun(false);
    }
  };

  return <section className="panel monitor-panel">
    <PanelHeader title={copy.monitorHistory} icon={<BrainCircuit size={18} />} />
    <div className="role-guard"><ShieldCheck size={22} /><div><strong>{copy.blindRoleBoundary}</strong><p>{copy.monitorLead}</p></div></div>
    <details className="monitor-prompt-editor" open>
      <summary><BrainCircuit size={15} /><span><strong>{settings.interfaceLanguage === "pl" ? "System prompt AI Monitora" : "AI Monitor system prompt"}</strong><small>{settings.interfaceLanguage === "pl" ? "Cały skuteczny prompt jest widoczny; część użytkownika można zmieniać." : "The complete effective prompt is visible; the user section is editable."}</small></span></summary>
      <div className="monitor-prompt-body">
        <label><span>{settings.interfaceLanguage === "pl" ? "Część edytowalna" : "Editable section"}</span><textarea rows={18} maxLength={100000} value={editablePrompt} onChange={(event) => { setEditablePrompt(event.target.value); setPromptSaved(false); }} /></label>
        <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{settings.interfaceLanguage === "pl" ? "Definicja aktywności — zablokowana" : "Activity definition — locked"}</strong><p>{lockedActivityDefinition(language)}</p></div></div>
        <div className="locked-prompt-block"><LockKeyhole size={15} /><div><strong>{settings.interfaceLanguage === "pl" ? "Reguła wykonania — zablokowana" : "Execution rule — locked"}</strong><pre>{lockedMonitorExecution(language)}</pre></div></div>
        <details className="effective-prompt-preview"><summary>{settings.interfaceLanguage === "pl" ? "Pokaż cały skuteczny prompt" : "Show the complete effective prompt"}</summary><pre>{buildEffectiveMonitorPrompt(language, editablePrompt)}</pre></details>
        <div className="monitor-prompt-actions"><button className="secondary-button" type="button" onClick={() => { setEditablePrompt(factoryMonitorEditablePrompt(language)); setPromptSaved(false); }}>{settings.interfaceLanguage === "pl" ? "Przywróć treść fabryczną" : "Restore factory text"}</button><button className="primary-button" type="button" disabled={!profile} onClick={() => void savePrompt()}>{settings.interfaceLanguage === "pl" ? "Zapisz prompt" : "Save prompt"}</button>{promptSaved && <span><Check size={13} />{settings.interfaceLanguage === "pl" ? "Zapisano" : "Saved"}</span>}</div>
        {promptError && <div className="provider-error">{promptError}</div>}
      </div>
    </details>
    {!runs.length ? <EmptyState icon={<MonitorCog size={28} />} title={copy.noMonitorRuns} body={copy.monitorLead} /> : <div className="monitor-history-layout"><div className="monitor-run-list">{runs.map((run) => <button className={run.id === selectedRunId ? "active" : ""} key={run.id} onClick={() => { setSelectedRunId(run.id); setExportPath(null); setExportError(null); }}><span><strong>{run.sessionCode}</strong><small>{run.modelRoute}</small></span><span>{run.interventionCount}</span></button>)}</div><div className="monitor-run-detail">{selected && <><div className="monitor-run-meta"><span><small>{copy.promptVersion}</small><strong>{selected.promptVersionId ?? "—"}</strong></span><span><small>{copy.libraryVersion}</small><strong>{selected.libraryVersion}</strong></span><span><small>{copy.interventions}</small><strong>{selected.interventionCount} / {selected.maxInterventions}</strong></span></div><div className="monitor-export-row"><button className="secondary-button" disabled={!isTauriRuntime() || exportingRun} onClick={() => void exportSelected()}>{exportingRun ? copy.exporting : copy.exportMonitorRun}</button><small>{copy.monitorExportSafe}</small></div></>}{interventions.length ? <div className="monitor-timeline">{interventions.map((item) => <article key={item.id} className={item.decision === "INTERVENE" ? "intervene" : "continue"}><div><span>{item.sequenceNumber}</span><strong>{item.decision === "INTERVENE" ? item.commandId ?? "INTERVENE" : copy.continueProtocol}</strong></div>{item.viewerEvidence && <div className="monitor-markdown-row"><b>{copy.viewerEvidence}</b><SafeMarkdown content={item.viewerEvidence} /></div>}{item.commandText && <div className="monitor-markdown-row"><b>{copy.monitorCommand}</b><SafeMarkdown content={item.commandText} /></div>}{item.rationale && <details className="monitor-rationale"><summary>{copy.rationale}</summary><SafeMarkdown content={formatMonitorRationale(item.rationale)} /></details>}</article>)}</div> : <p className="monitor-no-decisions">{copy.noMonitorRuns}</p>}{exportPath && <div className="storage-success"><Check size={14} />{copy.exportComplete} · {exportPath}</div>}{exportError && <div className="provider-error">{exportError}</div>}</div></div>}
  </section>;
}

function formatMonitorRationale(value: string): string {
  try {
    return `\`\`\`json\n${JSON.stringify(JSON.parse(value), null, 2)}\n\`\`\``;
  } catch {
    return value;
  }
}

function PanelHeader({ title, icon }: { title: string; icon: ReactNode }) {
  return <div className="panel-header"><span>{icon}</span><h2>{title}</h2></div>;
}
