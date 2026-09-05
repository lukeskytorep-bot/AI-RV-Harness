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
| RV Sessions screen | `src/App.tsx` | Later higher-risk extraction after protecting session transitions and Resume. |
| Training screen and long-run orchestration | `src/features/training/` | Extracted feature; import through `src/features/training/index.ts`. |
| Research screen and builder | `src/features/research/` | Extracted feature; import through `src/features/research/index.ts`. |
| AI Center interface | `src/features/aiCenter/` | Extracted presentation feature; identity and Viewer Notes domain rules remain in `src/aiCenter/`. |
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
| Public repository contract | `src/storage/types.ts` and exports under `src/storage/` | Keep stable while implementations are split internally. |
| Desktop SQLite implementation | `src/storage/sqliteRepository.ts` | Later delegate to domain repositories without changing the public facade. |
| Browser preview implementation | `src/storage/browserRepository.ts` | Preserve the shared contract where behavior is intended to match SQLite. |
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

`JudgeEvaluation` and `BatchEvaluation` have been moved from `App.tsx` into `src/features/judge/`. The interactive feature keeps the existing evaluation engine, model-route recovery, score freezing and add-another-Judge behavior. `JudgeResults` is a genuinely shared presentation component used by the live RV flow and by `SessionInspection`, which is shared by Training and Research. Complete-session Markdown is assembled by `src/exports/sessionDocument.ts`; ordinary RV, Training and Research retain their package/blinding adapters but no longer maintain competing Judge layouts.

The next frontend candidate should be selected between RV Sessions and Monitor. It should remain one protected panel rather than moving both at once.

## Updating this map

Update this file when ownership changes. A moved capability must have one clear current owner and, when shared across modules, a documented public entry point.
