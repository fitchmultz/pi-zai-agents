import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

test("native tool loop shapes translation HTTP payload and preserves results", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zai-agents-native-"));
  const agentDir = join(root, "agent");
  await mkdir(agentDir);
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "success", text: "Bonjour" }));
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
  modelRuntime.registerProvider("fixture", {
    api: "fixture", apiKey: "fixture", baseUrl,
    models: [{ id: "test", name: "test", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1024 }],
    streamSimple(model) {
      const first = turns++ === 0;
      const stream = createAssistantMessageEventStream();
      const message = { role: "assistant", api: model.api, provider: model.provider, model: model.id,
        timestamp: Date.now(), stopReason: first ? "toolUse" : "stop",
        content: first ? [{ type: "toolCall", id: "translate-1", name: "z_ai_agent_translate",
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
    assert.ok(events.some((event) => event.type === "tool_execution_update"));
    assert.deepEqual(errors, []);
  } finally {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
});
