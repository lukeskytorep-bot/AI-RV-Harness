# AI RV Harness

AI RV Harness is a local-first desktop workspace for blind AI Remote Viewing sessions and controlled RV research. The desktop stack is Tauri 2 + React/TypeScript + Rust + SQLite, with Windows as the primary release platform.

## Current checkpoint — 0.7.4

This is a substantial v1 implementation checkpoint, not a claim that the complete v1 distribution is releasable yet.

Implemented end to end:

- Polish/English UI, Profiles, Workspaces, Chat, RV Session, AI Monitor, Targets, Research and all eight Settings tabs;
- verified OS-native credential storage and native adapters for OpenRouter, Google, OpenAI, Anthropic, Z.AI, DeepSeek, Mistral and custom OpenAI-compatible endpoints;
- dynamic model/capability discovery, a versioned exact-model reasoning registry, explicit AUTO/OFF/effort semantics, provider-specific reasoning payloads, Profile-level reasoning and temperature defaults, requested/effective generation settings, recommended seeds and persistent model Favorites;
- strict Conversation / Manual RV context separation, multiple named and independently archived chat threads per mode, a Profile-level Viewer System Prompt, and per-thread Workspace Source selection with context-limit blocking;
- Full RCP v1.5a and RV Lite v1.0.0 automatic execution, Custom Protocol versioning/Dry Run, ordinary randomized batch runs, STOP/retry/cost safeguards and response autosave;
- approved RV Lite PL/EN resources with exactly four Viewer calls; Prompt 3 includes mandatory Deepening, Prompt 4 is Functional Sketches, and the Profile greeting omits the AI name cleanly when none is set;
- 10 bundled project-provided Training Targets with stable Target IDs 1–10, plus editable/deletable unused My Targets, immutable used targets and usage/repeat tracking;
- blind AI Monitor with bounded interventions, inflection-aware evidence validation, rejection audit/fallback and exportable Monitor history;
- external/automatic text or image Reveal, immutable sealed pre-reveal evidence, post-reveal Viewer discussion stored in a separate evidence domain, and supplementary Target Clarifications;
- independent 1–3 AI Judges using sanitized allowlist packets and frozen 3+3+2+2 scores;
- seven Research templates, study-wide Viewer controls (model, System Prompt, reasoning, temperature and output limit), searchable manual or random Training/My Target selection, optional 1–3 AI Judges or save-only external evaluation, Preflight, Experiment Lock, randomized anonymous assignments/Judge order, explicit interrupted-run recovery, freeze-before-unblind, statistics and reproducibility export;
- Calibration History, target-use policy, session codes, operational token/cost/time metrics, crash-safe formal-session history, backup/restore and managed artifact integrity checks;
- safe Markdown/ASCII rendering throughout human-readable AI output, a searchable all-Workspace directory and direct Workspace switching;
- redacted in-memory provider raw-payload diagnostics and capability cache controls.

The two content blockers from checkpoint 0.6.0 are now resolved: RV Lite PL/EN and the ten-target starter Training pack are bundled.

Checkpoint 0.7.1 follows the first native Windows installation test. It grants the webview the explicit SQLite execute permission required to seed the bundled Training Targets, replaces the indefinite startup spinner with a recoverable diagnostic state, and makes Aurora a distinct soft multicolor theme instead of a second dark variant. New installations now open in English with Aurora as the default theme, while the native window uses a matching light background before the web interface is ready.

The same checkpoint also hardens the first public test build: Practice Effect assignments preserve randomized adjacent `FIRST → SECOND` pairs; paid runs have a synchronous double-start guard; STOP cancels the active native HTTP request; enabled hard cost limits require enforceable cached pricing and pre-authorize each request; Reveal insertion changes session state atomically; Judge evidence comes from the SHA-256-verified sealed transcript; rapid Settings changes are serialized; and Full RCP accepts supported image-only automatic targets.

Checkpoint 0.7.2 consolidates every post-0.7.1 change into one upgrade. Guided first-run configuration connects and tests a provider, loads its model registry, requires an explicit default Viewer model, creates the first optional-name Profile, and offers skippable default AI Judge and AI Monitor selections. Profile creation/editing also stores an automatic or advertised reasoning level, temperature (initially 0.9 where supported), and a Viewer System Prompt. These defaults remain editable and preselect Chat/RV/Monitor/Judge routes without removing per-session choice.

The same checkpoint fixes the native credential backend that could leave a provider row in SQLite while the API key was absent from Windows Credential Manager. Native keyring backends are enabled per operating system and every new secret is verified by immediate readback. A broken/missing credential is repaired by removing and adding the provider connection again. The Profile editor changes its complete AI configuration in one place. Unused My Targets can be edited or deleted, while targets referenced by sessions or locked Research remain immutable.

Research target selection is split by Training/My Targets and manual/random modes, and AI Judge is explicitly optional: save-only projects export a shareable `external_evaluation` folder with blind packets and Judge instructions while keeping the condition mapping under `private_master`. Every experiment has a visible study-wide Viewer-control block that can override ordinary-session defaults. Model, fixed System Prompt, reasoning, temperature and maximum output are captured in Experiment Lock; the selected template alone decides which one may vary. A Profile/API-key comparison therefore applies the same chosen model, prompt, reasoning, temperature and output limit to every Profile. Multi-route controls are available only when all participating routes advertise compatible support, and Preflight rejects any second changing variable.

The Viewer System Prompt is used by Manual RV and all automatic protocol controllers; automatic and Research runs capture its exact content/hash in formal session snapshots. Every non-prompt-comparison Research requires one non-empty Profile-derived or custom fixed prompt. System Prompt Comparison intentionally varies it, while Custom Variable stores its tested instruction separately. Settings now includes a read-only PL/EN library of the exact bundled Full RCP and RV Lite resources plus project credits and MIT-license information.

Checkpoint 0.7.3 fixes the SQLite `database is locked` failure observed when starting a session. All writes now pass through one application-level coordinator with bounded retry for transient SQLite busy/locked responses. Multi-statement operations use one native SQLx transaction pinned to one pooled connection; the frontend no longer sends separate `BEGIN`, write and `COMMIT` calls through the connection pool. The desktop repository is initialized once and SQLite uses WAL journal mode so reads remain responsive during evidence persistence. Existing Profiles, Workspaces, sessions, targets and Research data are retained without a schema reset.

Checkpoint 0.7.4 integrates the complete post-test correction set on top of 0.7.3 without removing its SQLite locking safeguards. Invalid or temporarily failed AI Monitor decisions are now audited and skipped with `CONTINUE_PROTOCOL`; valid English plurals and common Polish inflections satisfy grounded evidence prerequisites. The shared repetition guard ignores six-Touch protocol labels, controlled descriptors and fenced ASCII while retaining warnings and hard stops for substantive generation loops. AI Monitor and RV Lite are blocked symmetrically, and Full RCP requires functional sketches as fenced, inline-labelled ASCII.

The same checkpoint adds safe Markdown presentation, a versioned model reasoning registry with provider-specific transport and marked fallbacks for unknown models, a global searchable Workspace directory/direct switcher, and multiple named Chat/Manual RV threads with isolated messages, formal state and Source selections. Existing chats remain intact; schema migration 14 only adds non-destructive thread archiving.

`.github/workflows/release-windows.yml` runs only from `main`, prevents overlapping releases, generates and commits the application `Cargo.lock`, checks TypeScript plus Rust tests/Clippy, and then uses the official Tauri GitHub Actions path to create a draft GitHub Release. A local Rust installation is therefore not required for distribution builds.

## Windows installer trust

Checkpoint 0.7.4 is not code-signed, so Windows SmartScreen or third-party endpoint protection may warn again for every newly built installer hash. Removing that recurring warning requires a stable Authenticode publisher identity (for example Microsoft Artifact Signing or another trusted certificate configured in the Tauri release workflow) or distribution through Microsoft Store. Signing improves reputation but does not guarantee that the first signed releases will never show a reputation warning. See the [Microsoft SmartScreen reputation guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) and [Tauri Windows code-signing guide](https://v2.tauri.app/distribute/sign/windows/).

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

The TypeScript test/build path and SQLite migration/invariant checks are verified in the checkpoint environment. A Rust toolchain is not installed there, so the native Tauri/Rust binary is verified by the Windows GitHub Actions release pipeline rather than locally.

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

AI RV Harness is a human-led project developed with multiple AI collaborators. See [CREDITS.md](CREDITS.md) for individual contributions.

## License

Source code is released under the MIT License. Methodology and target content may have separate licensing/source requirements and must be reviewed before redistribution.
