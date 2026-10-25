import { registerAbortOwnership, WorkflowAbortError, workflowOwnershipFailure } from "../../application/abortOwnership";
import { workflowOwnershipNative } from "../databaseNative";
import type { WorkflowContext, WorkflowScope, WorkflowToken } from "../../application/workflowOwnership";
import type { AppRepository } from "../repository";

export async function ownSqliteWorkflow<T>(scope: WorkflowScope, makeRepository: (context: WorkflowContext) => AppRepository, task: (repository: AppRepository, signal: AbortSignal) => Promise<T>, onOwner: (owner: string | null) => void): Promise<T> {
  const lost = new AbortController();
  let context: WorkflowContext | undefined;
  const token = await workflowOwnershipNative<WorkflowToken & { nativeHeartbeat?: boolean }>({ action: "acquire", profileId: scope.profileId, owner: crypto.randomUUID() }, failure => {
    if (!context?.closed) lost.abort(new WorkflowAbortError(failure.kind, failure.message));
  });
  const signal = scope.signal ? AbortSignal.any([scope.signal, lost.signal]) : lost.signal;
  context = { ...token, entities: [scope.entity], closed: false, signal };
  const owned = context;
  onOwner(token.owner);
  registerAbortOwnership(signal, async () => {
    if (owned.closed) throw new WorkflowAbortError("workflow_settled", "Workflow ownership has settled");
    try { await workflowOwnershipNative({ action: "check", ...token, entities: owned.entities.map(entity => ({ ...entity, allowEnded: false })) }); }
    catch (cause) { const failure = workflowOwnershipFailure(cause); lost.abort(failure); throw failure; }
  }, () => ({ profileId: token.profileId, owner: token.owner, version: token.version, entities: owned.entities.map(entity => ({ ...entity, allowEnded: false })) }));
  let renewal: Promise<unknown> = Promise.resolve();
  // Compatibility for old native builds and test ports; T4 advertises Rust renewal.
  const timer = token.nativeHeartbeat ? undefined : setInterval(() => {
    renewal = renewal.then(async () => {
      if (owned.closed) return;
      if (!await workflowOwnershipNative<boolean>({ action: "renew", ...token })) throw new WorkflowAbortError("ownership_lost", "Workflow ownership lost");
    }).catch(cause => lost.abort(workflowOwnershipFailure(cause)));
  }, 10_000);
  let failed = false;
  try {
    await workflowOwnershipNative({ action: "check", ...token, entities: owned.entities });
    return await task(makeRepository(owned), signal);
  } catch (cause) { failed = true; throw cause; }
  finally {
    if (timer !== undefined) clearInterval(timer);
    owned.closed = true;
    lost.abort(new WorkflowAbortError("workflow_settled", "Workflow settled"));
    await renewal;
    try { await workflowOwnershipNative({ action: "release", ...token }); }
    catch (cause) { if (!failed) throw cause; } // Keep the primary operation/ownership failure.
    finally { onOwner(null); }
  }
}
