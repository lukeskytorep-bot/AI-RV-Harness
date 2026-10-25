# AI RV Harness

AI RV Harness is a local-first desktop application for AI conversations, blind Remote Viewing sessions, Training and controlled Research. It uses Tauri 2, React/TypeScript, Rust and SQLite. Records are stored locally; selected AI providers receive the request content needed for their work.

[Download installers](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases) · [User documentation](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki) · [Project website](https://lukeskytorep-bot.github.io/AI-RV-Harness/)

## Source and downloads

This source tree uses application version **0.7.14** and SQLite schema **34**. The retained v0.7.13 internal data epoch is a compatibility identifier, not the application version. Keep a backup before upgrading.

For published installers, the exact build and platform availability, use **GitHub Releases** above. Source availability on `main` does not by itself mean that a matching installer has been published. Historical release records remain under `docs/releases/`.


## What you can do

- Keep ordinary Conversations separate from Manual and Automatic RV Sessions.
- Use Profiles, typed Workspaces, bundled protocols and your own targets.
- Run classic Training with versioned Field Guides and Viewer Notes. If an optional learning update fails after its bounded attempts, previous learning is retained and Training continues; diagnostics remain available in the learning records.
- Run AI–AI exchanges with a fixed lead and separate participants.
- Design frozen Research studies, including sampling comparisons, with blind session assignments and optional independent AI Judges.
- Inspect and export partial Research judgments, complete missing judgments, or create a separate evaluation panel without rerunning the Viewer sessions or overwriting the original study results.
- Review token, cost and timing information, archive records, export data and manage backups.

The application records model outputs and evaluations; it does not establish their accuracy or the scientific validity of Remote Viewing.

## User guides

| Topic | Documentation |
| --- | --- |
| Install and create your first Profile | [Quick Start and Installation](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Quick-Start-and-Installation) |
| Conversations, RV and AI–AI sessions | [Sessions and Protocols](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Sessions-and-Protocols) |
| Targets and classic Training | [Targets and Training](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Targets-and-Training) |
| Field Guides, Viewer Notes and identities | [AI Center and Viewer Learning](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/AI-Center-and-Viewer-Learning) |
| Research and evaluation | [Research and AI Judge](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Research-and-AI-Judge) |
| Providers, reasoning and sampling | [Providers, Models and AI Monitor](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Providers-Models-and-AI-Monitor) |
| Archive, backup, restore and export | [Data Lifecycle, Backup, Restore and Exports](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Data-Lifecycle-Backup-Restore-and-Exports) |
| Problems and recovery | [Troubleshooting](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Troubleshooting) |

Supported adapter families include OpenRouter, OpenAI, Google, Anthropic, Z.AI, DeepSeek, Mistral, Blackbox and Custom OpenAI-compatible endpoints. Available models, streaming and individual parameters depend on the selected route and its actual capabilities. A Custom endpoint must implement the API contract used by the application.

## Development

Start with [Development Architecture and Contributing](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Development-Architecture-and-Contributing), [Engineering Decisions and Integrity Safeguards](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Engineering-Design-and-Integrity-Safeguards), and [Source and Release Status](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Development-Status). The repository also keeps its contributor documentation in [docs/development/README.md](docs/development/README.md), and its documentation index in [docs/README.md](docs/README.md).

Install the Node.js version used by the repository CI, npm, and the platform prerequisites for Tauri 2. Desktop development also requires Rust and the platform build tools. From the repository root:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run tauri dev
```

The browser preview uses a development-only repository; the desktop application uses SQLite and the operating-system credential store. Frontend checks do not replace native Rust tests or Windows/Linux runtime acceptance. Follow the repository's CI and release checks before publication.

## Privacy and evidence

API keys are stored through the native operating-system credential store. Local records and exports can contain sensitive session content; review them before sharing. Research freezes its design and learning snapshots before execution, keeps target disclosure outside blind Viewer evidence, and separates later evaluation panels from original experimental results.

Read [Privacy, Security and Evidence Integrity](https://github.com/lukeskytorep-bot/AI-RV-Harness/wiki/Privacy-Security-and-Evidence-Integrity). Report security issues according to [SECURITY.md](SECURITY.md).

## Credits and licences

AI RV Harness is a human-directed project developed with Human and AI collaborators. See [CREDITS.md](CREDITS.md) and [CITATION.cff](CITATION.cff).

Source code is licensed under [MIT](LICENSE). Eligible documentation, protocols, prompts, training content and other non-code assets are licensed under [CC BY 4.0](CONTENT_LICENSE_CC_BY_4.0.md), unless a resource states otherwise. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
