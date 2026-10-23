import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type Receipt = { status: string; reviewSha256: string; [key: string]: unknown };
const TTL = 7 * 86400_000;

export class ReceiptStore {
  constructor(readonly directory: string, readonly now = () => Date.now()) {}

  read(key: string): Receipt | undefined {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.directory, `${key}.json`), 'utf8'));
      if (saved.key === key && saved.expires > this.now() && saved.receipt?.reviewSha256 === key && typeof saved.receipt.status === 'string') return saved.receipt;
    } catch {}
    return undefined;
  }

  private write(name: string, value: unknown) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const destination = path.join(this.directory, name);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, destination);
    } finally { fs.rmSync(temporary, { force: true }); }
  }

  save(key: string, receipt: Receipt, input: unknown) {
    this.write(`${key}.json`, { key, expires: this.now() + TTL, input, receipt });
  }

  revisions(scope: string): string[] {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.directory, `scope-${scope}.json`), 'utf8'));
      if (saved.expires > this.now() && Array.isArray(saved.revisions) && saved.revisions.every((v: unknown) => typeof v === 'string')) return saved.revisions;
    } catch {}
    return [];
  }

  recordRevision(scope: string, key: string) {
    this.write(`scope-${scope}.json`, { expires: this.now() + TTL, revisions: [...new Set([...this.revisions(scope), key])] });
  }

  async locked<T>(key: string, work: () => Promise<T>): Promise<T> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const lock = path.join(this.directory, `${key}.lock`);
    const deadline = Date.now() + 30000;
    let descriptor: number;
    while (true) {
      try { descriptor = fs.openSync(lock, 'wx', 0o600); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - fs.statSync(lock).mtimeMs > 90000) fs.rmSync(lock); } catch {}
        if (Date.now() >= deadline) throw Error('A matching check is still running. Reuse its receipt when it finishes.');
        await delay(100);
      }
    }
    try { return await work(); }
    finally { fs.closeSync(descriptor); fs.rmSync(lock, { force: true }); }
  }
}
