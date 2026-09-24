# UX-DATA compatibility gate

**Status:** current private v0.7.13 architecture guard  
**Introduced:** UX-DATA-9, 10 September 2026

## Purpose

UX-DATA-1 through UX-DATA-8 deliberately changed several product and persistence boundaries while preserving old data. UX-DATA-9 converts those accepted outcomes into a permanent compatibility gate so a later refactor cannot silently reintroduce the removed hierarchy or bypass the new lifecycle rules.

The gate is intentionally conservative. It does **not** remove dormant legacy schema merely because the current UI no longer uses it. Old `chat_thread_groups` rows and `chat_threads.thread_group_id` values may remain in upgraded SQLite databases as compatibility metadata. New Conversation / Manual RV records remain direct Workspace children.

## Frontend/source gate

`npm run verify:ux-data` runs `scripts/verify-ux-data-compatibility.mjs` and checks that:

- migrations remain contiguous and registered through `025_provider_continuation_state.sql`;
- browser-native Confirm/Prompt/Alert calls remain private to the shared `AppDialogProvider` fallback;
- `ChatThreadGroup` lifecycle does not return to production code;
- the SQLite Conversation adapter still reads legacy `thread_group_id` while new rows store `NULL` and do not operate on `chat_thread_groups`;
- Viewer/Monitor/Judge route selection keeps the canonical `modelRoutes.ts` + `ModelRouteSelect` boundary;
- Archive/Restore and Permanent Delete use cases remain exposed for the primary lifecycle domains;
- Archive and recovery keeps Deletion Preview and strong destructive confirmation;
- Viewer Notes source-preservation markers from migration 022 and target-history snapshots from migration 023 remain present;
- the Field Guide schema markers, provider-continuation schema 025 markers, and native exact-green-v23 → v24 plus exact-green-v24 → v25 upgrade tests remain wired into the Rust test build;
- the compatibility gate does not reintroduce an automatic public-v0.7.12/legacy → v0.7.13 migration chain.

The main CI and both release workflows execute this gate immediately after `verify:source`.

## Native legacy-database gate

`src-tauri/src/ux_data_compatibility.rs` is compiled only for tests. Its compatibility chain preserves the accepted green v23 → v24 Viewer Learning upgrade and adds a separate exact-green-v24 → v25 provider-continuation persistence gate. Public v0.7.12/legacy databases at schema 1–20 are classified by the database compatibility epoch gate and are not silently migrated into v0.7.13.

The exact-green-v23 fixture contains:

- Profile and Workspace;
- legacy `ChatThreadGroup` + Conversation + message;
- used My Target + completed RV Session;
- Training ownership metadata;
- Locked Research assignment using the same target;
- AI identity, Viewer Notes reflection, version, settings and activation linked to the Session/Workspace.

The test then applies migration 024 and requires all of the following:

1. the legacy Conversation and message still exist;
2. its historical `thread_group_id` remains readable;
3. Session and Research target snapshots and Viewer Notes provenance remain intact;
4. a preserved custom Profile Viewer prompt becomes an unresolved legacy Field Guide baseline without guessing identity or language;
5. no trained Field Guide version is invented by migration;
6. `controlled_purge_context` remains available and empty outside a purge transaction;
7. `PRAGMA foreign_key_check` reports no violations.

The v24 → v25 gate additionally requires both provider-state tables, preserves pre-existing Conversation data, verifies foreign-key cascades for message/event-owned state, and keeps `PRAGMA foreign_key_check` clean. Fresh-schema and live-validation tests exercise the complete 001 → 025 registry and SQLx checksums.

This complements the domain tests for Archive/Restore and controlled purge. It is not a substitute for them.

## Compatibility policy

A cleanup is acceptable only when it removes code that is no longer part of the product **without** making historical data unreadable. Physical legacy SQLite fields may be removed only in a later dedicated migration with its own old-database fixture, rollback/backup plan and full native CI evidence.
