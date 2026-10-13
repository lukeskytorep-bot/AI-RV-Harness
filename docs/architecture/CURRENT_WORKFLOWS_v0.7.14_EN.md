# Current workflows — v0.7.14 development line

**Reviewed:** 11 October 2026. **Source:** accepted AI RV branch through Training History UX, DOM interaction tests and their dependency fix. **Schema:** 031. Package version remains 0.7.13 in this source; the v0.7.14 name identifies development scope. This document reports implemented behavior, not release publication or a completed desktop smoke.

## Request, output and context budgets

Output allowance and input context are separate limits. A larger output allowance does not enlarge the model's context window. Provider-native reasoning may consume generation allowance; do not add OpenRouter-normalized and native token counters as if they represented independent work. Record the provider's finish reason and usage; provider metadata alone cannot establish which application step or retry it belonged to.

| Operation | Preferred first / recovery allowance | Owner |
| --- | --- | --- |
| Blind Viewer in ordinary automatic RV, Manual RV and classic Training | 16,384 → 32,768 | `src/sessions/viewerOutputRecovery.ts` |
| Research Viewer with a frozen policy | policy captured at Experiment Lock; new standard policy uses 16,384 → 32,768 | Research runner and the shared Viewer recovery layer |
| Legacy Research without the new policy snapshot | preserve its locked configured budget | compatibility path; no silent policy upgrade |
| Classic Training post-Reveal Viewer review | 16,384 → 32,768 | `budgetPolicy: training_reveal` in `src/providers/outputRecovery.ts` |
| Classic Training Field Guide and Viewer Notes proposals | document capacity C + 16,384 → C + 32,768 | `learningObjectOutputAllowance()` in `src/providers/operationResourceProfiles.ts` |
| Judge (ordinary and Training), RV post-Reveal Viewer/Monitor | 16,384 → 32,768 | analytical recovery |
| Live Monitor in existing RCP / classic Telepathic RV | 16,384 → 32,768 | existing Monitor engine, model ceiling retained |
| Judge in already locked Research without a Judge policy snapshot | 8,192 → 16,384 | legacy contract for missing scores; accepted scores unchanged |
| Learning-object proposals outside Training Reveal policy | C + 8,192 → C + 16,384 | capacity-bound resource profile |

These are preferred generation allowances, subject to the selected model/endpoint and available context. Known smaller limits can reduce the effective allowance; recovery must actually increase it or stop explicitly. An explicitly selected larger Viewer budget is preserved where supported. OpenRouter analytical Training Reveal requests use endpoint-capacity discovery rather than trusting an aggregate model limit alone. A policy change never authorizes silently changing the requested model.

The content capacity C does not increase with the generation allowance. A rejected, oversized or malformed Field Guide/Viewer Notes proposal is not an active learning version. Output recovery, JSON repair and document-capacity repair are distinct operations; the two-level Viewer rule must not be advertised as a universal cap of two HTTP calls for every workflow.

## Viewer completeness and durable recovery

`viewerResponseCompletion()` rejects explicit output-limit, error/refusal and empty results as complete Viewer evidence. HTTP 200 alone is insufficient. Incomplete material is retained with attempt metadata and cannot advance a phase as accepted evidence.

The shared resume ledger (`src/sessions/viewerResumeLedger.ts`) binds attempts to a stable `stepId` and request fingerprint, including the particular Monitor exchange or Special Task. `VIEWER_OUTPUT_ATTEMPT_STARTED` is durable evidence of dispatch intent; result/error events carry the same attempt identity. Restart does not reset the semantic recovery level.

- A confirmed first output-limit result can use the remaining larger-budget recovery.
- An exhausted second semantic attempt cannot receive a third automatic semantic attempt merely because the application restarted.
- Started dispatch without a reliably persisted terminal outcome is uncertain. Automatic paid continuation is blocked; use only the workflow's explicit recovery decision, where provided.
- Fingerprint drift or unresolved legacy attempt identity blocks unsafe automatic reconstruction; do not guess from the last displayed phase.
- Replay consumes accepted stored calls and suppresses duplicate writes. Live execution begins at the first missing call.

Transport retry has its own allowance and physical-attempt report. It does not erase semantic exhaustion or uncertainty.

## Training and Research Resume

Classic Training saves its active-target checkpoint and keeps the same Session during supported blind Resume. It does not create a fresh paid Session to conceal a partial one, rerandomize the target plan, duplicate accepted evidence, or reset Viewer recovery. After Reveal, completed stages remain complete; Resume proceeds from the first missing stage. Uncertain post-Reveal Viewer review requires the explicit decision in `trainingResumeRecovery.ts` and is rechecked under the review lease.

Research freezes configuration and output policy at lock. Supported explicit same-session Resume preserves the linked Session, events, frozen learning inputs and attempt ledger. It does not silently rerun an incomplete paid assignment as a new successful replacement. Legacy frozen policy remains readable without retroactively adopting newer budgets. See `src/research/researchResume.integration.test.ts` for regression evidence.

Neither Research nor AI–AI Telepathic Training writes Field Guide or Viewer Notes. Classic Training remains the learning-producing workflow.

## Training history and ending a run

The history header puts Show/Hide Sessions, Save and Archive icons beside the run name, with hover/focus tooltips and accessible labels. Resume stays in a separate row below metadata; End training is beside it. Flex/grid wrapping handles narrow layouts; these rows do not use absolute positioning to overlap the name or each other. Names and session identifiers use the RV-style 11px/1.25 monospace font at weight 400.

History starts expanded on a fresh screen mount. Its local toggle hides/shows the panel without clearing the active run, selected Session or expanded run. It is not a database/Profile setting.

End training records `termination: { reason: "user_finished", endedAt }` and status `Interrupted`. It means the user has ended further execution, not that all targets completed. Index, completed target IDs, Session IDs, checkpoint, snapshot and historical results remain intact. The marker survives restart and archive/restore; normal updates cannot remove it or return the run to Running. Resume and execute re-read and reject terminated runs. UI actions use a shared synchronous operation guard. Both Resume and End disappear after termination; history actions remain available. No Cancelled status or migration 032 is introduced.

Eligibility is centralized in `src/training/runLifecycle.ts`; termination is coordinated by `src/features/training/trainingTermination.ts`. Mounted interactions are tested in `TrainingScreen.dom.test.tsx` with the file-local jsdom environment. Commit both package.json and package-lock.json whenever test dependencies change.

## Markdown and live presentation

Accepted blind provider calls render as isolated records through `BlindTranscriptRecord`, not one Markdown string joined across phase boundaries. An open code fence or malformed fragment from one response cannot consume the next response. SafeMarkdown keeps its safety rules, including protection against unsolicited remote Markdown image loads. A literal/raw fallback is an honest display choice; it does not rewrite saved evidence to manufacture bold text or remove headings.

Live presentation is provisional until a response is accepted. Streamed characters are not proof of semantic completion. An output-limit or stream failure must retain its diagnosis and incomplete state rather than becoming a complete phase just because some text is visible.

## Profile and help controls

AI Center, Conversation and RV Sessions use the shared ProfileSelector. Selecting another Profile synchronizes its compatible Conversation and RV Workspace context; selecting the already active Profile preserves a manually opened compatible Workspace. Selectors display the Profile belonging to visible workspace data. Specific Workspace changes remain in Profiles; no additional Workspace selector is added to Conversation/RV headers.

ModuleHelpButton and ModuleHelpPanel provide the common green help style with the module icon and help label. Profile + How it works share the right header group where both exist; panels expand below the header. Targets' target-description/images control is outside this help unification.

## Costs, diagnostics and verification

There is no SessionCostGuard/CostAuthorization hard per-session spend blocker in the reviewed source. Pricing, preflight estimates, usage and possible duplicate billing remain useful diagnostics. An ambiguous paid call may have been billed; uncertainty protection remains despite removal of the spend blocker. A historical cost-limit statement in a release/checkpoint report is not a current runtime requirement.

Automated tests and source gates cover contracts and regressions. They do not prove desktop visual quality, upstream provider availability or completed release smoke. Execute the paired [desktop checklist](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md) on the exact release candidate and record platform/commit and actual results.

## Fixed-lead telepathy candidate

New telepathic series implement fixed_lead_v1 with geography, optional lead cycles, automatic AI finalization and role-safe transcript/history/export. This is a candidate pending native/visual acceptance; existing sections above describe the accepted input baseline. See [candidate workflow and ownership](TELEPATHY_FIXED_LEAD_v0.7.14_EN.md) and [implementation evidence](../reports/TELEPATHY_FIXED_LEAD_TRANSCRIPT_UX_IMPLEMENTATION_PL.md).

## BUDGET-0 compatibility

New Research drafts normalize Viewer control, requested/effective settings and output-policy snapshots together before preflight and Experiment Lock. The default is 16,384 with recovery at least 32,768; supported larger explicit budgets remain, while a shared smaller model ceiling limits the first allowance. New projects also freeze the Judge 16K/32K contract. Existing frozen Viewer policies (including 8K) and legacy projects are never rewritten by Resume; missing Judge scores in projects without the new Judge snapshot keep 8K/16K. Learning capacities and headroom are unchanged: Training Reveal uses C+16K/C+32K, other learning uses C+8K/C+16K. New Telepathy fixed-lead gateway budgets, including sharing consent 8K/16K, are unchanged. No live Monitor role is added to classic Training or Research.
