# Data Lifecycle, Backup, Restore and Exports

Current development schema: **31**, registry **001–031**. The schema-27 public baseline is a separate historical record. Current-epoch migration fixtures preserve ownership through Viewer Learning (024), continuation (025), typed Workspaces (026), factory classification (027), telepathy (028), series leases (029), attachment metadata (030) and review leases (031). Legacy databases are classified before normal load; do not silently force an unverified migration.

## Lifecycle

Supported records use **Active → Archived → Restore or Delete permanently**. Permanent deletion requires preview/explicit controlled purge. Sealed/frozen guards remain active outside that transaction. End is not Archive: ending execution retains the run, checkpoint and history while refusing later execution.

## Backup and restore

Use Settings tools and a personal backup before upgrades. Native validation checks integrity/schema; restore creates a safety backup. Native code manages database lifecycle and sidecars. Backup includes owned persisted continuation/metadata. Review the result on test copies before changing your only real database.

## Exports

Ordinary exports favor readable Markdown; Research retains reproducibility details. Provider continuation payloads, secrets and private reasoning are not ordinary transcript content.

Training export includes accepted sessions and an active interrupted checkpoint/Session, even before the first target completes. summary.md links to checkpoint transcript and learning settlements; JSON details retain exact audit/version/hash/provenance. failed_preserved and NO_CHANGE remain distinct. Unfinished work does not increase completed counts/means. Bounded final-channel learning candidates may be included for offline analysis, without private reasoning.

Telepathic history/export applies role-safe transcript projection and copies only authorized attachments. Opening or exporting history does not call a model. Exports can contain private prompts, targets and Reveals: review them before sharing.
