# Ollama Cloud — DIRECT-3C2-CLOUD-1 configuration and discovery

Candidate based on `ai-rv-2` at `c344cdbac02b6e0c236c5c5ba6de71b4859ec062`, 19 November 2026. Edward clarified that direct hosted Ollama Cloud is the current target; local Ollama is deferred. This delivery adapts connection setup/discovery, not the complete 3C2 generation/controller integration.

## Hosted connection

The new connection form defaults to Ollama Cloud at `https://ollama.com`, with mandatory Bearer authentication. The root is the saved credential-binding base; native requests append `/api` exactly once. It is read-only in new/hosted forms. The key is entered in the password field and stored through the existing verified native OS credential path. Editing a hosted connection leaves the password blank to reuse its saved bound key. The form discloses the destination and the non-generating access test before submission.

The native Cloud policy is selected only for the exact canonical root `https://ollama.com`. Lookalike hosts, different ports and path prefixes do not acquire hosted policy. None/missing-key attempts against the Cloud root fail before HTTP. There is no unauthenticated retry, redirect, guessed endpoint or API-dialect fallback. Existing server records keep their URL, auth, identity/revision and editing path. They are not converted into Cloud. The public ProviderKind union remains unchanged; pending records are still excluded from generating profile routes.

## Discovery and credential verification

A Cloud probe performs only:

1. GET `/api/balance`, with the bound/entered Bearer key, to verify authenticated access. A model catalog can be public and must not by itself validate the key. The documented endpoint's included/purchased objects are checked and discarded. No balance, allowance, credit amount or account response is cached, returned through IPC, exported or logged. No amount is used to assert generation eligibility. This is a single user-triggered check, not billing polling.
2. GET `/api/tags`, using the same key, to load exact hosted identifiers. No `:cloud`/`-cloud` suffix is added or stripped. An absent manual selection remains selected with a warning rather than silently choosing another model.

The Cloud branch does not call `/api/version`, `/api/show`, `/api/ps`, chat/generate, OpenAI `/v1` or model-management endpoints. HTTP errors including 401/403/404/405/429/503, malformed/oversized JSON and secret echoes fail the probe; no new config/key binding/cache is committed. The existing staging journal and atomic save/rollback/recovery path are reused. Balance endpoint unavailability intentionally means authentication was not confirmed; the app does not mark the key valid using public tags instead.

Cloud discovery records `serverVersion:null`, never a fabricated local version. Digest is optional. If a selected tag exists, a source-labelled SHA-256 of that tag's metadata is retained without importing local context/capability assumptions. Missing model details remain explicitly unknown. Older discovery JSON with a string serverVersion still deserializes as the same value; the local/server branch still requires its original version request and optional show logic.

The response body limit (2 MiB), timeout (30 seconds/request), model count cap (2000), no-redirect policy and recursive secret-metadata checks are retained. No extra automatic retry or fast polling is introduced. An access check can be rate-limited by Ollama; a refusal leaves the previous connection intact.

## Server-managed context

Cloud preference UI omits the local num_ctx control for new/empty preferences. A previously saved explicit num_ctx is displayed until the user clears it; it is neither silently dropped nor sent. Native preference save and both TS/Rust draft builders reject a nonempty hosted num_ctx. Clearing it is explicit, while manual sampling zero and the existing stage output budgets are preserved. No context or output capability is invented and no stage budget is reduced.

The hosted card displays service identity instead of demanding/displaying a local daemon version. C1 frozen-run provenance still requires the server-format version/digest; this patch does not manufacture those fields to activate Cloud. Hosted frozen provenance and actual profile/controller dispatch remain the next integration work, not a passed runtime feature here.

## Checks and remaining scope

Controlled tests exercise the hosted contract against loopback fixtures through the private probe core. The production public entry point always derives hosted policy from the exact canonical URL; no IPC option can select Cloud policy for an arbitrary host. Mock tests are not real HTTPS/Ollama Cloud or account acceptance. Existing real SQLite/vault-journal tests cover the shared persistence path; Cloud tests do not claim a complete real TLS/keyring save.

UI tests cover new Cloud defaults, mandatory key, blank-key edit, exact model names, absent daemon version/digest, local edit compatibility and clearing old num_ctx. TS/Rust draft tests reject hosted num_ctx without lowering output. Legacy discovery/secret, snapshot and SQLite regressions are retained.

Generation remains disabled (schema 35 enabled=0). This is not completion of all DIRECT-3C2: explicit Cloud frozen provenance, profile/identity consumers, all controllers/Research locks, runtime dispatch and its existing ownership/cancellation/evidence rules remain. Streaming/NDJSON/STOP stays 3D. Local Ollama feature development stays deferred. No user endpoint/account was contacted, no generating/billable probe was run, and no plan/key was purchased or changed.

Sources checked 19 November 2026: [Cloud API key](https://docs.ollama.com/cloud/api), [exact hosted model names](https://docs.ollama.com/cloud/models), [authenticated balance](https://docs.ollama.com/api/balance.md), [context length](https://docs.ollama.com/context-length). These document API shape; they are not account/live conformance evidence.
