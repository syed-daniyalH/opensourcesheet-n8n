import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue } from "./types.js";

// Spreadsheet documents saved by the /editor page. The document body is opaque to the server
// except for the few fields used for listing and for appending webhook rows.
export interface SheetDocument {
  id: string;
  title: string;
  starred?: boolean;
  sheets: SheetTab[];
  active?: number;
  [key: string]: unknown;
}

export interface SheetTab {
  id: string;
  name: string;
  rows: number;
  cols: number;
  cells: Record<string, { v: string; s?: Record<string, unknown>; note?: string }>;
  [key: string]: unknown;
}

export interface StoredDocument {
  version: number;
  updatedAt: string;
  updatedBy?: string;
  doc: SheetDocument;
}

export interface HistoryEntry {
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

export interface SheetStoreOptions {
  // At most one history snapshot per document per interval; the newest `historyLimit` are kept.
  historyIntervalMs?: number;
  historyLimit?: number;
}

export interface DocumentSummary {
  id: string;
  title: string;
  starred: boolean;
  version: number;
  updatedAt: string;
  updatedBy?: string;
}

export class VersionConflictError extends Error {
  public constructor(public readonly current: StoredDocument) {
    super("The document was changed by someone else");
  }
}

const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function isValidDocumentId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export class DocumentValidationError extends Error {}

export function validateSheetDocument(value: unknown, id: string): SheetDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DocumentValidationError("Document must be a JSON object");
  const doc = value as Record<string, unknown>;
  if (doc.id !== id) throw new DocumentValidationError("Document id does not match the URL");
  if (typeof doc.title !== "string" || doc.title.length > 500) throw new DocumentValidationError("Document title must be a string");
  if (!Array.isArray(doc.sheets) || doc.sheets.length === 0 || doc.sheets.length > 200) throw new DocumentValidationError("Document must contain 1-200 sheets");
  for (const sheet of doc.sheets as unknown[]) {
    if (!sheet || typeof sheet !== "object") throw new DocumentValidationError("Each sheet must be an object");
    const s = sheet as Record<string, unknown>;
    if (typeof s.id !== "string" || typeof s.name !== "string") throw new DocumentValidationError("Each sheet needs an id and a name");
    if (!Number.isInteger(s.rows) || !Number.isInteger(s.cols) || (s.rows as number) < 1 || (s.cols as number) < 1) throw new DocumentValidationError("Each sheet needs positive rows and cols");
    if ((s.rows as number) > 1_000_000 || (s.cols as number) > 18_278) throw new DocumentValidationError("Sheet dimensions are too large");
    if (!s.cells || typeof s.cells !== "object" || Array.isArray(s.cells)) throw new DocumentValidationError("Each sheet needs a cells object");
  }
  return doc as SheetDocument;
}

export class SheetStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly lastSnapshot = new Map<string, number>();
  private readonly historyIntervalMs: number;
  private readonly historyLimit: number;

  public constructor(private readonly directory: string, options: SheetStoreOptions = {}) {
    this.historyIntervalMs = options.historyIntervalMs ?? 5 * 60 * 1000;
    this.historyLimit = options.historyLimit ?? 200;
  }

  private historyDir(id: string): string {
    if (!isValidDocumentId(id)) throw new Error("Invalid document id");
    return join(this.directory, "history", id);
  }

  private async snapshot(id: string, stored: StoredDocument): Promise<void> {
    const now = Date.now();
    if (now - (this.lastSnapshot.get(id) ?? 0) < this.historyIntervalMs) return;
    this.lastSnapshot.set(id, now);
    const dir = this.historyDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${stored.version}.json`), JSON.stringify(stored), "utf8");
    const versions = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n)).map((n) => Number(n.slice(0, -5))).sort((a, b) => b - a);
    for (const old of versions.slice(this.historyLimit)) await rm(join(dir, `${old}.json`), { force: true });
  }

  public async history(id: string): Promise<HistoryEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.historyDir(id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const entries: HistoryEntry[] = [];
    for (const name of names) {
      if (!/^\d+\.json$/.test(name)) continue;
      try {
        const stored = JSON.parse(await readFile(join(this.historyDir(id), name), "utf8")) as StoredDocument;
        entries.push(stored.updatedBy ? { version: stored.version, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy } : { version: stored.version, updatedAt: stored.updatedAt });
      } catch {
        // Ignore unreadable snapshots.
      }
    }
    return entries.sort((a, b) => b.version - a.version);
  }

  public async historyVersion(id: string, version: number): Promise<StoredDocument | null> {
    if (!Number.isInteger(version) || version < 1) return null;
    try {
      return JSON.parse(await readFile(join(this.historyDir(id), `${version}.json`), "utf8")) as StoredDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private path(id: string): string {
    if (!isValidDocumentId(id)) throw new Error("Invalid document id");
    return join(this.directory, `${id}.json`);
  }

  // Serializes read-modify-write cycles per document so concurrent webhook calls and saves
  // cannot interleave.
  private exclusive<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    this.queues.set(id, next);
    void next.finally(() => {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }).catch(() => undefined);
    return next;
  }

  public async get(id: string): Promise<StoredDocument | null> {
    try {
      return JSON.parse(await readFile(this.path(id), "utf8")) as StoredDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(id: string, stored: StoredDocument): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(id);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, JSON.stringify(stored), "utf8");
    await rename(temporary, target);
    try {
      await this.snapshot(id, stored);
    } catch (error) {
      console.error(JSON.stringify({ event: "sheet_history_write_failed", id, error: String(error) }));
    }
  }

  private static stamp(version: number, doc: SheetDocument, user: string | undefined): StoredDocument {
    const stored: StoredDocument = { version, updatedAt: new Date().toISOString(), doc };
    if (user) stored.updatedBy = user;
    return stored;
  }

  // Saves a document. baseVersion must match the stored version (0 for a new document);
  // otherwise VersionConflictError carries the current copy so the client can merge.
  // `validate` runs inside the per-document lock with the stored copy, so permission checks and the
  // write cannot interleave with another save.
  public put(id: string, doc: SheetDocument, baseVersion: number, user?: string, validate?: (current: SheetDocument | null) => void): Promise<StoredDocument> {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      const currentVersion = current?.version ?? 0;
      if (current && baseVersion !== currentVersion) throw new VersionConflictError(current);
      validate?.(current ? current.doc : null);
      const stored = SheetStore.stamp(currentVersion + 1, doc, user);
      await this.write(id, stored);
      return stored;
    });
  }

  public update(id: string, create: () => SheetDocument, change: (doc: SheetDocument) => void, user?: string): Promise<StoredDocument> {
    return this.exclusive(id, async () => {
      const current = await this.get(id);
      const doc = current ? current.doc : create();
      change(doc);
      const stored = SheetStore.stamp((current?.version ?? 0) + 1, doc, user);
      await this.write(id, stored);
      return stored;
    });
  }

  public delete(id: string): Promise<boolean> {
    return this.exclusive(id, async () => {
      const existed = (await this.get(id)) !== null;
      await rm(this.path(id), { force: true });
      return existed;
    });
  }

  public async list(): Promise<DocumentSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const summaries: DocumentSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isValidDocumentId(id)) continue;
      try {
        const stored = await this.get(id);
        if (!stored) continue;
        const summary: DocumentSummary = { id, title: stored.doc.title, starred: !!stored.doc.starred, version: stored.version, updatedAt: stored.updatedAt };
        if (stored.updatedBy) summary.updatedBy = stored.updatedBy;
        summaries.push(summary);
      } catch {
        // Skip unreadable files instead of failing the whole listing.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

// Converts an incoming value to editor cell text. Strings that the editor would otherwise read as a
// formula, number, or boolean (e.g. "=HYPERLINK(...)", "+923001234567", "00123") are stored with the
// spreadsheet text prefix "'" so they display exactly as received and never execute.
export function literalCellText(value: JsonValue): string {
  if (value === null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const text = typeof value === "object" ? JSON.stringify(value) : value;
  const looksLikeValue = /^[=+\-@']/.test(text) || /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?\s*$/i.test(text) || /^(?:true|false)$/i.test(text.trim());
  return looksLikeValue ? `'${text}` : text;
}
