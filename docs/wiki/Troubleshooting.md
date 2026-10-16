# Troubleshooting

Record the exact app version, commit when using development source, OS, provider/model, operation, saved attempt IDs and actual error. Remove credentials/private evidence before sharing a report.

## Provider completed but Harness rejected the answer

HTTP 200 or finish_reason=stop does not prove a usable final response. Reasoning-only/empty/malformed output can be rejected after transport finishes. response_finished distinguishes known completed transport from unknown dispatch; it does not mean commit. Do not keep resending while an earlier paid attempt is unresolved. A bounded learning final candidate can support offline analysis without another call.

## Training reports a failed memory update

Expand the Field Guide/Viewer Notes details. After at most two shared dispatched requests, a known failed update can retain prior memory/absence and let Training proceed. This is failed_preserved, not model NO_CHANGE. It does not require Resume just to close optional learning. Stop, ownership/DB/hash/identity errors and uncertain dispatch remain interruptions and need their actual recovery path.

## Resume and saved identity

Resume reuses the saved Profile/model, target order, snapshots and accepted calls. Selecting new-run settings does not change an old run. If a saved route is unavailable or state/fingerprint is unsafe, restore a valid configuration or inspect the real error; do not silently substitute another model. Explicit essential-step retry retains history and cannot reset learning.

## Long calls and Stop

Classic native heartbeat is independent of a WebView timer, but cannot run while the whole process/computer is suspended. Real loss of lease/DB/view closes the operation and fences late writes. Stop cancels active transport and later stages; End permanently ends further execution while keeping history. Transport cancellation can still leave uncertain billing/dispatch.

## Output and network errors

length means the generation reached an output limit; eligible recovery is bounded by the operation/frozen policy and available context. Current analytical/Manual RV pairs differ from automatic blind Viewer/live Monitor. See [Providers](Providers-Models-and-AI-Monitor.md). 429 or a body reset may be upstream/network failures, not proof of a particular model defect. Unknown dispatch must not be reclassified just to enable retry.

## Data and exports

Use backup/restore and compatibility diagnostics; do not delete the only database to clear an error. Export is available for a stopped first Session/checkpoint even before any target completes. Inspect summary.md, learning settlements and saved transcript. Report a missing exported checkpoint separately from provider output failure.

For security problems follow the repository SECURITY.md privately. For ordinary bugs include a minimal redacted reproduction and checks actually performed.
