# Current development status

Reviewed 17 October 2026 against the OR-SAMPLING implementation line derived from `ai-rv-2` Training Continuity T5. Package version remains 0.7.13 and the current development schema is 32. This is development documentation, not a new public-release announcement.

The source includes separate Conversations/RV Sessions, typed Workspaces, 94 factory targets/eight categories, fixed-lead telepathic exchange/Training, durable Stop/Resume/End, frozen Research, paged telepathic history, native classic workflow heartbeat and Training Continuity T1–T5.

Classic Training can complete with failed optional memory updates: previous memory/absence stays intact, the real failure remains in expandable details and export, and each memory kind has a durable maximum of two dispatched requests per session/packet. Essential stages and genuine execution failures retain their own stricter rules.

Training now shows neutral module context, the saved run Profile/model and an exportable active interrupted checkpoint. It cannot silently use a newly selected Profile/model when resuming an existing run.

Implementation, automated checks, interactive Windows acceptance and paid-model tests are separate evidence. Final runtime acceptance is recorded on an exact candidate; green patch CI alone does not publish v0.7.14. See the repository [runtime checklist](../architecture/FINAL_RUNTIME_SMOKE_v0.7.14_EN.md).

The historical [public v0.7.13 status](Development-Status-v0.7.13.md) retains its original schema-27 release scope. Current registry is 001–032; migration 032 adds persisted OpenRouter Viewer sampling settings. Legacy database classification remains mandatory.


## OpenRouter additional sampling parameters

The current development line adds optional Viewer-only OpenRouter controls for `top_p`, `top_k`, and `seed`. The section is disabled by default, Auto means the field is omitted from the provider request, and existing temperature remains an independent setting. Manual values are frozen into Session/Research generation settings and survive Resume; later profile edits do not rewrite a running or locked experiment.

Manual sampling uses fail-closed endpoint capability qualification, including small requests that would otherwise skip capacity discovery. A request is dispatched only when sampling support is confirmed and existing capacity/routing constraints still fit. OpenRouter `provider.require_parameters` is used as an additional wire safeguard, not as a replacement for local endpoint qualification. Optional classic-Training learning continues to follow Training Continuity T5.

See [OpenRouter Sampling Parameters](../architecture/OPENROUTER_SAMPLING_PARAMETERS_v0.7.14_EN.md) for the contract, caveats and runtime acceptance checklist.
