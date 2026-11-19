# Ollama Native — DIRECT-3B2 settings and discovery

Candidate built on `ai-rv-2` at `76442e6b21bf7dd85518194626b53d931021ac97` (DIRECT-3B1), 19 November 2026. See the [implementation plan](OLLAMA_NATIVE_IMPLEMENTATION_PLAN.md) and [identity foundation](OLLAMA_NATIVE_IDENTITY_FOUNDATION.md).

## Available surface

Settings → Providers has a separate Ollama Native section. Create or edit a disabled pending connection, choose explicit None/Bearer authentication, test its canonical base, refresh discovery and select an exact model identifier. Polish and English copy shows the destination and warns that Bearer sends the entered or saved key there before the user submits. A blank key while editing Bearer reuses its existing endpoint-bound key inside native code. Switching to None clears the input; switching from None requires a key. Browser mode cannot invoke these operations.

This is configuration/discovery, not an enabled provider. The nine public ProviderKind values, legacy provider/AI lists, existing credentials, model assignments, learning and run constructors remain unchanged. Pending model selection uses a dedicated typed discovery view; it is not cast into the credential-fingerprint identity branch. The B1 profile route/AI identity port still prepares keyless pending identities only; Bearer profile identity activation, any memory display and all generating consumers must be integrated explicitly with the 3C gate. No placeholder fingerprint or implicit memory merge is introduced here.

## Native discovery

The three new dedicated commands are `native_connection_list`, `native_connection_save` and `native_connection_discover`. Existing binding inspection remains metadata-only. Existing connections are resolved from trusted SQLite persistence and checked against every binding field before discovery. A forged None or stale revision fails before HTTP. New configurations are tested explicitly before creation.

Discovery makes GET `/api/version`, GET `/api/tags` and, when the exact selected model is listed, POST `/api/show` with `verbose:false`. It never generates, pulls/deletes models, probes `/v1`, polls running models or falls back to another API dialect. Redirects are disabled, each request times out after 30 seconds, each response is capped at 2 MiB, and tags are capped at 2000 unique exact identifiers. Non-success, malformed JSON, HTTP-200 error objects and secret echoes fail. Missing required version/tags fails; 404/405 for optional show records details unavailable. An absent selected model is retained with an explicit warning and is not substituted.

The cache stores server version, capture time, exact tags/digests and selected model. Model show summary retains capabilities, thinking, parameters/details, renderer/parser/template provenance when supplied, plus a SHA-256 of the complete source JSON. Declared architecture context is labelled as metadata, never verified allocation. Missing values remain unknown. The cache is bound to connection identity/revision/endpoint/auth and written atomically with settings. This is provenance for future compatibility checks, not a generation authorization or proof of context safety.

## Secret and persistence boundary

None creates no credential metadata or secret record. Bearer uses the existing OS store, verifies the current endpoint binding when reusing a key and creates a new immutable bound key record for an endpoint/auth/key transition. Secrets never return through IPC or discovery diagnostics. No new dependencies or schema migration are required; schema 35 continues enforcing `enabled=0`.

A route/auth/key change increments the revision while preserving the configuration ID and connection identity. Label/model-only changes do not change route identity. Existing frozen bindings and B1 pending profile references are not rewritten; stale bindings fail closed. Old keys and metadata are retained so old identity provenance is not destroyed. They are never silently rebound to a different endpoint.

Before the OS write, a durable, secret-free staging journal is committed in app_settings. An immediate SQLite transaction rechecks the expected route and journal, excludes recovery during the secure-store write, updates credential metadata/configuration/discovery and deletes the journal atomically. A failure rolls SQLite back; an unreferenced staged key remains recoverable. An ambiguous commit is reported as unconfirmed; the UI reloads actual saved state rather than deleting a potentially referenced key or assuming success.

When native settings are listed, expired staging journals (15-minute grace period) are recovered under an immediate transaction. Only an unreferenced staged native credential may be removed. A committed/referenced key is kept. Journal presence is rechecked before writing a new key, so a save cannot resurrect a journal already recovered by another window. Interrupted work cannot permanently change a provider row without its successfully written bound key. Failed cleanup leaves the journal for a later attempt; no background polling is added.

## Evidence and remaining acceptance

Automated checks use real SQLite/SQLx and controlled loopback HTTP with a fake endpoint-bound vault. They exercise native methods/paths/headers, keyless isolation, same-ID endpoint revision, secure-store and SQLite failures, orphan recovery, reopened disk persistence, stale/forged bindings, unsupported metadata, redirects, size bounds and secret echoes. React tests cover creation, destination disclosure, blank-key edit, failure retention, explicit None, exact missing-model selection and no automatic discovery/generation. IPC tests verify the separate route and Browser restriction.

The portable evidence harness compiles the production policy/settings modules without Tauri or the real OS vault. It does not verify the Tauri wrapper, platform keyring backend, HTTPS proxy deployment, Windows app lifecycle or an actual Ollama version. Full native build/test/Clippy and desktop smoke are separate requirements. Generation remains unavailable until reviewed 3C context-fit, settings/snapshot and identity-consumer integration; NDJSON/STOP and thinking/replay remain 3D/3E.

API references checked 19 November 2026: [tags](https://docs.ollama.com/api/tags), [show](https://docs.ollama.com/api-reference/show-model-details), [authentication](https://docs.ollama.com/api/authentication). Controlled fixture version `0.99.fixture` is synthetic and is not a supported-runtime claim.
