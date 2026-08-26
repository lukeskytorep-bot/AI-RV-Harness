# Applying the AI RV Harness 0.7.10 changed-files package

1. Close GitHub Desktop and the running application if either is using files in the repository.
2. Extract the ZIP into the root of the existing `AI-RV-Harness` repository and allow it to replace files with matching paths.
3. Do **not** delete files that are absent from this changed-files ZIP.
4. In particular, keep the existing repository file `src-tauri/Cargo.lock`. The ZIP intentionally does not contain a lockfile because the supplied 0.7.9 source snapshot did not contain the current GitHub copy.
5. Commit and push the extracted changes.
6. Because `src-tauri/Cargo.toml` now reports version `0.7.10`, run the existing **Prepare Cargo lockfile** workflow once, download its `AI-RV-Harness-v0.7.10-Cargo-lock` artifact, replace `src-tauri/Cargo.lock`, then commit and push that single generated lockfile update. This is required only to synchronize the committed lockfile with the new Rust package version; dependencies were not intentionally changed by this release.
7. Wait for CI and CodeQL. The expected result is a green frontend job, Rust tests, Clippy and CodeQL.
8. Run the Windows and Linux release workflows. They create/update a draft release and attest the generated installer/package assets.

The package includes SHA-256 checksums. `node_modules`, `dist`, build caches and the current GitHub `Cargo.lock` are excluded.
