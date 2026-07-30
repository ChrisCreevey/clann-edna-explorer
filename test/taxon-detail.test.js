const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { buildLineage, computeTaxonDetail } = require('../src/model/taxon-detail');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('taxon-detail.js');

function loadTree() {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  return tree;
}

test('buildLineage returns the full root-to-leaf chain, root first', () => {
  const tree = loadTree();
  const lineage = buildLineage(tree, 1790162); // Coccinella transversoguttata
  assert.strictEqual(lineage[0].taxid, 1); // root
  assert.strictEqual(lineage[lineage.length - 1].taxid, 1790162);
  assert.strictEqual(lineage[lineage.length - 1].name, 'Coccinella transversoguttata');
  assert.ok(lineage.length > 5); // real lineage has many intermediate nodes
});

test('buildLineage returns an empty array for an unknown taxid, not throwing', () => {
  const tree = loadTree();
  assert.deepStrictEqual(buildLineage(tree, 999999999), []);
});

test('computeTaxonDetail reports abundance across every sample it appears in', () => {
  const tree = loadTree();
  const detail = computeTaxonDetail(tree, 1790162, ['barcode39', 'barcode40']);
  assert.strictEqual(detail.name, 'Coccinella transversoguttata');
  assert.strictEqual(detail.rank, 'S');
  const b39 = detail.perSample.find((s) => s.sampleId === 'barcode39');
  assert.strictEqual(b39.cladeReads, 33764);
});

test('computeTaxonDetail omits samples the taxon doesn\'t appear in, rather than reporting a false zero', () => {
  const tree = loadTree();
  // A taxon present only in barcode39 shouldn't produce a fabricated
  // barcode40 entry — either it's genuinely absent (0 reads) or it just
  // isn't in barcode40's tree at all; this only asserts the latter case
  // isn't silently reported as identical to the former for a taxon that
  // simply never appeared in barcode40's report at all.
  const detail = computeTaxonDetail(tree, 1790162, ['barcode39', 'nonexistent-sample']);
  assert.strictEqual(detail.perSample.length, 1);
  assert.strictEqual(detail.perSample[0].sampleId, 'barcode39');
});

test('computeTaxonDetail returns null for an unknown taxid', () => {
  const tree = loadTree();
  assert.strictEqual(computeTaxonDetail(tree, 999999999, ['barcode39']), null);
});

report();
