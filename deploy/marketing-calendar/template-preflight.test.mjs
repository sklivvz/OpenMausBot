import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTemplate } from './template-preflight.mjs';

const copy = 'This issue explains a specific product development and its effects on the readers who will receive this newsletter.';
const template = '<html><body><header>Company</header><keila-content name="main"></keila-content><footer><a href="{{ unsubscribe_link }}">Unsubscribe</a></footer></body></html>';
test('accepts the reusable template without demanding the issue copy in it', () => assert.equal(checkTemplate(template, copy).passed, true));
test('rejects an entire issue passed off as the template', () => assert.equal(checkTemplate(template.replace('<keila-content name="main"></keila-content>', `<p>${copy}</p>`), copy).passed, false));
test('rejects copy outside or inside the dynamic slot', () => {
  for (const html of [template.replace('<header>', `<p>${copy}</p><header>`), template.replace('</keila-content>', `${copy}</keila-content>`)]) assert.equal(checkTemplate(html, copy).passed, false);
});
test('ignores fake content slots in comments and scripts', () => assert.equal(checkTemplate('<script>"'+template+'"</script><!--'+template+'-->', copy).passed, false));
test('rejects duplicate slots, missing unsubscribe and relative assets', () => {
  for (const html of [template+template, template.replace('{{ unsubscribe_link }}', '#'), template.replace('<header>', '<img src="./assets/logo.png"><header>')]) assert.equal(checkTemplate(html, copy).passed, false);
});
test('does not claim separation was checked when no substantive copy was supplied', () => assert.equal(checkTemplate(template, 'Subject: Hello').passed, false));
