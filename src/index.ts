import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const EXTENSION_NAME = "pi-zai-agents";
const EXTENSION_VERSION = "0.1.0";
const DEFAULT_BASE_URL = "https://api.z.ai/api";
const DEFAULT_ACCEPT_LANGUAGE = "en-US,en";
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const COMPACT_PREVIEW_BYTES = 2_500;
const EXPANDED_PREVIEW_BYTES = 12_000;
const SUMMARY_TEXT_BYTES = 1_200;
const VIDEO_ARTIFACT_REFRESH_DELAY_MS = 2_000;
const VIDEO_ARTIFACT_REFRESH_ATTEMPTS = 3;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(["pdf", "doc", "xlsx", "ppt", "txt", "jpg", "png"]);

const SOURCE_LANGUAGE_CODES = [
  "auto",
  "zh-CN",
  "zh-TW",
  "wyw",
  "yue",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "pt",
  "it",
  "ar",
  "hi",
  "bg",
  "cs",
  "da",
  "el",
  "et",
  "fi",
  "hu",
  "id",
  "lt",
  "lv",
  "nl",
  "no",
  "pl",
  "ro",
  "sk",
  "sl",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "my",
  "ms",
  "Pinyin",
  "IPA",
] as const;

const TARGET_LANGUAGE_CODES = [
  "zh-CN",
  "zh-TW",
  "wyw",
  "yue",
  "en",
  "en-GB",
  "en-US",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "pt",
  "it",
  "ar",
  "hi",
  "bg",
  "cs",
  "da",
  "el",
  "et",
  "fi",
  "hu",
  "id",
  "lt",
  "lv",
  "nl",
  "no",
  "pl",
  "ro",
  "sk",
  "sl",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "my",
  "ms",
  "Pinyin",
  "IPA",
] as const;

const TRANSLATION_STRATEGIES = ["general", "paraphrase", "two_step", "three_step", "reflection", "cot"] as const;
const VIDEO_TEMPLATES = ["french_kiss", "bodyshake", "sexy_me"] as const;

const TranslationSchema = Type.Object({
  action: Type.Optional(StringEnum(["translate", "upload_glossary"] as const, {
    description: "Translate text or upload a glossary file for later Translation Agent use.",
    default: "translate",
  })),
  text: Type.Optional(Type.String({ description: "Text to translate. Required when action is translate." })),
  targetLang: Type.Optional(StringEnum(TARGET_LANGUAGE_CODES, { description: "Target language code.", default: "zh-CN" })),
  sourceLang: Type.Optional(StringEnum(SOURCE_LANGUAGE_CODES, { description: "Source language code. Use auto to auto-detect.", default: "auto" })),
  strategy: Type.Optional(StringEnum(TRANSLATION_STRATEGIES, { description: "Translation strategy. cot is supported by guide docs and live validation.", default: "general" })),
  glossaryId: Type.Optional(Type.String({ description: "Uploaded glossary file ID." })),
  glossaryPath: Type.Optional(Type.String({ description: "Local glossary file to upload before translating, resolved relative to the current pi session cwd. Live validation confirms .xlsx with source/target columns works." })),
  suggestion: Type.Optional(Type.String({ description: "Translation suggestions or style requirements." })),
  reasonLang: Type.Optional(StringEnum(["from", "to"] as const, { description: "COT reasoning language when strategy is cot.", default: "to" })),
  stream: Type.Optional(Type.Boolean({ description: "Use the API streaming mode. Defaults to false for compact translation output.", default: false })),
});

const SlideSchema = Type.Object({
  action: StringEnum(["create", "conversation"] as const, { description: "Create/refine a slide/poster, or retrieve conversation/export artifacts." }),
  prompt: Type.Optional(Type.String({ description: "Natural-language slide or poster request. Required for action=create." })),
  conversationId: Type.Optional(Type.String({ description: "slides_glm_agent conversation ID. Required for action=conversation; optional for create refinement." })),
  requestId: Type.Optional(Type.String({ description: "User-defined unique request ID for create calls." })),
  stream: Type.Optional(Type.Boolean({ description: "Use slides_glm_agent streaming on create. Z.AI documents true as default; this tool defaults true.", default: true })),
  includePdf: Type.Optional(Type.Boolean({ description: "For action=conversation, ask Z.AI to include/export a PDF file URL.", default: true })),
  pages: Type.Optional(Type.Array(Type.Object({
    position: Type.Number({ description: "Slide page position." }),
    width: Type.Optional(Type.Number({ description: "Slide width in pt." })),
    height: Type.Optional(Type.Number({ description: "Slide height in pt." })),
  }), { description: "Optional slide page export descriptors for action=conversation." })),
});

const VideoSchema = Type.Object({
  action: StringEnum(["create", "result"] as const, { description: "Create a video template task, or retrieve/poll an async result." }),
  imageUrl: Type.Optional(Type.String({ description: "Public Z.AI-fetchable image URL. Required for action=create. Avoid trailing slashes unless part of the real URL." })),
  template: Type.Optional(StringEnum(VIDEO_TEMPLATES, { description: "Video effect template for action=create." })),
  prompt: Type.Optional(Type.String({ description: "Optional prompt override for action=create. Defaults to the documented prompt for the selected template." })),
  requestId: Type.Optional(Type.String({ description: "User-defined unique request ID for action=create." })),
  asyncId: Type.Optional(Type.String({ description: "Task ID returned by action=create. Required for action=result." })),
  waitUntilComplete: Type.Optional(Type.Boolean({ description: "Poll async-result until success or failure and download video_url artifacts.", default: false })),
  pollIntervalMs: Type.Optional(Type.Number({ description: "Polling interval in milliseconds.", default: 5000, minimum: 1000 })),
  maxPolls: Type.Optional(Type.Number({ description: "Maximum poll attempts.", default: 60, minimum: 1 })),
});

type JsonObject = Record<string, unknown>;
type ArtifactDownload = {
  sourceKey: string;
  url: string;
  path: string;
  bytes: number;
  contentType?: string;
};
type ArtifactDownloadError = {
  sourceKey: string;
  url: string;
  message: string;
  status?: number;
};
type UploadedFile = {
  id: string;
  object?: string;
  bytes?: number;
  filename?: string;
  purpose?: string;
  created_at?: number;
};
type ApiConfig = {
  baseUrl: string;
  apiKey: string;
  acceptLanguage: string;
  timeoutMs: number;
};
type ToolUpdate = (result: { content: Array<{ type: "text"; text: string }>; details: unknown }) => void;
type ThemeColor = "success" | "error" | "warning" | "muted" | "dim" | "toolTitle" | "accent";
type ToolTheme = {
  fg: (color: ThemeColor, text: string) => string;
  bold: (text: string) => string;
};
type SummaryDetails = {
  title: string;
  status: string;
  lines: string[];
  phase?: string;
  artifacts: ArtifactDownload[];
  artifactErrors: ArtifactDownloadError[];
  rawResponsePath?: string;
  compactPreview: string;
  expandedPreview: string;
  truncated: boolean;
  response?: unknown;
};

class ZaiApiError extends Error {
  readonly status?: number;
  readonly code?: string | number;
  readonly body?: unknown;

  constructor(message: string, options?: { status?: number; code?: string | number; body?: unknown }) {
    super(message);
    this.name = "ZaiApiError";
    if (options?.status !== undefined) this.status = options.status;
    if (options?.code !== undefined) this.code = options.code;
    if (options?.body !== undefined) this.body = options.body;
  }
}

function errorOptions(status: number | undefined, code: string | number | undefined, body: unknown): { status?: number; code?: string | number; body?: unknown } {
  const options: { status?: number; code?: string | number; body?: unknown } = { body };
  if (status !== undefined) options.status = status;
  if (code !== undefined) options.code = code;
  return options;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function getConfig(): ApiConfig {
  const apiKey = process.env.Z_AI_API_KEY || process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error("Missing Z.AI API key. Set Z_AI_API_KEY or ZAI_API_KEY.");
  return {
    baseUrl: (process.env.Z_AI_AGENT_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    apiKey,
    acceptLanguage: process.env.Z_AI_ACCEPT_LANGUAGE || DEFAULT_ACCEPT_LANGUAGE,
    timeoutMs: positiveIntegerFromEnv("Z_AI_AGENT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  };
}

function normalizeToolPath(input: string): string {
  return input.startsWith("@") ? input.slice(1) : input;
}

function resolveToolPath(input: string, cwd: string): string {
  const normalized = normalizeToolPath(input);
  return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

function combineWithTimeout(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`Z.AI request timed out after ${timeoutMs}ms`)), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractError(body: unknown): { code?: string | number | undefined; message?: string | undefined } | undefined {
  if (!body || typeof body !== "object") return undefined;
  const object = body as JsonObject;
  const nested = object.error;
  if (nested && typeof nested === "object") {
    const error = nested as JsonObject;
    return {
      code: typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
    };
  }
  return {
    code: typeof object.code === "string" || typeof object.code === "number" ? object.code : undefined,
    message: typeof object.message === "string" ? object.message : undefined,
  };
}

function assertNoAgentError(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const object = body as JsonObject;
  const error = extractError(body);
  if (error?.message) throw new ZaiApiError(error.message, errorOptions(undefined, error.code, body));
  if (object.status === "failed") throw new ZaiApiError("Z.AI Agent task failed.", { body });
}

async function apiFetch(path: string, init: RequestInit, signal: AbortSignal | undefined): Promise<Response> {
  const config = getConfig();
  const { signal: requestSignal, cleanup } = combineWithTimeout(signal, config.timeoutMs);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${config.apiKey}`);
  headers.set("Accept-Language", config.acceptLanguage);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, { ...init, headers, signal: requestSignal });
    if (!response.ok) {
      const body = await readResponseBody(response);
      const error = extractError(body);
      throw new ZaiApiError(error?.message || `Z.AI API request failed with HTTP ${response.status}`, errorOptions(response.status, error?.code, body));
    }
    return response;
  } finally {
    cleanup();
  }
}

async function postJson(path: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, signal);
  const payload = await readResponseBody(response);
  assertNoAgentError(payload);
  return payload;
}

function defaultVideoPrompt(template: (typeof VIDEO_TEMPLATES)[number]): string {
  switch (template) {
    case "french_kiss":
      return "The two figures in the image gradually move closer, then passionately kiss with alternating deep and firm intensity.";
    case "bodyshake":
      return "Video content: The character performs a rhythmic dance sequence in an indoor setting. She starts by swaying her hips, then turns to the other side, briefly shaking her hips in a playful manner. Her movements are smooth and confident, consistently emphasizing rhythm and expressiveness. Requirement: Movement intensity – high.";
    case "sexy_me":
      return "Video content: The transformation varies depending on the subject's gender. If the image shows a female: The woman's clothing transforms seamlessly into a stylish bikini. At the final moment, she confidently places her hands on her waist. If the image shows a male: The man swiftly removes his shirt, revealing a muscular physique matching his skin tone. Requirements: close-up or medium shots should zoom out; movement intensity high.";
  }
}

function translationRequest(params: {
  text: string;
  sourceLang?: string;
  targetLang: string;
  strategy?: string;
  glossaryId?: string;
  suggestion?: string;
  reasonLang?: string;
  stream?: boolean;
}): JsonObject {
  const strategy = params.strategy || "general";
  const customVariables: JsonObject = {
    source_lang: params.sourceLang || "auto",
    target_lang: params.targetLang,
    strategy,
  };
  if (params.glossaryId) customVariables.glossary = params.glossaryId;
  const strategyConfig: JsonObject = {};
  if (params.suggestion) strategyConfig.general = { suggestion: params.suggestion };
  if (strategy === "cot" && params.reasonLang) strategyConfig.cot = { reason_lang: params.reasonLang };
  if (Object.keys(strategyConfig).length > 0) customVariables.strategy_config = strategyConfig;
  return {
    agent_id: "general_translation",
    stream: params.stream === true,
    messages: [{ role: "user", content: [{ type: "text", text: params.text }] }],
    custom_variables: customVariables,
  };
}

function slideCreateRequest(params: { prompt: string; conversationId?: string; requestId?: string; stream?: boolean }): JsonObject {
  const body: JsonObject = {
    agent_id: "slides_glm_agent",
    stream: params.stream ?? true,
    messages: [{ role: "user", content: [{ type: "text", text: params.prompt }] }],
  };
  if (params.conversationId) body.conversation_id = params.conversationId;
  if (params.requestId) body.request_id = params.requestId;
  return body;
}

function videoCreateRequest(params: { imageUrl: string; template: (typeof VIDEO_TEMPLATES)[number]; prompt?: string; requestId?: string }): JsonObject {
  const body: JsonObject = {
    agent_id: "vidu_template_agent",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: params.prompt || defaultVideoPrompt(params.template) },
        { type: "image_url", image_url: params.imageUrl },
      ],
    }],
    custom_variables: { template: params.template },
  };
  if (params.requestId) body.request_id = params.requestId;
  return body;
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolveSleep, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Cancelled"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function getAsyncResult(asyncId: string, signal: AbortSignal | undefined): Promise<unknown> {
  return postJson("/v1/agents/async-result", { agent_id: "vidu_template_agent", async_id: asyncId }, signal);
}

async function pollAsyncResult(params: {
  asyncId: string;
  pollIntervalMs: number;
  maxPolls: number;
  signal?: AbortSignal | undefined;
  onUpdate?: (status: string, attempt: number) => void;
}): Promise<unknown> {
  let last: unknown;
  for (let attempt = 1; attempt <= params.maxPolls; attempt += 1) {
    last = await getAsyncResult(params.asyncId, params.signal);
    const status = statusOf(last);
    params.onUpdate?.(status || "unknown", attempt);
    if (status === "success") return last;
    if (status === "failed") {
      assertNoAgentError(last);
      throw new ZaiApiError("Z.AI async task failed.", { body: last });
    }
    if (attempt < params.maxPolls) await sleep(params.pollIntervalMs, params.signal);
  }
  return last;
}

function statusOf(value: unknown): string | undefined {
  return value && typeof value === "object" && typeof (value as JsonObject).status === "string"
    ? (value as { status: string }).status
    : undefined;
}

function collectText(value: unknown): string[] {
  const output: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const object = node as JsonObject;
    if (typeof object.text === "string" && (object.type === undefined || object.type === "text")) output.push(object.text);
    for (const child of Object.values(object)) visit(child);
  };
  visit(value);
  return output;
}

function collectUrls(value: unknown): Array<{ key: string; url: string }> {
  const urls: Array<{ key: string; url: string }> = [];
  const seen = new Set<string>();
  const visit = (node: unknown, path: string[]) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...path, String(index)]));
      return;
    }
    const object = node as JsonObject;
    for (const [key, value] of Object.entries(object)) {
      if ((key === "file_url" || key === "image_url" || key === "video_url") && typeof value === "string" && /^https?:\/\//.test(value)) {
        const id = `${key}:${value}`;
        if (!seen.has(id)) {
          seen.add(id);
          urls.push({ key: [...path, key].join("."), url: value });
        }
      }
      visit(value, [...path, key]);
    }
  };
  visit(value, []);
  return urls;
}

function extensionFromContentType(contentType: string | null): string {
  if (!contentType) return "bin";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("html")) return "html";
  if (contentType.includes("json")) return "json";
  if (contentType.includes("text")) return "txt";
  return "bin";
}

function safeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120) || "artifact";
}

async function ensureTempDir(prefix = EXTENSION_NAME): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`));
  await mkdir(dir, { recursive: true });
  return dir;
}

async function downloadArtifacts(value: unknown, signal: AbortSignal | undefined): Promise<{ downloads: ArtifactDownload[]; errors: ArtifactDownloadError[] }> {
  const urls = collectUrls(value);
  if (urls.length === 0) return { downloads: [], errors: [] };
  const dir = await ensureTempDir(`${EXTENSION_NAME}-artifacts`);
  const downloads: ArtifactDownload[] = [];
  const errors: ArtifactDownloadError[] = [];
  for (const [index, item] of urls.entries()) {
    try {
      const { signal: requestSignal, cleanup } = combineWithTimeout(signal, getConfig().timeoutMs);
      let arrayBuffer: ArrayBuffer;
      let contentType: string | undefined;
      try {
        const response = await fetch(item.url, { signal: requestSignal });
        if (!response.ok) {
          errors.push({ sourceKey: item.key, url: item.url, status: response.status, message: `HTTP ${response.status}` });
          continue;
        }
        arrayBuffer = await response.arrayBuffer();
        contentType = response.headers.get("content-type") || undefined;
      } finally {
        cleanup();
      }
      const urlName = safeFileName(basename(new URL(item.url).pathname));
      const hasExtension = extname(urlName).length > 0;
      const fileName = hasExtension ? `${index + 1}-${urlName}` : `${index + 1}-${safeFileName(item.key)}.${extensionFromContentType(contentType || null)}`;
      const path = join(dir, fileName);
      const bytes = new Uint8Array(arrayBuffer);
      await writeFile(path, bytes);
      const download: ArtifactDownload = { sourceKey: item.key, url: item.url, path, bytes: bytes.byteLength };
      if (contentType) download.contentType = contentType;
      downloads.push(download);
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push({ sourceKey: item.key, url: item.url, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { downloads, errors };
}

async function saveJsonArtifact(name: string, value: unknown): Promise<string> {
  const dir = await ensureTempDir(`${EXTENSION_NAME}-raw`);
  const path = join(dir, `${safeFileName(name)}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

function artifactOpenUrl(path: string): string {
  return pathToFileURL(path).href;
}

function makeProgressDetails(title: string, phase: string, lines: string[] = []): SummaryDetails {
  return {
    title,
    status: "running",
    phase,
    lines,
    artifacts: [],
    artifactErrors: [],
    compactPreview: "",
    expandedPreview: "",
    truncated: false,
  };
}

function emitProgress(onUpdate: ToolUpdate | undefined, title: string, phase: string, lines: string[] = []): void {
  onUpdate?.({
    content: [{ type: "text", text: [title, phase, ...lines].join("\n") }],
    details: makeProgressDetails(title, phase, lines),
  });
}

function textPreview(value: unknown, maxBytes: number): { text: string; truncated: boolean } {
  const serialized = JSON.stringify(value, null, 2);
  const truncation = truncateHead(serialized, { maxLines: DEFAULT_MAX_LINES, maxBytes });
  return { text: truncation.content, truncated: truncation.truncated };
}

function summaryLine(label: string, value: string): { line: string; truncated: boolean } {
  const truncation = truncateHead(value, { maxLines: 12, maxBytes: SUMMARY_TEXT_BYTES });
  const suffix = truncation.truncated ? "\n[summary truncated; expand or open the raw response for full output]" : "";
  return { line: `${label}: ${truncation.content}${suffix}`, truncated: truncation.truncated };
}

async function makeToolResult(title: string, status: string, lines: string[], payload: unknown, options?: { saveRawAlways?: boolean; signal?: AbortSignal | undefined; onProgress?: ((phase: string) => void) | undefined }) {
  if (collectUrls(payload).length > 0) options?.onProgress?.("Downloading returned artifacts...");
  const { downloads: artifacts, errors: artifactErrors } = await downloadArtifacts(payload, options?.signal);
  const compact = textPreview(payload, COMPACT_PREVIEW_BYTES);
  const expanded = textPreview(payload, EXPANDED_PREVIEW_BYTES);
  const full = textPreview(payload, DEFAULT_MAX_BYTES);
  if (options?.saveRawAlways || full.truncated) options?.onProgress?.("Saving raw response for expanded details...");
  const rawResponsePath = options?.saveRawAlways || full.truncated ? await saveJsonArtifact(title, payload) : undefined;

  const contentLines = [title, `Status: ${status}`, ...lines];
  if (artifacts.length > 0) {
    contentLines.push("Downloaded artifacts:");
    for (const artifact of artifacts) {
      contentLines.push(`- ${artifact.sourceKey}: ${artifact.path} (${formatSize(artifact.bytes)})`);
      contentLines.push(`  open: ${artifactOpenUrl(artifact.path)}`);
    }
  }
  if (artifactErrors.length > 0) {
    contentLines.push("Artifact download warnings:");
    for (const error of artifactErrors) contentLines.push(`- ${error.sourceKey}: ${error.message} (${error.url})`);
  }
  if (rawResponsePath) {
    contentLines.push(`Full raw response: ${rawResponsePath}`);
    contentLines.push(`Open raw response: ${artifactOpenUrl(rawResponsePath)}`);
  }
  contentLines.push("TUI output is compact; press Ctrl+O on the tool result to expand details.");

  const details: SummaryDetails = {
    title,
    status,
    lines,
    artifacts,
    artifactErrors,
    compactPreview: compact.text,
    expandedPreview: expanded.text,
    truncated: full.truncated,
  };
  if (rawResponsePath) details.rawResponsePath = rawResponsePath;
  if (!full.truncated) details.response = payload;

  return {
    content: [{ type: "text" as const, text: contentLines.join("\n") }],
    details,
  };
}

function extractSseData(block: string): string | undefined {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data.length > 0 ? data : undefined;
}

function parseSseText(text: string): unknown[] {
  const events: unknown[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = extractSseData(block);
    if (!data || data === "[DONE]") continue;
    const payload = JSON.parse(data) as unknown;
    assertNoAgentError(payload);
    events.push(payload);
  }
  return events;
}

async function parseSseResponse(response: Response, params: { signal?: AbortSignal | undefined; onData?: (payload: unknown, index: number) => void }): Promise<unknown[]> {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  let buffer = "";
  let done = false;
  while (!done) {
    if (params.signal?.aborted) throw params.signal.reason instanceof Error ? params.signal.reason : new Error("Cancelled");
    const result = await reader.read();
    if (result.done) {
      buffer += decoder.decode();
      done = true;
    } else {
      buffer += decoder.decode(result.value, { stream: true });
    }
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = extractSseData(block);
      if (!data) continue;
      if (data === "[DONE]") {
        done = true;
        break;
      }
      const payload = JSON.parse(data) as unknown;
      assertNoAgentError(payload);
      events.push(payload);
      params.onData?.(payload, events.length);
    }
  }
  const tail = extractSseData(buffer);
  if (tail && tail !== "[DONE]") {
    const payload = JSON.parse(tail) as unknown;
    assertNoAgentError(payload);
    events.push(payload);
    params.onData?.(payload, events.length);
  }
  return events;
}

function summarizeStreamEvents(events: unknown[]): { id?: string; conversationId?: string; agentId?: string; status?: string; textByPhase: Record<string, string>; lastEvent?: unknown } {
  const textByPhase: Record<string, string> = {};
  let id: string | undefined;
  let conversationId: string | undefined;
  let agentId: string | undefined;
  let status: string | undefined;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const object = event as JsonObject;
    if (typeof object.id === "string") id = object.id;
    if (typeof object.conversation_id === "string") conversationId = object.conversation_id;
    if (typeof object.agent_id === "string") agentId = object.agent_id;
    if (typeof object.status === "string") status = object.status;
    const choices = Array.isArray(object.choices) ? object.choices : [];
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const choiceObject = choice as JsonObject;
      const messages = Array.isArray(choiceObject.messages) ? choiceObject.messages : Array.isArray(choiceObject.message) ? choiceObject.message : [];
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const messageObject = message as JsonObject;
        const phase = typeof messageObject.phase === "string" ? messageObject.phase : "answer";
        const text = collectText(messageObject.content).join("");
        if (text) textByPhase[phase] = `${textByPhase[phase] || ""}${text}`;
      }
    }
  }
  const summary: { id?: string; conversationId?: string; agentId?: string; status?: string; textByPhase: Record<string, string>; lastEvent?: unknown } = { textByPhase };
  if (id) summary.id = id;
  if (conversationId) summary.conversationId = conversationId;
  if (agentId) summary.agentId = agentId;
  if (status) summary.status = status;
  if (events.length > 0) summary.lastEvent = events[events.length - 1];
  return summary;
}

async function postAgentStreaming(body: unknown, signal: AbortSignal | undefined, onUpdate: ((text: string) => void) | undefined): Promise<unknown> {
  const response = await apiFetch("/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, signal);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) {
    const payload = await readResponseBody(response);
    if (typeof payload === "string" && payload.trimStart().startsWith("data:")) {
      const events = parseSseText(payload);
      return { stream: true, event_count: events.length, summary: summarizeStreamEvents(events), events };
    }
    assertNoAgentError(payload);
    return payload;
  }
  let lastUpdate = 0;
  const events = await parseSseResponse(response, {
    signal,
    onData: (_payload, index) => {
      const now = Date.now();
      if (now - lastUpdate < 1000 && index % 25 !== 0) return;
      lastUpdate = now;
      onUpdate?.(`Received ${index} streaming event(s) from Z.AI Agent API...`);
    },
  });
  return { stream: true, event_count: events.length, summary: summarizeStreamEvents(events), events };
}

async function uploadFile(pathInput: string, purpose: "agent", signal: AbortSignal | undefined, cwd: string): Promise<UploadedFile> {
  const path = resolveToolPath(pathInput, cwd);
  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw new Error(`Not a file: ${path}`);
  if (fileStat.size > MAX_UPLOAD_BYTES) throw new Error(`File exceeds Z.AI upload limit: ${formatSize(fileStat.size)} > ${formatSize(MAX_UPLOAD_BYTES)}`);
  const extension = extname(path).slice(1).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) throw new Error(`Unsupported file extension .${extension}. Allowed: ${[...ALLOWED_UPLOAD_EXTENSIONS].join(", ")}`);
  const data = await readFile(path);
  const form = new FormData();
  form.append("purpose", purpose);
  form.append("file", new Blob([new Uint8Array(data)]), basename(path));
  const response = await apiFetch("/paas/v4/files", { method: "POST", body: form }, signal);
  const payload = await readResponseBody(response);
  assertNoAgentError(payload);
  if (!payload || typeof payload !== "object" || typeof (payload as JsonObject).id !== "string") throw new Error("Z.AI upload response did not include a file id.");
  return payload as UploadedFile;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${name} is required.`);
  return value;
}

function requireTemplate(value: unknown): (typeof VIDEO_TEMPLATES)[number] {
  if (value === "french_kiss" || value === "bodyshake" || value === "sexy_me") return value;
  throw new Error(`template is required and must be one of: ${VIDEO_TEMPLATES.join(", ")}.`);
}

function appendUploaded(payload: unknown, uploaded: UploadedFile | undefined): unknown {
  if (!uploaded || !payload || typeof payload !== "object") return payload;
  return { uploaded_glossary: uploaded, ...(payload as JsonObject) };
}

async function makeVideoToolResult(params: {
  title: string;
  lines: string[];
  payload: unknown;
  asyncId?: string | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: (phase: string) => void;
}) {
  let payload = params.payload;
  for (let attempt = 1; attempt <= VIDEO_ARTIFACT_REFRESH_ATTEMPTS; attempt += 1) {
    const result = await makeToolResult(params.title, statusOf(payload) || "success", params.lines, payload, {
      signal: params.signal,
      onProgress: params.onProgress,
    });
    const details = result.details as SummaryDetails;
    const staleVideoUrl = details.artifacts.length === 0 && details.artifactErrors.some((error) => error.status === 404 && error.sourceKey.endsWith("video_url"));
    if (!params.asyncId || statusOf(payload) !== "success" || !staleVideoUrl || attempt === VIDEO_ARTIFACT_REFRESH_ATTEMPTS) return result;
    params.onProgress?.("Refreshing video artifact URL...");
    await sleep(VIDEO_ARTIFACT_REFRESH_DELAY_MS, params.signal);
    payload = await getAsyncResult(params.asyncId, params.signal);
  }
  return makeToolResult(params.title, statusOf(payload) || "success", params.lines, payload, {
    signal: params.signal,
    onProgress: params.onProgress,
  });
}

function renderToolCall(title: string, args: Record<string, unknown>, theme: ToolTheme): Text {
  const action = typeof args.action === "string" ? args.action : undefined;
  const detail = action ? ` ${action}` : "";
  return new Text(`${theme.fg("toolTitle", theme.bold(title))}${theme.fg("muted", detail)}`, 0, 0);
}

function renderSummary(result: { details?: unknown }, options: { expanded?: boolean; isPartial?: boolean }, theme: ToolTheme) {
  const t = theme;
  const details = result.details as SummaryDetails | undefined;
  if (!details) return new Text(t.fg("muted", "Z.AI Agent result"), 0, 0);
  if (options.isPartial) {
    const lines = [
      `${t.fg("toolTitle", t.bold(details.title))} ${t.fg("warning", "…")}`,
      `  ${t.fg("warning", details.phase || "Working with Z.AI Agent API...")}`,
      ...details.lines.map((line) => `  ${t.fg("muted", line)}`),
    ];
    return new Text(lines.join("\n"), 0, 0);
  }
  const lines = [
    `${t.fg("toolTitle", t.bold(details.title))} ${details.status === "success" ? t.fg("success", "✓") : t.fg("warning", details.status)}`,
    ...details.lines.map((line) => `  ${t.fg("muted", line)}`),
  ];
  if (details.artifacts.length > 0) {
    lines.push(t.fg("success", `  artifacts: ${details.artifacts.length}`));
    for (const artifact of details.artifacts.slice(0, options.expanded ? 10 : 3)) {
      lines.push(`  ${artifact.path} ${t.fg("dim", `(${formatSize(artifact.bytes)})`)}`);
      lines.push(`  open: ${artifactOpenUrl(artifact.path)}`);
    }
  }
  if (details.artifactErrors.length > 0) {
    lines.push(t.fg("warning", `  artifact download warnings: ${details.artifactErrors.length}`));
    for (const error of details.artifactErrors.slice(0, options.expanded ? 10 : 3)) {
      lines.push(`  ${t.fg("warning", error.message)} ${t.fg("dim", error.url)}`);
    }
  }
  if (details.rawResponsePath && options.expanded) {
    lines.push(`  ${t.fg("dim", "raw:")} ${details.rawResponsePath}`);
    lines.push(`  open raw: ${artifactOpenUrl(details.rawResponsePath)}`);
  }
  if (!options.expanded) {
    lines.push(t.fg("dim", "  Ctrl+O: show details"));
  } else {
    lines.push("", t.fg("dim", "Response preview:"), details.expandedPreview);
  }
  return new Text(lines.join("\n"), 0, 0);
}

export default function zaiAgentsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "z_ai_agent_translate",
    label: "Z.AI Translation Agent",
    description: "Translate text or upload an .xlsx glossary with Z.AI General-Purpose Translation Agent. Paid Z.AI Agent API token billing applies. TUI output is compact; expand with Ctrl+O.",
    promptSnippet: "Translate text with Z.AI Translation Agent, optionally uploading/using glossary files.",
    promptGuidelines: [
      "Use z_ai_agent_translate when the user explicitly wants Z.AI Translation Agent output, glossary-aware translation, or a named translation strategy.",
      "For glossary-aware translation, prefer glossaryPath pointing to an .xlsx file with source/target columns; live validation showed free-form txt glossaries upload but may fail when used.",
    ],
    parameters: TranslationSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const title = "Z.AI Translation Agent";
      const action = params.action || "translate";
      emitProgress(onUpdate, title, action === "upload_glossary" ? "Preparing glossary upload..." : "Preparing translation request...");
      let uploaded: UploadedFile | undefined;
      if (params.glossaryPath) {
        emitProgress(onUpdate, title, "Uploading glossary file...", [normalizeToolPath(params.glossaryPath)]);
        uploaded = await uploadFile(params.glossaryPath, "agent", signal, ctx.cwd);
      }
      if (action === "upload_glossary") {
        if (!uploaded) throw new Error("glossaryPath is required for action=upload_glossary.");
        return makeToolResult(title, "success", [`uploaded glossary: ${uploaded.id}`], uploaded, { signal, onProgress: (phase) => emitProgress(onUpdate, title, phase) });
      }
      const text = requireString(params.text, "text");
      const targetLang = params.targetLang || "zh-CN";
      const requestInput: {
        text: string;
        targetLang: string;
        sourceLang?: string;
        strategy?: string;
        glossaryId?: string;
        suggestion?: string;
        reasonLang?: string;
        stream?: boolean;
      } = { text, targetLang };
      if (params.sourceLang) requestInput.sourceLang = params.sourceLang;
      if (params.strategy) requestInput.strategy = params.strategy;
      const glossaryId = uploaded?.id || params.glossaryId;
      if (glossaryId) requestInput.glossaryId = glossaryId;
      if (params.suggestion) requestInput.suggestion = params.suggestion;
      if (params.reasonLang) requestInput.reasonLang = params.reasonLang;
      if (params.stream !== undefined) requestInput.stream = params.stream;
      emitProgress(onUpdate, title, params.stream ? "Streaming translation from Z.AI..." : "Calling Z.AI Translation Agent...");
      const payload = params.stream
        ? await postAgentStreaming(translationRequest(requestInput), signal, (message) => emitProgress(onUpdate, title, message))
        : await postJson("/v1/agents", translationRequest(requestInput), signal);
      const fullPayload = appendUploaded(payload, uploaded);
      const textSummary = collectText(payload).join("").trim();
      const textLine = textSummary ? summaryLine("text", textSummary) : undefined;
      const resultOptions: { signal?: AbortSignal | undefined; saveRawAlways?: boolean; onProgress: (phase: string) => void } = {
        signal,
        onProgress: (phase) => emitProgress(onUpdate, title, phase),
      };
      if (textLine?.truncated) resultOptions.saveRawAlways = true;
      return makeToolResult(title, statusOf(payload) || "success", textLine ? [textLine.line] : [], fullPayload, resultOptions);
    },
    renderCall: (args, theme) => renderToolCall("Z.AI Translation Agent", args as Record<string, unknown>, theme),
    renderResult: renderSummary,
  });

  pi.registerTool({
    name: "z_ai_agent_slide",
    label: "Z.AI Slide/Poster Agent",
    description: "Create/refine slides/posters or retrieve slide conversation/export artifacts. Paid Z.AI Agent API token billing applies. TUI output is compact; expand with Ctrl+O.",
    promptSnippet: "Create/refine Z.AI slides/posters and retrieve/download slide exports through one tool.",
    promptGuidelines: [
      "Use z_ai_agent_slide for Z.AI Slide/Poster Agent work. action=create returns a conversationId; action=conversation retrieves/downloads exports.",
      "After z_ai_agent_slide action=create, call z_ai_agent_slide action=conversation when the user needs PDF/image artifacts.",
    ],
    parameters: SlideSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      const title = "Z.AI Slide/Poster Agent";
      emitProgress(onUpdate, title, params.action === "create" ? "Preparing slide/poster request..." : "Preparing slide conversation export...");
      if (params.action === "create") {
        const prompt = requireString(params.prompt, "prompt");
        const requestInput: { prompt: string; conversationId?: string; requestId?: string; stream?: boolean } = { prompt };
        if (params.conversationId) requestInput.conversationId = params.conversationId;
        if (params.requestId) requestInput.requestId = params.requestId;
        if (params.stream !== undefined) requestInput.stream = params.stream;
        const body = slideCreateRequest(requestInput);
        emitProgress(onUpdate, title, body.stream === true ? "Streaming slide/poster generation..." : "Generating slide/poster...");
        const payload = await postAgentStreaming(body, signal, (message) => emitProgress(onUpdate, title, message));
        const streamSummary = summarizeStreamEvents(Array.isArray((payload as JsonObject).events) ? (payload as { events: unknown[] }).events : []);
        const conversationId = typeof (payload as JsonObject).conversation_id === "string" ? String((payload as JsonObject).conversation_id) : streamSummary.conversationId;
        const lines = [];
        if (conversationId) lines.push(`conversation_id: ${conversationId}`);
        if (streamSummary.textByPhase.answer) lines.push(summaryLine("answer", streamSummary.textByPhase.answer).line);
        return makeToolResult(title, "success", lines, payload, { signal, saveRawAlways: true, onProgress: (phase) => emitProgress(onUpdate, title, phase, conversationId ? [`conversation_id: ${conversationId}`] : []) });
      }
      const conversationId = requireString(params.conversationId, "conversationId");
      const customVariables: JsonObject = { include_pdf: params.includePdf ?? true };
      if (params.pages) customVariables.pages = params.pages;
      emitProgress(onUpdate, title, "Retrieving slide export metadata...", [`conversation_id: ${conversationId}`]);
      const payload = await postJson("/v1/agents/conversation", {
        agent_id: "slides_glm_agent",
        conversation_id: conversationId,
        custom_variables: customVariables,
      }, signal);
      return makeToolResult(title, statusOf(payload) || "success", [`conversation_id: ${conversationId}`], payload, { signal, onProgress: (phase) => emitProgress(onUpdate, title, phase, [`conversation_id: ${conversationId}`]) });
    },
    renderCall: (args, theme) => renderToolCall("Z.AI Slide/Poster Agent", args as Record<string, unknown>, theme),
    renderResult: renderSummary,
  });

  pi.registerTool({
    name: "z_ai_agent_video",
    label: "Z.AI Video Template Agent",
    description: "Create a Z.AI Video Effect Template task or retrieve/poll its async result. Paid Z.AI per-video billing applies. TUI output is compact; expand with Ctrl+O.",
    promptSnippet: "Create/poll Z.AI french_kiss, bodyshake, or sexy_me video template tasks through one tool.",
    promptGuidelines: [
      "Use z_ai_agent_video only when the user explicitly asks for Z.AI Video Effect Template output and provides or approves an image URL.",
      "Use z_ai_agent_video action=result for async IDs returned by action=create when waitUntilComplete was false or timed out.",
    ],
    parameters: VideoSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      const title = "Z.AI Video Template Agent";
      emitProgress(onUpdate, title, params.action === "create" ? "Preparing video template request..." : "Preparing async result lookup...");
      let asyncId = params.asyncId;
      let payload: unknown;
      if (params.action === "create") {
        const imageUrl = requireString(params.imageUrl, "imageUrl");
        const template = requireTemplate(params.template);
        const requestInput: { imageUrl: string; template: typeof template; prompt?: string; requestId?: string } = { imageUrl, template };
        if (params.prompt) requestInput.prompt = params.prompt;
        if (params.requestId) requestInput.requestId = params.requestId;
        emitProgress(onUpdate, title, "Starting Z.AI video template task...", [`template: ${template}`]);
        const created = await postJson("/v1/agents", videoCreateRequest(requestInput), signal);
        asyncId = typeof (created as JsonObject).async_id === "string" ? String((created as JsonObject).async_id) : asyncId;
        payload = created;
      } else {
        asyncId = requireString(asyncId, "asyncId");
      }
      if ((params.waitUntilComplete || params.action === "result") && asyncId) {
        emitProgress(onUpdate, title, "Polling video task...", [`async_id: ${asyncId}`]);
        payload = await pollAsyncResult({
          asyncId,
          pollIntervalMs: Math.max(1000, Math.trunc(params.pollIntervalMs ?? 5000)),
          maxPolls: Math.max(1, Math.trunc(params.maxPolls ?? 60)),
          signal,
          onUpdate: (status, attempt) => emitProgress(onUpdate, title, `Poll ${attempt}: ${status}`, [`async_id: ${asyncId}`]),
        });
      }
      const lines = [];
      if (asyncId) lines.push(`async_id: ${asyncId}`);
      lines.push(`status: ${statusOf(payload) || "unknown"}`);
      return makeVideoToolResult({ title, lines, payload, asyncId, signal, onProgress: (phase) => emitProgress(onUpdate, title, phase, asyncId ? [`async_id: ${asyncId}`] : []) });
    },
    renderCall: (args, theme) => renderToolCall("Z.AI Video Template Agent", args as Record<string, unknown>, theme),
    renderResult: renderSummary,
  });

  pi.registerCommand("zai-agents-status", {
    description: "Show pi-zai-agents configuration status",
    handler: async (_args, ctx) => {
      const hasKey = Boolean(process.env.Z_AI_API_KEY || process.env.ZAI_API_KEY);
      ctx.ui.notify([
        `${EXTENSION_NAME} ${EXTENSION_VERSION}`,
        `API key: ${hasKey ? "configured" : "missing"}`,
        `Tools: z_ai_agent_translate, z_ai_agent_slide, z_ai_agent_video`,
        `Base URL: ${(process.env.Z_AI_AGENT_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "")}`,
        `Accept-Language: ${process.env.Z_AI_ACCEPT_LANGUAGE || DEFAULT_ACCEPT_LANGUAGE}`,
        `Timeout: ${positiveIntegerFromEnv("Z_AI_AGENT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)}ms`,
      ].join("\n"), hasKey ? "info" : "warning");
    },
  });
}
