# AI RV Harness documentation

## Current development documentation — reviewed 16 October 2026

The current `ai-rv-2` source through Training Continuity T5 uses package version 0.7.13 and SQLite schema 31. The v0.7.14 label describes development scope; final Windows/provider smoke and release publication are separate records.

Start with the English [Developer Guide](development/README.md), [current workflows](architecture/CURRENT_WORKFLOWS_v0.7.14_EN.md) ([PL](architecture/CURRENT_WORKFLOWS_v0.7.14_PL.md)), [user/wiki mirror](wiki/Home.md), and [architecture index](architecture/README.md). Current references cover output-policy versions, two-dispatch learning settlement, finished versus uncertain responses, native ownership and interrupted checkpoint exports. Historical release/checkpoint/audit evidence below is not rewritten into present-day instructions.

This directory contains project documentation that is useful for development, review, release reconstruction and historical audit but is not required in the repository root.

## Directory structure

| Directory | Purpose |
| --- | --- |
| [`development/`](development/) | English setup, commands, contributor contracts and review guidance. |
| [`wiki/`](wiki/) | English current-development user guides mirrored for separate GitHub Wiki publication. |
| [`architecture/`](architecture/) | Current system overview, engineering invariants, integrity safeguards, and feature architecture. |
| [`checkpoints/`](checkpoints/) | Historical implementation checkpoints from v0.6.0 through v0.7.7. |
| [`releases/`](releases/) | Version-specific plans, notes, reports, manifests, verification records and patch documentation. |
| [`specifications/`](specifications/) | As-built functional and technical specifications. |
| [`requirements/`](requirements/) | Historical requirements, accepted correction sets and test-derived change lists. |
| [`prompts/`](prompts/) | Design records for bundled prompt packages. Runtime prompt resources remain in source/resource directories. |
| [`reports/`](reports/) | Implementation and audit reports, including the completed v0.7.13 UX-DATA campaign. |
| [`credits/`](credits/) | Credit history, attribution policy and technical-reference records supporting the root `CREDITS.md` and `CITATION.cff`. |

## Documented public release and living architecture

The documented public release baseline here is v0.7.13 for Windows and Linux. Its exact release notes, verification record, checksums and source identity are stored under [`releases/v0.7.13/`](releases/v0.7.13/). Living architecture now describes the accepted development source; release reports retain their original v0.7.13 scope:

- [Public release notes](releases/v0.7.13/RELEASE_NOTES_v0.7.13.md)
- [Release verification](releases/v0.7.13/RELEASE_VERIFICATION_v0.7.13.md)
- [Release checksums](releases/v0.7.13/SHA256SUMS.txt)
- [Release source identity](releases/v0.7.13/SOURCE_IDENTITY.txt)

- [Architecture documentation index](architecture/README.md)
- [System overview](architecture/SYSTEM_OVERVIEW.md)
- [Engineering design and integrity safeguards](architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md)
- [AI Center and Viewer Notes architecture](architecture/AI_CENTER_AND_VIEWER_NOTES.md)
- [Training, target pack, and typed Workspaces](architecture/TRAINING_TARGETS_AND_TYPED_WORKSPACES.md)
- [UX-DATA-6 Soft Archive / Restore implementation report](reports/UX_DATA_SOFT_ARCHIVE_LIFECYCLE_v0.7.13_PL.md)
- [UX-DATA-7 Viewer Notes source preservation implementation report](reports/UX_DATA_VIEWER_NOTES_SOURCE_PRESERVATION_v0.7.13_PL.md)
- [UX-DATA-8 Permanent Delete / controlled purge implementation report](reports/UX_DATA_CONTROLLED_PURGE_v0.7.13_PL.md)
- [UX-DATA-9 final cleanup and compatibility gate report](reports/UX_DATA_FINAL_CLEANUP_COMPATIBILITY_GATE_v0.7.13_PL.md)
- [UX-DATA compatibility gate architecture](architecture/UX_DATA_COMPATIBILITY_GATE.md)
- [Etap 6 Rust provider modularization report](reports/MODULARIZATION_RUST_PROVIDERS_SPLIT_v0.7.13_PL.md)
- [Stage 9 modularization closeout](reports/MODULARIZATION_STAGE_9_CLOSEOUT_v0.7.13_PL.md)
- [Historical v0.7.13 desktop runtime and release smoke](architecture/FINAL_RUNTIME_SMOKE_v0.7.13_PL.md)
- [v0.7.14 development final runtime/release smoke — EN](architecture/FINAL_RUNTIME_SMOKE_v0.7.14_EN.md) ([PL](architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md))
- [v0.7.14 Step 6 final release gate](reports/STEP6_V0714_FINAL_RELEASE_GATE_PL.md)
- [Viewer Learning 1 Field Guide foundation report](reports/VIEWER_LEARNING_1_FIELD_GUIDE_FOUNDATION_R1_v0.7.13_PL.md)
- [Viewer Learning 2 Training Field Guide update report](reports/VIEWER_LEARNING_2_TRAINING_FIELD_GUIDE_UPDATE_v0.7.13_PL.md)
- [Viewer Learning 3 Research Field Guide controls report](reports/VIEWER_LEARNING_3_RESEARCH_FIELD_GUIDE_CONTROLS_v0.7.13_PL.md)
- [Source package hygiene report](reports/SOURCE_PACKAGE_HYGIENE_1_v0.7.13_PL.md)
- [Training/targets/typed Workspaces — Stage 6 closeout](reports/TRAINING_TARGETS_TYPED_WORKSPACES_STAGE_6_CLOSEOUT_v0.7.13_PL.md)

The current source registry is **001–031**: Viewer Learning (024), continuation (025), typed Workspaces (026), factory classification (027), telepathic exchange (028), cross-instance series lease (029), Conversation attachment metadata (030) and post-Reveal review lease (031). Native current-epoch fixtures protect the accepted upgrade chain without moving historical ownership. Legacy databases are classified before normal loading; current development does not authorize an unverified legacy migration.

The v0.7.12 records below remain historical implementation and release documentation:

- [AI Center implementation plan](releases/v0.7.12/AI_CENTER_IMPLEMENTATION_PLAN_PL.md)
- [AI Center wiki documentation](releases/v0.7.12/AI_CENTER_VIEWER_NOTES_WIKI_EN.md)
- [Implementation report](releases/v0.7.12/IMPLEMENTATION_REPORT_v0.7.12_PL.md)
- [Application instructions](releases/v0.7.12/APPLY_UPDATE_v0.7.12_PL.md)
- [Changed-file manifest](releases/v0.7.12/CHANGED_FILES_v0.7.12.txt)
- [Changed-file SHA-256 checksums](releases/v0.7.12/SHA256SUMS_v0.7.12.txt)

The previous public v0.7.11 baseline remains archived here:

- [Reasoning compatibility plan](releases/v0.7.11/AI_RV_Harness_v0.7.11_REASONING_COMPATIBILITY_PLAN_PL.md)
- [Implementation report](releases/v0.7.11/AI_RV_Harness_v0.7.11_IMPLEMENTATION_REPORT_PL.md)
- [Public release notes](releases/v0.7.11/AI_RV_Harness_v0.7.11_PUBLIC_RELEASE_NOTES.md)
- [Changed-file manifest](releases/v0.7.11/AI_RV_Harness_v0.7.11_CHANGED_FILES.txt)
- [Changed-file SHA-256 checksums](releases/v0.7.11/AI_RV_Harness_v0.7.11_CHANGED_FILES_SHA256.txt)
- [Application instructions](releases/v0.7.11/AI_RV_Harness_v0.7.11_APPLY_README_PL.md)

## Root-directory policy

The repository root is reserved for files that developers, hosting platforms and package tooling expect to find immediately:

- `README.md`;
- `LICENSE` and the supplementary content licence;
- `SECURITY.md`;
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`;
- `CREDITS.md`;
- `CITATION.cff`;
- package, TypeScript, Vite, Tauri and environment configuration files.

Checkpoint records, release plans, reports, manifests, verification logs and historical requirements belong under `docs/`. Generated build output and dependency directories do not belong in source archives.

## Rules for future documentation

1. Put new release-specific documentation in `docs/releases/vX.Y.Z/`.
2. Keep filenames versioned when the document describes one immutable release.
3. Update this index when adding a new documentation category or current-release document.
4. Use relative Markdown links and verify them before packaging.
5. Do not rewrite historical manifests merely because files were reorganized later; those manifests describe the package that existed at their recorded time.
6. Keep runtime resources in their existing `src/resources/` or `src-tauri/resources/` locations rather than moving them into documentation.
7. Keep `.git`, `node_modules`, `dist`, Rust `target` and compiler cache files out of complete-source archives.

## Legal and security documents

The authoritative project-level files remain in the repository root:

- [MIT source-code licence](../LICENSE)
- [CC BY 4.0 content licence](../CONTENT_LICENSE_CC_BY_4.0.md)
- [Security policy](../SECURITY.md)
- [Contributing guide](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Credits](../CREDITS.md)
- [Citation metadata](../CITATION.cff)
- [Credits and attribution records](credits/)


### Custom OpenAI wire parameter override

Custom OpenAI-compatible connections keep `max_tokens` as the compatibility default. A connection may explicitly override only the maximum-output-token wire field to `max_completion_tokens`. The override is scoped to that Custom OpenAI provider configuration, stored in existing application settings, and never changes the built-in OpenRouter, OpenAI, Google, Anthropic, Z.AI, DeepSeek, Mistral, or Blackbox mappings. The override introduced no migration; the current registry subsequently advanced through schema 032.

## Developer documentation language

Use English for primary developer setup, current architecture and developer-facing wiki pages. Retain dated Polish historical reports and optional PL counterparts without treating them as the current build recipe. See [Developer Guide](development/README.md).

## Documentation review record

[16 October 2026 synchronization report — English](reports/DOCUMENTATION_CURRENT_SYNC_2026-10-16_EN.md) records the source commit, corrected contracts, language policy and checks actually performed.

## Direct provider update — 19 October 2026

Mistral and Blackbox now include direct additional Viewer sampling and Chat Completions SSE. Mistral also preserves compatible thinking/text continuation. Blackbox supports explicit account endpoints and manual model IDs for non-legacy routes without guessed discovery. See [Mistral and Blackbox configuration and engineering contract](development/DIRECT_MISTRAL_BLACKBOX.md) for exact scope, code map and acceptance limits. Ollama Native is planned, not implemented. This update does not change the package/release version or claim live/Windows acceptance.
