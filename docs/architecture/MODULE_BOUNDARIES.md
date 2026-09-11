# AI RV Harness module boundaries

**Status:** initial enforceable boundaries for private v0.7.13  
**Architecture:** modular monolith

## Dependency direction

The intended dependency direction is:

```text
features / UI
      ↓
application use cases
      ↓
domain rules and types

infrastructure implements ports required by application.
domain does not import infrastructure.
```

The repository remains one application and one release process. Folder boundaries are used to control responsibility, not to create microservices.

## Initial module rules

1. `src/providers/native.ts` owns one physical provider attempt. Only `src/providers/requestExecutor.ts` may call `providerChatAttempt`.
2. All production inference paths call the central provider executor, directly or through a documented application service.
3. Session controllers may request transport execution but may not implement their own transport retry loop.
4. Output recovery, Judge JSON repair and Viewer Notes capacity recovery are separate logical operations. They must not be classified as transport retry.
5. `src/domain/` must not import React, Tauri APIs, SQLite implementations or provider transport.
6. A feature module may import its public application/domain contracts and shared UI. It must not reach into another feature's internal files.
7. `src/storage/sqliteRepository.ts` and `src/storage/browserRepository.ts` remain compatibility facades. Extracted domain repositories implement contracts under `src/storage/contracts/` and are protected by shared contract tests.
8. Code that renders AI-authored Markdown must use the established safe renderer.
9. Reveal and target material must not enter Viewer or Monitor messages before the recorded Reveal boundary.
10. Judge receives only the allowlisted evidence packet; it does not read arbitrary session storage.
11. Viewer Notes updates remain limited to the Training workflow unless a separate product decision changes that rule.
12. Shared helpers must have more than one genuine consumer. `shared` and `utils` are not fallback directories.
13. Current Viewer/Monitor/Judge route selection must use `src/modelRoutes.ts` for route keys and Profile/credential scoping; role/model UI that stores route keys uses the shared `ModelRouteSelect`. Historical persisted routes may still be resolved against their frozen snapshot/inventory for replay and display.
14. Product-level creation of a new Profile must use `src/application/profileWorkspace.ts` so the initial Workspace is created in the same application use case and a failed second write cannot leave an active Profile without a Workspace. Direct repository `createProfile()` remains an infrastructure primitive, not a feature-level workflow.
15. `archiveWorkspace()` must preserve at least one active Workspace for an active Profile. This invariant is enforced in Browser/SQLite persistence, not only by button state.
16. Product feature modules must request Confirm/TextInput/Information/Destructive interactions through `useAppDialogs` from `src/components/AppDialogProvider.tsx`. Direct `window.confirm`, `window.prompt` and `window.alert` are forbidden outside the shared provider fallback.
17. Native provider commands in `src-tauri/src/providers.rs` are a facade only. Request construction belongs to `src-tauri/src/providers/request_builders.rs`, response interpretation to `response_parsers.rs`, reasoning extraction/normalization to `reasoning.rs`, provider family/base URL/authentication routing to `adapters.rs`, shared error mapping to `errors.rs`, request validation to `validation.rs`, and the one physical HTTP attempt plus cancellation registry to `transport.rs`. Rust must not add its own transport retry loop.

## Native Rust provider modules after Etap 6

Etap 6 keeps the existing Tauri command names and TypeScript retry ownership while splitting the former monolithic `src-tauri/src/providers.rs` implementation into focused native modules:

| Native module | Owns | Must not own |
| --- | --- | --- |
| `src-tauri/src/providers.rs` | public Tauri command facade, request/response DTOs, debug-payload redaction coordination | provider-specific wire-format implementations, retry loops |
| `src-tauri/src/providers/adapters.rs` | provider family classification, fixed/custom base URL validation, authentication headers, OpenRouter attribution headers | request payload construction, response parsing |
| `src-tauri/src/providers/request_builders.rs` | OpenAI-compatible, Google and Anthropic request payloads/endpoints | HTTP dispatch, response interpretation |
| `src-tauri/src/providers/response_parsers.rs` | normalized `ProviderChatResponse` construction and provider response payload interpretation | HTTP transport, retry policy |
| `src-tauri/src/providers/reasoning.rs` | native/tagged reasoning extraction and final-content normalization | provider authentication, HTTP dispatch |
| `src-tauri/src/providers/errors.rs` | request error classification, safe/redacted HTTP error text and structured provider error metadata | response success parsing, retry policy |
| `src-tauri/src/providers/validation.rs` | request-id and chat-input validation | HTTP dispatch, provider response parsing |
| `src-tauri/src/providers/transport.rs` | shared reqwest client, one physical send, body/HTTP error handling and cancellation registry | transport retry/backoff, provider-specific request/response formats |

Google and Anthropic remain explicit special wire-format families. OpenRouter, OpenAI, ZAI, DeepSeek, Mistral, Blackbox and Custom OpenAI share the OpenAI-compatible family instead of duplicating near-identical adapter modules. This is intentional: the architectural boundary follows protocol differences rather than brand count.

`src/providerRustModuleBoundary.test.ts` protects the split structurally. Existing native provider contract tests remain in `src-tauri/src/providers/tests.rs` and continue to verify request payloads, parsing, reasoning separation, error redaction, OpenRouter attribution and local simulator behavior.

## Public entry points

New feature modules should expose a small `index.ts`. Callers import from the module root rather than from internal component or controller paths.

The active public feature entry points are:

| Module | Public entry point | Owns | Does not own |
| --- | --- | --- | --- |
| Home | `src/features/home/index.ts` | Home rendering and local presentational helpers | navigation state, persistence, provider calls, session execution |
| Settings | `src/features/settings/index.ts` | Settings tabs, settings-specific cards, local dialogs and repository-backed maintenance UI | canonical application settings state, top-level navigation, provider transport, session execution |
| Profiles | `src/features/profiles/index.ts` | Profiles rendering, profile forms, Viewer-default controls, calibration-history presentation and ordered profile edit/archive operations | canonical profile list, top-level navigation, repository construction, Workspace lifecycle, first-run orchestration |
| Targets | `src/features/targets/index.ts` | Targets rendering, target forms, grouping and lock-state presentation, and ordered user-target operations | top-level navigation, repository implementation, target domain hashing, session target selection, protocol execution |
| AI Center | `src/features/aiCenter/index.ts` | AI Center tabs, profile-scoped presentation, Viewer Notes capacity/restore controls and history rendering | top-level navigation, Monitor execution, Viewer identity rules, Viewer Notes reflection/update policy, repository implementation |
| Research | `src/features/research/index.ts` | Research screen, configuration builder, project controls, scoring/unblinding presentation and export initiation | top-level navigation, research methodology, experiment planning/execution rules, repository implementation, provider transport |
| Training | `src/features/training/index.ts` | Training screen, long-run sequencing, durable checkpoint/Resume coordination, pause/cancellation propagation and orchestration of post-Reveal review, optional Judge and Viewer Notes reflection | top-level navigation, curriculum definitions, session protocol implementation, Judge rules, Viewer Notes versioning, repository implementation, provider transport |
| Workspaces | `src/features/workspaces/index.ts` | Workspace directory, search/filter presentation, switcher dialog and ordered rename/archive coordination | top-level navigation, repository implementation, Profile lifecycle, RV Session execution |
| Conversations | `src/features/conversations/index.ts` | Conversation and Manual RV screen state, thread/group/source coordination, model selection, retry UI and export initiation | provider transport, repository implementation, chat message construction rules, persistence schema, top-level Workspace navigation |
| Judge | `src/features/judge/index.ts` | single-session and ordinary-batch Judge configuration, execution state, stored-score recovery and evaluation presentation | Judge prompt/rubric, evidence-packet construction, score persistence implementation, provider transport, top-level RV Session navigation |
| Monitor | `src/features/monitor/index.ts` | Monitor history, editable prompt presentation, intervention timeline and export initiation | Monitor decision engine, prompt construction rules, repository implementation, provider transport, RV Session execution |
| RV Sessions | `src/features/rvSessions/index.ts` | session configuration and progress UI, Reveal/Post-Reveal presentation, recovery controls, recent-session presentation and orchestration of existing session use cases | protocol state machines, Reveal invariants, Monitor/Judge engines, repository implementation, export formats, target rules, provider transport, top-level Workspace navigation |

Example:

```ts
import { HomeScreen } from "./features/home";
import { SettingsScreen } from "./features/settings";
import { ProfilesScreen } from "./features/profiles";
import { TargetsScreen } from "./features/targets";
import { AiCenterScreen } from "./features/aiCenter";
import { ResearchScreen } from "./features/research";
import { TrainingScreen } from "./features/training";
import { WorkspacesScreen, WorkspaceSwitcherDialog } from "./features/workspaces";
import { ChatPanel } from "./features/conversations";
import { BatchEvaluation, JudgeEvaluation } from "./features/judge";
import { MonitorPanel } from "./features/monitor";
import { RvSessionPanel } from "./features/rvSessions";
```

Avoid:

```ts
import { HomeResumeCard } from "./features/home/components/HomeResumeCard";
```

Internal files may remain private even if TypeScript technically permits a deep import. New callers must import Home, Settings, Profiles, Targets, AI Center, Research, Training, Workspaces, Conversations, Judge, Monitor and RV Sessions from their module roots, not directly from implementation files. The architecture test enforces these public entry points and keeps their implementations out of `App.tsx`.

`src/components/JudgeResults.tsx` is intentionally shared because it has two independent presentation contexts: the live RV evaluation and stored-session inspection used by Training and Research. `src/exports/sessionDocument.ts` is the sole owner of the readable complete-session section order and Judge Markdown. Domain exporters may choose package paths and safe metadata, but must not recreate the Judge narrative layout.

`src/components/ModelRouteSelect.tsx` is intentionally shared across Profile setup/edit, RV Sessions, Training, Research and Judge evaluation. It delegates route identity, sorting and credential scope to `src/modelRoutes.ts`. Feature modules may still keep role-specific controls such as reasoning/temperature, but they must not rebuild route keys or expose models from a credential outside the active Profile.

`src/application/profileWorkspace.ts` is an intentional cross-domain application use case. It coordinates the existing Profile and Workspace repository operations without merging their persistence contracts. Normal creation produces one `Workspace 1`; if Workspace creation fails after the Profile write, the Profile is archived as a safe-recovery record. Existing Profiles are not backfilled by this use case.

`src/components/AppDialogProvider.tsx` is intentionally shared application UI infrastructure. One provider is mounted around `App` in `src/main.tsx`; feature modules call `useAppDialogs()` rather than browser-native dialogs. The surface supports normal/warning/destructive severity, text input, exact confirmation phrases, queued requests, async busy/error state and information-only messages. `src/appDialogBoundary.test.ts` prevents direct native dialog calls from returning to production feature code.

## Cross-domain operations

An operation spanning several domains must have one explicit application-level owner:

| Operation | Required owner |
| --- | --- |
| Start or resume an RV session | session execution use case |
| Seal blind evidence and record Reveal | session transition use case |
| Run Judge group | judging use case |
| Complete a Training target and reflect Viewer Notes | training execution use case |
| Archive or restore a Workspace | workspace management use case |
| Export a complete Research record | research export use case |
| Archive or restore a Profile together with its Workspaces | compatibility facade until a dedicated cross-domain transaction unit is extracted |

UI components initiate these operations and render their state; they do not coordinate multi-step persistence themselves after the relevant use case has been extracted.

## Internal persistence modules

The controlled Etap 5 split keeps the public `AppRepository` contract unchanged:

| Contract | Browser implementation | SQLite implementation | Explicit facade responsibility |
| --- | --- | --- | --- |
| `src/storage/contracts/profilesRepository.ts` | `src/storage/browser/profilesRepository.ts` | `src/storage/sqlite/profilesRepository.ts` | Profile archive/restore remains in both facades because it also archives/restores matching Workspaces. |
| `src/storage/contracts/targetsRepository.ts` | `src/storage/browser/targetsRepository.ts` | `src/storage/sqlite/targetsRepository.ts` | The browser facade owns the cross-domain used-target predicate; SQLite preserves the existing mutation-guard triggers. |
| `src/storage/contracts/settingsModelsRepository.ts` | `src/storage/browser/settingsModelsRepository.ts` | `src/storage/sqlite/settingsModelsRepository.ts` | Browser Profile-reference cleanup is an explicit facade callback. SQLite owns the existing atomic provider/credential/Profile cleanup transaction. Native credential secrets remain outside repository storage. |
| `src/storage/contracts/workspacesConversationsRepository.ts` | `src/storage/browser/workspacesConversationsRepository.ts` | `src/storage/sqlite/workspacesConversationsRepository.ts` | Workspace → Conversation/Manual RV is the active product hierarchy. Legacy group identifiers remain readable for old records, but group lifecycle is not exposed and new records use no group parent. Workspace Sources remain facade-owned for a later focused split. |
| `src/storage/contracts/sessionsRepository.ts` | `src/storage/browser/sessionsRepository.ts` | `src/storage/sqlite/sessionsRepository.ts` | RV Session records, ordered events, sealed evidence, immutable snapshots, Reveal, post-Reveal transcript, target clarifications and bounded recent-session reads delegate here. Research frozen-score knowledge is supplied explicitly by `ResearchRepository`; active Workspace scope for the Home recent query is supplied by the compatibility facade rather than hard-coded into Sessions storage. |
| `src/storage/contracts/trainingRepository.ts` | `src/storage/browser/trainingRepository.ts` | `src/storage/sqlite/trainingRepository.ts` | Training run creation, numbering, checkpoints, execution snapshots, session-id linkage, error accumulation and listing delegate here. Training execution, Sessions, Judge and Viewer Notes persistence remain separate owners. |
| `src/storage/contracts/aiCenterRepository.ts` | `src/storage/browser/aiCenterRepository.ts` | `src/storage/sqlite/aiCenterRepository.ts` | AI identities and Viewer Notes persistence delegate here. SQLite preserves the append-only/stale-base guards and atomic reflection commit; Monitor/Judge/Research remain separate contracts. |
| `src/storage/contracts/monitorRepository.ts` | `src/storage/browser/monitorRepository.ts` | `src/storage/sqlite/monitorRepository.ts` | Monitor runs and ordered interventions delegate here. Browser receives `listRvSessions` explicitly for Workspace/session-code mapping; SQLite preserves the existing join to `rv_sessions`. |
| `src/storage/contracts/judgeRepository.ts` | `src/storage/browser/judgeRepository.ts` | `src/storage/sqlite/judgeRepository.ts` | Frozen Judge runs and scores delegate here. Browser preserves duplicate-index guards; SQLite preserves one transaction for batched run+score inserts and migration-003 immutability. |
| `src/storage/contracts/researchRepository.ts` | `src/storage/browser/researchRepository.ts` | `src/storage/sqlite/researchRepository.ts` | Research projects, lock plans, conditions, assignments, Blinding Key mappings, state transitions and immutable results delegate here. Sessions/Targets receive only explicit helper queries for frozen scores and target usage. |
| `src/storage/contracts/exportRepository.ts` | `src/storage/browser/exportRepository.ts` | `src/storage/sqlite/exportRepository.ts` | Cross-domain export audit records delegate here so Training/Session/Monitor/Research exports do not become hidden Research writes. |

SECURITY-IPC-1C-R1 narrows the desktop SQLite trust boundary without changing the repository facade or schema. The main WebView has no `sql:default`, `sql:allow-select` or `sql:allow-execute`, and production code does not call plugin-SQL `select` or `execute`; the plugin retains only `load`/`close` for database lifecycle and migrations. Repository reads cross a dedicated native `database_select_readonly` command that opens a fresh SQLite connection with `read_only(true)` plus `PRAGMA query_only = ON`. Repository writes are resolved to a finite operation identifier in `src/storage/databaseWriteOperations.ts`; only that identifier and bound values cross IPC, while executable write SQL is fixed in the Rust `DatabaseWriteOperation` registry. Multi-statement writes use the same closed registry. Database snapshotting and controlled purge are separate native commands; controlled purge opens and closes `controlled_purge_context` inside one Rust transaction. Arbitrary SELECT/WITH text remains a documented confidentiality/read surface, but the connection-level read-only guard prevents it from becoming a write bypass.

The numbered Etap 5 domain split is complete after Judge/Research/Export extraction. Auxiliary Workspace Sources, chat-source activation and Custom Protocol version persistence intentionally remain compatibility-facade owned because they were not part of the eight numbered domain slices.

Domain repositories must not silently mutate another storage area. Cross-domain effects are injected or documented as explicit transactions. A later extraction may move Profile lifecycle or provider deletion into named cross-domain transaction units, but it must preserve the exact timestamp-coupling and atomic SQLite transactions already used by the facades.

## Enforcement introduced in Step 1

`src/architecture/importBoundaries.test.ts` scans production TypeScript and fails if `providerChatAttempt` appears outside `native.ts` or `requestExecutor.ts`. This protects the first established infrastructure boundary without adding a new dependency.

Additional rules will be automated only after real module boundaries exist. This avoids freezing an artificial folder structure before the first extraction has been tested.

### Post-Etap-5 bounded recent-session read

`AppRepository.listRecentRvSessions(limit)` is an intentional post-Etap-5 API extension for Home. The broad compatibility facade remains the cross-domain coordinator: it obtains the current active Workspace order from `WorkspacesConversationsRepository` and passes only the Workspace IDs plus the requested limit to `SessionsRepository`. This keeps archived-Workspace knowledge out of Sessions persistence while eliminating the previous N-per-Workspace session reads in `App.tsx`. Workspace-local screens and exporters continue to use `listRvSessions(workspaceId)`.

### Post-Etap-5 model-route and credential boundary

`src/modelRoutes.ts` is the canonical owner of `providerConfigId::modelId` construction/parsing and of the current Profile/credential scope for role models. `ModelRouteSelect` is the shared route-key selector. New/current role selection is intentionally narrower than historical replay: a stale or foreign route is rejected for a current Profile, while an already stored Training/Session/Research/Judge snapshot keeps its exact route for history, display and safe Resume where the workflow requires the original frozen configuration.

`src/modelRouteBoundary.test.ts` protects this boundary by rejecting local route-key builders in the migrated feature modules and by requiring the shared selector in every route-key role UI covered by UX-DATA-2.

### PERF-UI-1 route loading boundary

The application shell owns when top-level feature code is loaded. `Home`, `Profiles`, `Workspaces`, `Training`, `Targets`, Conversations and RV Sessions remain eager because they are core or frequent navigation paths. `Research`, `Settings` and the composed `AI Center` route are loaded through `React.lazy` from their public feature entry points.

The lazy boundary is a performance boundary only. It must not own feature state, persistence, provider calls or session logic. One shared `Suspense` fallback is rendered inside the content pane so Sidebar and TopBar remain mounted. A route-level error boundary converts a failed dynamic import into a visible recoverable state instead of a blank content area. No prefetch policy is introduced in PERF-UI-1.

`src/features/aiCenter/AiCenterRoute.tsx` is a thin composition surface used to keep the existing AI Center + Monitor relationship inside the deferred route. It imports Monitor only through `src/features/monitor/index.ts`; AI Center domain and persistence ownership remain unchanged.
