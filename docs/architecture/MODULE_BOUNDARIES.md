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
7. `src/storage/sqliteRepository.ts` and `src/storage/browserRepository.ts` remain compatibility facades until repository contract tests protect their split.
8. Code that renders AI-authored Markdown must use the established safe renderer.
9. Reveal and target material must not enter Viewer or Monitor messages before the recorded Reveal boundary.
10. Judge receives only the allowlisted evidence packet; it does not read arbitrary session storage.
11. Viewer Notes updates remain limited to the Training workflow unless a separate product decision changes that rule.
12. Shared helpers must have more than one genuine consumer. `shared` and `utils` are not fallback directories.

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

Example:

```ts
import { HomeScreen } from "./features/home";
import { SettingsScreen } from "./features/settings";
import { ProfilesScreen } from "./features/profiles";
import { TargetsScreen } from "./features/targets";
import { AiCenterScreen } from "./features/aiCenter";
```

Avoid:

```ts
import { HomeResumeCard } from "./features/home/components/HomeResumeCard";
```

Internal files may remain private even if TypeScript technically permits a deep import. New callers must import Home, Settings, Profiles, Targets and AI Center from their module roots, not directly from implementation files. The architecture test enforces these public entry points and keeps their implementations out of `App.tsx` or the shared component directory.

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

UI components initiate these operations and render their state; they do not coordinate multi-step persistence themselves after the relevant use case has been extracted.

## Enforcement introduced in Step 1

`src/architecture/importBoundaries.test.ts` scans production TypeScript and fails if `providerChatAttempt` appears outside `native.ts` or `requestExecutor.ts`. This protects the first established infrastructure boundary without adding a new dependency.

Additional rules will be automated only after real module boundaries exist. This avoids freezing an artificial folder structure before the first extraction has been tested.
