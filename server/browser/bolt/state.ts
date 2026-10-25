import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BoltFault, type BoltInput, type BoltView } from "./contracts.ts";

export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface BoltReceipt {
  operationId: string;
  requestHash: string;
  status: "pending" | "dispatched" | "verified" | "not_executed";
  input: BoltInput;
  before: BoltView;
  startedAt: string;
  verifiedAt?: string;
  verification?: "input_only";
  checkoutHash?: string;
  orderId?: string;
  /** Basket snapshot the host adapter observed when it wrote add intent. */
  basketBaseline?: unknown;
}

/** Durable intent is written before the first effect. Unknown outcomes block new mutations. */
export class BoltJournal {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  async locked<T>(work: () => Promise<T>): Promise<T> {
    const path = join(this.directory, "lock");
    let fd: number;
    try { fd = openSync(path, "wx", 0o600); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new BoltFault("operation_locked_reconcile_before_unlock");
      throw error;
    }
    try { return await work(); } finally { closeSync(fd); unlinkSync(path); }
  }

  read(): Record<string, BoltReceipt> {
    const path = join(this.directory, "receipts.json");
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as Record<string, BoltReceipt> : {};
  }

  write(receipt: BoltReceipt): void {
    const receipts = this.read();
    Object.defineProperty(receipts, receipt.operationId, { value: receipt, enumerable: true, configurable: true, writable: true });
    const temporary = join(this.directory, "receipts.next");
    const fd = openSync(temporary, "w", 0o600);
    try { writeFileSync(fd, JSON.stringify(receipts)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, join(this.directory, "receipts.json"));
    const directory = openSync(this.directory, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
