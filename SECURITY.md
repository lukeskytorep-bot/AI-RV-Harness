# Security policy

AI RV Harness handles provider credentials, private target material and blinded research data. Security defects that could expose any of those are considered high priority.

## Do not include in reports or public issues

- real API keys or bearer tokens;
- private target/reveal content;
- user session databases or research exports containing private data.

Use redacted reproductions instead. Provider credentials must never be written to logs, SQLite, research packages or ordinary exports.

## Supported code

Until the first stable release, security fixes are applied to the latest development version.
