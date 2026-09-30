import { useState, type FormEvent } from "react";

import { FormDialog } from "../../components/FormDialog";
import { getCopy } from "../../i18n";
import { isTauriRuntime } from "../../storage";
import type { TargetRecord } from "../../targets/types";

export interface CreateTargetDialogProps {
  copy: ReturnType<typeof getCopy>;
  onCancel: () => void;
  onCreate: (
    title: string,
    revealText: string,
    tags: string[],
    images: File[],
    targetKind: "general" | "telepathic",
  ) => Promise<void>;
}

export function CreateTargetDialog({ copy, onCancel, onCreate }: CreateTargetDialogProps) {
  const [title, setTitle] = useState("");
  const [revealText, setRevealText] = useState("");
  const [tags, setTags] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const [targetKind, setTargetKind] = useState<"general" | "telepathic">("general");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!revealText.trim() && !images.length) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(title, revealText, tags.split(","), images, targetKind);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <FormDialog title={copy.addTarget} onCancel={onCancel}>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {copy.home === "Home" ? "Target category" : "Kategoria celu"}
          <select value={targetKind} onChange={(event) => setTargetKind(event.target.value as typeof targetKind)}>
            <option value="general">{copy.home === "Home" ? "General RV target" : "Ogólny cel RV"}</option>
            <option value="telepathic">{copy.home === "Home" ? "Telepathic target (person / being / group)" : "Cel telepatyczny (osoba / istota / grupa)"}</option>
          </select>
        </label>
        <label>{copy.targetName}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{copy.targetReveal}<textarea rows={7} value={revealText} onChange={(event) => setRevealText(event.target.value)} /></label>
        <label>{copy.targetImages}<input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" disabled={!isTauriRuntime() || saving} onChange={(event) => setImages(Array.from(event.target.files ?? []).slice(0, 8))} /></label>
        {images.length > 0 && <div className="form-image-list">{images.map((file) => <span key={`${file.name}-${file.size}`}>▣ {file.name}</span>)}</div>}
        <label>{copy.targetTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        <small className="form-hint">{targetKind === "telepathic" ? (copy.home === "Home" ? "This target appears only when the Telepathic Protocol is selected." : "Ten cel pojawi się wyłącznie po wybraniu Protokołu Telepatycznego.") : (copy.home === "Home" ? "This target is available to Full RCP, RV Lite, and custom protocols." : "Ten cel jest dostępny dla Full RCP, RV Lite i protokołów własnych.")}</small>
        {error && <div className="provider-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button>
          <button className="primary-button" disabled={!title.trim() || (!revealText.trim() && !images.length) || saving}>{copy.saveTarget}</button>
        </div>
      </form>
    </FormDialog>
  );
}

export interface EditTargetDialogProps {
  copy: ReturnType<typeof getCopy>;
  target: TargetRecord;
  onCancel: () => void;
  onSave: (title: string, revealText: string, tags: string[]) => Promise<void>;
}

export function EditTargetDialog({ copy, target, onCancel, onSave }: EditTargetDialogProps) {
  const [title, setTitle] = useState(target.title);
  const [revealText, setRevealText] = useState(target.revealText ?? "");
  const [tags, setTags] = useState(target.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || (!revealText.trim() && !target.revealArtifacts?.length) || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(title, revealText, tags.split(","));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSaving(false);
    }
  };

  return (
    <FormDialog title={copy.editTarget} onCancel={onCancel}>
      <form onSubmit={(event) => void submit(event)}>
        <label>{copy.targetName}<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>{copy.targetReveal}<textarea rows={7} value={revealText} onChange={(event) => setRevealText(event.target.value)} /></label>
        {Boolean(target.revealArtifacts?.length) && <div><small className="form-hint">{copy.existingTargetImages}</small><div className="form-image-list">{target.revealArtifacts!.map((artifact) => <span key={`${artifact.artifactId}-${artifact.sha256}`}>▣ {artifact.originalFileName}</span>)}</div></div>}
        <label>{copy.targetTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        {error && <div className="provider-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>{copy.cancel}</button>
          <button className="primary-button" disabled={!title.trim() || (!revealText.trim() && !target.revealArtifacts?.length) || saving}>{saving ? copy.saving : copy.saveChanges}</button>
        </div>
      </form>
    </FormDialog>
  );
}
