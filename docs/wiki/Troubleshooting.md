# Troubleshooting

Record the exact app version, commit when using development source, OS, provider/model, operation, saved attempt IDs and actual error. Remove credentials/private evidence before sharing a report.

## Provider completed but Harness rejected the answer

HTTP 200 or finish_reason=stop does not prove a usable final response. Reasoning-only/empty/malformed output can be rejected after transport finishes. response_finished distinguishes known completed transport from unknown dispatch; it does not mean commit. Do not keep resending while an earlier paid attempt is unresolved. A bounded learning final candidate can support offline analysis without another call.

## Training reports a failed memory update

Check the existing AI Center / Field Guide / Viewer Notes histories. Classic Training explicitly uses preserve_and_continue: known invalid proposals use at most the existing two shared dispatched requests, then retain previous memory/absence and continue as failed_preserved, not model NO_CHANGE. An unknown optional-learning result is preserved without another paid call or a user confirmation. An unavailable optional Review skips dependent learning and continues to eligible later stages/targets. Training does not duplicate warning lists or memory-failure counters. Stop, real ownership/DB/hash/identity failures and uncertain essential-step calls retain their own interruption/recovery contract. Models may miscount tokens or fail shortening instructions; this does not justify accepting invalid documents, automatically enlarging them or stopping the whole run.

## Resume and saved identity

Resume reuses the saved Profile/model, target order, snapshots and accepted calls. Selecting new-run settings does not change an old run. If a saved route is unavailable or state/fingerprint is unsafe, restore a valid configuration or inspect the real error; do not silently substitute another model. Explicit essential-step retry retains history and cannot reset learning.

## Long calls and Stop

Classic native heartbeat is independent of a WebView timer, but cannot run while the whole process/computer is suspended. Real loss of lease/DB/view closes the operation and fences late writes. Stop cancels active transport and later stages; End permanently ends further execution while keeping history. Transport cancellation can still leave uncertain billing/dispatch.

## Output and network errors

length means the generation reached an output limit; eligible recovery is bounded by the operation/frozen policy and available context. Current analytical/Manual RV pairs differ from automatic blind Viewer/live Monitor. See [Providers](Providers-Models-and-AI-Monitor.md). 429 or a body reset may be upstream/network failures, not proof of a particular model defect. Unknown dispatch must not be reclassified just to enable retry.

## Data and exports

Use backup/restore and compatibility diagnostics; do not delete the only database to clear an error. Export is available for a stopped first Session/checkpoint even before any target completes. Inspect summary.md, learning settlements and saved transcript. Report a missing exported checkpoint separately from provider output failure.

For security problems follow the repository SECURITY.md privately. For ordinary bugs include a minimal redacted reproduction and checks actually performed.

## Windows app closes during Training, Reveal or window interaction

The October 2026 incident produced native APPCRASH 0xC000001D; the old EXE had a UD2 reference-count trap strongly matching Tauri Context cloning. It was not merely a model JSON rejection. The local runtime ownership repair and IPC reduction are described in [Engineering Decisions](Engineering-Design-and-Integrity-Safeguards.md).

After the repairs, Edward reported Training completing in about 20 minutes and Stop working without closing the app. Do not infer from the earlier timing that Stop intentionally exits the process, or that high IPC alone explains every crash. If it recurs, retain the exact EXE hash/commit, Windows/WebView2 versions, error code and matching private PDB/dump. Do not apply the old RVA to a new build, remove UD2 checks, loosen JSON validation or raise token limits as a crash workaround. Raw dumps can contain sensitive data.

For a future Tauri upgrade, verify the upstream fix covers the local ownership guarantees before removing the patch; test the actual standalone Windows EXE through IPC, Reveal, Stop/Resume and minimize/restore. A new version number alone is not sufficient.
