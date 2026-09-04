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
| Workspaces and RV Sessions screens | `src/App.tsx` | Extract one screen at a time into `src/features/`. |
| Conversation and Manual RV message timeline presentation | `src/chat/ChatMessageList.tsx` | Keeps display-only time policy separate from persisted `createdAt`; broader Chat orchestration remains in `App.tsx`. |
| Training screen | `src/components/TrainingScreen.tsx` | Move behind a future `features/training` public entry point. |
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
| AI Judge | `src/judge/engine.ts` | Receives only the sanitized allowlist packet. |
| Viewer Notes | `src/aiCenter/viewerNotes.ts` | Training-only update policy and immutable version history. |
| Training orchestration | `src/training/`, `src/components/TrainingScreen.tsx` | One completed target may trigger at most one Notes version. |

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

The next candidate should be selected separately after reviewing the remaining screen dependencies. Training is more isolated than the large Workspace/RV surface, but it owns long-running execution and Viewer Notes updates, so its extraction should begin with characterization tests. Workspace and RV Sessions remain later, higher-risk steps.

## Updating this map

Update this file when ownership changes. A moved capability must have one clear current owner and, when shared across modules, a documented public entry point.
