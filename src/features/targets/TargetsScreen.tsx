import { BrainCircuit, Crosshair, FileCheck2, LockKeyhole, Pencil, Plus, Trash2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { getCopy } from "../../i18n";
import type { AppRepository } from "../../storage/repository";
import { TRAINING_CATEGORIES, TRAINING_CATEGORY_LABELS } from "../../targets/bundled";
import { localizedTargetReveal, localizedTargetTitle } from "../../targets/localization";
import type { TargetRecord, TargetUsageRecord } from "../../targets/types";
import type { AppSettings, InterfaceLanguage } from "../../types";
import { CreateTargetDialog, EditTargetDialog } from "./TargetDialogs";
import { createFeatureTarget, deleteFeatureTarget, loadTargetLibrary, updateFeatureTarget } from "./targetOperations";
import { collectLockedTargetIds, groupTargets } from "./targetViewModel";

export interface TargetsScreenProps {
  copy: ReturnType<typeof getCopy>;
  settings: AppSettings;
  repository: AppRepository | null;
}

export function TargetsScreen({ copy, settings, repository }: TargetsScreenProps) {
  const [targets, setTargets] = useState<TargetRecord[]>([]);
  const [usage, setUsage] = useState<TargetUsageRecord[]>([]);
  const [researchLockedTargetIds, setResearchLockedTargetIds] = useState<string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<TargetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!repository) return;
    const state = await loadTargetLibrary(repository);
    setTargets(state.targets);
    setUsage(state.usage);
    setResearchLockedTargetIds(state.researchLockedTargetIds);
  }, [repository]);

  useEffect(() => {
    void reload().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [reload]);

  const groups = groupTargets(targets);
  const usedTargetIds = collectLockedTargetIds(usage, researchLockedTargetIds);

  const createTarget = async (title: string, revealText: string, tags: string[], images: File[], targetKind: "general" | "telepathic") => {
    if (!repository) return;
    const target = await createFeatureTarget(repository, { title, revealText, tags, images, targetKind });
    setTargets((current) => [target, ...current]);
    setDialogOpen(false);
  };

  const editTarget = async (target: TargetRecord, title: string, revealText: string, tags: string[]) => {
    if (!repository) return;
    setError(null);
    await updateFeatureTarget(repository, target, { title, revealText, tags });
    setEditingTarget(null);
    await reload();
  };

  const deleteTarget = async (target: TargetRecord) => {
    if (!repository || !window.confirm(`${copy.deleteTargetConfirm}\n\n${localizedTargetTitle(target, settings.interfaceLanguage)}`)) return;
    setError(null);
    try {
      await deleteFeatureTarget(repository, target.id);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="page">
      <PageHeader title={copy.targets} subtitle={copy.targetsLead} action={<button className="primary-button" onClick={() => setDialogOpen(true)}><Plus size={16} />{copy.addTarget}</button>} />
      <div className="target-columns">
        <section className="panel target-panel">
          <PanelHeader title={`${copy.trainingTargets} · ${groups.training.length}`} icon={Crosshair} />
          {groups.training.length ? <div className="training-target-groups">{TRAINING_CATEGORIES.map((category) => {
            const items = groups.training.filter((target) => target.sourceMetadata.category === category);
            return <details key={category}><summary><span>{TRAINING_CATEGORY_LABELS[category][settings.interfaceLanguage]}</span><b>{items.length}</b></summary><TargetList copy={copy} language={settings.interfaceLanguage} targets={items} usedTargetIds={usedTargetIds} /></details>;
          })}</div> : <EmptyState icon={<FileCheck2 size={28} />} title={copy.statusNext} body={copy.targetPackPending} />}
        </section>
        <section className="panel target-panel">
          <PanelHeader title={`${copy.myTargets} · ${groups.general.length}`} icon={LockKeyhole} />
          {groups.general.length ? <TargetList copy={copy} language={settings.interfaceLanguage} targets={groups.general} usedTargetIds={usedTargetIds} onEdit={setEditingTarget} onDelete={(target) => void deleteTarget(target)} /> : <EmptyState icon={<Plus size={28} />} title={copy.noPrivateTargets} body={copy.secureLocal} action={<button className="secondary-button" onClick={() => setDialogOpen(true)}><Plus size={15} />{copy.addTarget}</button>} />}
        </section>
        <section className="panel target-panel">
          <PanelHeader title={`${settings.interfaceLanguage === "pl" ? "Moje cele telepatyczne" : "My Telepathic Targets"} · ${groups.telepathic.length}`} icon={BrainCircuit} />
          {groups.telepathic.length ? <TargetList copy={copy} language={settings.interfaceLanguage} targets={groups.telepathic} usedTargetIds={usedTargetIds} onEdit={setEditingTarget} onDelete={(target) => void deleteTarget(target)} /> : <EmptyState icon={<BrainCircuit size={28} />} title={settings.interfaceLanguage === "pl" ? "Brak celów telepatycznych" : "No telepathic targets"} body={settings.interfaceLanguage === "pl" ? "Dodaj osobę, istotę lub grupę przeznaczoną dla Protokołu Telepatycznego." : "Add a person, being, or group intended for the Telepathic Protocol."} />}
        </section>
      </div>
      <section className="panel target-help-panel">
        <strong>{settings.interfaceLanguage === "pl" ? "Opis celu i obrazy" : "Target descriptions and images"}</strong>
        {settings.interfaceLanguage === "pl" ? <><p>Cel może zawierać opis tekstowy, jeden lub więcej obrazów PNG, JPG, WEBP lub GIF albo oba rodzaje danych. Zalecamy dodanie dokładnego opisu słownego, ponieważ nie każdy model potrafi odczytać obrazy. Opis możesz przygotować samodzielnie albo poprosić model obsługujący obrazy — na przykład z rodziny Google lub OpenAI — o opisanie zdjęcia.</p><p>Jeśli obraz ma być częścią Revealu lub materiału dla AI Judge, wybierz trasę Judge obsługującą obrazy; aplikacja sprawdzi tę zgodność przed oceną. Treść celu i obrazy pozostają ukryte podczas ślepej części sesji i są udostępniane dopiero po Reveal.</p></> : <><p>A target may contain a text description, one or more PNG, JPG, WEBP, or GIF images, or both. We recommend adding an accurate written description because not every model can read images. You can write it yourself or ask an image-capable model — for example from Google or OpenAI — to describe the image.</p><p>If an image is part of the Reveal or AI Judge evidence, select a Judge route that accepts images; the app checks this compatibility before evaluation. Target content and images remain hidden during the blind portion and are released only after Reveal.</p></>}
      </section>
      {error && <div className="provider-error">{error}</div>}
      {dialogOpen && <CreateTargetDialog copy={copy} onCancel={() => setDialogOpen(false)} onCreate={createTarget} />}
      {editingTarget && <EditTargetDialog copy={copy} target={editingTarget} onCancel={() => setEditingTarget(null)} onSave={(title, revealText, tags) => editTarget(editingTarget, title, revealText, tags)} />}
    </div>
  );
}

function TargetList({ copy, language, targets, usedTargetIds, onEdit, onDelete }: { copy: ReturnType<typeof getCopy>; language: InterfaceLanguage; targets: TargetRecord[]; usedTargetIds: Set<string>; onEdit?: (target: TargetRecord) => void; onDelete?: (target: TargetRecord) => void }) {
  return <div className="target-list">{targets.map((target) => {
    const locked = usedTargetIds.has(target.id);
    const revealText = localizedTargetReveal(target, language);
    return <article className="target-card" key={target.id}><div className="target-card-head"><div><strong>{localizedTargetTitle(target, language)}</strong><small>{target.tags.length ? target.tags.join(" · ") : target.collection}</small></div>{target.collection === "user" && <div className="target-card-actions"><button className="icon-button" disabled={locked} title={locked ? copy.usedTargetLocked : copy.editTarget} onClick={() => onEdit?.(target)}><Pencil size={14} /></button><button className="icon-button danger" disabled={locked} title={locked ? copy.usedTargetLocked : copy.deleteTarget} onClick={() => onDelete?.(target)}><Trash2 size={14} /></button></div>}</div>{revealText && <details className="target-reveal-preview"><summary>{copy.targetReveal}</summary><p>{revealText}</p></details>}{Boolean(target.revealArtifacts?.length) && <div className="target-image-list">{target.revealArtifacts!.map((artifact) => <span key={`${artifact.artifactId}-${artifact.sha256}`}>▣ {artifact.originalFileName}</span>)}</div>}{locked && <small className="target-locked-note"><LockKeyhole size={11} />{copy.usedTargetLocked}</small>}{target.contentHash && <code>sha256 {target.contentHash.slice(0, 16)}…</code>}</article>;
  })}</div>;
}

function PanelHeader({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  return <div className="panel-header"><span><Icon size={18} /></span><h2>{title}</h2></div>;
}
