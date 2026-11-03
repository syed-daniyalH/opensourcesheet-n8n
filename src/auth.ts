import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = "admin" | "editor" | "viewer";
export const ROLES: readonly Role[] = ["admin", "editor", "viewer"];

export interface UserAccount {
  username: string;
  role: Role;
  // The bootstrap admin comes from ADMIN_USERNAME / ADMIN_PASSWORD and cannot be edited in the UI.
  builtIn: boolean;
  createdAt: string;
}

interface StoredUser {
  username: string;
  role: Role;
  salt: string;
  hash: string;
  createdAt: string;
}

export class UserInputError extends Error {}

const USERNAME_PATTERN = /^[A-Za-z0-9._@+-]{2,64}$/;
export const MIN_PASSWORD_LENGTH = 12;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, 32);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

// Accounts are stored in a JSON file with scrypt hashes; the bootstrap admin is always available.
export class UserStore {
  private users = new Map<string, StoredUser>();
  private loaded = false;
  private readonly dummySalt = randomBytes(16);

  public constructor(
    private readonly file: string,
    private readonly bootstrap: { username: string; passwordDigest: Buffer; passwordSalt: Buffer },
  ) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const list = JSON.parse(await readFile(this.file, "utf8")) as StoredUser[];
      for (const user of list) if (isRole(user.role) && USERNAME_PATTERN.test(user.username)) this.users.set(user.username.toLowerCase(), user);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.loaded = true;
  }

  private save(): Promise<void> {
    return writeJsonAtomic(this.file, [...this.users.values()]);
  }

  private isBootstrap(username: string): boolean {
    return username.toLowerCase() === this.bootstrap.username.toLowerCase();
  }

  public async verify(username: string, password: string): Promise<UserAccount | null> {
    await this.load();
    const name = username.trim();
    if (this.isBootstrap(name)) {
      const supplied = await hashPassword(password, this.bootstrap.passwordSalt);
      return timingSafeEqual(supplied, this.bootstrap.passwordDigest) ? this.bootstrapAccount() : null;
    }
    const stored = this.users.get(name.toLowerCase());
    // Hash even for unknown users so response time does not reveal which usernames exist.
    const supplied = await hashPassword(password, stored ? Buffer.from(stored.salt, "hex") : this.dummySalt);
    if (!stored) return null;
    const expected = Buffer.from(stored.hash, "hex");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? this.toAccount(stored) : null;
  }

  private bootstrapAccount(): UserAccount {
    return { username: this.bootstrap.username, role: "admin", builtIn: true, createdAt: "" };
  }

  private toAccount(user: StoredUser): UserAccount {
    return { username: user.username, role: user.role, builtIn: false, createdAt: user.createdAt };
  }

  public async get(username: string): Promise<UserAccount | null> {
    await this.load();
    if (this.isBootstrap(username)) return this.bootstrapAccount();
    const stored = this.users.get(username.toLowerCase());
    return stored ? this.toAccount(stored) : null;
  }

  public async list(): Promise<UserAccount[]> {
    await this.load();
    return [this.bootstrapAccount(), ...[...this.users.values()].map((u) => this.toAccount(u)).sort((a, b) => a.username.localeCompare(b.username))];
  }

  // Creates a user, or updates the role and/or password of an existing one.
  public async upsert(username: string, password: string | null, role: Role): Promise<UserAccount> {
    await this.load();
    const name = username.trim();
    if (!USERNAME_PATTERN.test(name)) throw new UserInputError("Username must be 2-64 characters: letters, digits, . _ @ + -");
    if (this.isBootstrap(name)) throw new UserInputError("The built-in admin is managed through ADMIN_USERNAME / ADMIN_PASSWORD");
    if (!isRole(role)) throw new UserInputError("Role must be admin, editor, or viewer");
    const existing = this.users.get(name.toLowerCase());
    if (!existing && !password) throw new UserInputError("A password is required for a new user");
    if (password !== null && password.length < MIN_PASSWORD_LENGTH) throw new UserInputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    let salt = existing?.salt ?? "";
    let hash = existing?.hash ?? "";
    if (password !== null) {
      const saltBytes = randomBytes(16);
      salt = saltBytes.toString("hex");
      hash = (await hashPassword(password, saltBytes)).toString("hex");
    }
    const user: StoredUser = { username: existing?.username ?? name, role, salt, hash, createdAt: existing?.createdAt ?? new Date().toISOString() };
    this.users.set(name.toLowerCase(), user);
    await this.save();
    return this.toAccount(user);
  }

  public async remove(username: string): Promise<boolean> {
    await this.load();
    if (this.isBootstrap(username)) throw new UserInputError("The built-in admin cannot be removed");
    const existed = this.users.delete(username.toLowerCase());
    if (existed) await this.save();
    return existed;
  }
}

interface StoredSession {
  username: string;
  expiresAt: number;
}

// Sessions survive gateway restarts. Only a SHA-256 of each cookie token is written to disk.
export class SessionStore {
  private sessions = new Map<string, StoredSession>();
  private loaded = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();

  public constructor(private readonly file: string | null, private readonly ttlMs: number) {}

  private static digest(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  public async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const entries = JSON.parse(await readFile(this.file, "utf8")) as Array<[string, StoredSession]>;
      const now = Date.now();
      for (const [key, session] of entries) if (session.expiresAt > now) this.sessions.set(key, session);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(JSON.stringify({ event: "session_store_unreadable", error: String(error) }));
    }
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const file = this.file!;
      this.saving = this.saving.then(() => writeJsonAtomic(file, [...this.sessions.entries()])).catch((error: unknown) => {
        console.error(JSON.stringify({ event: "session_store_write_failed", error: String(error) }));
      });
    }, 200);
    this.saveTimer.unref();
  }

  // Logins and logouts are written straight away so a restart right after them keeps the change.
  private async persist(): Promise<void> {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const file = this.file;
    this.saving = this.saving.catch(() => undefined).then(() => writeJsonAtomic(file, [...this.sessions.entries()]));
    await this.saving;
  }

  public async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.file) {
        const file = this.file;
        this.saving = this.saving.then(() => writeJsonAtomic(file, [...this.sessions.entries()]));
      }
    }
    await this.saving;
  }

  public async create(username: string): Promise<string> {
    await this.load();
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(SessionStore.digest(token), { username, expiresAt: Date.now() + this.ttlMs });
    this.prune();
    await this.persist();
    return token;
  }

  public async get(token: string | undefined): Promise<StoredSession | null> {
    if (!token) return null;
    await this.load();
    const key = SessionStore.digest(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      this.scheduleSave();
      return null;
    }
    return session;
  }

  public async delete(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.load();
    if (this.sessions.delete(SessionStore.digest(token))) await this.persist();
  }

  // Signs a user out everywhere (used when their account is removed or their password changes).
  public async deleteForUser(username: string): Promise<void> {
    await this.load();
    let changed = false;
    for (const [key, session] of this.sessions) {
      if (session.username.toLowerCase() === username.toLowerCase()) {
        this.sessions.delete(key);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
  }
}

// Fixed-window counter per key, e.g. failed logins per IP or webhook calls per minute.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  public constructor(private readonly limit: number, private readonly windowMs: number) {}

  public check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
    return entry.count >= this.limit ? { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) } : { allowed: true, retryAfterSeconds: 0 };
  }

  public hit(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count += 1;
    if (this.hits.size > 10_000) {
      for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
    }
  }

  public reset(key: string): void {
    this.hits.delete(key);
  }

  // Counts this call and reports whether it is still within the limit.
  public consume(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const result = this.check(key);
    if (result.allowed) this.hit(key);
    return result;
  }
}
