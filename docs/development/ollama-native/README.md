# Ollama Native contract material

This is **DIRECT-3A planning material**, not a supported provider or runnable server.

- [Implementation plan](../OLLAMA_NATIVE_IMPLEMENTATION_PLAN.md)
- [Reviewed source inventory](source_inventory.json)
- [Synthetic contract cases](fixtures/contract_cases.json)

Fixture model `fixture-text:latest`, hosts ending in `.invalid`, digests and version strings are synthetic. No file contains a key. Expected results describe future adapter/controller behavior; structural validation of these files is not evidence that Harness supports Ollama.

The NDJSON files use short independent examples: complete output, terminal content, output limit, thinking-only, HTTP-200 error after output and premature EOF. The byte-split JSON describes an exact UTF-8 buffer and chunk sizes, including a split inside a multibyte character and a final frame with no newline. Implementation tests should additionally exercise every byte boundary, buffer limits, invalid UTF-8, timing and cancellation races.

Some negative wire fixtures deliberately omit a terminal frame or end with an error. A validator must not reject their existence merely because they are not success cases. The catalog is the source of their expected interpretation. No JSON request is sent automatically.
