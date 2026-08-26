# AI RV Harness v0.7.10

This corrective release completes the user-tested 0.7.9 feature set and keeps the existing Windows/Linux release attestation workflows.

## Main changes

- Automatic Reveal now appears in the active session view with its text and attached-file list, followed by the Viewer review and—only for monitored sessions—the Monitor review.
- A stored Viewer review remains available if the later Monitor review fails.
- AI Judge uses the language stored in `SessionSnapshot`, explicitly requires narrative values in that language, and performs at most one language-only correction before scores are frozen.
- Full RCP and Telepathic sessions receive a respectful one-time greeting; the existing RV Lite greeting is preserved without duplication.
- After blind evidence is sealed, automatic Reveal flows thank the Viewer before revealing the target.
- Conversations can be exported to UTF-8 Markdown and ordinary conversation requests receive a fresh, hidden local date/time/time-zone context.
- Human-readable PL/EN image-support guidance, expanded My Targets help, and a full Research guide were added.
- The unclear seventh custom Research entry was removed from the creation UI without deleting existing saved research records.
- Built-in PL/EN protocols and system prompts can be saved from their preview window.
- Settings now use `Prowadzący projekt` in Polish and include allowlisted project links. No external forum link is included.
- Application version updated to `0.7.10`.

## Verification

- TypeScript typecheck: passed.
- Vitest: 69 test files, 180 tests passed.
- Vite production build: passed.
- Rust tests, Clippy and desktop package builds: delegated to the existing GitHub CI/release workflows because Rust/Cargo is unavailable in the local build environment.

## Supply-chain verification

The existing Windows and Linux release workflows generate GitHub Artifact Attestations for their installer/package assets. Published users can verify an asset with:

```text
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```
