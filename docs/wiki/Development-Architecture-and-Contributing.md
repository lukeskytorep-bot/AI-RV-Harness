# Development Architecture and Contributing

This page and the primary [Developer Guide](../development/README.md) are English. Reviewed against the current development source through T5, schema 31. Historical Polish audits are records, not the current build recipe.

## Setup

Use Node 24 and Rust stable with Clippy. Install native Tauri prerequisites for your platform; Linux CI uses build-essential, libwebkit2gtk-4.1-dev, libayatana-appindicator3-dev, librsvg2-dev and patchelf. Windows needs C++ desktop build tools/Windows SDK and WebView2.

```bash
npm ci
npm run tauri dev
```

Browser preview is not native SQLite/credential/backup acceptance.

## Checks from the repository root

```bash
npm run verify:source
npm run verify:ux-data
npm run verify:architecture
npm run verify:v0.7.14-release-gate
npm run typecheck
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets --locked
npm run verify:openrouter-continuation-bridge
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

The bridge runs separately orchestrated fixtures. Keep Cargo.lock committed. Do not hide native shared-error size regressions with lint suppression.

## Boundaries

One modular desktop application, with public feature entry points and repository contracts. Rust owns one physical HTTP request; TS owns transport retry; Session/Training/Research domains own semantic recovery. Classic learning shares one durable two-dispatch allowance across retries and repairs. Transport completion is not semantic acceptance or commit.

Native classic heartbeat renews every 10 seconds with TTL 45 seconds, still checking owner/version/window and cancelling bound transport on loss. Telepathic/review leases retain their own contracts. Named SQL writes, credential binding, sealed evidence and frozen Research cannot be bypassed.

Keep migrations 001–031 immutable; any new migration needs its registered additive path and compatibility tests. Do not infer an automatic legacy upgrade. Follow [CONTRIBUTING](../../CONTRIBUTING.md), [Code Map](../architecture/CODE_MAP.md) and [Module Boundaries](../architecture/MODULE_BOUNDARIES.md).

No merge, release publication or Wiki push is implied by a local documentation update. Record actual platform/provider smoke separately.
