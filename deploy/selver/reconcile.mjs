import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, assertFresh, snapshotState, verifyFinal } from './plan.mjs';

function stateAfter(plan, count) {
  const state = structuredClone(plan.before);
  for (const change of plan.changes.slice(0, count)) {
    if (change.quantity === 0) delete state.quantities[change.sku];
    else state.quantities[change.sku] = change.quantity;
  }
  return state;
}
function save(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
export function readPrivateJson(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 1_000_000 || (stat.mode & 0o077)) throw new Error('Private bounded regular JSON file required');
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
export class CartReconciler {
  constructor({ client, stateDir }) {
    if (!path.isAbsolute(stateDir)) throw new Error('Absolute private state directory required');
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(stateDir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Private state directory required');
    this.client = client;
    this.stateDir = stateDir;
  }
  async run(plan, operationId, { reconcileOnly = false } = {}) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) throw new Error('Invalid operation ID');
    const lock = path.join(this.stateDir, 'reconciliation.lock');
    const file = path.join(this.stateDir, `${operationId}.json`);
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Cart reconciliation is locked; inspect owner before recovery'); throw error; }
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, operationId, startedAt: new Date().toISOString() }));
    let receipt;
    const persist = status => { receipt.status = status; receipt.updatedAt = new Date().toISOString(); save(file, receipt); return structuredClone(receipt); };
    try {
      if (fs.existsSync(file)) {
        receipt = readPrivateJson(file);
        if (receipt.planHash !== digest(plan)) throw new Error('Operation ID already belongs to another plan');
        if (!Number.isInteger(receipt.completed) || receipt.completed < 0 || receipt.completed > plan.changes.length) throw new Error('Invalid receipt progress');
      } else {
        if (reconcileOnly) throw new Error('No operation receipt to reconcile');
        receipt = { operationId, planHash: digest(plan), completed: 0, pending: null, status: 'planned', createdAt: new Date().toISOString() };
        persist('planned');
      }
      let observed;
      try { observed = await this.client.read(); assertFresh(observed); }
      catch { return persist(receipt.pending !== null ? 'unknown' : 'read_failed'); }
      if (receipt.pending !== null) {
        if (receipt.pending !== receipt.completed || receipt.completed >= plan.changes.length) throw new Error('Invalid pending receipt');
        if (digest(snapshotState(observed)) !== digest(stateAfter(plan, receipt.completed + 1))) return persist('unknown');
        receipt.completed++;
        receipt.pending = null;
        persist('reconciled');
      }
      if (digest(snapshotState(observed)) !== digest(stateAfter(plan, receipt.completed))) return persist('conflict');
      if (reconcileOnly && receipt.completed < plan.changes.length) return persist('ready_to_resume');
      for (let index = receipt.completed; index < plan.changes.length; index++) {
        try { observed = await this.client.read(); assertFresh(observed); }
        catch { return persist('read_failed'); }
        if (digest(snapshotState(observed)) !== digest(stateAfter(plan, index))) return persist('conflict');
        if (observed.totalEur > plan.ceilingEur && plan.changes[index].quantity >= (stateAfter(plan, index).quantities[plan.changes[index].sku] || 0)) return persist('budget_failed');
        receipt.pending = index;
        persist('writing');
        const change = plan.changes[index];
        try {
          await this.client.change(change.sku, change.quantity, stateAfter(plan, index));
          observed = await this.client.read();
          assertFresh(observed);
          if (digest(snapshotState(observed)) !== digest(stateAfter(plan, index + 1))) return persist('unknown');
        } catch { return persist('unknown'); }
        receipt.completed++;
        receipt.pending = null;
        persist('running');
      }
      try { observed = await this.client.read(); receipt.verification = verifyFinal(plan, observed); }
      catch { return persist('verification_failed'); }
      return persist(receipt.verification.ok ? 'achieved' : 'verification_failed');
    } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
  }
}
