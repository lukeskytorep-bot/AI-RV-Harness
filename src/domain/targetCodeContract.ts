/** An accidental-corruption check, not a signature against rewriting the record. */
export interface TargetCodeContractCarrier {
  targetCodeContractVersion?: 1;
  targetCodeContract?: { version: 1; canonicalPolicy: string };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** New-record boundaries only; never call to repair or upgrade a resumed record. */
export function captureTargetCodeContract(carrier: TargetCodeContractCarrier, owner: unknown, policy: unknown): void {
  if (carrier.targetCodeContractVersion !== undefined || carrier.targetCodeContract !== undefined) throw new Error("Target-code contract is already frozen.");
  if (policy === undefined || policy === null) throw new Error("Target-code contract requires a frozen policy.");
  carrier.targetCodeContractVersion = 1;
  carrier.targetCodeContract = { version: 1, canonicalPolicy: canonical({ owner, policy }) };
}
export function assertTargetCodeContract(carrier: TargetCodeContractCarrier, owner: unknown, policy: unknown): void {
  if (carrier.targetCodeContractVersion === undefined && carrier.targetCodeContract === undefined) return; // historical record
  if (carrier.targetCodeContractVersion !== 1 || !carrier.targetCodeContract || carrier.targetCodeContract.version !== 1
    || policy === undefined || policy === null || carrier.targetCodeContract.canonicalPolicy !== canonical({ owner, policy })) {
    throw new Error("Invalid frozen target-code policy contract: missing or inconsistent.");
  }
}

/** Checkpoint updates cannot replace a previously frozen contract or policy. */
export function assertUnchangedTargetCodeContract(previous: TargetCodeContractCarrier, next: TargetCodeContractCarrier, previousPolicy: unknown, nextPolicy: unknown): void {
  if (canonical({ version: previous.targetCodeContractVersion, contract: previous.targetCodeContract, policy: previousPolicy }) !==
      canonical({ version: next.targetCodeContractVersion, contract: next.targetCodeContract, policy: nextPolicy })) {
    throw new Error("Frozen target-code policy contract cannot change during a checkpoint.");
  }
}
