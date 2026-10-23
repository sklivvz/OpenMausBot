import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTemplate } from './template-preflight.mjs';

const copy = 'This issue explains a specific product development and its effects on the readers who will receive this newsletter.';
const template = '<html><body><header>Company</header><keila-content name="main"></keila-content><footer><a href="{{ unsubscribe_link }}">Unsubscribe</a></footer></body></html>';
test('accepts the reusable template without demanding the issue copy in it', () => assert.equal(checkTemplate(template, copy).passed, true));
const designed = template.replace('<keila-content name="main"></keila-content>', '<keila-content name="main"><section class="entry"><h2>[Entry headline]</h2><p>[Entry text]</p></section></keila-content>');
test('preserves a designed placeholder template instead of requiring a blank body', () => {
  const result = checkTemplate(designed, copy, designed);
  assert.equal(result.passed, true);
  assert.deepEqual(result.placeholders, ['[Entry headline]', '[Entry text]']);
  assert.equal(checkTemplate(template, copy, designed).passed, false);
});
test('accepts multiple named slots with defaults used by Keila to seed campaign editors', () => {
  const html = designed.replace('</header>', '</header><keila-content name=edition>[Edition date]</keila-content>');
  assert.equal(checkTemplate(html, copy).passed, true);
  assert.deepEqual(checkTemplate(html, copy).slots, ['edition', 'main']);
});
test('accepts native campaign-data loops without imposing a content-slot design', () => {
  const html = template.replace('<keila-content name="main"></keila-content>', '{% for article in campaign.data.articles %}<section><h2>{{ article.title | escape }}</h2><p>{{ article.text | escape }}</p></section>{% endfor %}');
  const result = checkTemplate(html, copy);
  assert.equal(result.passed, true);
  assert.equal(result.dataDriven, true);
  assert.deepEqual(result.slots, []);
});
test('rejects duplicate names, unnamed, unclosed and nested slots', () => {
  for (const html of [designed + '<keila-content name="main"></keila-content>', designed.replace('name="main"', ''), designed.replace('</keila-content>', ''), designed.replace('</keila-content>', '<keila-content name="nested"></keila-content></keila-content>')]) assert.equal(checkTemplate(html, copy).passed, false);
});
test('requires every occurrence of a designer placeholder and its layout classes', () => {
  const original = designed.replace('</keila-content>', '<p>[Entry text]</p></keila-content>');
  assert.equal(checkTemplate(designed, copy, original).passed, false);
  assert.equal(checkTemplate(designed.replace('class="entry"', ''), copy, designed).passed, false);
  assert.equal(checkTemplate(template + '<!-- [Entry headline] [Entry text] -->', copy, designed).passed, false);
});
test('rejects an entire issue passed off as the template', () => assert.equal(checkTemplate(template.replace('<keila-content name="main"></keila-content>', `<p>${copy}</p>`), copy).passed, false));
test('rejects copy outside or inside the dynamic slot', () => {
  for (const html of [template.replace('<header>', `<p>${copy}</p><header>`), template.replace('</keila-content>', `${copy}</keila-content>`)]) assert.equal(checkTemplate(html, copy).passed, false);
});
test('ignores fake content slots in comments and scripts', () => assert.equal(checkTemplate('<script>"'+template+'"</script><!--'+template+'-->', copy).passed, false));
test('rejects duplicate slots, missing unsubscribe and relative assets', () => {
  for (const html of [template+template, template.replace('{{ unsubscribe_link }}', '#'), template.replace('<header>', '<img src="./assets/logo.png"><header>')]) assert.equal(checkTemplate(html, copy).passed, false);
});
test('does not claim separation was checked when no substantive copy was supplied', () => assert.equal(checkTemplate(template, 'Subject: Hello').passed, false));
