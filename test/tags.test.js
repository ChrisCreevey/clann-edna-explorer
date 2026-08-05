const { test, report, assert } = require('./harness');
const { parseTaxonTagList, parseKeywordRules, resolveTag, computeTreeTagMap } = require('../src/model/tags');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');

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

test('resolveTag: keyword rules match whole tokens, not substrings', () => {
  const rules = [{ keyword: 'aves', category: 'Birds' }];
  assert.strictEqual(resolveTag('Cavesia sp.', 1, new Map(), rules), null);
  assert.strictEqual(resolveTag('Aves', 2, new Map(), rules), 'Birds');
  assert.strictEqual(resolveTag('Class Aves', 3, new Map(), rules), 'Birds');
});

function buildLineageTree() {
  const tree = new TaxonomyTree();
  tree.getOrCreateNode(2, 'Chordata', 'P', 1, null);
  tree.getOrCreateNode(40674, 'Mammalia', 'C', 2, 2);
  tree.getOrCreateNode(9606, 'Homo sapiens', 'S', 3, 40674);
  tree.getOrCreateNode(9989, 'Rodentia', 'O', 3, 40674);
  tree.getOrCreateNode(10090, 'Mus musculus', 'S', 4, 9989);
  return tree;
}

test('computeTreeTagMap: a keyword match on an ancestor propagates to every descendant', () => {
  const tree = buildLineageTree();
  const rules = [{ keyword: 'chordata', category: 'Host' }];
  const { byTaxid } = computeTreeTagMap(tree, new Map(), rules);
  assert.strictEqual(byTaxid.get(9606), 'Host');
  assert.strictEqual(byTaxid.get(10090), 'Host');
  assert.strictEqual(byTaxid.get(2), 'Host');
});

test('computeTreeTagMap: an uploaded list match also propagates to descendants', () => {
  const tree = buildLineageTree();
  const uploaded = new Map([['chordata', 'Host']]);
  const { byTaxid, byName } = computeTreeTagMap(tree, uploaded, []);
  assert.strictEqual(byTaxid.get(9606), 'Host');
  assert.strictEqual(byName.get('Mus musculus'), 'Host');
});

test('computeTreeTagMap: a more specific descendant match wins over a broader ancestor match', () => {
  const tree = buildLineageTree();
  const rules = [
    { keyword: 'chordata', category: 'Host' },
    { keyword: 'homo sapiens', category: 'Contaminant' },
  ];
  const { byTaxid } = computeTreeTagMap(tree, new Map(), rules);
  assert.strictEqual(byTaxid.get(9606), 'Contaminant');
  assert.strictEqual(byTaxid.get(10090), 'Host');
});

test('computeTreeTagMap: unrelated branches are untagged', () => {
  const tree = buildLineageTree();
  const rules = [{ keyword: 'rodentia', category: 'Pest' }];
  const { byTaxid } = computeTreeTagMap(tree, new Map(), rules);
  assert.strictEqual(byTaxid.has(9606), false);
  assert.strictEqual(byTaxid.get(10090), 'Pest');
});

report();
