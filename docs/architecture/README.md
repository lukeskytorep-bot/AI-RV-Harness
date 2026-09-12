# AI RV Harness architecture documentation

These documents describe the implemented architecture and integrity model of AI RV Harness. The latest public release remains v0.7.12; the private v0.7.13 development baseline extends it through the modularization and UX-DATA campaign. Release-specific plans, reports, manifests, and verification records remain under [`docs/releases/`](../releases/) or [`docs/reports/`](../reports/) for private-development work.

The private v0.7.13 modularization work adds the following living architecture records. Stage 8 is accepted after full GitHub Actions; Stage 9 is the final validation/documentation gate and remains open until the desktop runtime smoke passes:

- [Code map](CODE_MAP.md)
- [Module boundaries](MODULE_BOUNDARIES.md)
- [ADR-0001: Modular monolith](decisions/ADR-0001-MODULAR_MONOLITH.md)
- [ADR-0003: Stable storage facade and domain repositories](decisions/ADR-0003-STORAGE_FACADE.md)
- [Central provider retry architecture](PROVIDER_RETRY_ARCHITECTURE_FINAL_PL.md)
- [Native Rust provider module boundaries](MODULE_BOUNDARIES.md#native-rust-provider-modules-after-etap-6)
- [UX-DATA compatibility gate](UX_DATA_COMPATIBILITY_GATE.md)
- [Final modularization runtime smoke](FINAL_RUNTIME_SMOKE_v0.7.13_PL.md)

## Documents

| Document | Purpose |
| --- | --- |
| [System Overview](SYSTEM_OVERVIEW.md) | High-level product structure, roles, workflows, storage model, provider layer, and current capabilities. |
| [Engineering Design and Integrity Safeguards](ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md) | Stable engineering decisions protecting blinding, evidence, judging, Research, provider normalization, recovery, and persistence. |
| [AI Center and Viewer Notes](AI_CENTER_AND_VIEWER_NOTES.md) | Identity scope, note lifecycle, immutable provenance, source-preservation behavior, Research controls, and controlled-purge integration. |

## Documentation policy

- Architecture documents describe the current implemented system, not a release checklist.
- Version-specific implementation evidence belongs in `docs/releases/vX.Y.Z/`.
- Historical specifications and checkpoints remain historical records and are not silently rewritten.
- Material changes to blinding, scoring, AI identity, provider normalization, persistence, or Research controls must update the relevant architecture document in the same change.
- The code map and module-boundary documents are living records and must be updated whenever ownership or a protected boundary changes.
