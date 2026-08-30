# AI RV Harness architecture documentation

These documents describe the implemented architecture and integrity model of AI RV Harness v0.7.12. Release-specific plans, reports, manifests, and verification records remain under [`docs/releases/`](../releases/).

## Documents

| Document | Purpose |
| --- | --- |
| [System Overview](SYSTEM_OVERVIEW.md) | High-level product structure, roles, workflows, storage model, provider layer, and current capabilities. |
| [Engineering Design and Integrity Safeguards](ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md) | Stable engineering decisions protecting blinding, evidence, judging, Research, provider normalization, recovery, and persistence. |
| [AI Center and Viewer Notes](AI_CENTER_AND_VIEWER_NOTES.md) | Identity scope, note lifecycle, version history, session timing, Research controls, and UI behavior introduced in v0.7.12. |

## Documentation policy

- Architecture documents describe the current implemented system, not a release checklist.
- Version-specific implementation evidence belongs in `docs/releases/vX.Y.Z/`.
- Historical specifications and checkpoints remain historical records and are not silently rewritten.
- Material changes to blinding, scoring, AI identity, provider normalization, persistence, or Research controls must update the relevant architecture document in the same change.
- A future source-code modularization may add a code map here; it should complement these decision records rather than duplicate them.
