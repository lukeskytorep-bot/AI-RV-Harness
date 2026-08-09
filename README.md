# AI RV Harness

AI RV Harness is a local-first desktop workspace for blind AI Remote Viewing sessions and controlled RV research. The desktop stack is Tauri 2 + React/TypeScript + Rust + SQLite, with Windows as the primary release platform.

## Current checkpoint — 0.7.1

This is a substantial v1 implementation checkpoint, not a claim that the complete v1 distribution is releasable yet.

Implemented end to end:

- Polish/English UI, Profiles, Workspaces, Chat, RV Session, AI Monitor, Targets, Research and all seven Settings tabs;
- OS secure credential storage and native adapters for OpenRouter, Google, OpenAI, Anthropic, Z.AI, DeepSeek, Mistral and custom OpenAI-compatible endpoints;
- dynamic model/capability discovery, requested/effective generation settings, recommended seeds and persistent model Favorites;
- strict Conversation / Manual RV context separation and explicit Workspace Source selection with context-limit blocking;
- Full RCP v1.5a and RV Lite v1.0.0 automatic execution, Custom Protocol versioning/Dry Run, ordinary randomized batch runs, STOP/retry/cost safeguards and response autosave;
- approved RV Lite PL/EN resources with exactly four Viewer calls; Prompt 3 includes mandatory Deepening, Prompt 4 is Functional Sketches, and the Profile greeting omits the AI name cleanly when none is set;
- 10 bundled project-provided Training Targets with stable Target IDs 1–10, plus My Targets and usage/repeat tracking;
- blind AI Monitor with bounded interventions and exportable Monitor history;
- external/automatic text or image Reveal, immutable sealed pre-reveal evidence, post-reveal Viewer discussion stored in a separate evidence domain, and supplementary Target Clarifications;
- independent 1–3 AI Judges using sanitized allowlist packets and frozen 3+3+2+2 scores;
- seven Research templates, Preflight, Experiment Lock, randomized anonymous assignments/Judge order, explicit interrupted-run recovery, freeze-before-unblind, statistics and reproducibility export;
- Calibration History, target-use policy, session codes, operational token/cost/time metrics, crash-safe formal-session history, backup/restore and managed artifact integrity checks;
- redacted in-memory provider raw-payload diagnostics and capability cache controls.

The two content blockers from checkpoint 0.6.0 are now resolved: RV Lite PL/EN and the ten-target starter Training pack are bundled.

Checkpoint 0.7.1 follows the first native Windows installation test. It grants the webview the explicit SQLite execute permission required to seed the bundled Training Targets, replaces the indefinite startup spinner with a recoverable diagnostic state, and makes Aurora a distinct soft multicolor theme instead of a second dark variant. New installations now open in English with Aurora as the default theme, while the native window uses a matching light background before the web interface is ready.

The same checkpoint also hardens the first public test build: Practice Effect assignments preserve randomized adjacent `FIRST → SECOND` pairs; paid runs have a synchronous double-start guard; STOP cancels the active native HTTP request; enabled hard cost limits require enforceable cached pricing and pre-authorize each request; Reveal insertion changes session state atomically; Judge evidence comes from the SHA-256-verified sealed transcript; rapid Settings changes are serialized; and Full RCP accepts supported image-only automatic targets.

The remaining release boundary is verification of the corrected 0.7.1 Windows installer. `.github/workflows/release-windows.yml` runs only from `main`, prevents overlapping releases, checks TypeScript plus Rust tests/Clippy, creates the application `Cargo.lock` on the first reproducible release when it is missing, and then uses the official Tauri GitHub Actions path to create a draft GitHub Release. A local Rust installation is therefore not required for distribution builds.

## Development and verification

Prerequisites: Node.js/npm. Desktop builds additionally require Rust and the operating-system prerequisites required by Tauri.

```bash
npm install
npm run typecheck
npm test -- --run
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
