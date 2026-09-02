# AI RV Harness code map

**Status:** current private development map for v0.7.13  
**Purpose:** identify the primary owner of each major product capability before code is moved into feature modules.

This document maps responsibilities, not every source file. Historical release records remain under `docs/releases/`.

## Application composition

| Responsibility | Current primary location | Direction |
| --- | --- | --- |
| Application bootstrap, active profile, active Workspace and top-level navigation | `src/App.tsx` | Keep in the future `AppShell`. |
| Home, Profiles, Workspaces, Chat, RV Sessions, Targets and Settings screens | `src/App.tsx` | Extract one screen at a time into `src/features/`. |
| Training screen | `src/components/TrainingScreen.tsx` | Move behind a future `features/training` public entry point. |
| Research screen and builder | `src/research/`, `src/components/ResearchBuilder.tsx` | Consolidate behind `features/research`. |
| AI Center interface | `src/components/AiCenterScreen.tsx`, `src/aiCenter/` | Preserve identity and Viewer Notes boundaries when modularized. |
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

## First extraction candidate

The first frontend extraction is `HomeScreen` from `src/App.tsx` into `src/features/home/`. Home is read-only, callback-driven and does not own provider calls, persistence transactions or session state. It is therefore the safest module for establishing the extraction pattern.

## Updating this map

Update this file when ownership changes. A moved capability must have one clear current owner and, when shared across modules, a documented public entry point.
