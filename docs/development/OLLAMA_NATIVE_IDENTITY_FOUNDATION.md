# Ollama Native — DIRECT-3B1 identity and persistence foundation

Implemented against `ai-rv-2` base `fcc03b1` on 19 November 2026. Candidate for independent review. See the [implementation plan](OLLAMA_NATIVE_IMPLEMENTATION_PLAN.md).

This stage stores **disabled pending native connections** and genuine connection identities. It does not enable an Ollama provider, model discovery, HTTP generation, a settings form or a new learning path. The existing nine ProviderKind values and their UI remain unchanged until the configuration/transport stages are implemented.

## Storage contract

Migration 035 adds explicit native authentication (`none` / `bearer`), connection identity and revision. Existing provider records default to `legacy_credential`, retaining their existing transport-specific credential semantics (Google/Anthropic headers are not relabelled as Bearer). Their credential FK remains mandatory. Only Ollama `none` permits a null credential FK and requires a null hint. Missing native mode is never inferred as keyless.

All Ollama rows remain `enabled=0` by a database CHECK. Later discovery may inspect a pending connection, but enabling generation requires a separately reviewed schema/transport gate. Keyed Ollama configuration/secret verification remains for 3B2; B1 cannot create a supposedly authenticated connection or bypass secret storage by accepting an empty key.

A new `profile_native_connection_routes` relation references the provider config and freezes its identity, revision and canonical endpoint. This uses an additive relation rather than rebuilding Profiles. It does not reuse credentialId as connectionId or change legacy Profile route resolution. Inserting a route requires an unarchived Profile with no credential binding and an exact pending keyless connection. Replacing/upgrading an existing route is not an implicit upsert.

The AI identity table gains a discriminant: legacy `credential` or native `connection`. A connection identity has NULL credential fingerprint/display and a distinct unique route key. The B1 internal API prepares Viewer identities with route_status=unavailable and does not bootstrap notes or invoke learning. Its separate typed port prevents handing a null fingerprint to existing keyed identity consumers. Legacy provider/identity lists exclude pending native records, while the dedicated port preserves their historical metadata. New session snapshots have an optional typed nativeConnection slot; no existing snapshot is rewritten and run constructors do not dispatch native calls yet.

## Migration safety

The provider/model registry pair and the nine-table AI identity dependency closure are rebuilt in one migration transaction with foreign keys enabled. The script first copies every affected row into transaction-local temporary tables, suspends only the affected triggers, rebuilds/copies the tables, restores the exact existing indexes/triggers, adds new guards and checks `pragma_foreign_key_check` through a CHECK-constrained assertion. All old primary IDs, source pointers, JSON, hashes and memory lineage are retained. Trigger suspension is transactional and is rolled back with the data if the migration fails.

The existing pre-migration backup path already keys off the current migration version and therefore applies to 034→035. SQLx tests cover the transaction path; Node SQLite tests also exercise a file-backed close/reopen and copy restore. These are not a Windows desktop backup acceptance claim. Old migration files and compatibility data epoch remain unchanged. Old binaries are not promised access to schema 35.

## Internal interfaces

- `AppRepository.nativeConnections` delegates to the dedicated SQLite/Browser adapter.
- SQLite: createPendingKeylessConnection, getNativeConnection, bindPendingNativeProfile, getPendingNativeProfile, ensurePendingNativeAiIdentity and getPendingNativeAiIdentity.
- IDs are generated independently of credentials or outputs. Creating another connection at the same URL creates another identity. A changed endpoint, auth mode, identity or revision invalidates a saved binding.
- Browser mode reads explicit pending metadata namespaces and validates them; creating native connections/identities remains desktop-only. It does not store a secret or silently invent a fallback fingerprint.
- Only three new fixed named write operations are registered. No arbitrary SQL write interface is added. Schema triggers verify the exact route again inside the write transaction.
- `native_connection_binding` reads the saved row using providerConfigId, normalizes/checks its URL and compares every binding field. It returns canonical metadata with generationAvailable=false. It performs no HTTP request or secret read. This metadata-only response is not proof of Bearer key validity and must not be reused as a generation authorization token. A future transport must resolve its persisted binding again at dispatch time.
- The old provider_chat/discovery/secret APIs retain their original ProviderKind and credential checks. A forged native None request cannot downgrade a legacy or saved Bearer route.

## URL and isolation rules

The native base is before `/api`; an explicitly chosen reverse-proxy prefix retains its case. HTTPS is allowed; HTTP is limited to exact localhost, 127.0.0.1 and ::1. Query, fragment, userinfo, encoded path components and pasted api/v1 path components are rejected. TypeScript/Rust cases agree on normalization and IPv6. These rules apply only to the pending native contract; existing Custom endpoint normalization is unchanged.

Neither pending connection metadata nor keyless AI identities may contain a credential fingerprint, hint, key or secret. They are not authenticated statements about a remote AI's identity. Existing Field Guides/Viewer Notes are not merged with a new connection identity.

## Required follow-up and review

Next is 3B2: forms, keyed native secret setup, discovery and capabilities. Integrate native identity consumers explicitly before displaying their memory; do not cast the pending identity to the old required-fingerprint type. Model selection and changes to endpoint/auth need an explicit, transactional transition with preserved old identities and frozen-run compatibility checks. Later 3C must prove context fit and enable generation only through its reviewed gate; 3D/3E handle NDJSON and model-specific thinking replay.

Before acceptance, review the copied-table closure/guards, real SQLite migration/retry/rollback evidence, legacy lists and hashes, named-write/IPC command-set agreement, TS/Rust binding cases and native CI. Full Tauri/Clippy and Windows OS secret storage/runtime checks are separate from the isolated native policy/SQLx tests. No endpoint or user account is contacted by this stage.
