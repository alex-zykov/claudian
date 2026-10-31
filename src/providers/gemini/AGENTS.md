# Gemini constraints

- Spawn Gemini ACP as `agy acp` (binary `agy` only). Settings path overrides PATH discovery.
- Authentication is native to `agy` (`agy auth login` or `GEMINI_API_KEY` / `GOOGLE_API_KEY` / Vertex AI environment variables); never automatically call ACP `authenticate` or store Gemini credentials in plugin settings.
- Capability flags: `supportsFork` / `supportsRewind` / `supportsTurnSteer` are false; restore history via `session/load` replaying `session/update`. A missing/stale ACP session id falls back to `session/new` and prompt-side history replay.
- Discover models via `agy models` and merge live ACP session model and thought-level metadata when a session starts or loads.
- Permission modes map Claudian `permissionMode` to `agy` ACP session modes `default`, `autoEdit`, `plan` (read-only planning), and `yolo` (bypasses approvals). Permission answers use `allow-once` / `allow-always` / `reject-once` through shared `mapACPApprovalDecision`.
