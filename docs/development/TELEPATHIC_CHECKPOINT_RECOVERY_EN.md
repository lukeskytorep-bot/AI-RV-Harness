# Telepathic checkpoint recovery — stage 1

Reviewed 22 October 2026. This change separates local persistence failures from
provider transport failures; it does not authorize automatic API retries.

- `sqliteWriteCoordinator(databaseKey)` shares the write queue across SQLite
  repository instances in one WebView, including workflow-scoped repositories.
  Telepathic fenced batches use that queue too. Separate windows and native
  heartbeat tasks remain subject to SQLite locking and native ownership fences.
- BUSY/LOCKED retries use seven delays: 40, 80, 160, 320, 640, 1200 and 2000 ms.
  Exhaustion is explicit, so an outer checkpoint queue cannot multiply the same
  retry budget. Other errors are not retried.
- A native telepathic fenced batch begins with `BEGIN IMMEDIATE`, then checks
  owner, version and expiry in the same transaction. Every retry checks again.
  Statement and fence failures are rolled back explicitly. Failed commit or
  rollback acknowledgements carry `[sqlite-no-retry]`: automatic replay is
  blocked because a safe rollback has not been established.
- The gateway catches transport errors only around provider execution. Response
  validation and the final checkpoint run outside that catch. A received answer
  retains its text, usage, finish reason and generation ID while its local save
  is retried. Invalid/partial answers remain rejected.
- `TelepathicCheckpointError` stops the engine's model-attempt loop. It carries
  the current call record in memory and must never be interpreted as permission
  to purchase another response. An exhausted/permanent storage error can still
  leave only the preceding durable checkpoint after process termination.
- Round and finalization error handlers propagate checkpoint failures without
  another save. Direct `saveCheckpoint` failures become a typed
  `TelepathicSeriesCheckpointError` carrying the original cause and a copied
  series snapshot. Gateway failures retain their `TelepathicCheckpointError`
  and call record. Neither handler reopens an exhausted local retry budget or
  replays an ambiguous commit merely to store an error message.
- STOP does not authorize a new dispatch. A result already received can still be
  saved locally before the engine observes STOP.

Historical `uncertain` records are not automatically accepted by this stage.
Recovery from saved historical responses, explicit bounded transport retry
policy, panel integration and Research Judge recovery belong to stages 2–3 of
the automatic recovery audit. Sampling, token budgets, routing, lead prompts,
schema and learning policy are unchanged.

## Verification

Run the normal project gates plus:

```bash
npx vitest run src/telepathicExchange/providerCheckpointRecovery.test.ts src/storage/sqliteWriteCoordinator.test.ts src/storage/sqliteCheckpointRecovery.test.ts
cargo test --manifest-path src-tauri/Cargo.toml checkpoint_ --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

The TypeScript SQLite tests use the real repository facade and file-backed
SQLite with an emulated IPC boundary. They do not execute SQLx. Native Rust tests
cover atomic rollback, stale owner/version/expiry, and a concurrent native writer.
Windows runtime and live endpoints require separate acceptance.

For the subsequent implementation, see [Automatic Recovery S2](TELEPATHIC_AUTOMATIC_RECOVERY_EN.md). Its in-memory receipt buffer, saved retry policy and shared UI decision build on this stage without changing its write-retry budget.
