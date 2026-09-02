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

The first active public feature entry point is:

| Module | Public entry point | Owns | Does not own |
| --- | --- | --- | --- |
| Home | `src/features/home/index.ts` | Home rendering and local presentational helpers | navigation state, persistence, provider calls, session execution |

Example:

```ts
import { HomeScreen } from "./features/home";
```

Avoid:

```ts
import { HomeResumeCard } from "./features/home/components/HomeResumeCard";
```

Internal files may remain private even if TypeScript technically permits a deep import. New callers of Home must import from `src/features/home`, not directly from `HomeScreen.tsx`. A later architecture test will enforce this rule for every feature after at least two real feature modules establish a stable pattern.

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
