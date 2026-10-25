# Contributing to AI RV Harness

Thank you for helping improve AI RV Harness. Contributions may include code, tests, documentation, provider-compatibility reports, reproducible bug reports, and carefully scoped design proposals.

## Before contributing

1. Search existing issues before opening a new one.
2. Use the relevant issue form and provide the exact application version, operating system, provider, model, and session role when applicable.
3. Never publish API keys, credentials, private targets, personal transcripts, database files, or sensitive logs.
4. Discuss large changes before implementation, especially changes to blinding, Reveal, AI Judge, Research, scoring, database migrations, provider parsing, or AI identity.

Security vulnerabilities must be reported according to [SECURITY.md](SECURITY.md), not through a public issue.

## Development setup

The desktop application uses React, TypeScript, Vite, Tauri, Rust, and SQLite.

```bash
npm ci
npm run typecheck
npm test
npm run build
cd src-tauri
cargo test --locked
cargo clippy --locked -- -D warnings
```

Use the supported Node and Rust toolchains from the repository workflows. Keep `src-tauri/Cargo.lock` committed and change it only when Rust dependencies require regeneration.

## Engineering invariants

Contributions must preserve the project safeguards documented in [`docs/architecture/`](docs/architecture/):

- blind evidence remains separated from target and Reveal data until the blind phase is sealed;
- sealed evidence and frozen Research state are not rewritten;
- AI Judge receives an allowlisted packet and uses the fixed `3 + 3 + 2 + 2` rubric;
- Research scores are frozen before unblinding;
- provider reasoning is normalized separately from final assistant content;
- retries and continuation do not duplicate completed Viewer or Monitor work;
- Viewer Notes remain profile-wide but bound to one exact AI identity, versioned, and separated from Monitor, Judge, and post-Viewer-review material;
- database migrations are additive and their integrity constraints are tested.

If a proposed change intentionally alters one of these invariants, explain the reason and update the architecture documentation in the same pull request.

## Pull requests

- Keep each pull request focused on one coherent change.
- Link the relevant issue or explain why no issue is needed.
- Add or update tests for changed behavior.
- Run the frontend and Rust checks that are available in your environment.
- Update documentation, translations, manifests, and migrations when affected.
- Do not commit generated `dist`, `node_modules`, Rust `target`, caches, secrets, or personal data.
- Describe any checks you could not run.

By contributing, you agree that source-code contributions are provided under the MIT License and eligible non-code project content under the project's CC BY 4.0 terms, unless a specific file states otherwise.

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
