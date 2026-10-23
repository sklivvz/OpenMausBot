import fs from 'node:fs';
import { makePlan, digest } from './plan.mjs';
import { readPrivateJson } from './reconcile.mjs';

try {
  const [specPath, baselinePath] = process.argv.slice(2);
  if (!specPath || !baselinePath || process.argv.length !== 4) throw new Error();
  const spec = readPrivateJson(specPath);
  const baseline = readPrivateJson(baselinePath);
  const plan = makePlan(spec, baseline, digest(spec));
  fs.writeSync(1, JSON.stringify({ ...plan, remoteEffects: false, authority: 'not_assessed', sourceEvidence: 'caller_supplied_not_independently_verified' }) + '\n');
} catch {
  fs.writeSync(2, 'Preview rejected; check the private fixed specification and fresh baseline against the documented schema.\n');
  process.exitCode = 1;
}
