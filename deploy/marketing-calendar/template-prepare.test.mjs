import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareTemplate, run } from './template-prepare.mjs';

const copy = 'This issue explains a specific product development and its effects on the readers who will receive this newsletter.';
const entry = '<section class="entry"><div>[Optional image]</div><h2>[Headline]</h2><p>[Text]</p></section>';
const source = `<html><head><style>@font-face{font-family:Designer;src:url("./assets/font.woff2")}</style></head><body><header>[DATE]</header>${entry}<footer><a href="{{ unsubscribe_link }}">Unsubscribe</a></footer></body></html>`;
const plan = { slots: [{ name: 'date', content: '[DATE]' }, { name: 'main', content: entry }], assets: [{ from: './assets/font.woff2', to: 'https://assets.example.test/font.woff2' }] };
const options = { source, issueCopy: copy, plan, readAsset: async () => Buffer.from('fixture-font'), fetchAsset: async () => Buffer.from('fixture-font') };

test('only wraps original regions and replaces verified URLs, retaining every other byte', async () => {
  const { html, receipt } = await prepareTemplate(options);
  const unwrapped = html.replace(/<\/?keila-content\b[^>]*>/g, '').replace(plan.assets[0].to, plan.assets[0].from);
  assert.equal(unwrapped, source);
  assert.deepEqual(receipt.slots, ['date', 'main']);
  assert.equal(receipt.check.passed, true);
  assert.equal(receipt.assets[0].occurrences, 1);
});
test('rejects a substituted hosted font instead of changing the design', async () => {
  await assert.rejects(prepareTemplate({ ...options, fetchAsset: async () => Buffer.from('a different font') }), /does not match designer bytes/);
});
test('rejects invented, ambiguous, overlapping and duplicate slot regions', async () => {
  for (const slots of [
    [{ name: 'main', content: 'invented' }],
    [{ name: 'main', content: '>' }],
    [{ name: 'main', content: entry }, { name: 'title', content: '[Headline]' }],
    [{ name: 'main', content: entry }, { name: 'main', content: '[DATE]' }],
  ]) await assert.rejects(prepareTemplate({ ...options, plan: { ...plan, slots } }));
});
test('rejects issue prose used as a reusable master', async () => {
  await assert.rejects(prepareTemplate({ ...options, source: source.replace('[Text]', copy), plan: { ...plan, slots: [{ name: 'date', content: '[DATE]' }, { name: 'main', content: entry.replace('[Text]', copy) }] } }), /issue paragraph/);
});
test('rejects unmapped assets and placeholders outside editable slots', async () => {
  await assert.rejects(prepareTemplate({ ...options, plan: { ...plan, assets: [] } }), /relative assets/);
  await assert.rejects(prepareTemplate({ ...options, plan: { ...plan, slots: [plan.slots[1]] } }), /outside the editable slots/);
});
test('rejects an already adapted source instead of adding duplicate slots', async () => {
  const { html } = await prepareTemplate(options);
  await assert.rejects(prepareTemplate({ ...options, source: html }), /already has content slots/);
});
test('rejects unreferenced assets and credential-bearing or non-HTTPS destinations', async () => {
  for (const asset of [
    { from: './missing.png', to: 'https://assets.example.test/file.png' },
    { from: './assets/font.woff2', to: 'https://user:password@assets.example.test/file' },
    { from: './assets/font.woff2', to: 'file:///tmp/file' },
  ]) await assert.rejects(prepareTemplate({ ...options, plan: { ...plan, assets: [asset] } }));
});
test('writes a new installation file and preserves originals and existing outputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newsletter-template-'));
  try {
    const original = source.replace('<style>@font-face{font-family:Designer;src:url("./assets/font.woff2")}</style>', '');
    const paths = ['source.html', 'plan.json', 'issue.txt', 'installation.html'].map(name => path.join(dir, name));
    fs.writeFileSync(paths[0], original);
    fs.writeFileSync(paths[1], JSON.stringify({ ...plan, assets: [] }));
    fs.writeFileSync(paths[2], copy);
    const receipt = await run(paths);
    assert.equal(receipt.check.passed, true);
    assert.equal(fs.readFileSync(paths[0], 'utf8'), original);
    assert.match(fs.readFileSync(paths[3], 'utf8'), /keila-content name="main"/);
    await assert.rejects(run(paths), /new file/);
    await assert.rejects(run([...paths.slice(0, 3), paths[0]]), /new file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
