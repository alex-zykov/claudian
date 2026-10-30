# Cursor constraints

- Spawn Cursor ACP as `agent acp` (binary `agent` preferred, then `cursor-agent`). Settings path overrides PATH discovery.
- After `initialize`, authenticate with `methodId: cursor_login`. Time out hung login waits and surface `agent login` / `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` guidance. Never store Cursor tokens in plugin settings.
- Capability flags: `supportsFork` / `supportsRewind` / `supportsTurnSteer` are false; restore history via `session/load` replaying `session/update`. Do not invent an on-disk Cursor history store. A missing/stale ACP session id falls back to `session/new` and prompt-side history replay.
- CLI `--list-models` ids (`auto`, `composer-2.5`) are not ACP `session/set_model` ids (`default[]`, `composer-2.5[fast=true]`); resolve against the live session catalog before set_model.
- Permission modes are Cursor ACP modes `agent` (default full tools), `plan` (read-only planning), and `ask` (read-only Q&A). Map Claudian `permissionMode` to those ACP session mode ids. Permission answers use `allow-once` / `allow-always` / `reject-once` through shared `mapACPApprovalDecision`.
- Register Cursor extensions only in this provider: blocking `cursor/ask_question` and `cursor/create_plan`; notifications `cursor/update_todos`, `cursor/task`, and `cursor/generate_image`. Shared ACP stays free of Cursor launch policy and extensions.
- Nonstandard Cursor behavior needs sanitized native protocol evidence under `.context/` / `tests/fixtures/providers/cursor/`.
