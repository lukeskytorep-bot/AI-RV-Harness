# Engineering Design and Integrity Safeguards

Current development: schema 31, through Training Continuity T5. See the full [engineering record](../architecture/ENGINEERING_DESIGN_AND_INTEGRITY_SAFEGUARDS.md) and [Developer Guide](../development/README.md).

- Blind Viewer/Monitor packets exclude target and Reveal until evidence is sealed. Telepathic receiver packets also exclude hidden geography and other receivers' blind answers.
- Immutable Session snapshots, sealed evidence, Research Lock, frozen Judge scores and learned versions are not silently replaced by current defaults.
- Judge receives a constructed allowlist packet and uses the fixed 3+3+2+2 rubric. Scores freeze before Research unblinding.
- Transport retry, semantic recovery and domain repair have explicit owners. Classic optional learning shares one durable two-dispatch allowance instead of multiplying these mechanisms.
- failed_preserved is distinct from NO_CHANGE and from execution interruption. Stop, DB/ownership/hash/identity/unknown dispatch cannot be hidden as optional learning failure.
- response_finished proves full transport, not semantic validity/commit. Every physical outcome matters; accepted results replay before missing work.
- Final answer, reasoning, continuation and diagnostics are separate data classes. Bounded final candidates do not authorize copying private reasoning into evidence.
- Native classic heartbeat renews every 10 seconds with TTL 45 seconds; owner/version/expiry fencing remains. Loss/DB failure/destruction cancels bound transport and rejects late writes. Other leases retain their own contracts.
- Named native writes, controlled purge, backups and additive migration tests protect persistence. No broad architecture exceptions are required.

Automated green checks, actual Windows smoke and published release provenance answer different questions. Record each separately on the exact candidate and do not infer scientific accuracy from software correctness.
