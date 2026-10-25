# Privacy, Security and Evidence Integrity

AI RV Harness is local-first. Session records, settings and learning histories are stored in the local application data directory unless the user explicitly exports them or sends content to a selected AI provider.

## Provider disclosure

When an AI request is made, the selected provider receives the prompt content, selected attachments and the provider-native continuation data required for that route. Provider policies and account settings apply to those requests.

Continuation state may contain opaque reasoning-related provider data. The application stores no more of it than required for compatible continuation, keeps it outside visible transcripts and validates its size and structure.

## Credentials

API credentials use the operating system secret-storage path and are bound to provider/endpoint identity. A legacy or mismatched binding requires explicit rebinding rather than silent reuse.

## Evidence integrity

- blind evidence is sealed before Reveal;
- post-Reveal analysis cannot rewrite it;
- Training and Research Resume use frozen snapshots and hashes;
- Judge results and frozen scores are append-only evidence;
- Research Lock freezes configuration and content;
- backup/restore and destructive actions use preflight checks.

## Attachments and local files

File type, content and size checks protect attachment and document ingestion. Provider endpoints are explicitly validated/bound; supported attachment and managed-file flows have their own checks. Exported packages should still be reviewed before sharing because they may contain session content or personal notes.

## Privacy Policy

The application includes local Polish and English Privacy Policy resources under Settings → About. The public project page provides the current published policy. The GitHub repository and GitHub Releases are the authoritative sources for code and release artifacts.

## Reporting security issues

Follow the private reporting instructions in the repository `SECURITY.md`. Do not publish credentials, private transcripts or exploit details in a public issue.


## Rejected final output

The development source can retain a bounded final-channel learning candidate with hash/validation for offline analysis. This is separate from private reasoning/continuation. Exported candidates may contain model-provided personal material; inspect them before sharing.
