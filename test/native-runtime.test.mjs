import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

test("native tool loop shapes translation HTTP payload and preserves results", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zai-agents-native-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const requests = [];
  const artifactDirectories = new Set();
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": req.url.endsWith(".pdf") ? "application/pdf" : "video/mp4" });
      res.end("owned-fixture-artifact");
      return;
    }
    const raw = Buffer.concat(chunks).toString();
    const body = req.url === "/paas/v4/files" ? raw : JSON.parse(raw);
    requests.push({ url: req.url, method: req.method, auth: req.headers.authorization, body });
    if (body.agent_id === "general_translation" && body.messages[0].content[0].text === "fixture-error") {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Owned service failure\u001b]52;c;unsafe\u0007\u0000" } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    const result = req.url === "/paas/v4/files" ? { id: "uploaded-fixture" }
      : req.url === "/v1/agents/conversation" ? { status: "success", file_url: `${baseUrl}/deck.pdf` }
      : req.url === "/v1/agents/async-result" ? { status: "success", video_url: `${baseUrl}/video.mp4` }
      : body.agent_id === "slides_glm_agent" ? { status: "success", conversation_id: "slides-fixture" }
      : body.agent_id === "vidu_template_agent" ? { status: "processing", async_id: "video-fixture" }
      : { status: "success", text: "Bonjour" };
    res.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", Z_AI_API_KEY: "local-fixture-key", Z_AI_AGENT_API_BASE_URL: baseUrl });
  const fetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    assert.equal(new URL(typeof input === "string" ? input : input.url ?? input).origin, baseUrl, "only the loopback fixture is allowed");
    return fetch(input, options);
  };
  t.after(async () => {
    globalThis.fetch = fetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
    for (const directory of artifactDirectories) await rm(directory, { recursive: true, force: true });
  });
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [fileURLToPath(new URL("../", import.meta.url))] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(agentDir, "models-store.json"), allowModelNetwork: false });
  let turns = 0;
  const queuedCalls = [];
  modelRuntime.registerProvider("fixture", {
    api: "fixture", apiKey: "fixture", baseUrl,
    models: [{ id: "test", name: "test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model) {
      const first = turns++ === 0;
      const calls = queuedCalls.splice(0);
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: first || calls.length ? "toolUse" : "stop",
        content: calls.length ? calls : first ? [{ type: "toolCall", id: "translate-1", name: "z_ai_agent_translate",
          arguments: { text: "Hello", sourceLang: "en", targetLang: "fr", strategy: "cot", reasonLang: "from", glossaryId: "glossary-fixture" } }]
          : [{ type: "text", text: "complete" }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); });
      return stream;
    },
  });
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime,
    model: modelRuntime.getModel("fixture", "test"), resourceLoader: loader, settingsManager,
    sessionManager: SessionManager.inMemory(root), noTools: "builtin" });
  const errors = [];
  const events = [];
  session.subscribe((event) => events.push(event));
  try {
    await session.bindExtensions({ onError: (error) => errors.push(error) });
    assert.deepEqual(session.getActiveToolNames().sort(), ["z_ai_agent_slide", "z_ai_agent_translate", "z_ai_agent_video"]);
    await session.prompt("Translate using the fixture service");
    assert.equal(turns, 2);
    assert.deepEqual(requests, [{ url: "/v1/agents", method: "POST", auth: "Bearer local-fixture-key", body: {
      agent_id: "general_translation", stream: false,
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      custom_variables: { source_lang: "en", target_lang: "fr", strategy: "cot", glossary: "glossary-fixture", strategy_config: { cot: { reason_lang: "from" } } },
    } }]);
    const result = session.messages.find((message) => message.role === "toolResult");
    assert.equal(result?.isError, false);
    assert.equal(result.toolCallId, "translate-1");
    assert.match(JSON.stringify(result.content), /Bonjour/);
    assert.deepEqual(events.find(event => event.type === "tool_execution_end" && event.toolCallId === "translate-1")?.result.structuredContent, {
      title: "Z.AI Translation Agent", status: "success", summary: ["text: Bonjour"],
      artifacts: [], artifactWarnings: [],
    }, "native callers receive the existing bounded outcome, not raw service data");
    assert.ok(events.some((event) => event.type === "tool_execution_update"));
    await writeFile(join(root, "glossary.xlsx"), "owned-fixture-spreadsheet");
    const actions = [
      ["glossary", "z_ai_agent_translate", { action: "upload_glossary", glossaryPath: "@glossary.xlsx" }],
      ["slides-create", "z_ai_agent_slide", { action: "create", prompt: "Owned poster fixture", requestId: "poster-receipt", stream: false }],
      ["slides-export", "z_ai_agent_slide", { action: "conversation", conversationId: "slides-fixture", includePdf: true }],
      ["video-create", "z_ai_agent_video", { action: "create", imageUrl: `${baseUrl}/approved-image.png`, template: "bodyshake", requestId: "video-receipt" }],
      ["video-result", "z_ai_agent_video", { action: "result", asyncId: "video-fixture", maxPolls: 1 }],
      ["invalid", "z_ai_agent_translate", { action: "translate" }],
      ["remote-error", "z_ai_agent_translate", { text: "fixture-error" }],
    ];
    const retrievalIds = new Set(["slides-export", "video-result"]);
    queuedCalls.push(...actions.filter(([id]) => !retrievalIds.has(id)).map(([id, name, arguments_]) => ({ type: "toolCall", id, name, arguments: arguments_ })));
    await session.prompt("Exercise only the owned glossary/poster/video creation fixtures.");
    assert.deepEqual(requests.filter(request => request.url === "/v1/agents" && request.body.agent_id === "slides_glm_agent").map(request => request.body.request_id), ["poster-receipt"], "exactly one poster job is created");
    assert.deepEqual(requests.filter(request => request.url === "/v1/agents" && request.body.agent_id === "vidu_template_agent").map(request => request.body.request_id), ["video-receipt"], "exactly one video job is created");
    const creationsBeforeRetrieval = requests.filter(request => request.url === "/v1/agents").length;
    queuedCalls.push(...actions.filter(([id]) => retrievalIds.has(id)).map(([id, name, arguments_]) => ({ type: "toolCall", id, name, arguments: arguments_ })));
    await session.prompt("Retrieve only the existing owned poster/video fixture jobs.");
    assert.equal(requests.filter(request => request.url === "/v1/agents").length, creationsBeforeRetrieval, "retrieval never creates or replays a paid job");
    const ended = events.filter(event => event.type === "tool_execution_end" && actions.some(([id]) => id === event.toolCallId));
    assert.equal(ended.length, actions.length);
    for (const event of ended) {
      if (event.toolCallId === "invalid" || event.toolCallId === "remote-error") {
        assert.equal(event.isError, true);
        const rendered = session.extensionRunner.getToolDefinition("z_ai_agent_translate").renderResult(event.result,
          { expanded: false, isPartial: false }, { fg: (_color, text) => text, bold: text => text }, { isError: event.isError });
        const text = rendered.render(80).join("\n");
        assert.match(text, event.toolCallId === "invalid" ? /Failed[\s\S]*text is required/ : /Failed[\s\S]*Owned service failure/);
        assert.equal(/[\u0000\u001b\u0007]/.test(text), false, "untrusted service failures cannot inject terminal controls");
        continue;
      }
      const outcome = event.result.structuredContent;
      assert.ok(outcome?.title && outcome.status && Array.isArray(outcome.summary));
      assert.equal("response" in outcome, false);
      if (event.toolCallId === "slides-export") assert.deepEqual(outcome.artifacts.map(artifact => artifact.sourceKey), ["file_url"], "slide export must deliver its local receipt");
      if (event.toolCallId === "video-result") assert.deepEqual(outcome.artifacts.map(artifact => artifact.sourceKey), ["video_url"], "video retrieval must deliver its local receipt");
      for (const artifact of outcome.artifacts) {
        artifactDirectories.add(dirname(artifact.path));
        assert.equal(await readFile(artifact.path, "utf8"), "owned-fixture-artifact");
        assert.equal(artifact.bytes, Buffer.byteLength("owned-fixture-artifact"));
        assert.equal("url" in artifact, false, "structured receipts do not expose service URLs");
      }
      if (outcome.rawResponsePath) artifactDirectories.add(dirname(outcome.rawResponsePath));
    }
    assert.match(requests.find(request => request.url === "/paas/v4/files").body, /filename="glossary.xlsx"/);
    assert.equal(requests.filter(request => request.url === "/v1/agents/async-result").length, 1, "video retrieval polls exactly once");
    const completedRequests = requests.length;
    await session.reload();
    assert.deepEqual(session.getActiveToolNames().sort(), ["z_ai_agent_slide", "z_ai_agent_translate", "z_ai_agent_video"]);
    assert.equal(requests.length, completedRequests, "reload must not repeat a completed paid-service request");
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
