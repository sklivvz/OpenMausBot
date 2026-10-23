import fs from 'node:fs';
import { makePlan } from './plan.mjs';
import { CartReconciler, readPrivateJson } from './reconcile.mjs';
import { PinnedSelverCart } from './client.mjs';

async function main() {
  const [command, configPath, specPath, baselinePath, operationId] = process.argv.slice(2);
  if (!['preview', 'apply', 'reconcile'].includes(command) || !configPath || !specPath || !baselinePath) throw new Error('Usage: main.mjs preview|apply|reconcile CONFIG SPEC BASELINE [OPERATION_ID]');
  const config = readPrivateJson(configPath);
  const spec = readPrivateJson(specPath);
  const baseline = readPrivateJson(baselinePath);
  const plan = makePlan(spec, baseline, config.specHash, command === 'preview' ? Date.now() : Date.parse(baseline.observedAt));
  if (command === 'preview') { process.stdout.write(JSON.stringify(plan) + '\n'); return; }
  if (!operationId || (command === 'apply' ? config.cartUpdatesEnabled !== true : config.cartReadsEnabled !== true)) throw new Error('Host operation configuration and operation ID required');
  const session = readPrivateJson(config.sessionFile);
  if (session.account !== spec.account || config.cartId !== spec.cartId) throw new Error('Host account/cart binding mismatch');
  const client = new PinnedSelverCart({ token: session.token, account: session.account, cartId: config.cartId });
  const runner = new CartReconciler({ client, stateDir: config.stateDir });
  const receipt = await runner.run(plan, operationId, { reconcileOnly: command === 'reconcile' });
  process.stdout.write(JSON.stringify(receipt) + '\n');
  if (receipt.status !== 'achieved' && receipt.status !== 'ready_to_resume') process.exitCode = 2;
}
main().catch(() => { fs.writeSync(2, 'Selver operation failed; inspect private configuration, specification and receipt.\n'); process.exitCode = 1; });
