# AI RV Harness v0.7.13 — Windows and Linux Release

AI RV Harness v0.7.13 is a major architecture, learning, provider-transport, data-lifecycle, and interface release.

This release provides public packages for both **Windows** and **Linux**:

- Windows NSIS installer (`.exe`);
- Windows MSI installer (`.msi`);
- Linux AppImage;
- Linux Debian package (`.deb`).

The published packages were built from the same `main` commit:

`b13fcc19245bbdc0f334d2ce22815a8c54444607`

## Important data compatibility notice

AI RV Harness v0.7.13 starts a new local-data compatibility epoch and uses SQLite schema **027**.

Automatic migration from public v0.7.12 and earlier databases is intentionally not supported. The internal model changed substantially, and silently converting older data could produce incomplete or incorrect records.

Before starting v0.7.13:

- create a portable backup of any data you want to preserve;
- keep v0.7.12 installed or retain its installer if you need continued access to an older database;
- when v0.7.13 detects legacy data, use its controlled **Start Fresh** path to create a new current database;
- the previous database and its SQLite sidecars are preserved as a backup rather than silently overwritten.

Profiles and Viewer Learning should then be created or trained in the new v0.7.13 data epoch.

## What’s new

### Viewer Learning and Field Guide

AI Center now contains the mature **Viewer Learning** area. It keeps two separate versioned learning packages:

- **Field Guide** — the Viewer’s trained descriptions of how it personally perceives and distinguishes field elements;
- **Viewer Notes** — the Viewer’s general internal observations and working guidance.

The effective Viewer prompt is composed from:

1. Locked Core Identity;
2. Locked Base Vocabulary;
3. the optional trained Field Guide.

Important safeguards include:

- learning belongs to one exact Profile, credential identity, provider, model route, language, and Viewer role;
- learning is never transferred silently between models or roles;
- every accepted Field Guide or Viewer Notes update creates an immutable version;
- people cannot directly rewrite AI-generated learning versions;
- an older version may be restored through an explicitly audited restore action;
- document capacity is enforced without automatic truncation;
- stale concurrent updates are rejected;
- ordinary Conversations, RV Sessions, and Research use frozen learning snapshots read-only;
- only completed Training targets may create new Field Guide or Viewer Notes versions.

Training preserves the learning order:

`Post-Reveal Viewer Review → Field Guide Update → Viewer Notes Reflection → AI Judge`

The Polish or English AI Field Perception Lexicon is supplied only to the matching Field Guide update flow.

### Expanded Training system

The factory Training library now contains **94 read-only targets in eight categories**, with paired Polish and English Reveal resources.

Full Training supports:

- one to ten frozen rounds;
- eight sessions per round;
- one randomly selected target from each factory category;
- randomized session order;
- Profile-scoped repeat avoidance;
- resumable checkpoints and complete exports.

Partial Training retains explicit category controls and may also use My Targets. Historical sessions and the former curricula remain readable according to their stored planner version.

### Polish and English target Reveals

New Training sessions freeze the target Reveal in the active session language:

- Polish session → Polish Reveal;
- English session → English Reveal.

The localization is integrated into the existing factory target identities rather than creating a second target system. Historical frozen Reveals are not rewritten.

### Research controls

Research can now control Viewer Learning independently:

- Viewer Notes: `OFF` or `CURRENT`;
- Field Guide: `OFF` or `CURRENT`;
- Prompt Research: manual variants or selected Field Guide history;
- selection of two to four compatible versions from the six most recent Field Guide versions.

Experiment Lock freezes the exact selected content. Resume uses only those snapshots. Research remains read-only and cannot create new Viewer Notes or Field Guide versions.

### Provider continuation, streaming, and recovery

The provider layer now includes centralized transport and retry handling together with provider-native conversation continuation.

Highlights include:

- provider-native continuation for OpenRouter, Google native, and the contracted Anthropic session subset;
- continuation state stored separately from visible transcripts;
- conservative canonicalization of streamed OpenRouter reasoning fragments;
- exact preservation of opaque encrypted and signature data;
- separation of provider reasoning from final assistant content;
- recovery when a provider returns reasoning without a usable final response;
- controlled analytical post-Reveal output recovery;
- transport retry kept separate from semantic output recovery and document-capacity retry;
- bounded handling of transient provider failures and supported `Retry-After` forms;
- redacted, in-memory provider diagnostics without API keys or inline image data.

The versioned model-reasoning registry uses exact verified contracts where available. Unknown models no longer receive invented reasoning levels: Harness uses provider-advertised capabilities or leaves the model at `AUTO / provider default`.

### Post-Reveal assessment

Viewer, Monitor, and Judge instructions now distinguish among:

- confirmed correspondence with the principal target;
- confirmed surrounding context;
- plausible but unverified context;
- contradicted or inaccurate information.

The principal target receives the greatest weight. A surrounding detail omitted from a Reveal is not automatically treated as either a confirmed hit or an error. Sealed pre-Reveal evidence remains immutable.

### Profiles, providers, and Workspaces

- Profile setup and editing use one unified provider/model/credential flow.
- Viewer identity, provider route, model, and trained learning remain aligned.
- Conversations and RV Sessions now have separate typed Workspaces and separate active selections.
- Legacy combined Workspaces remain available through controlled compatibility handling.
- Ordinary Conversation can use compatible Viewer Learning read-only and enables it by default when a trained package exists.
- Workspace switching, Conversation/RV help, and Custom Protocol dialogs were improved.
- Incorrect human-label/API-key status presentation under Profile cards was corrected.

### Data lifecycle and security boundaries

v0.7.13 completes the staged UX-DATA lifecycle:

- archive, restore, and controlled permanent deletion;
- deletion preview and parent/child dependency protection;
- protected Viewer Notes provenance;
- immutable sealed evidence, frozen Judge scores, and locked Research mappings;
- controlled SQLite compatibility inspection before database loading;
- preservation of legacy or incomplete databases before a fresh start;
- closed, named database operations instead of an unrestricted raw-SQL write surface;
- OS-native credential storage with credential binding and verification.

### Interface, privacy, and documentation

- Viewer Learning is no longer labelled experimental.
- Settings includes the offline Privacy Policy in Polish and English.
- Project Credits and official project links are available in Settings.
- Conversation and RV Session help are available inside the application.
- Profile, Workspace, and Custom Protocol layouts received practical desktop fixes.
- Source, architecture, release, and library documentation were reorganized and verified.

## Verification performed

The accepted `main` source passed the project’s required GitHub Actions gates, including:

- TypeScript typecheck;
- full Vitest suite;
- Vite production build;
- source-integrity verification;
- UX/data compatibility verification;
- architecture verification;
- Rust tests;
- Rust formatting and Clippy checks;
- Windows release build;
- Linux release build;
- GitHub Artifact Attestation generation.

Practical Windows and Linux launch testing was also completed without a newly identified release-blocking issue.

## Downloads and SHA-256 checksums

| Platform | Release asset | SHA-256 |
| --- | --- | --- |
| Windows | `AI RV Harness_0.7.13_x64-setup.exe` | `67ab171348e9225683520d53253f16a4d5664efbabd7366ecd473e4bba19daf7` |
| Windows | `AI RV Harness_0.7.13_x64_en-US.msi` | `b8cb4bd7daf046e5d77dea67e0281de7062c7b2241aff3681c8eb4429d8573d7` |
| Linux | `AI RV Harness_0.7.13_amd64.AppImage` | `b4ee881c36e5d4c9b978ca386f7ccc8f307242a09ddd2f2ceaa6f1d0b04bc982` |
| Linux | `AI RV Harness_0.7.13_amd64.deb` | `e69a037d77d99b2327f0e0900f88efd1f791154c1a3f97497145401414387b6b` |

## Verify downloaded packages

Verify any downloaded asset with GitHub Artifact Attestations:

```bash
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```

Windows PowerShell checksum verification:

```powershell
Get-FileHash "PATH_TO_ASSET" -Algorithm SHA256
```

Linux checksum verification:

```bash
sha256sum "PATH_TO_ASSET"
```

### GitHub Artifact Attestations

- Windows: https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51409244
- Linux: https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/51414231

Both attestations identify commit:

`b13fcc19245bbdc0f334d2ce22815a8c54444607`

Artifact Attestations establish build provenance and integrity. They do not guarantee that the software contains no bugs and do not replace platform publisher signing.

## Installation notes

### Windows

Use either the NSIS `.exe` installer or the `.msi` package. These installers may display a Windows SmartScreen or endpoint-protection warning because GitHub Artifact Attestation is not an Authenticode publisher signature. Verify the attestation and SHA-256 checksum before installation.

### Linux AppImage

```bash
chmod +x "AI RV Harness_0.7.13_amd64.AppImage"
"./AI RV Harness_0.7.13_amd64.AppImage"
```

### Debian package

```bash
sudo apt install "./AI RV Harness_0.7.13_amd64.deb"
```

## Provider limitations

Provider availability, rate limits, endpoint routing, model capability metadata, context limits, output limits, and model behavior remain external dependencies.

Some reasoning-intensive models may consume their available output budget without returning a usable final answer during large post-Reveal or Field Guide operations. Harness includes bounded recovery and clear failure handling, but it cannot force an external model or endpoint to produce a final answer.

## Licenses

- Application source code: MIT License.
- Bundled documentation, prompts, authored protocols, Training content, and non-code visual resources: CC BY 4.0 unless a specific resource states otherwise.

Thank you to everyone who tested AI RV Harness on Windows and Linux and reported practical provider, Training, Viewer Learning, Workspace, and release behavior. Those reports directly shaped v0.7.13.
