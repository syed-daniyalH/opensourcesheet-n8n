import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  at: string;
  event: string;
  user?: string | undefined;
  ip?: string | undefined;
  [key: string]: unknown;
}

const MAX_BYTES = 5 * 1024 * 1024;

// Append-only JSON-lines log of security and data events, rotated to audit.log.1 at 5 MB.
export class AuditLog {
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly file: string | null) {}

  public record(event: string, details: Omit<AuditEvent, "at" | "event"> = {}): Promise<void> {
    if (!this.file) return Promise.resolve();
    const file = this.file;
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`;
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      try {
        if ((await stat(file)).size > MAX_BYTES) await rename(file, `${file}.1`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await appendFile(file, line, "utf8");
    }).catch((error: unknown) => {
      console.error(JSON.stringify({ event: "audit_write_failed", error: String(error) }));
    });
    return this.queue;
  }

  public async recent(limit: number): Promise<AuditEvent[]> {
    if (!this.file) return [];
    await this.queue;
    let text = "";
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const events: AuditEvent[] = [];
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        events.push(JSON.parse(line) as AuditEvent);
      } catch {
        // Skip a partially written line.
      }
    }
    return events;
  }
}
