export interface Config {
  baseUrl: string;
  docId: string;
  tableId: string;
  apiKey: string;
  sourceName: string;
  dryRun: boolean;
  mockSource: boolean;
  batchSize: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = required(env, "GRIST_BASE_URL");
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("GRIST_BASE_URL must be a valid HTTP(S) URL");
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    docId: required(env, "GRIST_DOC_ID"),
    tableId: required(env, "GRIST_TABLE_ID"),
    apiKey: required(env, "GRIST_API_KEY"),
    sourceName: required(env, "SOURCE_NAME"),
    dryRun: booleanValue(env, "DRY_RUN", true),
    mockSource: booleanValue(env, "MOCK_SOURCE", false),
    batchSize: positiveInteger(env, "BATCH_SIZE", 100),
    maxRetries: positiveInteger(env, "MAX_RETRIES", 3),
    retryBaseDelayMs: positiveInteger(env, "RETRY_BASE_DELAY_MS", 500),
  };
}
