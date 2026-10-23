import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

type CapturedRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  body: {
    records?: Array<{
      require?: Record<string, unknown>;
      fields?: Record<string, unknown>;
    }>;
  };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function startFakeGrist(statuses: number[]) {
  const requests: CapturedRequest[] = [];
  let requestNumber = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        authorization: request.headers.authorization,
        body: JSON.parse(rawBody) as CapturedRequest["body"],
      });

      const status = statuses[Math.min(requestNumber, statuses.length - 1)] ?? 200;
      requestNumber += 1;
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ addRecordIds: status === 200 ? [1, 2] : [], updateRecordIds: [] }));
    });
  });

  await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake Grist server did not bind to a TCP port");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => error ? rejectClose(error) : resolveClose());
    }),
  };
}

async function runExecutable(baseUrl: string, maxRetries: string) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GRIST_BASE_URL: baseUrl,
      GRIST_DOC_ID: "smoke-doc",
      GRIST_TABLE_ID: "RawRecords",
      GRIST_API_KEY: "smoke-key",
      SOURCE_NAME: "mock-source",
      DRY_RUN: "false",
      MOCK_SOURCE: "true",
      BATCH_SIZE: "100",
      MAX_RETRIES: maxRetries,
      RETRY_BASE_DELAY_MS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

  const result = await new Promise<{ exitCode: number | null }>((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      child.kill();
      rejectResult(new Error("Executable smoke test timed out"));
    }, 15_000);
    child.on("error", rejectResult);
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolveResult({ exitCode });
    });
  });

  return { ...result, stdout, stderr };
}

test("runs the executable ingestion path against a local Grist-compatible endpoint", async () => {
  const fakeGrist = await startFakeGrist([200]);
  try {
    const result = await runExecutable(fakeGrist.baseUrl, "1");

    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /\"event\":\"ingestion_complete\"/);
    assert.equal(fakeGrist.requests.length, 1);
    assert.equal(fakeGrist.requests[0]?.method, "PUT");
    assert.equal(fakeGrist.requests[0]?.url, "/api/docs/smoke-doc/tables/RawRecords/records");
    assert.equal(fakeGrist.requests[0]?.authorization, "Bearer smoke-key");
    assert.equal(fakeGrist.requests[0]?.body.records?.length, 2);
    assert.deepEqual(fakeGrist.requests[0]?.body.records?.map((record) => record.require?.CanonicalKey), [
      "mock-source:demo-001",
      "mock-source:demo-002",
    ]);
  } finally {
    await fakeGrist.close();
  }
});

test("recovers from a transient Grist HTTP failure through the executable path", async () => {
  const fakeGrist = await startFakeGrist([500, 200]);
  try {
    const result = await runExecutable(fakeGrist.baseUrl, "2");

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(fakeGrist.requests.length, 2);
    assert.match(result.stdout, /\"written\":2/);
  } finally {
    await fakeGrist.close();
  }
});
