# Developer Guide

Reviewed 16 October 2026 against `ai-rv-2` commit `9c92bdbb94d1125406e0094779102458cdeee87c` (Training Continuity T5). This is the primary English contributor entry point. Package version: 0.7.13; SQLite schema: 31. The v0.7.14 name describes development scope, not a published binary.

## Prerequisites and local start

Use **Node 24**, npm with the committed package lock, and **Rust stable with Clippy**. The checked-in `.github/workflows/ci.yml`, `release-windows.yml` and `release-linux.yml` own the CI/build recipe; do not copy old Node versions or removed commands from historical reports.

On Linux, CI installs:

```bash
sudo apt-get update
sudo apt-get install -y build-essential libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
```

On Windows, install the C++ desktop build tools/Windows SDK and WebView2 runtime needed by Tauri. Native credentials use the operating system secret store; headless/browser fixtures cannot prove that interactive storage and provider calls work on a user's desktop.

From the repository root:

```bash
npm ci
npm run tauri dev
```

`npm run dev` starts the browser preview only. It uses BrowserRepository and has explicit restrictions, including inability to create/rotate native provider credentials. Do not present browser localStorage tests as native SQLite or Windows acceptance.

## Required automated checks

Run these from the repository root:

```bash
npm run verify:source
npm run verify:ux-data
npm run verify:architecture
npm run verify:v0.7.14-release-gate
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked
npm run verify:openrouter-continuation-bridge
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

The bridge orchestrates the otherwise ignored Rust bridge fixtures and TypeScript persistence/replay. Reporting ignored fixture counts without running the bridge is incomplete native validation. Do not disable `result_large_err`, weaken size tests or raise lint thresholds to hide an enlarged shared error. `ProviderCallError` has a strict `< 128`-byte regression test; optional boxed metadata preserves flat IPC serialization.

`npm run tauri build` builds local desktop bundles after the prerequisites are available. Release workflows add their own platform, packaging, lockfile and provenance gates. Building locally does not authorize release publication. Never regenerate/push `Cargo.lock` from CI as a workaround.

For documentation-only edits, verify local links and the source/architecture/compatibility/release-structure gates; record runtime tests as not rerun if executable source is byte-identical. For behavior changes, run the relevant regressions and complete the required full suite/native checks. Report each unavailable check honestly.

## Code ownership and boundaries

| Concern | Primary owner |
| --- | --- |
| Application navigation and neutral Training header | `src/App.tsx` |
| Feature public APIs | `src/features/*/index.ts`; external callers do not import private feature files |
| Canonical repository contract | `src/storage/repository.ts`, `contracts/`; Browser/SQLite facades delegate to domain adapters |
| Native credential/endpoint binding | `src-tauri/src/secrets.rs`, `providers.rs`, provider adapters |
| One physical HTTP attempt / cancellation | Rust `providers/transport.rs` |
| Transport retry and physical-attempt evidence | `src/providers/requestExecutor.ts`, `retry.ts`, `responseEvidence.ts` |
| Semantic completeness, same-step replay and manual retry authorization | `src/sessions/viewerOutputRecovery.ts`, `viewerResumeLedger.ts`, `viewerResumeDecision.ts` |
| Training orchestration and first missing stage | `src/features/training/trainingExecution.ts`, `trainingResumeRecovery.ts` |
| Learning two-dispatch allowance and settlements | `src/aiCenter/learningExecution.ts`, `fieldGuideUpdate.ts`, `viewerNotes.ts` |
| Native workflow heartbeat/fencing | `src-tauri/src/workflow_heartbeat.rs`, `workflow_ownership.rs`; TS ownership helpers |
| Training warning aggregation and readable checkpoint export | `src/training/learningSummary.ts`, `export.ts`; `src/components/LearningWarnings.tsx` |
| Telepathic stages, roles and frozen budgets | `src/telepathicExchange/`; independent series lease |

See [Code Map](../architecture/CODE_MAP.md) and [Module Boundaries](../architecture/MODULE_BOUNDARIES.md). The architecture allowlist is empty; do not add broad exceptions or move storage/native dependencies into pure domain code.

## Provider and recovery contracts

Rust sends one physical request; the TypeScript executor owns classified transport retry. Domain recovery must not wrap another unbranded executor or silently restart accepted work. Request cancellation preserves user Stop, ownership/DB/view-close, timeout and repetition diagnoses.

`response_finished` means the full transport response arrived (`body_read` or `sse_done` evidence). It does not mean semantic validity or local commit. A rejected final answer can be known finished; an earlier unknown physical attempt is not resolved by a later successful one. HTTP 200, `finish_reason=stop` or a provider dashboard alone cannot prove a usable final answer or a durable local checkpoint.

T2 preserves an allowlisted, size-bounded final-channel candidate with its hash/validation in existing learning events and exports. Reasoning is separate. Do not scan arbitrary JSON strings for reasoning tags or reconstruct continuation state from displayed text.

Classic Training's Field Guide and Viewer Notes each permit at most **two durable dispatched requests** per session/packet across transport retry, output recovery, JSON/capacity repair and restart. In classic Training, `failurePolicy: "preserve_and_continue"` settles an unknown optional-learning result as `failed_preserved` without another dispatch or an operator dialog. Known invalid proposals still consume at most two slots. Historical pending operations are preserved without resending. An unavailable optional Viewer Review skips both learning updates and records their failure using the unchanged memory versions; its checkpoint records the missing Review rather than inventing text. Training uses the already-owned native RV workflow for Review, not a second WebView-timer lease. Detailed learning diagnostics stay in AI Center. Stop and DB/ownership/hash/identity errors still interrupt execution. Blind Viewer, Judge, Research, Telepathy and non-Training Review retain their own contracts. See [Classic Training automatic learning](TRAINING_AUTOMATIC_LEARNING.md).

The shared Viewer Resume decision distinguishes replay, known finished rejection, unsafe state and uncertain dispatch. An explicit retry of an essential step retains attempt history and does not reopen exhausted learning. See [Current Workflows](../architecture/CURRENT_WORKFLOWS_v0.7.14_EN.md) for current budget tables and frozen-policy exceptions.

## Telepathic lead decision contract

New Training and Conversation series use `fixed_lead_guidance_v2`, while the round protocol remains `fixed_lead_v1`. Each active Viewer receives one `individual` instruction or an explicit participation finish. End-round decisions have an empty `individual` list. Do not introduce a broadcast fallback, split a shared instruction, merge two questions or silently drop unknown fields. Validation follows the frozen series version. Loading a v1 series must preserve its saved request bytes, accepted decisions, attempts and fingerprints; creation is the only point that selects v2.

See [Fixed-lead telepathy](../architecture/TELEPATHY_FIXED_LEAD_v0.7.14_EN.md) for compatibility and scope. `individualLeadGuidance.test.ts` covers the new contract; the existing v1 packet/engine golden files remain unchanged. Stage 1 does not recover rejected mixed historical decisions or change the paid-attempt allowance.

## Database and native IPC changes

Migrations `001–031` are registered in `src-tauri/src/migrations.rs`. Keep accepted migration bytes unchanged; introduce a new additive migration only with matching registry/compatibility tests. Legacy databases are classified before normal loading; an unverified legacy upgrade must not be made automatic.

Use named writes and native transactional fencing, not generic renderer SQL writes. Native command additions require matching command registration, permissions/ACL and corresponding bridge/tests. Do not commit generated native permission output as hand-written source. Backup/restore and controlled purge stay in their explicit native/use-case boundaries.

The classic workflow heartbeat renews every 10 seconds with TTL 45 seconds. It is keyed by profile/owner/version and window, binds active transport IDs, cancels on lease/DB failure, and fences later writes. `Destroyed` stops/releases exact ownership; merely requesting window close does not. Failed startup releases an acquired token. A full process restart resets the closed-window registry; recreating the same label in one process is not the present single-window lifecycle. Separate post-Reveal and telepathic leases are not automatically replaced by this mechanism.

## Tests that exercise the current repair

- `src/storage/trainingLearning.sqlite.test.ts`: real SQLite, mixed learning results, restart/Stop and two controlled model identities across three targets.
- `src/App.trainingContext.dom.test.tsx`, `src/features/training/TrainingContinuityT5.dom.test.tsx`: actual App navigation, saved-run identity, warning presentation and export action, PL/EN.
- `src/training/export.test.ts`: readable interrupted checkpoint/session and exact learning provenance, with native file-write boundary captured.
- `src/features/training/TrainingResumeT3.dom.test.tsx` and Session Resume tests: rendered action plus the shared resolver.
- Native `workflow_heartbeat`/provider tests: actual Rust task, SQLite renewal, takeover, DB failure, window destruction and cancellation without JS callback.

Fixture responses are controlled test inputs, not evidence that NVIDIA, Qwen or any upstream service was called. A repository reconnect is not a full OS/process smoke.

## Documentation, language and review

English is required for the primary Developer Guide, CONTRIBUTING, living architecture and developer-facing wiki pages. Polish counterparts and historical audit/requirements records can remain Polish and are clearly labeled. Update EN and an existing PL counterpart together; do not rewrite signed/checksummed historical evidence as if it described today's code.

Update README, [documentation index](../README.md), affected architecture, wiki mirror and [desktop checklist](../architecture/FINAL_RUNTIME_SMOKE_v0.7.14_EN.md) when behavior changes. Wiki pages live under `docs/wiki/`; publishing them to the separate GitHub Wiki is a separate operation.

A PR should explain the concrete behavior, validation and limits. Never include API keys, databases, private targets/transcripts, raw continuation payloads, build output or caches. Follow [CONTRIBUTING](../../CONTRIBUTING.md), [SECURITY](../../SECURITY.md) and the [Code of Conduct](../../CODE_OF_CONDUCT.md).

## Windows runtime crash candidate

The pinned local runtime ownership repair and manual diagnostic build are described in [Windows Runtime Ownership Repair](WINDOWS_RUNTIME_OWNERSHIP_REPAIR_EN.md). Source verification rejects a registry fallback. The diagnostic workflow preserves a GUID/age-verified EXE/PDB pair, encrypts private symbols, and requires a separate Windows IPC/Reveal/Stop/minimize soak; local Linux checks do not close that acceptance.

## Maintenance decisions to preserve

Before changing runtime dependencies, recurring IPC or post-Reveal recovery, read [Engineering Decisions 25 and 26](../architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md#decision-25--windows-runtime-ownership-and-bounded-ipc-observation). They record the Windows crash investigation/repair, criteria for replacing the local Tauri patch with a verified upstream fix, and the selective restoration of unattended Training. Optional learning rejection must not become a mandatory operator gate. The 17 October user test completed Training in approximately 20 minutes and verified Stop without app closure; it is not a substitute for every Windows acceptance scenario.

## Telepathic checkpoint recovery

See [Telepathic Checkpoint Recovery](TELEPATHIC_CHECKPOINT_RECOVERY_EN.md) for local BUSY retries, shared write coordination, native fencing, and the separation of received responses from persistence failures. This stage does not enable automatic transport retries.

## Telepathic automatic recovery

[Automatic Recovery S2](TELEPATHIC_AUTOMATIC_RECOVERY_EN.md) describes saved policy, bounded transport retries, receipt recovery, STOP/restart behavior, and the shared Training/Conversation Resume decision.
