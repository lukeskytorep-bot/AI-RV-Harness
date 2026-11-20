# Ollama Cloud — standard workflows and NDJSON

20 November 2026. CLOUD-FINAL candidate based on `ai-rv-2` at `51e0b9d` (CLOUD-3). Edward explicitly requested the normal provider flow and withdrew the separate diagnostic screen and Cloud-only automatic gate. This decision supersedes earlier CLOUD-2/3 activation prerequisites; it does not establish measured hosted capacity.

## Normal setup

Choose **Ollama Cloud** in Add Provider, enter the API key, save, choose a discovered model in the ordinary profile/model controls and use the application. Existing enabled Cloud profiles remain valid. Setup authenticates `/api/balance` and discovers `/api/tags` without billed generation. Refresh, model favorites, credentials, profile assignments and Viewer identity retain their existing paths. No multi-turn test or extra activation prerequisite is shown for active providers. The optional legacy source-account panel retains explicit activation for previously saved pending accounts. Local Ollama stays deferred and disabled.

## Requests and streaming

The destination remains fixed at `https://ollama.com/api/chat`, with native Bearer authentication and redirects disabled. Before HTTP, native checks the saved enabled connection, bound credential and exact cached model. Keys never cross the IPC response boundary. Requests preserve ordered text history and use `stream:true`; stage output budgets map to `options.num_predict`. Optional samplers preserve explicit zero. No `num_ctx`, generic effort, images, tools, undocumented truncation flags or private-thinking replay is introduced. The model chooses its default thinking behavior.

Native NDJSON is decoded independently of SSE: byte fragments/UTF-8, CRLF, multiple lines per chunk and a final line without newline are supported. A pending line is limited to 2 MiB and the raw/accumulated response to 16 MiB. Only content deltas enter the existing shared preview/internal-repetition path. Thinking accumulates separately and is never substituted for final text. Terminal usage and native nanosecond metrics survive aggregation. A native JSON response from a proxy is accepted through the bounded JSON fallback.

The shared request cancellation registry handles STOP and ownership cancellation. First-frame, idle and emergency deadlines use existing operation timeout profiles. EOF, decode errors, oversize, cancellation and timeout without a valid terminal frame retain an unknown request outcome; they do not invent completion. A validated terminal frame records `ndjson_done` transport evidence; a complete JSON fallback retains `body_read`. Existing version-1 `body_read`/`sse_done` snapshots retain their meaning. Transport completion is separate from final-content and domain acceptance.

The final parser still rejects incorrect models, tools, empty/reasoning-only output and unsupported terminal reasons. A length result remains length for the controller to assess. Common bounded retries, refusal/repetition rules, checkpoints, reveal ordering, Research lock/blinding and learning policies are unchanged.

## Workflow coverage and limits

Cloud follows the common request path in Conversation, Manual/automatic RV, classical Training, Research, telepathic Conversation/Training, Monitor, Judge, post-Reveal and learning calls. The distinct `telepathic_exchange` classification remains; it no longer carries a special Cloud refusal. Controller regressions exercise real telepathic engine/gateway calls, durable Training replay after length and Research STOP/reopen/resume/judging/export.

Discovery does not invent context/output maxima, vision or effort controls. Capacity remains unknown when unavailable, following the normal direct-provider policy. Enabling workflows is a product decision, not a guarantee that the remote server never truncates input. There is no additional paid conformance prerequisite in the product.

Automated checks use synthetic responses and loopback HTTP, not an authenticated hosted account. Windows OS keyring, desktop runtime and actual Ollama Cloud behavior are explicitly left to ordinary user acceptance. No claim that all possible runtime cases have been verified is made.

Official wire reference: [NDJSON streaming](https://docs.ollama.com/api/streaming), reviewed 20 November 2026. This describes protocol behavior, not a live-account result.
