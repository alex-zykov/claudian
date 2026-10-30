# Cursor ACP evidence

Collected against Cursor CLI `agent` version `2026.10.22-27dcf5f` on Linux x64
(installed via `curl https://cursor.com/install -fsS | bash` → `~/.local/bin/agent`).

Authentication on this machine: **not logged in**. Live `session/new`, prompt,
permission, and `cursor/*` extension captures are therefore incomplete. Docs at
https://cursor.com/docs/cli/acp and the initialize/auth-error probes below are
the evidence base; differences from the ticket's prior "Cursor ACP facts" are
listed at the end.

## Probe method

Throwaway clients in `.context/probe-acp-init.mjs` and
`.context/probe-acp-methods.mjs` / `probe-acp-more.mjs` spawn `agent acp`, speak
newline-delimited JSON-RPC 2.0 on stdio, and record sanitized results under
`tests/fixtures/providers/cursor/`.

## initialize (live)

Request: `protocolVersion: 1`, minimal client capabilities, clientInfo
`claudian-probe`.

Response (also `tests/fixtures/providers/cursor/runtime/initialize.json`):

- `protocolVersion`: 1
- `agentCapabilities.loadSession`: **true**
- `agentCapabilities.mcpCapabilities`: `{ http: true, sse: true }`
- `agentCapabilities.promptCapabilities`: `{ audio: false, embeddedContext: false, image: true }`
- `agentCapabilities.sessionCapabilities.list`: `{}` (list supported)
- `authMethods`: only `{ id: "cursor_login", name: "Cursor Login", ... }`
  description tells the user to run `agent login` first

## authenticate (live, unauthenticated)

`authenticate({ methodId: "cursor_login" })` **does not return** within 15s when
credentials are missing (hangs waiting for login state). Claudian must time out
and surface the actionable `agent login` / `CURSOR_API_KEY` guidance from the
auth-required error shape below — never store a Cursor token in plugin settings.

## Methods without a session (live)

| Method | Result |
| --- | --- |
| `session/list` | `-32000 Authentication required` (see auth-required fixture) |
| `session/new` | `-32000 Authentication required` |
| `session/load` | `-32000 Authentication required` |
| `session/fork` | **`-32601 Method not found`** |
| `session/rewind` | **`-32601 Method not found`** |
| `session/steer` | **`-32601 Method not found`** |
| `session/set_model` | Exists (`Session x not found`, not Method not found) |
| `session/set_mode` | Exists (`Session x not found`) |
| `session/set_config_option` | Exists (`Session x not found`) |
| `session/prompt` | Exists (`Session x not found`) |
| `session/cancel` as **request** | `-32601 Method not found` — ACP clients send cancel as a **notification** (Claudian's `ACPClientConnection.cancel` already does) |

## Capability flags (backed by this file)

| Flag | Value | Evidence |
| --- | --- | --- |
| `supportsNativeHistory` | `true` | `loadSession: true`; restore via `session/load` replaying `session/update` (no verified readable on-disk store without auth) |
| `supportsFork` | `false` | `session/fork` Method not found |
| `supportsRewind` | `false` | `session/rewind` Method not found |
| `supportsTurnSteer` | `false` | `session/steer` Method not found |
| `supportsEphemeralSessions` | `false` | No ephemeral/session-less mode observed; sessions are `session/new` / `session/load` |
| `supportsProviderCommands` | `false` | No command list method observed; not advertised on initialize |
| `supportsImageAttachments` | `true` | `promptCapabilities.image: true` |
| `reasoningControl` | `'none'` | No effort/reasoning config observed without auth; do not invent an effort control |
| `supportsResponseThroughput` | `false` | Not advertised |

## Docs-derived (not yet live-verified)

Until `CURSOR_API_KEY` / `agent login` is available on the probe host, these come
from https://cursor.com/docs/cli/acp and are marked in fixtures with
`_source: docs-derived…`:

- Launch: `agent acp` (binary also installed as `cursor-agent`)
- Pre-auth: `agent login`, `--api-key` / `CURSOR_API_KEY`, `--auth-token` / `CURSOR_AUTH_TOKEN`
- Modes: `agent`, `plan`, `ask`
- Permission option ids: `allow-once`, `allow-always`, `reject-once`
- Blocking extensions: `cursor/ask_question`, `cursor/create_plan`
- Notifications: `cursor/update_todos`, `cursor/task`, `cursor/generate_image`
- MCP from project/user `.cursor/mcp.json` only (no team-level in ACP mode)
- `session/new` is expected to return `models` / `modes` / `configOptions` (ACP
  shape Claudian already types as `ACPNewSessionResponse`)

## Differences vs ticket "Cursor ACP facts"

1. **`session/fork` is absent** on this CLI build (Method not found), matching the
   conservative `supportsFork: false` plan — not merely "out of scope".
2. **`session/rewind` and `session/steer` are absent** (Method not found).
3. **`session/cancel` is notification-only** on the wire for this build; sending it
   as a JSON-RPC *request* yields Method not found. Shared ACP already notifies.
4. **Unauthenticated `authenticate(cursor_login)` hangs** rather than returning a
   structured error; auth-required errors appear on subsequent session methods.
5. Live shapes for `session/new` models/modes, streamed turns, permission
   requests, and `cursor/*` payloads are **not yet captured** on a logged-in agent;
   fixtures under `tests/fixtures/providers/cursor/` use docs-derived placeholders
   for those until re-probed.

## History strategy

With `loadSession: true` and no verified native transcript store path on this
host, Claudian restores by calling `session/load` and replaying the
`session/update` notifications the agent emits during load. Persisted provider
state stays small: `sessionId`, `cwd`, and `nativeConversationContextEstablished`.
Do not create a real session solely to discover models or history.
