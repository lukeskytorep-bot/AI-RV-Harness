# AI RV Harness documentation

This directory contains project documentation that is useful for development, review, release reconstruction and historical audit but is not required in the repository root.

## Directory structure

| Directory | Purpose |
| --- | --- |
| [`architecture/`](architecture/) | Current system overview, engineering invariants, integrity safeguards, and feature architecture. |
| [`checkpoints/`](checkpoints/) | Historical implementation checkpoints from v0.6.0 through v0.7.7. |
| [`releases/`](releases/) | Version-specific plans, notes, reports, manifests, verification records and patch documentation. |
| [`specifications/`](specifications/) | As-built functional and technical specifications. |
| [`requirements/`](requirements/) | Historical requirements, accepted correction sets and test-derived change lists. |
| [`prompts/`](prompts/) | Design records for bundled prompt packages. Runtime prompt resources remain in source/resource directories. |
| [`credits/`](credits/) | Credit history, attribution policy and technical-reference records supporting the root `CREDITS.md` and `CITATION.cff`. |

## Current release documentation

The current development baseline is v0.7.12:

- [Architecture documentation index](architecture/README.md)
- [System overview](architecture/SYSTEM_OVERVIEW.md)
- [Engineering design and integrity safeguards](architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md)
- [AI Center and Viewer Notes architecture](architecture/AI_CENTER_AND_VIEWER_NOTES.md)

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
