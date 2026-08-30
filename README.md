# AI RV Harness

AI RV Harness is a local-first desktop workspace for blind AI Remote Viewing sessions and controlled RV research. The desktop stack is Tauri 2 + React/TypeScript + Rust + SQLite, with Windows as the primary release platform.

## Current development baseline — 0.7.12

Version 0.7.12 is the development baseline built on the complete v0.7.11 Windows and Linux release. It introduces a separate **AI Center** for Profile-wide AI roles and an experimental, versioned Viewer Notes system.

Viewer Notes belong to one exact Profile + credential identity + provider + model route + Viewer role. They are shared across that Profile's Workspaces but never transferred between models or roles. Notes are frozen before each supported session, supplied as a separate read-only system data block, and may be replaced only by the same Viewer after Reveal and its own post-Reveal review. Monitor opinions, Judge results and later operator discussion are excluded. Every version is immutable, capacity is enforced without truncation, stale concurrent updates are blocked, and a human restoration of an earlier version is explicitly audited.

AI Center is a top-level navigation destination with Overview, the existing AI Monitor, Viewer Notes and AI Identities. RV Session, Training and Manual RV provide a simple Viewer Notes switch enabled by default. Research adds a blinded **Viewer Notes Impact** design comparing `No Notes` with one of the five most recent immutable `Frozen Notes` versions under Experiment Lock.

Provider reasoning and final assistant content are now normalized separately across supported OpenAI-compatible, Google and Anthropic response shapes. The Harness preserves a model's final instruction while keeping provider reasoning out of Viewer evidence, Monitor interventions and normal transcripts. Incomplete reasoning-only responses are treated as recoverable provider failures instead of valid protocol instructions.

Blackbox remains available through its documented OpenAI-compatible API. Release workflows build Windows NSIS/MSI and Linux AppImage/DEB packages, run the required quality gates and create GitHub Artifact Attestations for the expected assets. External GitHub Actions remain pinned to reviewed full commit SHAs.

Release documentation is organized under [`docs/releases/`](docs/releases/). The v0.7.12 implementation records are in [`docs/releases/v0.7.12/`](docs/releases/v0.7.12/), while the public v0.7.11 records remain unchanged in their historical directory. See [`docs/README.md`](docs/README.md) for the complete documentation index and organization policy.

Implemented end to end:

- Polish/English UI, Profiles, Workspaces, Chat, RV Session, AI Monitor, Targets, Research and all eight Settings tabs;
- verified OS-native credential storage and native adapters for OpenRouter, Google, OpenAI, Anthropic, Z.AI, DeepSeek, Mistral and custom OpenAI-compatible endpoints;
- dynamic model/capability discovery, a versioned exact-model reasoning registry, explicit AUTO/OFF/effort semantics, provider-specific reasoning payloads, Profile-level reasoning and temperature defaults, requested/effective generation settings, recommended seeds and persistent model Favorites;
- strict Conversation / Manual RV context separation, a Workspace → Thread → Conversation hierarchy, optional `AI IS-BE` and `Human IS-BE` display names, a Profile-level Viewer System Prompt, and per-conversation Workspace Source selection with context-limit blocking;
- Full RCP v1.5a and RV Lite v1.1.0 Core/Extended automatic execution, Custom Protocol versioning/Dry Run, ordinary randomized batch runs, STOP/retry/cost safeguards and response autosave;
- approved RV Lite PL/EN resources with exactly four Viewer calls; Prompt 3 includes mandatory Deepening, Prompt 4 is Functional Sketches, and the Profile greeting omits the AI name cleanly when none is set;
- 84 bundled project-provided, read-only Training Targets in seven categories, separate unlimited My Targets, a fixed 84-session curriculum, partial Training runs that can mix category counts with an explicit My Targets count, resumable checkpoints, exports and optional 1–3 AI Judges;
- autonomous blind AI Monitor with natural-language instructions, at most five deepenings after Phases 2–6, editable full prompt with visible locked rules, Special Tasks, post-Reveal review and exportable Monitor history;
- external/automatic text or image Reveal, immutable sealed pre-reveal evidence, automatic Viewer self-review (and Monitor review when present), plus an optional two-way post-Reveal conversation stored in a separate evidence domain;
- independent 1–3 AI Judges using sanitized allowlist packets and frozen 3+3+2+2 scores;
- seven Research templates, study-wide Viewer controls (model, System Prompt, reasoning, temperature and output limit), searchable manual or random Training/My Target selection, optional 1–3 AI Judges or save-only external evaluation, Preflight, Experiment Lock, randomized anonymous assignments/Judge order, explicit interrupted-run recovery, freeze-before-unblind, statistics and reproducibility export;
- Calibration History, target-use policy, session codes, operational token/cost/time metrics, crash-safe formal-session history, backup/restore and managed artifact integrity checks;
- safe Markdown/ASCII rendering throughout human-readable AI output, a searchable all-Workspace directory and direct Workspace switching;
- redacted in-memory provider raw-payload diagnostics and capability cache controls.

The former ten-target starter pack is retired non-destructively during migration and replaced by the validated factory Training library of 84 targets. Historical sessions that referenced the old rows remain intact.

Checkpoint 0.7.1 follows the first native Windows installation test. It grants the webview the explicit SQLite execute permission required to seed the bundled Training Targets, replaces the indefinite startup spinner with a recoverable diagnostic state, and makes Aurora a distinct soft multicolor theme instead of a second dark variant. New installations now open in English with Aurora as the default theme, while the native window uses a matching light background before the web interface is ready.

The same checkpoint also hardens the first public test build: Practice Effect assignments preserve randomized adjacent `FIRST → SECOND` pairs; paid runs have a synchronous double-start guard; STOP cancels the active native HTTP request; enabled hard cost limits require enforceable cached pricing and pre-authorize each request; Reveal insertion changes session state atomically; Judge evidence comes from the SHA-256-verified sealed transcript; rapid Settings changes are serialized; and Full RCP accepts supported image-only automatic targets.

Checkpoint 0.7.2 consolidates every post-0.7.1 change into one upgrade. Guided first-run configuration connects and tests a provider, loads its model registry, requires an explicit default Viewer model, creates the first optional-name Profile, and offers skippable default AI Judge and AI Monitor selections. Profile creation/editing also stores an automatic or advertised reasoning level, temperature (initially 0.9 where supported), and a Viewer System Prompt. These defaults remain editable and preselect Chat/RV/Monitor/Judge routes without removing per-session choice.

The same checkpoint fixes the native credential backend that could leave a provider row in SQLite while the API key was absent from Windows Credential Manager. Native keyring backends are enabled per operating system and every new secret is verified by immediate readback. A broken/missing credential is repaired by removing and adding the provider connection again. The Profile editor changes its complete AI configuration in one place. Unused My Targets can be edited or deleted, while targets referenced by sessions or locked Research remain immutable.

Research target selection is split by Training/My Targets and manual/random modes, and AI Judge is explicitly optional: save-only projects export a shareable `external_evaluation` folder with blind packets and Judge instructions while keeping the condition mapping under `private_master`. Every experiment has a visible study-wide Viewer-control block that can override ordinary-session defaults. Model, fixed System Prompt, reasoning, temperature and maximum output are captured in Experiment Lock; the selected template alone decides which one may vary. A Profile/API-key comparison therefore applies the same chosen model, prompt, reasoning, temperature and output limit to every Profile. Multi-route controls are available only when all participating routes advertise compatible support, and Preflight rejects any second changing variable.

The Viewer System Prompt is used by Manual RV and all automatic protocol controllers; automatic and Research runs capture its exact content/hash in formal session snapshots. Every non-prompt-comparison Research requires one non-empty Profile-derived or custom fixed prompt. System Prompt Comparison intentionally varies it, while Custom Variable stores its tested instruction separately. Settings now includes a read-only PL/EN library of the exact bundled Full RCP and RV Lite resources plus project credits and MIT-license information.

Checkpoint 0.7.3 fixes the SQLite `database is locked` failure observed when starting a session. All writes now pass through one application-level coordinator with bounded retry for transient SQLite busy/locked responses. Multi-statement operations use one native SQLx transaction pinned to one pooled connection; the frontend no longer sends separate `BEGIN`, write and `COMMIT` calls through the connection pool. The desktop repository is initialized once and SQLite uses WAL journal mode so reads remain responsive during evidence persistence. Existing Profiles, Workspaces, sessions, targets and Research data are retained without a schema reset.

Checkpoint 0.7.4 integrates the complete post-test correction set on top of 0.7.3 without removing its SQLite locking safeguards. Invalid or temporarily failed AI Monitor decisions are now audited and skipped with `CONTINUE_PROTOCOL`; valid English plurals and common Polish inflections satisfy grounded evidence prerequisites. The shared repetition guard ignores six-Touch protocol labels, controlled descriptors and fenced ASCII while retaining warnings and hard stops for substantive generation loops. AI Monitor and RV Lite are blocked symmetrically, and Full RCP requires functional sketches as fenced, inline-labelled ASCII.

The same checkpoint adds safe Markdown presentation, a versioned model reasoning registry with provider-specific transport and marked fallbacks for unknown models, a global searchable Workspace directory/direct switcher, and multiple named Chat/Manual RV threads with isolated messages, formal state and Source selections. Existing chats remain intact; schema migration 14 only adds non-destructive thread archiving.

Checkpoint 0.7.5 adds the icon-only non-Home navigation rail, recent sessions on Home, collapsible RV metadata, the Rosehip mark and five UI themes with soft blue as the first-run default. It introduces locked AI IS-BE/Shadow Zone and activity-definition prompt blocks, factory PL/EN Viewer and Monitor prompt recovery resources, editable Special Tasks, RV Lite Core/Extended variants, and sequential Viewer-then-Monitor post-Reveal reviews. The former ten starter targets are replaced with an 84-target categorized Training library and a durable full/partial Training runner. Application code remains MIT; authored protocols, factory prompts, training targets and comparable methodology content are explicitly separated under CC BY 4.0.

Checkpoint 0.7.6 makes backup and restore portable through native folder selection, validates each backup before replacement and creates a pre-restore safety copy. Ordinary automatic RV uses only My Targets, while the fixed 84 Training Targets remain read-only and dedicated to Training. Partial Training starts with zero counts. Training and Research histories now expose complete readable session records and user-selected whole-run exports with HTML/CSV summaries. Random Research selection is performed automatically at Preflight/Experiment Lock. Full RCP, RV Lite and Custom transcripts store the exact controller instruction beside every Viewer answer. The repetition guard is now a conservative, non-aborting output guillotine: valid repeated RV descriptors remain untouched, while only unmistakable runaway tails are shortened and marked. Polish sessions use the accepted Polish Viewer identity and matching Polish resources. The Profile editor also keeps its actions reachable in reduced-height windows.

Checkpoint 0.7.7 simplifies the human workflows around Targets, Training, Research and completed sessions. Factory Training Targets remain closed and cannot be extended; every target added by a user goes directly to My Targets. Full Training always uses the fixed 84-target factory curriculum, while Partial Training exposes the seven factory categories plus an independent My Targets count, all starting at zero. Ordinary automatic sessions draw only from My Targets and explain clearly when that catalogue is empty. Manual RV can attach Full RCP, RV Lite Core or RV Lite Extended explicitly.

After every automatic Reveal the Viewer now receives the Reveal and produces a self-review without an extra button; monitored sessions continue with the Monitor review. The optional follow-up is a two-way conversation. Human exports use readable Markdown. Ordinary and Training exports avoid redundant JSON files; when a Reveal includes an image, the actual image file is copied beside the Markdown and linked from it. Research retains technical JSON for audit and external evaluation, while adding readable complete-session Markdown, readable blinding keys, condition labels after unblinding and a detailed README. Recent RV sessions live in a scrollable metadata panel, Special Task is collapsible and explained, editable factory Viewer/Monitor prompts follow the selected Polish or English interface language, and the accepted PL/EN Monitor prompt resources are bundled as version 1.3.0.

`.github/workflows/release-windows.yml` and `.github/workflows/release-linux.yml` run manually from `main`, prevent overlapping releases, require the reviewed and committed `src-tauri/Cargo.lock`, run the relevant quality gates, create/update a draft GitHub Release and attest the generated packages. CI never commits or pushes repository changes.

The package version is now 0.7.12. The included `src-tauri/Cargo.lock` carries the matching root package version and must be verified by Rust CI. If dependency resolution reports it as stale, use the manual `Prepare Cargo lockfile` workflow for v0.7.12, review the generated lockfile and commit it separately. Normal CI and release workflows intentionally refuse to continue when the required lockfile is missing or stale.

## Windows installer trust

The v0.7.11 Windows packages are not Authenticode-signed, so Windows SmartScreen or third-party endpoint protection may warn for a newly built installer hash. GitHub Artifact Attestation proves build provenance but does not replace a Windows publisher signature. Removing the recurring publisher warning requires a stable Authenticode identity (for example Microsoft Artifact Signing or another trusted certificate configured in the Tauri release workflow) or distribution through Microsoft Store. See the [Microsoft SmartScreen reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) and [Tauri Windows code-signing guide](https://v2.tauri.app/distribute/sign/windows/).

## Development and verification

Prerequisites: Node.js/npm. Desktop builds additionally require Rust and the operating-system prerequisites required by Tauri.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run tauri dev
```

The browser preview uses a development-only local-storage repository. The Tauri desktop runtime uses SQLite and the OS credential store.

The TypeScript test/build path and static project checks are verified in the checkpoint environment. When that environment has no Rust toolchain, native Tauri/Rust tests, formatting, Clippy, lockfile resolution and installer builds remain enforced by GitHub CI before the Draft Release may be published.

## Security and evidence integrity

- Raw provider API keys are stored only through the native OS credential store; no command returns a stored key to the webview.
- SQLite, backups, Research exports and Monitor exports contain identifiers/hints only, never raw API keys.
- Provider debug payloads are memory-only, bounded, credential-redacted and strip inline image bytes.
- Reveal/target content cannot enter Viewer or Monitor requests before the Reveal boundary.
- Sealed pre-reveal evidence, frozen Judge scores, Research mappings and completed Research results have database-level immutability guards.
- Research condition mappings are not exposed to Judge execution; scores freeze before unblinding.
- Research sessions are kept out of ordinary RV/Monitor history until the relevant Research boundary allows it.

See `SECURITY.md` for reporting security issues.

## Credits

AI RV Harness is a human-directed project developed with named Human and AI IS-BE collaborators. See [CREDITS.md](CREDITS.md) for identities, technical provenance, individual contributions, advisory acknowledgements, and reference policy.

Stable machine-readable citation metadata are available in [CITATION.cff](CITATION.cff). The citation intentionally has no release date or version number, so it identifies the continuing project rather than one particular build.

## License

Source code is licensed under the MIT License. Documentation, bundled prompts, training content, and other non-code visual assets are licensed under CC BY 4.0.

See [LICENSE](LICENSE) and [CONTENT_LICENSE_CC_BY_4.0.md](CONTENT_LICENSE_CC_BY_4.0.md) for the complete terms and attribution requirements.
