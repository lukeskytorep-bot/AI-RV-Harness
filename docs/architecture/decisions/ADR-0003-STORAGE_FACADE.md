# ADR-0003: Preserve a stable storage facade while extracting domain repositories

**Status:** Accepted  
**Date:** 6 September 2026  
**Updated:** 8 September 2026 — Workspaces and Conversations extraction

## Context

`AppRepository` is used throughout the application and has two implementations: SQLite in the Tauri desktop runtime and local storage in the browser preview. Replacing that public contract or changing the database schema during structural modularization would unnecessarily risk stored user data.

Some repository operations belong to one domain, while others deliberately cross boundaries. In particular, archiving or restoring a Profile also archives or restores the Workspaces that were changed in the same lifecycle operation. SQLite performs that work in one transaction and the browser implementation couples records by an exact archive timestamp.

## Decision

`src/storage/repository.ts` remains the stable public `AppRepository` facade. Callers continue to receive `AppRepository`; they do not construct or import internal domain repositories.

Internal persistence is extracted one small domain at a time behind contracts in `src/storage/contracts/`. Each extracted contract has matching implementations under `src/storage/browser/` and `src/storage/sqlite/`, and a shared contract suite covers behavior intended to match.

The first extraction is Profiles. Profile-only listing, creation, editing and configuration writes delegate to `ProfilesRepository`. `archiveProfile` and `restoreProfile` remain explicit facade operations for now because they also change Workspaces. This avoids hiding a cross-domain mutation inside the Profile-only repository.

The second extraction is Targets. Listing, user-target CRUD and target-usage persistence delegate to `TargetsRepository`. In browser storage the compatibility facade supplies the predicate that checks usage recorded by target usage, RV Sessions and Research assignments. In SQLite, the existing database triggers remain the authority preventing mutation of factory or already-used targets. This keeps cross-domain knowledge visible without changing schema or behavior.

The third extraction is Settings and model configuration. Application settings, provider-connection metadata and cached models delegate to `SettingsModelsRepository`. The browser implementation keeps credential creation and rotation unavailable and receives an explicit facade callback to clear Profile defaults when a provider is removed. The SQLite implementation preserves the existing atomic transactions for provider plus credential metadata, model replacement, and provider deletion together with Profile-reference cleanup. Native credential secrets remain outside this contract.

The fourth extraction is Workspaces and Conversations. Workspace lifecycle, Thread-group lifecycle, Conversation/Manual RV records and messages delegate together to `WorkspacesConversationsRepository`, because their archive/restore guards and timestamp coupling form one existing consistency boundary. The public facade, schema, browser storage keys and historical lazy migration remain unchanged. Workspace Sources are not part of this extraction. The planned removal of the `ChatThreadGroup` product layer is a later data/UX migration and must not be mixed into this structural move.

No schema, migration, table, local-storage key or serialized record format changes as part of this decision.

## Alternatives considered

### Replace `AppRepository` with many repositories in every caller

Rejected for this stage because it would turn an internal persistence refactor into a broad application rewrite and increase regression risk.

### Move Profile archive/restore into `ProfilesRepository`

Rejected because the methods also mutate Workspaces. Doing so would conceal a cross-domain transaction behind a domain-specific name.

### Change the schema while moving code

Rejected because file organization does not require a data migration. Schema changes need their own rationale, compatibility fixtures and rollback analysis.

## Consequences

Positive consequences:

- application callers and existing data remain compatible;
- browser and SQLite implementations can be compared with the same contract tests;
- domain persistence becomes smaller and easier to review;
- cross-domain transactions remain visible.

Costs and constraints:

- the compatibility facades temporarily retain cross-domain methods;
- both facade and domain files coexist during Etap 5;
- every next extraction must add or extend contract tests before delegation;
- moving transaction ownership later requires a named transaction unit, not an implicit domain side effect.
