# AI RV Harness code map

**Status:** current private development map for v0.7.13  
**Purpose:** identify the primary owner of each major product capability before code is moved into feature modules.

This document maps responsibilities, not every source file. Historical release records remain under `docs/releases/`.

## Application composition

| Responsibility | Current primary location | Direction |
| --- | --- | --- |
| Application bootstrap, active profile, active Workspace and top-level navigation | `src/App.tsx` | Keep in the future `AppShell`. |
| Home screen | `src/features/home/` | First extracted feature; keep its public import through `src/features/home/index.ts`. |
| Settings screen | `src/features/settings/` | Extracted feature; import through `src/features/settings/index.ts`. |
| Profiles screen and profile-specific forms | `src/features/profiles/` | Extracted feature; import through `src/features/profiles/index.ts`. |
| Targets screen, dialogs and target-library operations | `src/features/targets/` | Extracted feature; import through `src/features/targets/index.ts`. |
| Workspace directory, switching and lifecycle presentation | `src/features/workspaces/` | Extracted feature; import through `src/features/workspaces/index.ts`. |
| Conversation and Manual RV orchestration | `src/features/conversations/` | Extracted feature; import through `src/features/conversations/index.ts`; message rendering and chat use cases remain in `src/chat/`. |
| RV Sessions screen and UI orchestration | `src/features/rvSessions/` | Extracted feature; import through `src/features/rvSessions/index.ts`; protocol controllers and protected transition rules remain in `src/sessions/`. |
| Training screen and long-run orchestration | `src/features/training/` | Extracted feature; import through `src/features/training/index.ts`. |
| Research screen and builder | `src/features/research/` | Extracted feature; import through `src/features/research/index.ts`. |
| AI Center interface | `src/features/aiCenter/` | Extracted presentation feature; identity and Viewer Notes domain rules remain in `src/aiCenter/`. |
| AI Monitor history, prompt editor and export UI | `src/features/monitor/` | Extracted feature; decisions and intervention rules remain in `src/monitor/`. |
| Shared safe rendering | `src/components/SafeMarkdown.tsx` | Shared UI infrastructure; must remain the path for AI-authored Markdown. |

## AI execution and protected workflows

| Capability | Primary owner | Important boundary |
| --- | --- | --- |
| One physical provider request | `src/providers/native.ts` and `src-tauri/src/providers.rs` | Domain code must not call it directly. |
| Transport retry and attempt accounting | `src/providers/requestExecutor.ts` | The only transport-retry owner. |
| Error classification and retry policy | `src/providers/providerError.ts`, `src/providers/retry.ts` | Must not absorb output or domain recovery. |
| Output-length recovery | `src/providers/outputRecovery.ts` | A new logical request, separate from transport retry. |
| Full RCP automatic execution | `src/sessions/controller.ts` | Protect protocol order, sealed evidence, Reveal and Resume. |
| RV Lite execution | `src/sessions/rvLiteController.ts` | Protect the four-call protocol contract. |
| Telepathic execution | `src/sessions/telepathicController.ts` | Protect protocol steps, questions, Reveal and Resume. |
| Custom protocol execution | `src/sessions/customController.ts` | Execute the captured immutable protocol version. |
| Post-Reveal reviews | `src/sessions/postReveal.ts` | Viewer review precedes Monitor review; not blind evidence. |
| AI Monitor decisions | `src/monitor/engine.ts` | Monitor never rewrites Viewer evidence. |
| AI Monitor workflow UI | `src/features/monitor/` | History, prompt editing, intervention presentation and export initiation through the public entry point. |
| AI Judge execution | `src/judge/engine.ts` | Receives only the sanitized allowlist packet and freezes scores without UI ownership. |
| AI Judge workflow UI | `src/features/judge/` | Extracted feature; owns single-session and batch evaluation controls through `src/features/judge/index.ts`. |
| Shared AI Judge result presentation | `src/components/JudgeResults.tsx` | Canonical complete score presentation used by live RV and stored-session inspection in Training/Research. |
| Complete session and Judge Markdown | `src/exports/sessionDocument.ts` | Canonical section order and complete frozen-score rendering used by RV Session, Training and Research exporters. |
| Read-only AI Judge prompt resource | `src/judge/prompt.ts`, exposed through `src/resources/systemPrompts.ts` | About & Protocols displays and saves the exact runtime PL/EN prompt rather than a copied UI string. |
| Viewer Notes | `src/aiCenter/viewerNotes.ts` | Training-only update policy and immutable version history. |
| Training orchestration | `src/features/training/trainingExecution.ts`, `src/training/` | Durable checkpoints select the first unfinished target; one completed target may trigger at most one Notes reflection. |

## Data and infrastructure

| Capability | Current primary location | Direction |
| --- | --- | --- |
| Public repository contract | `src/storage/repository.ts` and exports under `src/storage/` | Stable `AppRepository` facade; callers do not import domain implementations. |
| Profiles persistence contract | `src/storage/contracts/profilesRepository.ts` | Shared internal contract for Profile-only reads and writes. Archive/restore remain facade-owned because they also change Workspaces. |
| Targets persistence contract | `src/storage/contracts/targetsRepository.ts` | Shared internal contract for target listing, user CRUD and usage records. Cross-domain mutation guards remain explicit. |
| Settings and model-registry persistence contract | `src/storage/contracts/settingsModelsRepository.ts` | Shared internal contract for application settings, provider metadata and cached model registry. Native secrets remain outside repository storage. |
| Workspaces and Conversations persistence contract | `src/storage/contracts/workspacesConversationsRepository.ts` | Shared internal contract for Workspace lifecycle, Thread groups, Conversation/Manual RV records and messages. Workspace Sources remain outside this focused split. |
| RV Sessions persistence contract | `src/storage/contracts/sessionsRepository.ts` | Shared internal contract for RV session records, events, immutable snapshots, sealed evidence, Reveal, post-Reveal transcript and target clarifications. Monitor/Judge/Research persistence remains outside this focused split; Research frozen-score checks are injected explicitly at the facade boundary. |
| Desktop SQLite implementation | `src/storage/sqliteRepository.ts`, delegating under `src/storage/sqlite/` | Continue one domain at a time without changing the facade or schema. Provider/credential metadata and Profile-reference cleanup remain one explicit transaction. |
| Browser preview implementation | `src/storage/browserRepository.ts`, delegating under `src/storage/browser/` | Preserve contracts and local-storage keys; the facade supplies explicit cross-domain callbacks where required. |
| Database migrations and native transactions | `src-tauri/src/database.rs` and storage migration code | Keep ordered, atomic and backwards compatible. |
| Credentials | native credential commands and provider configuration modules | Secrets must never enter SQLite, exports or UI diagnostics. |
| Human-readable and research exports | `src/exports/`, `src/artifacts/` | Preserve evidence-domain separation and existing formats. |
| Sources and attachments | `src/sources/`, `src/attachments/` | Never leak Reveal or target material into blind messages. |
| PL/EN text | `src/i18n.ts`, versioned resources under `src/resources/` | Split later by domain; do not change wording during structural extraction. |

## Frontend extractions completed

`HomeScreen` has been moved from `src/App.tsx` into `src/features/home/`. The module owns its presentational components, accepts data and callbacks through `HomeScreenProps`, and does not own navigation, provider calls, persistence transactions or session state. Regression tests cover empty and populated rendering plus callback delegation.

`SettingsScreen` has been moved into `src/features/settings/` together with its private settings cards and dialogs. It owns tab selection and settings-specific UI state, while `App.tsx` continues to own the canonical `AppSettings` state and passes updates through `SettingsScreenProps.onChange`. The reusable read-only protocol dialog now lives in `src/components/ProtocolDialog.tsx`, because RV Sessions and Settings both use it.

`ProfilesScreen` has been moved into `src/features/profiles/` together with profile creation and editing dialogs, Viewer-default controls, calibration-history rendering and the ordered persistence operations for edit/archive. `App.tsx` continues to own the canonical profile list, top-level navigation, first-run flow and repository initialization. Shared page/dialog primitives live under `src/components/`, while reasoning capability labels live under `src/providers/`.

`TargetsScreen` has been moved into `src/features/targets/` together with its create/edit dialogs, pure grouping and lock-state view model, and repository-backed target-library operations. `App.tsx` retains top-level navigation and passes only settings plus the repository contract. The existing target domain service remains the owner of normalization, hashing and protocol eligibility, while the feature coordinates UI-specific loading and persistence.

`AiCenterScreen` has been moved into `src/features/aiCenter/` behind a public entry point. The feature owns AI Center navigation, profile-scoped presentation, Viewer Notes capacity/restore controls and read-only history rendering. Viewer identity, versioning and Training-only update policy remain owned by `src/aiCenter/` and the repository contract; `App.tsx` still composes the Workspace-specific Monitor panel.

`ResearchScreen` and its builder have been moved into `src/features/research/` behind a public entry point. The feature owns Research configuration, preflight/lock presentation, project execution controls, scoring/unblinding presentation and package-export coordination. Research planning, target sampling, study controls, execution, persistence contracts and export construction remain in their existing domain/application modules under `src/research/`, `src/storage/` and `src/exports/`.

`TrainingScreen` and its long-running execution use case have been moved into `src/features/training/` behind a public entry point. The screen owns Training configuration and presentation. `trainingExecution.ts` owns target sequencing, durable per-target checkpoints, Resume from the first unfinished target, pause/cancellation propagation, post-Reveal review, optional judging and the Training-only Viewer Notes reflection trigger. Curriculum and export formats remain in `src/training/`; session, Judge and Viewer Notes domain rules remain with their existing owners.

`WorkspacesScreen`, its filtered directory, switcher dialog and ordered rename/archive operations have been moved into `src/features/workspaces/`. `ChatPanel` has been moved into `src/features/conversations/` together with Conversation and Manual RV UI orchestration. Existing chat engines, persistence contracts, source handling, provider execution and export builders retain their previous ownership. `App.tsx` composes both public feature entry points and retains top-level navigation plus the Workspace shell that selects Chat or RV Session.

`JudgeEvaluation` and `BatchEvaluation` have been moved from `App.tsx` into `src/features/judge/`. The interactive feature keeps the existing evaluation engine, model-route recovery, score freezing and add-another-Judge behavior. `JudgeResults` is a genuinely shared presentation component used by the live RV flow, expanded batch results and by `SessionInspection`, which is shared by Training and Research. Complete-session Markdown is assembled by `src/exports/sessionDocument.ts`; ordinary RV, Training and Research retain their package/blinding adapters but no longer maintain competing Judge layouts.

`MonitorPanel` has been moved from `App.tsx` into `src/features/monitor/` behind a public entry point. The feature owns Monitor history, prompt editing, saved-run inspection and export initiation. Monitor decisions, prompts, persistence, blinding rules and provider execution keep their existing owners.

`RvSessionPanel` and its private Custom Protocol dialog have been moved from `App.tsx` into `src/features/rvSessions/` behind a public entry point. The feature owns session configuration, live progress, Reveal/Post-Reveal presentation, recovery controls, recent-session presentation and orchestration of the established use cases. Full RCP, RV Lite, Custom and Telepathic controllers, Monitor/Judge engines, persistence, exports, target rules and provider transport retain their existing owners. `App.tsx` now remains the Workspace shell and supplies only the active Profile, Workspace, settings and repository contract.

The first Etap 5 persistence split keeps `AppRepository`, the SQLite schema and browser storage keys unchanged. Profile-only CRUD and configuration calls delegate to matching browser and SQLite implementations through `ProfilesRepository`. Profile archive/restore deliberately remain in the compatibility facades because each operation atomically changes both the Profile and its active Workspaces. A shared contract suite runs against both internal adapters.

The second Etap 5 split delegates target listing, user-target CRUD and usage persistence through `TargetsRepository`. Browser storage receives its cross-domain used-target check from the compatibility facade; SQLite keeps the existing target-integrity triggers. No target record, storage key, query result or public caller contract changes.

The third Etap 5 split delegates application settings, provider-connection metadata and the cached model registry through `SettingsModelsRepository`. Browser preview retains its established inability to create or rotate credentials. SQLite keeps provider creation, credential-metadata updates, model replacement and provider deletion transactional; deletion still clears matching Profile defaults in the same transaction. Actual API secrets remain owned by native credential commands and never enter this repository contract.

The fourth Etap 5 split delegates Workspace lifecycle plus the existing Thread group, Conversation/Manual RV and message persistence through `WorkspacesConversationsRepository`. The stable facade, SQLite schema, local-storage keys, lazy browser migration of legacy ungrouped conversations, archive timestamp coupling and restore guards remain unchanged. Workspace Sources are deliberately excluded because they form a separate persistence surface. The later UX plan may remove `ChatThreadGroup` as a product level, but this structural split preserves it exactly.

The fifth Etap 5 split delegates the RV Session persistence surface through `SessionsRepository`: session creation/state, ordered events, pre-Reveal transcript, immutable snapshot, sealing, atomic Reveal, sealed-evidence reads, post-Reveal transcript, session listing and target clarifications. Browser storage keeps its existing explicit Research frozen-score guards; SQLite continues to rely on the existing database triggers for atomic Reveal, target-clarification protection and append-only post-Reveal enforcement, while the facade supplies the Research-score lookup used by the preflight check. Monitor, Judge, Research project persistence and custom protocols remain outside this focused split. No schema, migration, storage-key or serialized-record change is introduced.

The sixth Etap 5 split delegates Training-run persistence through `TrainingRepository`: run creation and numbering, durable run updates, per-target checkpoints, frozen execution snapshots, ordered session-id linkage, error accumulation and run listing. The execution workflow remains owned by `src/features/training/trainingExecution.ts`; RV Sessions, Judge results and Viewer Notes persistence remain with their existing repositories. The existing `training_runs` table continues to store the canonical `TrainingRunRecord` in `record_json` with mirrored `status` and `run_number` columns. No schema, migration, browser key or serialized-record change is introduced.

## Updating this map

Update this file when ownership changes. A moved capability must have one clear current owner and, when shared across modules, a documented public entry point.
