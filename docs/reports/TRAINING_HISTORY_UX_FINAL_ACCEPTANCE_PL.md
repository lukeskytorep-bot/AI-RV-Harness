# Training History UX — final acceptance / consolidated base

Data: 2026-10-11.

Status: ACCEPTED after green CI reported by the user and final DOM dependency/test fixes supplied by the auditor.

Consolidated line includes:
- accepted Viewer Output Safety through STEP C AUDIT FIX 4 from the input base;
- Training History UX STEP 1 foundation + AUDIT FIX + AUDIT FIX 2;
- STEP 2 HISTORY UI + AUDIT FIX + AUDIT FIX 2 + AUDIT FIX 3;
- DOM interaction tests CI candidate;
- TRAINING_HISTORY_DOM_DEPENDENCIES_FIX;
- TRAINING_HISTORY_DOM_FINAL_FIX.

Final Training History behavior:
- durable user termination marker without pretending Completed;
- Start/Resume/End/Archive share a synchronous operation guard;
- archive and termination writes preserve concurrent state safely;
- three header icons, separate Resume/End row, collapsible history, RV Sessions monospace typography;
- portal tooltips with viewport clamping and hover/focus behavior;
- mounted TrainingScreen DOM tests under jsdom 26.1.0;
- schema remains 031 and migrations 001-031 are unchanged.

Local consolidation checks on the reconstructed full tree:
- verify:ux-data: PASS, 31 migrations;
- verify:source: PASS;
- verify:v0.7.14-release-gate: PASS.

GitHub Actions / full automated test suite: user reports green after the final auditor files were applied.

Visual Windows/Tauri smoke at 330px/breakpoint/125-150% zoom remains part of the broader final runtime smoke checklist and is not reclassified here as locally executed.

Next formal roadmap step in the current source tree: docs/architecture/FINAL_RUNTIME_SMOKE_v0.7.14_PL.md.
