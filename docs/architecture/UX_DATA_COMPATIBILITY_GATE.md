# UX-DATA compatibility gate

**Status:** current private v0.7.13 architecture guard  
**Introduced:** UX-DATA-9, 10 September 2026

## Purpose

UX-DATA-1 through UX-DATA-8 deliberately changed several product and persistence boundaries while preserving old data. UX-DATA-9 converts those accepted outcomes into a permanent compatibility gate so a later refactor cannot silently reintroduce the removed hierarchy or bypass the new lifecycle rules.

The gate is intentionally conservative. It does **not** remove dormant legacy schema merely because the current UI no longer uses it. Old `chat_thread_groups` rows and `chat_threads.thread_group_id` values may remain in upgraded SQLite databases as compatibility metadata. New Conversation / Manual RV records remain direct Workspace children.

## Frontend/source gate

`npm run verify:ux-data` runs `scripts/verify-ux-data-compatibility.mjs` and checks that:

- migrations remain contiguous and registered through `023_controlled_purge.sql`;
- browser-native Confirm/Prompt/Alert calls remain private to the shared `AppDialogProvider` fallback;
- `ChatThreadGroup` lifecycle does not return to production code;
- the SQLite Conversation adapter still reads legacy `thread_group_id` while new rows store `NULL` and do not operate on `chat_thread_groups`;
- Viewer/Monitor/Judge route selection keeps the canonical `modelRoutes.ts` + `ModelRouteSelect` boundary;
- Archive/Restore and Permanent Delete use cases remain exposed for the primary lifecycle domains;
- Archive and recovery keeps Deletion Preview and strong destructive confirmation;
- Viewer Notes source-preservation markers from migration 022 and target-history snapshots from migration 023 remain present;
- the native legacy-upgrade test module remains wired into the Rust test build.

The main CI and both release workflows execute this gate immediately after `verify:source`.

## Native legacy-database gate

`src-tauri/src/ux_data_compatibility.rs` is compiled only for tests. It creates an in-memory SQLite database and applies migrations 001–020 to reproduce the pre-UX-DATA schema. It then inserts a representative historical data set containing:

- Profile and Workspace;
- legacy `ChatThreadGroup` + Conversation + message;
- used My Target + completed RV Session;
- Training ownership metadata;
- Locked Research assignment using the same target;
- AI identity, Viewer Notes reflection, version, settings and activation linked to the Session/Workspace.

The test then applies migrations 021–023 and requires all of the following:

1. the legacy Conversation and message still exist;
2. its historical `thread_group_id` remains readable;
3. the Session and Research assignment receive `target_id_snapshot` backfill;
4. Viewer Notes receive immutable source provenance including Training ID, number and name;
5. live Viewer Notes source references still point to retained source records;
6. `controlled_purge_context` is empty outside a purge transaction;
7. `PRAGMA foreign_key_check` reports no violations.

This complements the domain tests for Archive/Restore and controlled purge. It is not a substitute for them.

## Compatibility policy

A cleanup is acceptable only when it removes code that is no longer part of the product **without** making historical data unreadable. Physical legacy SQLite fields may be removed only in a later dedicated migration with its own old-database fixture, rollback/backup plan and full native CI evidence.
