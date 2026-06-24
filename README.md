# pi-zai-agents

Unofficial pi extension package for Z.AI **Agent API** products:

- GLM Slide/Poster Agent (`slides_glm_agent`)
- Translation Agent (`general_translation`)
- Video Effect Template Agent (`vidu_template_agent`)
- Shared Agent API support: file upload, async result polling, and slide conversation/export retrieval

This package is intentionally separate from `pi-zai-mcp`. It does **not** register or manage Z.AI MCP servers.

## Install

```bash
pi install npm:pi-zai-agents
```

Install directly from GitHub:

```bash
pi install https://github.com/fitchmultz/pi-zai-agents
```

From a local clone:

```bash
git clone https://github.com/fitchmultz/pi-zai-agents.git
cd pi-zai-agents
npm install
pi install .
```

Try without installing permanently:

```bash
Z_AI_API_KEY="your_key" pi -e .
```

## Configure

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `Z_AI_API_KEY` / `ZAI_API_KEY` | Yes | none | Z.AI API key sent as `Authorization: Bearer ...`. |
| `Z_AI_AGENT_API_BASE_URL` | No | `https://api.z.ai/api` | Agent API base URL. |
| `Z_AI_ACCEPT_LANGUAGE` | No | `en-US,en` | `Accept-Language` header. |
| `Z_AI_AGENT_TIMEOUT_MS` | No | `300000` | Per-request timeout in ms. Applies to API and artifact download requests. |

Run `/zai-agents-status` in pi to check local configuration. In TUI/RPC mode it uses Pi notifications; in print mode it writes the status text to stdout; in JSON mode it emits a custom message event.

## Tools

The package intentionally exposes the minimum product-level surface: three tools, one per Z.AI Agent product. Shared helper behavior is folded into those tools to reduce tool count, prompt size, and agent confusion.

| Tool | Purpose |
| --- | --- |
| `z_ai_agent_translate` | Calls `general_translation` for translation, streaming translation, glossary upload, or glossary-backed translation. `glossaryPath` is resolved relative to the current pi session cwd and supports a leading `@`. |
| `z_ai_agent_slide` | Calls `slides_glm_agent` to create/refine slides/posters (`action=create`) or retrieve/download conversation exports (`action=conversation`). |
| `z_ai_agent_video` | Calls `vidu_template_agent` to create video-template tasks (`action=create`) or retrieve/poll async results (`action=result`). Polling is clamped to 1-120 attempts and 1000-60000 ms intervals. |

TUI output is compact by default and uses colored custom renderers. Long-running calls emit early progress updates so the tool card appears before the API call completes. Expand a tool result to show details. Large JSON responses and truncated summaries are saved to temp files when needed; streaming slide responses are always saved as raw JSON.

When `file_url`, `image_url`, or `video_url` values appear in a response, this extension downloads those artifacts into an OS temp directory and reports the local paths.

## Paid-call warning

These tools make real Z.AI Agent API calls. Z.AI pricing docs list:

- GLM Slide/Poster Agent(beta): `$0.7 / MTok`
- General-Purpose Translation: `$3 / MTok`
- Popular Special Effects Video Templates: `$0.2 / video`

File upload docs state uploaded files are retained for 180 days. Do not upload sensitive files unless that retention is acceptable.

## Integration contract

Evidence inspected on 2026-06-05:

- Docs index: <https://docs.z.ai/llms.txt>
- Slide/Poster guide: <https://docs.z.ai/guides/agents/slide>
- Translation guide: <https://docs.z.ai/guides/agents/translation>
- Video Template guide: <https://docs.z.ai/guides/agents/video-template>
- Agent API: <https://docs.z.ai/api-reference/agents/agent>
- File Upload API: <https://docs.z.ai/api-reference/agents/file-upload>
- Async Result API: <https://docs.z.ai/api-reference/agents/get-async-result>
- Slide Conversation API: <https://docs.z.ai/api-reference/agents/agent-conversation>
- HTTP/API auth guide: <https://docs.z.ai/guides/develop/http/introduction>
- Pricing: <https://docs.z.ai/guides/overview/pricing>
- Errors: <https://docs.z.ai/api-reference/api-code>

### Auth and base URL

- Base server: `https://api.z.ai/api`
- Auth: `Authorization: Bearer <api key>`
- JSON calls also send `Content-Type: application/json` and `Accept-Language: en-US,en` by default.
- File upload uses `multipart/form-data`.

### Endpoints

| Endpoint | Method | Used by | Notes |
| --- | --- | --- | --- |
| `/v1/agents` | POST | Translation, Slide/Poster, Video Template | Request shape differs by `agent_id`. |
| `/paas/v4/files` | POST | File upload | Purpose must be `agent`. |
| `/v1/agents/async-result` | POST | Video async polling | Documented for `vidu_template_agent`. |
| `/v1/agents/conversation` | POST | Slide conversation/export | Docs say only `slides_glm_agent` is supported. |

### Agent request contracts

#### Translation Agent

`agent_id: general_translation`

Request:

```json
{
  "agent_id": "general_translation",
  "stream": false,
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "..." }] }],
  "custom_variables": {
    "source_lang": "auto",
    "target_lang": "zh-CN",
    "glossary": "optional uploaded file id",
    "strategy": "general",
    "strategy_config": {
      "general": { "suggestion": "optional style guidance" },
      "cot": { "reason_lang": "to" }
    }
  }
}
```

Strategies exposed: `general`, `paraphrase`, `two_step`, `three_step`, `reflection`, `cot`. The guide lists COT as a strategy. The OpenAPI enum omits `cot`, but a live probe on 2026-06-05 returned HTTP 200 for `strategy: "cot"`, so this package exposes it.

Response includes `id`, `agent_id`, `status`, `choices`, and `usage` token counts. `finish_reason` may be `stop`, `tool_calls`, `length`, `sensitive`, or `network_error`.

#### Slide/Poster Agent

`agent_id: slides_glm_agent`

Request:

```json
{
  "agent_id": "slides_glm_agent",
  "stream": true,
  "conversation_id": "optional existing conversation",
  "request_id": "optional caller id",
  "messages": [{ "role": "user", "content": [{ "type": "text", "text": "..." }] }]
}
```

The API docs list `stream` default `true`; this tool follows that default. A live streaming probe confirmed `text/event-stream` frames shaped as `data: {...}` and terminated by `data: [DONE]`. Frames include fields such as `id`, `agent_id`, `conversation_id`, `choices`, `messages`, `phase`, and text deltas.

Use `z_ai_agent_slide` with `action=conversation` and the returned `conversation_id` to retrieve export metadata. Conversation requests support `custom_variables.include_pdf` and optional page descriptors with `position`, `width`, and `height`. Conversation responses can include `file_url` and `image_url` artifacts.

#### Video Effect Template Agent

`agent_id: vidu_template_agent`

Request:

```json
{
  "agent_id": "vidu_template_agent",
  "request_id": "optional caller id",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "template prompt" },
      { "type": "image_url", "image_url": "https://..." }
    ]
  }],
  "custom_variables": { "template": "bodyshake" }
}
```

Supported templates from docs: `french_kiss`, `bodyshake`, `sexy_me`.

Initial response includes `status`, `agent_id`, and `async_id`. Poll `/v1/agents/async-result` with `agent_id` and `async_id`; status can be `pending`, `success`, or `failed`. Successful async result choices can include MP4 `video_url` artifacts.

#### File Upload

`POST /paas/v4/files` with multipart form fields:

- `purpose`: `agent`
- `file`: binary file

Documented limits:

- Max 100 files
- Max 100 MB per file
- Retained for 180 days
- Formats: `pdf`, `doc`, `xlsx`, `ppt`, `txt`, `jpg`, `png`

Response includes `id`, `object`, `bytes`, `filename`, `purpose`, and `created_at`.

### Failure semantics

Z.AI documents two layers of errors:

- HTTP status codes, such as 400 parameter errors, 401 auth errors, 429 rate/balance/concurrency errors, 435 file too large, and 500 server errors.
- JSON body business errors under `error.code` and `error.message`.

This extension throws tool errors for non-2xx HTTP responses, top-level `error` objects, and `status: "failed"`. Streaming failures may arrive inside SSE frames and are surfaced as tool errors when present.

## Examples

Translate text:

```json
{
  "action": "translate",
  "text": "Two roads diverged in a wood.",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "strategy": "general"
}
```

Translate with an uploaded glossary in one call. Relative paths resolve from the current pi session cwd:

```json
{
  "action": "translate",
  "text": "pi-zai-agents live validation is complete.",
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "glossaryPath": "./glossary.xlsx"
}
```

Create a slide/poster:

```json
{
  "action": "create",
  "prompt": "Create a five-slide product launch deck for a developer tool.",
  "stream": true
}
```

Retrieve slide exports:

```json
{
  "action": "conversation",
  "conversationId": "returned-conversation-id",
  "includePdf": true
}
```

Create and poll a video template task:

```json
{
  "action": "create",
  "imageUrl": "https://example.com/input.png",
  "template": "bodyshake",
  "waitUntilComplete": true,
  "pollIntervalMs": 5000,
  "maxPolls": 60
}
```

Poll an existing video async result:

```json
{
  "action": "result",
  "asyncId": "returned-async-id",
  "waitUntilComplete": true
}
```

## What this package does not include

- Z.AI MCP servers. Use `pi-zai-mcp` for Web Search, Web Reader, Zread, and Vision MCP.
- Generic raw `/v1/agents` escape hatches. This package keeps a strict scope and only exposes the three verified product tools.
- Z.AI GLM chat model provider support. Pi already has Z.AI model provider support through `ZAI_API_KEY`.

## Verify this repo

```bash
npm install
npm run ci
```

Use `npm run release:dry-run` after bumping to an unpublished version.

Local pi package smoke check:

```bash
tmpdir="$(mktemp -d)"
cd "$tmpdir"
PI_SKIP_VERSION_CHECK=1 PI_OFFLINE=1 pi install -l --approve /path/to/pi-zai-agents
PI_SKIP_VERSION_CHECK=1 PI_OFFLINE=1 pi list --approve
```

## Project map

```text
extensions/zai-agents.ts  # pi package entrypoint
src/index.ts              # extension implementation
package.json              # npm + pi package manifest
CHANGELOG.md              # release notes
```
