#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { checkTemplate } from './template-check.mjs';
export { checkTemplate };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (![4, 5].includes(process.argv.length)) throw Error('Usage: newsletter-template-preflight TEMPLATE_HTML ISSUE_COPY [DESIGNER_TEMPLATE_HTML]');
    for (const file of process.argv.slice(2)) if (!fs.statSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024) throw Error('Expected a bounded text file.');
    const result = checkTemplate(fs.readFileSync(process.argv[2], 'utf8'), fs.readFileSync(process.argv[3], 'utf8'), process.argv[4] ? fs.readFileSync(process.argv[4], 'utf8') : undefined);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ passed: false, error: error.message }) + '\n');
    process.exitCode = 2;
  }
}
