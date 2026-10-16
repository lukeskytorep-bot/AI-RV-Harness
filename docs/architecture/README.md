# AI RV Harness architecture documentation

These living documents describe the accepted AI RV development source through Training Continuity T5, reviewed 16 October 2026, with SQLite schema 031. The documented public baseline remains v0.7.13; this update does not verify current GitHub publication or claim a completed v0.7.14 desktop smoke. Release-specific notes and verification records remain under [`docs/releases/`](../releases/); historical implementation and audit reports remain under [`docs/reports/`](../reports/).

The completed v0.7.13 modularization work adds the following living architecture records. Stages 1–9 and the modularization campaign are closed after their accepted automated gates. The desktop checklist is retained as the release/runtime regression procedure and is accompanied by the final v0.7.13 release verification record:

- [Code map](CODE_MAP.md)
- [Module boundaries](MODULE_BOUNDARIES.md)
- [ADR-0001: Modular monolith](decisions/ADR-0001-MODULAR_MONOLITH.md)
- [ADR-0003: Stable storage facade and domain repositories](decisions/ADR-0003-STORAGE_FACADE.md)
- [Central provider retry architecture](PROVIDER_RETRY_ARCHITECTURE_FINAL_EN.md) ([PL](PROVIDER_RETRY_ARCHITECTURE_FINAL_PL.md))
- [Provider continuation contract v1](PROVIDER_CONTINUATION_CONTRACT_V1_EN.md) ([PL](PROVIDER_CONTINUATION_CONTRACT_V1_PL.md))
- [Native Rust provider module boundaries](MODULE_BOUNDARIES.md#native-rust-provider-modules-after-etap-6)
- [UX-DATA compatibility gate](UX_DATA_COMPATIBILITY_GATE.md)
- [v0.7.13 public release verification](../releases/v0.7.13/RELEASE_VERIFICATION_v0.7.13.md)
- [v0.7.14 development final runtime/release smoke](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md) ([PL](FINAL_RUNTIME_SMOKE_v0.7.14_PL.md))
- [Stage 9 modularization closeout](../reports/MODULARIZATION_STAGE_9_CLOSEOUT_v0.7.13_PL.md)

## Developer entry point

- [English Developer Guide](../development/README.md) — setup, exact check commands, ownership, learning/recovery contracts and review policy.
- [English user/wiki mirror](../wiki/Home.md) — concise product guidance for the same development line.

## Current workflow reference

- [Recovery, presentation and Training history — EN](CURRENT_WORKFLOWS_v0.7.14_EN.md) ([PL](CURRENT_WORKFLOWS_v0.7.14_PL.md))

## Documents

| Document | Purpose |
| --- | --- |
| [System Overview](SYSTEM_OVERVIEW.md) | High-level product structure, roles, workflows, storage model, provider layer, and current capabilities. |
| [Engineering Design and Integrity Safeguards](ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md) | Stable engineering decisions protecting blinding, evidence, judging, Research, provider normalization, recovery, and persistence. |
| [AI Center and Viewer Notes](AI_CENTER_AND_VIEWER_NOTES.md) | Identity scope, note lifecycle, immutable provenance, source-preservation behavior, Research controls, and controlled-purge integration. |
| [Training, target pack, and typed Workspaces](TRAINING_TARGETS_AND_TYPED_WORKSPACES.md) | Current 94-target/eight-category curriculum, Full Training rounds, Viewer learning order, top-level Conversations/RV Sessions split, typed Workspaces, and schema 031 development compatibility. |

## Language and publication policy

- English is the default language for public-facing and living architecture documentation.
- Polish versions may coexist as working or translated counterparts and should use the `_PL` suffix when both language versions exist.
- Audit reports, implementation checkpoints, and internal execution plans may remain Polish unless they become part of the public architecture or release surface.
- When both EN and PL exist, architecture indexes should link to EN first and expose PL as an alternate version.

## Documentation policy

- Architecture documents describe the current implemented system, not a release checklist.
- Version-specific implementation evidence belongs in `docs/releases/vX.Y.Z/`.
- Historical specifications and checkpoints remain historical records and are not silently rewritten.
- Material changes to blinding, scoring, AI identity, provider normalization, persistence, or Research controls must update the relevant architecture document in the same change.
- The code map and module-boundary documents are living records and must be updated whenever ownership or a protected boundary changes.
