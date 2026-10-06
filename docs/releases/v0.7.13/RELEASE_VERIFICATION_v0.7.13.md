# AI RV Harness v0.7.13 — release verification

## Source identity

The public Windows and Linux packages were produced from the same accepted `main` commit:

`b13fcc19245bbdc0f334d2ce22815a8c54444607`

The release uses application version `0.7.13`, SQLite schema `027`, and data epoch `v0.7.13`.

## Verified release gates

The accepted source completed the required GitHub Actions gates, including:

- TypeScript typecheck and the full Vitest suite;
- Vite production build;
- `verify:source`, `verify:ux-data`, and `verify:architecture`;
- Rust tests, formatting, and Clippy checks;
- Windows release packaging and GitHub Artifact Attestation;
- Linux release packaging and GitHub Artifact Attestation.

Practical launch testing was completed successfully for the Windows and Linux packages. This confirms that both packaged applications start and operate on the tested systems. The broader runtime-smoke checklist remains a reusable regression procedure; it is not a claim that every external provider, endpoint, model, or operating-system configuration has been exhaustively certified.

## Artifact provenance

- Windows attestation: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51409244>
- Linux attestation: <https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51414231>

Both attestations identify the source commit shown above. Verify downloaded files with:

```bash
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```

Artifact Attestations establish build provenance and integrity. They do not guarantee that the application contains no defects and do not replace platform publisher signing.

## Checksums

The canonical checksums are stored in [`SHA256SUMS.txt`](SHA256SUMS.txt). They cover the two Windows installers and the two Linux packages produced by the accepted workflows.

## Data compatibility

v0.7.13 starts a new local-data compatibility epoch. Automatic migration from public v0.7.12 and earlier databases is intentionally unsupported. Users who require access to older data should retain v0.7.12 and create a portable backup. The controlled v0.7.13 **Start Fresh** path preserves the detected legacy database and its SQLite sidecars before creating a current schema.

## Release boundary

Provider availability, routing, quotas, model behavior, advertised context/output limits, and third-party service continuity remain external dependencies. A green build and successful platform launch do not certify every provider/model combination.
