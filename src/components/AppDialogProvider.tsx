import { AlertTriangle, Info, ShieldAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type AppDialogSeverity = "normal" | "warning" | "destructive";

export interface AppDialogBaseOptions {
  title: string;
  description?: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  busyLabel?: string;
  severity?: AppDialogSeverity;
  requiredPhrase?: string;
  requiredPhraseLabel?: string;
}

export interface AppConfirmDialogOptions extends AppDialogBaseOptions {
  action?: () => void | Promise<void>;
}

export interface AppPromptDialogOptions extends AppDialogBaseOptions {
  initialValue?: string;
  inputLabel?: string;
  placeholder?: string;
  inputRequired?: boolean;
  action?: (value: string) => void | Promise<void>;
}

export interface AppInformationDialogOptions {
  title: string;
  description?: string;
  details?: string[];
  confirmLabel: string;
  severity?: Exclude<AppDialogSeverity, "destructive">;
}

export interface AppDialogs {
  confirm: (options: AppConfirmDialogOptions) => Promise<boolean>;
  prompt: (options: AppPromptDialogOptions) => Promise<string | null>;
  information: (options: AppInformationDialogOptions) => Promise<void>;
}

type ConfirmRequest = { kind: "confirm"; options: AppConfirmDialogOptions; resolve: (value: boolean) => void };
type PromptRequest = { kind: "prompt"; options: AppPromptDialogOptions; resolve: (value: string | null) => void };
type InformationRequest = { kind: "information"; options: AppInformationDialogOptions; resolve: () => void };
export type AppDialogRequest = ConfirmRequest | PromptRequest | InformationRequest;

const fallbackDialogs: AppDialogs = {
  async confirm(options) {
    if (typeof globalThis.confirm !== "function" || !globalThis.confirm([options.description, ...(options.details ?? [])].filter(Boolean).join("\n\n") || options.title)) return false;
    if (options.action) await options.action();
    return true;
  },
  async prompt(options) {
    if (typeof globalThis.prompt !== "function") return null;
    const value = globalThis.prompt([options.description, ...(options.details ?? [])].filter(Boolean).join("\n\n") || options.title, options.initialValue ?? "");
    if (value === null || (options.inputRequired && !value.trim())) return null;
    if (options.action) await options.action(value);
    return value;
  },
  async information(options) {
    if (typeof globalThis.alert === "function") globalThis.alert([options.description, ...(options.details ?? [])].filter(Boolean).join("\n\n") || options.title);
  },
};

const AppDialogContext = createContext<AppDialogs>(fallbackDialogs);

export function useAppDialogs(): AppDialogs {
  return useContext(AppDialogContext);
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<AppDialogRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [phraseValue, setPhraseValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<AppDialogRequest | null>(null);
  const queueRef = useRef<AppDialogRequest[]>([]);
  const busyRef = useRef(false);

  const show = useCallback((request: AppDialogRequest) => {
    if (activeRef.current) {
      queueRef.current.push(request);
      return;
    }
    activeRef.current = request;
    setInputValue(request.kind === "prompt" ? request.options.initialValue ?? "" : "");
    setPhraseValue("");
    busyRef.current = false;
    setBusy(false);
    setError(null);
    setActive(request);
  }, []);

  const finish = useCallback((value?: boolean | string | null) => {
    const request = activeRef.current;
    if (!request) return;
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setInputValue(next?.kind === "prompt" ? next.options.initialValue ?? "" : "");
    setPhraseValue("");
    busyRef.current = false;
    setBusy(false);
    setError(null);
    setActive(next);
    if (request.kind === "confirm") request.resolve(Boolean(value));
    else if (request.kind === "prompt") request.resolve(typeof value === "string" ? value : null);
    else request.resolve();
  }, []);

  const dialogs = useMemo<AppDialogs>(() => ({
    confirm: (options) => new Promise<boolean>((resolve) => show({ kind: "confirm", options, resolve })),
    prompt: (options) => new Promise<string | null>((resolve) => show({ kind: "prompt", options, resolve })),
    information: (options) => new Promise<void>((resolve) => show({ kind: "information", options, resolve })),
  }), [show]);

  const cancel = () => {
    if (busyRef.current || !active) return;
    finish(active.kind === "confirm" ? false : active.kind === "prompt" ? null : undefined);
  };

  const submit = async () => {
    if (busyRef.current || !active || !dialogCanSubmit(active, inputValue, phraseValue, busy)) return;
    if (active.kind === "information") {
      finish();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (active.kind === "confirm") {
        await active.options.action?.();
        finish(true);
      } else {
        const value = inputValue.trim();
        await active.options.action?.(value);
        finish(value);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      busyRef.current = false;
      setBusy(false);
    }
  };

  return <AppDialogContext.Provider value={dialogs}>
    {children}
    {active && <AppDialogSurface
      request={active}
      inputValue={inputValue}
      phraseValue={phraseValue}
      busy={busy}
      error={error}
      onInputChange={setInputValue}
      onPhraseChange={setPhraseValue}
      onCancel={cancel}
      onSubmit={() => void submit()}
    />}
  </AppDialogContext.Provider>;
}

export function dialogCanSubmit(request: AppDialogRequest, inputValue: string, phraseValue: string, busy: boolean): boolean {
  if (busy) return false;
  if (request.kind === "prompt" && request.options.inputRequired && !inputValue.trim()) return false;
  const phrase = request.kind === "information" ? undefined : request.options.requiredPhrase;
  if (phrase !== undefined && phraseValue !== phrase) return false;
  return true;
}

export function AppDialogSurface({
  request,
  inputValue,
  phraseValue,
  busy,
  error,
  onInputChange,
  onPhraseChange,
  onCancel,
  onSubmit,
}: {
  request: AppDialogRequest;
  inputValue: string;
  phraseValue: string;
  busy: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onPhraseChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const options = request.options;
  const severity = options.severity ?? "normal";
  const phrase = request.kind === "information" ? undefined : request.options.requiredPhrase;
  const canSubmit = dialogCanSubmit(request, inputValue, phraseValue, busy);
  const icon = severity === "destructive" ? <ShieldAlert size={20} /> : severity === "warning" ? <AlertTriangle size={20} /> : <Info size={20} />;
  const confirmLabel = busy && "busyLabel" in options && options.busyLabel ? options.busyLabel : options.confirmLabel;
  return <div className="modal-backdrop app-dialog-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
    <section className={`modal app-dialog app-dialog-${severity}`} role="dialog" aria-modal="true" aria-labelledby="app-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-heading app-dialog-heading"><span className="app-dialog-icon" aria-hidden="true">{icon}</span><div><h2 id="app-dialog-title">{options.title}</h2>{options.description && <p>{options.description}</p>}</div><button className="icon-button" type="button" aria-label={request.kind === "information" ? request.options.confirmLabel : request.options.cancelLabel ?? "Cancel"} disabled={busy} onClick={onCancel}><X size={19} /></button></div>
      <div className="app-dialog-body">
        {options.details?.length ? <div className="app-dialog-details">{options.details.map((detail, index) => <p key={`${index}:${detail}`}>{detail}</p>)}</div> : null}
        {request.kind === "prompt" && <label className="app-dialog-input"><span>{request.options.inputLabel ?? request.options.title}</span><input autoFocus value={inputValue} placeholder={request.options.placeholder} disabled={busy} onChange={(event) => onInputChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && canSubmit) { event.preventDefault(); onSubmit(); } }} /></label>}
        {phrase !== undefined && <label className="app-dialog-input app-dialog-confirmation"><span>{request.kind !== "information" && request.options.requiredPhraseLabel ? request.options.requiredPhraseLabel : phrase}</span><input value={phraseValue} disabled={busy} onChange={(event) => onPhraseChange(event.target.value)} /></label>}
        {error && <div className="provider-error app-dialog-error" role="alert">{error}</div>}
      </div>
      <div className="modal-actions app-dialog-actions">
        {request.kind !== "information" && <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{request.options.cancelLabel ?? "Cancel"}</button>}
        <button type="button" className={severity === "destructive" ? "danger-button" : "primary-button"} disabled={!canSubmit} onClick={onSubmit}>{confirmLabel}</button>
      </div>
    </section>
  </div>;
}
