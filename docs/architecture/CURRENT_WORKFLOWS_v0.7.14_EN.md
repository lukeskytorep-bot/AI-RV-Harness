# Current workflows — v0.7.14 development line

Reviewed **16 October 2026**, through Training Continuity T5, against `ai-rv-2` commit `9c92bdbb94d1125406e0094779102458cdeee87c`. Package version remains **0.7.13**; schema **31**. Implemented source behavior is distinct from a published release, interactive Windows acceptance and actual upstream model tests. Start with the English [Developer Guide](../development/README.md).

## Output and context budgets

Output allowance is not input-context capacity. Reasoning may consume output allowance. Do not add normalized and native usage counters twice or infer a local commit from a provider's finish reason.

| Operation | Current preferred first / recovery allowance | Source owner |
| --- | --- | --- |
| Conversation | 16,384 default; no universal semantic two-call rule | `src/startupDefaults.ts`, `src/chat/outputPreference.ts` |
| Manual RV Viewer | 32,768 → 49,152 | `src/chat/outputPolicy.ts` |
| Automatic blind Viewer and classic Training blind Viewer | 16,384 → 32,768 | `src/sessions/viewerOutputRecovery.ts` |
| New Research Viewer | normally 16,384 → 32,768, frozen at lock; supported larger configured values preserved | `src/research/engine.ts`, frozen condition policy |
| Judge, post-Reveal Viewer/Monitor, classic Training Review | 32,768 → 49,152 | `src/providers/outputRecovery.ts` current analytical policy v2 |
| Classic Training Field Guide / Viewer Notes | C + 32,768 → C + 49,152 | `learningObjectOutputAllowance()` in `src/providers/operationResourceProfiles.ts` |
| Live Monitor | 16,384 → 32,768 | `src/monitor/engine.ts`, immutable analytical v1 constants |
| Locked Research Judge with analytical policy v1 / v2 | 16,384 → 32,768 / 32,768 → 49,152 | frozen `judgeOutputPolicy` and `analyticalBudgetPolicyForSnapshot()` |
| Legacy locked Research without a Judge policy snapshot | 8,192 → 16,384 for missing work | `legacy_analytical` compatibility policy |
| New fixed-lead telepathic Reveal, shared comments, series reflection | 32,768 → 49,152 | `src/telepathicExchange/outputBudgets.ts`, policy v3 |
| Other new fixed-lead stages | 16,384 → 32,768 | same stage table |
| Telepathic sharing consent | 8,192 → 16,384 | same stage table |

C is document capacity and does not grow with output headroom. Learning requires explicit `training_reveal`; there is no current C+8K/C+16K fallback for an unspecified learning policy. These preferences are bounded by actual model/endpoint and context capacity; an unavailable larger recovery fails explicitly rather than changing models or accepting partial output. OpenRouter endpoint-capacity discovery is used where the operation contract permits it.

Conversation's former unversioned saved 8,000/8,192 value upgrades once to 16,384 using `conversationOutputBudgetVersion`. A deliberate later reduction remains. The RV/global defaults are separate settings. Older Research/telepathic snapshots are never silently rewritten to today's table. Existing fixed-lead scopes retain policy v1/v2/v3 and attempt history.

## Transport evidence, semantic validity and commit

`response_finished` is transport completion evidence (`body_read` or `sse_done`), including a completed rejected answer. It is not semantic acceptance or durable commit. The classifier in `src/providers/responseEvidence.ts` considers every physical attempt: a later finished response cannot settle an earlier unknown dispatch. HTTP 200, dashboard token counts and `finish_reason=stop` alone are insufficient.

Rust sends one physical attempt. `requestExecutor.ts` owns classified transport retry and attempt diagnostics; output/JSON/capacity repair belongs to its domain. `semanticOutputStarted`, cancellation, permanent errors and dispatch uncertainty constrain retries. See [retry architecture](PROVIDER_RETRY_ARCHITECTURE_FINAL_EN.md).

Final-channel text and private reasoning remain separate. Initial reasoning envelopes may be removed; literal `<think>` text inside a JSON string remains data. A bounded final candidate, hash, native validation and attempt identifiers can cross IPC on success or error and be stored in existing learning events. `learning_candidates.json` supports offline review without another paid generation. Missing final text is not filled with private reasoning.

## Classic Training continuity and learning

The durable sequence is blind Session → Reveal → Viewer Review → Field Guide Update → Viewer Notes Reflection → optional Judge. Each learning kind has its own **maximum of two dispatched requests per Session/packet**, shared across all physical retries, output recovery and domain repair. The durable reservation/ledger survives restart. A proven `not_dispatched` slot may be released; unknown dispatch is not proof of an unused slot.

| Settlement | Memory | Training |
| --- | --- | --- |
| `updated` | One immutable accepted version | Continue |
| `model_no_change` | Existing version/absence retained | Continue without warning |
| `failed_preserved` | Previous exact version/absence retained; real FAILED_* audit and cause | Continue; detailed audit in AI Center, no Training warning list |
| `disabled` | No learning operation | Continue |

Classic Training explicitly selects `preserve_and_continue` for optional post-Reveal learning. After bounded recovery, an invalid JSON/schema/capacity proposal preserves the exact previous learning version or absence, records `failed_preserved`, and continues to eligible remaining stages and the next target. It is not model `NO_CHANGE`. An unknown optional-learning result is preserved and audited without another paid dispatch or a user confirmation; it is not relabelled as a successfully completed transport. An unavailable optional Viewer Review skips dependent learning while retaining the Session and continuing. Stop, actual loss of ownership, database/audit persistence failure, identity/hash corruption and mandatory evidence failures still interrupt. Blind Viewer, Judge, Research and non-Training callers retain their own contracts. Audit/settlement persistence must succeed before advancing the checkpoint. Existing failed known-result histories can be recovered without issuing another request.

Viewer Notes receives the exact Field Guide version after this session's update or preservation, never an arbitrary newer active version. Successful Field Guide remains active when Notes fails. If Notes never had a first version, failure leaves no version and UI says so. Source owners are `learningExecution.ts`, `fieldGuideUpdate.ts`, `viewerNotes.ts` and `trainingExecution.ts`.

Only classic Training produces these updates. Ordinary RV, Conversations, Research and AI–AI Telepathic Training use allowed learning snapshots read-only.

## Shared Resume, Stop and End

Viewer attempts retain stable step/fingerprint/dispatch identity. UI and engines share `viewerResumeDecision.ts` / `viewerResumeLedger.ts` and the transport classifier. Accepted stored results replay locally before the first missing call. Completed rejected output is not shown as a request still generating. Exhausted essential Viewer recovery may require explicit one-attempt authorization that retains history; it does not reset learning or create an automatic retry loop. Unknown essential-step dispatch retains its explicit resolution path. The optional Classic Training learning exception above preserves memory without resending or requiring operator resolution. Unsafe legacy/fingerprint state fails closed.

Classic Training Resume retains the Session, target order and frozen inputs. Review and each learning/Judge stage resume from the first missing stage. Research retains frozen config, linked Sessions, blinding and Judge policies. Stop cancels current work and prevents subsequent dispatch. End is terminal and distinct from Stop or completion.

Training stores `termination: { reason: "user_finished", endedAt }` with status `Interrupted`. It preserves progress, checkpoints, snapshots and results across restart/archive/restore. Engine/repository checks refuse stale execution, and Resume/End actions disappear after termination. RV and Research terminal markers have their own guarded APIs; Research's marker is outside its frozen configuration.

## Native ownership

Classic SQLite owned workflows acquire an exact profile/owner/version token. Rust `workflow_heartbeat.rs` renews every **10 seconds**, TTL **45 seconds**, independently of WebView JS timers. SQL still rejects expired/stale ownership. Bound provider IDs are cancelled on ownership loss, heartbeat DB error or destroyed window; failed ownership fences later writes even before lease expiry. TS preserves the actual abort reason and received transport evidence.

Release stops the exact heartbeat. `WindowEvent::Destroyed` cancels/releases it; `CloseRequested` alone does not. Failed start releases the acquired token and a late acquisition cannot start after destruction. Native handshake `nativeHeartbeat:true` disables the JS timer; old ports without the flag retain compatibility fallback. The current single-window process does not recreate a destroyed label; full restart resets the registry. Separate telepathic and post-Reveal leases retain their own contracts. Sleeping the entire computer is not equivalent to switching programs.

## Training context, history and export

Training's top breadcrumb is neutral, not the unrelated global Conversation Workspace. New-run settings are labeled separately. Active/history context shows the saved Profile/model; a new dropdown choice does not silently rebind Resume.

Show/Hide Sessions, Save and Archive remain beside the history title with accessible tooltips; recovery controls stay in their established row. The history toggle is local UI state. Completed runs show a failed-update count and expandable separate Field Guide/Notes causes. NO_CHANGE is not a warning. AI Center uses the same warning language and retained-version/absence distinction.

A stopped first Session can be exported even before `run.sessionIds` contains it. `src/training/export.ts` includes the active checkpoint, readable saved Session, settlement/version/hash/audit data and bounded candidates. Settlements merge run/checkpoint/events without duplicates. `summary.md` links to details. An unfinished Session does not inflate completed progress or completed-score means. Exports may contain private evidence; review them before sharing.

## Telepathic roles, history and presentation

New fixed-lead series freeze the lead, participants, personal learning, routes, geography and stage policies. Each round locks a fresh target; up to three lead-guided cycles can precede Reveal. Legacy protocol markers preserve earlier semantics. Operator visibility is broader than model visibility. Receivers do not see target/geography or other receivers' blind text before Reveal; consent controls later sharing. These are packet/visibility rules, not proof against every semantic leak. New decisions use `fixed_lead_guidance_v2`: one separately addressed `individual` instruction per active Viewer, or an explicit finish for that Viewer. The whole round can end with an empty instruction list. Identical questions must be repeated as separate addressed entries. Saved v1 decisions and requests keep their original contract, including accepted broadcasts.

History reads lightweight 50-summary pages, filtered before LIMIT, with updatedAt/id cursor order; opening/exporting one item loads its full state without a model call. Polling uses safe projections, call IDs and ownership-aware waiting; it must not turn an old uncertain dispatch into live generation. Readable instruction/answer projection is separate from evidence/continuation. This is implemented history work, not completion of every planned refresh/storage optimization.

`BlindTranscriptRecord` and telepathic transcript records isolate Markdown boundaries. One unfinished code fence cannot swallow the next accepted response. SafeMarkdown blocks unsolicited remote image loads. Provisional stream text is not accepted evidence.

## Verification and release status

Use the full English [Developer Guide](../development/README.md) check list. The architecture allowlist is empty and schema remains 31. There is no hard SessionCostGuard/CostAuthorization spend blocker; estimates, known cost subtotals and ambiguous billing diagnostics remain independent of uncertainty protection.

Source tests, real SQLite fixtures and native tests answer different questions from a real Windows window or a paid upstream provider. Record final acceptance with commit/platform/model and actual results using the [runtime checklist](FINAL_RUNTIME_SMOKE_v0.7.14_EN.md). Historical manifests and v0.7.13 release verification retain their dated scope.
