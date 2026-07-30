const { test, report, assert } = require('./harness');
const { parseTaxonTagList, parseKeywordRules, resolveTag } = require('../src/model/tags');

console.log('tags.js');

test('parseTaxonTagList parses a two-column name/taxid -> category list', () => {
  const map = parseTaxonTagList('Escherichia coli,Pathogen\n1790162,Indicator species\n');
  assert.strictEqual(map.get('escherichia coli'), 'Pathogen');
  assert.strictEqual(map.get('1790162'), 'Indicator species');
});

test('parseTaxonTagList also accepts tab-delimited input', () => {
  const map = parseTaxonTagList('Homo sapiens\tContaminant\n');
  assert.strictEqual(map.get('homo sapiens'), 'Contaminant');
});

test('parseTaxonTagList skips malformed lines rather than throwing', () => {
  const map = parseTaxonTagList('no-category-here\nEscherichia coli,Pathogen\n');
  assert.strictEqual(map.size, 1);
});

test('parseKeywordRules supports both "=>" and comma separators', () => {
  const rules = parseKeywordRules('coli => Pathogen\nBos, Livestock contaminant\n');
  assert.deepStrictEqual(rules, [
    { keyword: 'coli', category: 'Pathogen' },
    { keyword: 'bos', category: 'Livestock contaminant' },
  ]);
});

test('resolveTag: an uploaded exact name match wins over a keyword rule', () => {
  const uploaded = new Map([['coccinella transversoguttata', 'Beneficial insect']]);
  const rules = [{ keyword: 'coccinella', category: 'Wrong category' }];
  assert.strictEqual(resolveTag('Coccinella transversoguttata', 1790162, uploaded, rules), 'Beneficial insect');
});

test('resolveTag: an uploaded exact taxid match works when the name differs in case/spacing', () => {
  const uploaded = new Map([['1790162', 'Beneficial insect']]);
  assert.strictEqual(resolveTag('Coccinella transversoguttata', 1790162, uploaded, []), 'Beneficial insect');
});

test('resolveTag: falls back to the first matching keyword rule', () => {
  const rules = [
    { keyword: 'xyz', category: 'No match' },
    { keyword: 'coli', category: 'Pathogen' },
  ];
  assert.strictEqual(resolveTag('Escherichia coli', 562, new Map(), rules), 'Pathogen');
});

test('resolveTag returns null when nothing matches', () => {
  assert.strictEqual(resolveTag('Escherichia coli', 562, new Map(), []), null);
});

report();
