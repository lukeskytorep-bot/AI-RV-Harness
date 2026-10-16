import type { WorkflowEntity, WorkflowToken } from "./workflowOwnership";
export interface NativeWorkflowBinding extends WorkflowToken { entities: WorkflowEntity[]; }
const verifiers = new WeakMap<AbortSignal, () => Promise<void>>();
const bindings = new WeakMap<AbortSignal, () => NativeWorkflowBinding>();
export function registerAbortOwnership(signal: AbortSignal, verify: () => Promise<void>, binding?: () => NativeWorkflowBinding): void {
  verifiers.set(signal, verify);
  if (binding) bindings.set(signal, binding);
}
export function inheritAbortOwnership(signal: AbortSignal, ...parents: Array<AbortSignal | undefined>): void {
  const checks = parents.flatMap(parent => parent && verifiers.has(parent) ? [verifiers.get(parent)!] : []);
  const contexts = parents.flatMap(parent => parent && bindings.has(parent) ? [bindings.get(parent)!] : []);
  if (checks.length) registerAbortOwnership(signal, async () => { for (const check of checks) await check(); }, contexts.length ? () => {
    const current = contexts.map(get => get());
    if (current.some(c => c.profileId !== current[0].profileId || c.owner !== current[0].owner || c.version !== current[0].version)) throw new Error("Conflicting provider workflow ownership scopes");
    return current[current.length - 1];
  } : undefined);
}
export function nativeWorkflowBinding(signal?: AbortSignal): NativeWorkflowBinding | undefined {
  signal?.throwIfAborted();
  return signal ? bindings.get(signal)?.() : undefined;
}
export async function assertAbortOwnership(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted(); if (signal) await verifiers.get(signal)?.(); signal?.throwIfAborted();
}
export type WorkflowAbortKind = "ownership_lost" | "database_error" | "view_closed" | "workflow_settled";
export class WorkflowAbortError extends Error {
  readonly name = "AbortError";
  constructor(readonly kind: WorkflowAbortKind, message: string, cause?: unknown) { super(message, { cause }); }
}
export function workflowOwnershipFailure(cause: unknown): WorkflowAbortError {
  if (cause instanceof WorkflowAbortError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new WorkflowAbortError(/ownership lost|expired|ended|archived|settled|active.*not found/i.test(message) ? "ownership_lost" : "database_error", message, cause);
}
/** Keep the real abort cause and received transport evidence as separate data. */
export function providerAbortFromSignal(signal: AbortSignal, cause?: unknown): Error {
  const reason: unknown = signal.reason;
  const failure = new Error(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Provider request cancelled", { cause: reason });
  failure.name = "AbortError";
  if (reason instanceof WorkflowAbortError) Object.assign(failure, { kind: reason.kind });
  if (cause !== undefined) {
    Object.assign(failure, { causeError: cause });
    if (cause && typeof cause === "object" && "details" in cause) Object.assign(failure, { details: cause.details });
  }
  return failure;
}
