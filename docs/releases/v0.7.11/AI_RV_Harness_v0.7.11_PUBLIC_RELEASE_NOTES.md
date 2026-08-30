# AI RV Harness v0.7.11 — Windows and Linux desktop release

AI RV Harness v0.7.11 is a focused compatibility and reliability update for reasoning-capable AI models and AI Monitor sessions.

The update fixes a response-handling issue affecting some DeepSeek, NVIDIA and Google model routes. These models may return internal reasoning and their final answer through separate API fields. Earlier Harness versions could misread those formats, receive an apparently empty answer, stop the session, or treat reasoning as an AI Monitor instruction.

Practical full-session tests with DeepSeek, NVIDIA and Google reasoning-capable routes now complete correctly.

## Highlights

### Improved reasoning-model compatibility

- Provider responses now keep internal reasoning separate from final assistant content.
- OpenAI-compatible routes support `reasoning`, `reasoning_content`, `reasoning_details`, `thinking` and typed response parts.
- Google thought parts are separated from ordinary final text.
- Anthropic thinking blocks are separated from final text blocks.
- Common reasoning delimiters such as `<think>...</think>` are supported as a fallback for compatible local or hosted endpoints.
- Ordinary models that return only final `content` retain their existing behavior.

The normalization is shared across the Harness rather than being limited to AI Monitor. It benefits automatic RV sessions, Conversation, Manual RV, Research, Judge and post-Reveal calls.

### Correct AI Monitor instructions

- AI Monitor sends only the model's final response to the Viewer.
- Internal reasoning is no longer interpreted as an intervention or added to the sealed session transcript.
- A final Monitor instruction may contain one sentence, several sentences or a longer natural-language instruction; the Harness does not shorten, rewrite or semantically filter it.
- The exact `CONTINUE_PROTOCOL` value remains the controller signal for advancing without another intervention.
- A Telepathic Protocol regression involving Steps 7 and 8 is fixed: Monitor reasoning can no longer cause Step 8 to run early or be repeated.

### Larger output budget and safer recovery

- The former fixed 800-token AI Monitor limit has been removed.
- The first Monitor request can use up to 4,096 output tokens, limited by the selected model route.
- A controlled recovery attempt can use up to 8,192 output tokens when the route supports it.
- Existing reasoning settings and native provider controls remain enabled.
- Reasoning without final content, an unfinished reasoning block, or a response ending because of an output-token limit is not sent to the Viewer.
- Recoverable incomplete responses receive a bounded retry according to the configured retry policy.
- An incomplete Monitor response is not saved as a completed intervention and is not replayed as one when the user selects **Continue session**.
- Existing transcripts and completed Viewer work are preserved during recovery.

## Practical validation

The original failure appeared early in monitored sessions on affected reasoning-capable routes. After the v0.7.11 changes:

- a complete DeepSeek session finished without the earlier response error;
- a complete NVIDIA reasoning-model session finished correctly;
- a complete Google reasoning-model session finished correctly;
- Monitor reasoning remained separate from the final instruction delivered to the Viewer;
- protocol progression remained synchronized.

Automated project verification also completed successfully:

- TypeScript typecheck: passed;
- Vitest: 71 test files and 193 tests passed;
- Vite production build: passed;
- dependency audit: no known vulnerabilities reported;
- Windows and Linux release workflows produced attested desktop packages.

## Download and installation

### Windows

Download either:

- `AI.RV.Harness_0.7.11_x64-setup.exe` — recommended standard installer; or
- `AI.RV.Harness_0.7.11_x64_en-US.msi` — Windows Installer package.

The Windows packages use GitHub Artifact Attestations for provenance but are not Authenticode-signed. Microsoft Defender SmartScreen may therefore show a warning even when attestation verification succeeds.

### Linux

Download either:

- `AI.RV.Harness_0.7.11_amd64.AppImage` — portable application; or
- `AI.RV.Harness_0.7.11_amd64.deb` — Debian/Ubuntu package.

For AppImage:

```bash
chmod +x AI.RV.Harness_0.7.11_amd64.AppImage
./AI.RV.Harness_0.7.11_amd64.AppImage
```

For Debian or Ubuntu:

```bash
sudo apt install ./AI.RV.Harness_0.7.11_amd64.deb
```

## Verify downloads before installation

Verify every downloaded asset with GitHub CLI:

```bash
gh attestation verify "PATH_TO_ASSET" --repo lukeskytorep-bot/AI-RV-Harness
```

Artifact Attestations:

- [Windows attestation 43329507](https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/43329507)
- [Linux attestation 43330376](https://github.com/lukeskytorep-bot/AI-RV-Harness/attestations/43330376)

| Platform | Asset | SHA-256 |
|---|---|---|
| Linux | `AI.RV.Harness_0.7.11_amd64.AppImage` | `e0df3febde57b011d1d7dfa5bb1cedb5fde399307b9c1a5032ae7af5858de472` |
| Linux | `AI.RV.Harness_0.7.11_amd64.deb` | `2c110b2d5e570abc9f6ed4633eefc3de798fb063cd0d97026b39a4e17be275ef` |
| Windows | `AI.RV.Harness_0.7.11_x64-setup.exe` | `df49dd6b60fd8af0770ba15f639b424e82f96f21300691b43ba7c9edfbebcf54` |
| Windows | `AI.RV.Harness_0.7.11_x64_en-US.msi` | `571a47e55f760f0b6f53064bc80169f861c95e214e92771b316b08440174188f` |

Artifact Attestations establish build provenance and asset integrity. They do not guarantee that software contains no bugs and do not replace platform code signing.

## Updating from v0.7.10

- v0.7.11 is intended to update the existing installation while retaining profiles, Workspaces, targets, conversations and session history.
- Do not manually delete the application database before upgrading.
- Existing interrupted sessions remain available. If their stored state is recoverable, use **Continue session** after the update.
- Provider availability remains an external dependency. Temporary upstream failures may still occur, but the Harness now distinguishes incomplete reasoning responses from completed final answers.

## Licenses

- Application source code: MIT License.
- Bundled documentation, prompts, training content and non-code visual resources: CC BY 4.0 unless a specific bundled resource states otherwise.

Thank you to everyone who tested the reasoning-capable model routes and supplied complete session reports. Those practical tests made it possible to identify the response-format mismatch and verify the fix across multiple providers.
