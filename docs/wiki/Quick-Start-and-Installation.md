# Quick Start and Installation

Use [GitHub Releases](https://github.com/lukeskytorep-bot/AI-RV-Harness/releases) for available Windows NSIS/MSI and Linux AppImage/DEB packages. Read that release's compatibility notes. This Wiki describes the development line through T5, not a newly published v0.7.14 binary.

Where an attestation is supplied:

```bash
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```

Provenance is not Authenticode signing or a guarantee of correctness. Actions test artifacts do not automatically become public releases.

On first start, create/test a provider connection, load models, explicitly select a default Viewer and create a Profile. Each new Profile receives a Conversation Workspace and an RV Workspace. Human IS-BE is an optional display name, not another provider credential.

Choose Conversations for ordinary chat; RV Sessions for Manual/Automatic RV; classic Training for learning; AI–AI Training for separate read-only-learning telepathy; Research for frozen studies. New installations default to English and the Blue theme in the reviewed source; saved settings remain.

Development source uses schema 31; the recorded public v0.7.13 baseline uses schema 27. Keep a backup before upgrades. Legacy databases are classified before normal load; do not force an unverified migration. Linux AppImage may need executable permission; install DEB with your distribution's package tools.

Records are local, but a selected AI provider receives permitted request content. Review its privacy/retention terms. For source builds use the English [Developer Guide](../development/README.md).
