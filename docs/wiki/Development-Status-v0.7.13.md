# Development Status — v0.7.13

> **Historical public v0.7.13 release record (30 September 2026).** Windows and Linux packages were built from accepted `main` commit `b13fcc19245bbdc0f334d2ce22815a8c54444607`.

## Current boundary

- application version: 0.7.13;
- SQLite schema: 27;
- migration registry: 001–027;
- factory Training: 94 targets / eight categories;
- platform targets: Windows NSIS/MSI and Linux AppImage/DEB;
- modularization Stages 1–9: completed;
- UX-DATA campaign and compatibility gate: completed.

## Controlled database epoch

The accepted v0.7.13-epoch chain is:

1. exact-green 23 → 24: Viewer Learning Field Guide;
2. exact-green 24 → 25: provider continuation state;
3. exact-green 25 → 26: typed Workspaces;
4. exact-green 26 → 27: factory Training classification upgrade.

Public/legacy schemas are classified before `Database.load()` and are not silently migrated through an unverified chain.

## Current product state

- Conversations and RV Sessions are separate top-level areas.
- New Profiles receive one Conversation Workspace and one RV Workspace.
- Viewer Learning contains separate immutable Field Guide and Viewer Notes versions.
- Only completed Training may create learning versions; Conversation, ordinary RV and Research use snapshots read-only.
- Factory Training uses 94 targets, eight categories and paired PL/EN Reveals.
- Provider continuation is persisted outside visible transcripts and bound to the exact message/event and route fingerprint.
- OpenRouter streamed reasoning fragments are canonicalized conservatively before continuation validation.
- Judge and post-Reveal analytical work has one controlled 8,192 → 16,384 output recovery; learning objects preserve capacity and add the same headroom.

## Release verification

- full required GitHub Actions passed for the accepted source;
- Windows NSIS/MSI packages were built and practically launched;
- Linux AppImage/DEB packages were built and practically launched;
- schema 27 and the exact-green 26→27 path remain protected by the compatibility gates;
- published assets have release checksums and GitHub Artifact Attestations.

Attestations:

- Windows: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51409244>
- Linux: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51414231>

## Current development source

This page retains schema-27 release claims as dated historical evidence. It does not describe the current schema-31 source or verify today's release listing. See [Current development status](Development-Status.md).
