# Engineering Design and Integrity Safeguards

Current development: schema 31, through Training Continuity T5. See the full [engineering record](https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/ai-rv-2/docs/architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md) and [Developer Guide](https://github.com/lukeskytorep-bot/AI-RV-Harness/blob/ai-rv-2/docs/development/README.md).

- Blind Viewer/Monitor packets exclude target and Reveal until evidence is sealed. Telepathic receiver packets also exclude hidden geography and other receivers' blind answers.
- Immutable Session snapshots, sealed evidence, Research Lock, frozen Judge scores and learned versions are not silently replaced by current defaults.
- Judge receives a constructed allowlist packet and uses the fixed 3+3+2+2 rubric. Scores freeze before Research unblinding.
- Transport retry, semantic recovery and domain repair have explicit owners. Classic optional learning shares one durable two-dispatch allowance instead of multiplying these mechanisms.
- failed_preserved is distinct from NO_CHANGE and from execution interruption. Stop and DB/ownership/hash/identity failures remain interruptions. Unknown optional-learning results in Classic Training preserve memory without resending or operator approval; unknown essential calls retain their recovery contract.
- response_finished proves full transport, not semantic validity/commit. Every physical outcome matters; accepted results replay before missing work.
- Final answer, reasoning, continuation and diagnostics are separate data classes. Bounded final candidates do not authorize copying private reasoning into evidence.
- Native classic heartbeat renews every 10 seconds with TTL 45 seconds; owner/version/expiry fencing remains. Loss/DB failure/destruction cancels bound transport and rejects late writes. Other leases retain their own contracts.
- Named native writes, controlled purge, backups and additive migration tests protect persistence. No broad architecture exceptions are required.

Automated green checks, actual Windows smoke and published release provenance answer different questions. Record each separately on the exact candidate and do not infer scientific accuracy from software correctness.

## Windows Tauri incident and maintenance decision — 17 October 2026

Training sometimes closed completely around Reveal or window interaction. The original EXE showed APPCRASH 0xC000001D and a UD2 reference-count trap, strongly matching Tauri Context cloning thread-affine state. A matched dump/PDB was unavailable, so the full corruption sequence is not proven. The affected versions were tauri 2.11.5, runtime-wry 2.11.4, tao 0.35.3 and wry 0.55.1.

The repair pins a local runtime source: the strong event-loop target stays on its owner thread; dispatchers carry private atomic weak tokens and check thread identity before upgrade. Shared ownership observers use 2-second visible / 10-second hidden polling without overlap; only Acquire allocates a loss channel. Native heartbeat and write/dispatch fences remain. Extra IPC could increase overhead and exposure to the runtime bug; polling reduction alone does not prove memory safety.

A newer Tauri version may replace this patch only after its released fix and resolved dependencies are checked against owner-thread access, clone/drop and teardown guarantees. Review the replacement separately, update lockfile and patch gates, retain equivalent tests and IPC improvements, and repeat standalone Windows IPC/Reveal/Stop/Resume/minimize acceptance. Record the replacement version and evidence. Do not remove the local protection solely because a new release exists.

## Automatic Training continuity decision — 17 October 2026

Later hardening had blocked unattended Training on optional learning and introduced duplicate warnings. We selectively restored automatic progression while retaining larger accepted budgets, evidence and native persistence safeguards. Invalid JSON/schema/capacity output uses only the existing bounded recovery; if it still fails, preserve the previous document/absence, audit failed_preserved and continue. Never pretend an invalid proposal succeeded. An unknown optional-learning result is preserved without another paid call or a manual resolution gate. Missing optional Review skips dependent learning and continues. Actual Stop/ownership/database/hash/identity failures remain distinct.

Keep detailed learning diagnostics in AI Center / Field Guide / Viewer Notes histories, not repeated beneath Training. Models can fail to shorten notes or count tokens; this must not stop the curriculum. Do not automatically overflow Guide content into Notes or increase capacities. Prompt improvements are deferred.

Edward reported a completed approximately 20-minute Training and verified that Stop did not close the repaired app. Earlier Stop/crash coincidence is not a proven Stop-handler defect. This is user scenario feedback, not a full controlled benchmark or complete Windows soak. See [Troubleshooting](Troubleshooting.md) and the repository engineering record above for future regression requirements.

## Direct provider contracts — 19 October 2026

Mistral and Blackbox now share bounded SSE infrastructure while retaining separate parameter mapping, response/error handling and route identity. Do not copy OpenRouter-only fields into their requests or treat HTTP 200 as proof that a sampler was applied. Blackbox non-legacy models can be registered explicitly without guessed discovery; credentials remain endpoint-bound. Preserve current budgets, unattended Training continuity and bounded IPC. Ollama Native remains planned and needs NDJSON rather than SSE. See [Decision 27](../architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md#decision-27--direct-provider-contracts-remain-distinct) and the [direct provider guide](../development/DIRECT_MISTRAL_BLACKBOX.md).
