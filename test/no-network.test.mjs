import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

import {
  ZaiApiError,
  apiFetch,
  formatStatus,
  getStatusInfo,
  normalizeVideoPolling,
  parseSseText,
  readResponseBody,
} from "../src/index.ts";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    server.on("error", reject);
  });
}

function withEnv(values, fn) {
  const old = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [key, value] of old) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

test("apiFetch timeout covers response body reads", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("headers are not enough");
  });
  const port = await listen(server);
  try {
    await withEnv({
      Z_AI_API_KEY: "test-key",
      Z_AI_AGENT_API_BASE_URL: `http://127.0.0.1:${port}`,
      Z_AI_AGENT_TIMEOUT_MS: "50",
    }, async () => {
      await assert.rejects(
        apiFetch("/stall", { method: "GET" }, undefined, (response) => readResponseBody(response)),
        /timed out|aborted|AbortError|operation was aborted/i,
      );
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("malformed SSE frames throw a ZaiApiError", () => {
  assert.throws(
    () => parseSseText("data: {not json}\n\n"),
    (error) => error instanceof ZaiApiError && /Invalid Z\.AI SSE data frame/.test(error.message),
  );
});

test("video polling values are bounded", () => {
  assert.deepEqual(normalizeVideoPolling(10, 999), { pollIntervalMs: 1000, maxPolls: 120 });
  assert.deepEqual(normalizeVideoPolling(120_000, 0), { pollIntervalMs: 60_000, maxPolls: 1 });
  assert.deepEqual(normalizeVideoPolling(undefined, undefined), { pollIntervalMs: 5000, maxPolls: 60 });
});

test("status uses package version", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const info = await getStatusInfo();
  assert.equal(info.version, packageJson.version);
  assert.match(formatStatus(info), new RegExp(`^pi-zai-agents ${packageJson.version.replaceAll(".", "\\.")}`));
});
