# Targets and Training

Reviewed 16 October 2026 for the development line through T5. [Current status](Development-Status.md).

## Targets and frozen plans

The factory library contains **94 read-only targets in eight categories**: Mountains; Structures; Structures in mountain terrain; Water and combined elements; Human activity; Disasters and destruction; Space; Mixed targets. Stable identifiers and paired PL/EN Reveals preserve earlier history.

Full Training freezes 1–10 rounds of eight sessions, one target per category, before the first call. Partial Training uses explicit category counts and may include My Targets. My Targets never enter Full Training automatically. Repeat avoidance is Profile-scoped; the smallest remaining category pool limits available rounds. Resume never rerandomizes a saved plan. Historical seven-session curricula retain their recorded planner.

## Classic Training learning

After Reveal: **Viewer Review → Field Guide Update → Viewer Notes Reflection → optional Judge**. Field Guide and Notes each have a separate durable maximum of **two dispatched requests per session/packet**, including transport retry, output recovery and JSON/capacity repair. Restart does not reset it.

A valid UPDATE creates an immutable version. NO_CHANGE is the model's decision and is not a warning. A known rejected second proposal is recorded as failed_preserved: keep the exact prior memory or its absence and continue to Judge/next target with the real failure in expandable details. A successful Guide is not rolled back when Notes fails. Notes uses the exact Guide checkpoint after this update/preservation.

Stop, ownership/DB/hash/identity errors and unknown dispatch still interrupt. They are not treated as harmless failed learning. Unconfirmed requests require explicit resolution before another paid request.

## Budgets and context

Current Review/Judge allowance: 32,768 → 49,152. Learning: capacity C + 32,768 → C + 49,152, without increasing C. Automatic blind Viewer: 16,384 → 32,768. Actual model/context limits apply; see [provider guide](Providers-Models-and-AI-Monitor.md).

Training's top breadcrumb is neutral. New-run settings are separate from a saved run's Profile/model. Resume uses the saved identity or refuses an unavailable route. Completed runs retain memory warnings. Save also exports the first interrupted Session/checkpoint before any target completes.

## AI–AI Telepathic Training

This is a separate workflow for 2–6 Profiles. New fixed-lead series freeze the selected lead, participants, routes, learning and per-round geography. Each round locks a new target, permits up to three additional lead-guided cycles, then Reveal/reflections. It reads frozen Field Guide/Notes and never updates them. Legacy series retain their saved protocol/policy.
