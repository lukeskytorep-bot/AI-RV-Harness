const verifiers=new WeakMap<AbortSignal,()=>Promise<void>>();
export function registerAbortOwnership(signal:AbortSignal,verify:()=>Promise<void>):void { verifiers.set(signal,verify); }
export function inheritAbortOwnership(signal:AbortSignal,...parents:Array<AbortSignal|undefined>):void {
 const checks=parents.flatMap(parent=>parent&&verifiers.has(parent)?[verifiers.get(parent)!]:[]);
 if(checks.length)registerAbortOwnership(signal,async()=>{for(const check of checks)await check();});
}
export async function assertAbortOwnership(signal?:AbortSignal):Promise<void> {signal?.throwIfAborted();if(signal)await verifiers.get(signal)?.();signal?.throwIfAborted();}
