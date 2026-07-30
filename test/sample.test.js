const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { buildSample } = require('../src/model/sample');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');
const { parseBracken } = require('../src/parsers/bracken');
const { parseGeneric } = require('../src/parsers/generic');
const { captureProvenance } = require('../src/parsers/provenance');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');
const parsers = { parseBreport, parseBracken, parseGeneric, captureProvenance };

console.log('sample.js');

test('builds a sample from both .breport and .bracken', () => {
  const tree = new TaxonomyTree();
  const sample = buildSample(
    'barcode39',
    {
      breport: { text: read('barcode39.breport'), filename: 'barcode39.breport' },
      bracken: { text: read('barcode39.bracken'), filename: 'barcode39.bracken' },
    },
    tree,
    parsers
  );
  assert.strictEqual(sample.kind, 'tree');
  assert.strictEqual(sample.hasBreport, true);
  assert.strictEqual(sample.hasBracken, true);
  assert.strictEqual(sample.provenance, null); // confirmed non-feature for these files
  assert.strictEqual(tree.node(1790162).name, 'Coccinella transversoguttata');
});

test('builds a breport-only sample (hierarchy, no raw/re-estimated split)', () => {
  const tree = new TaxonomyTree();
  const sample = buildSample(
    'barcode39',
    { breport: { text: read('barcode39.breport'), filename: 'barcode39.breport' } },
    tree,
    parsers
  );
  assert.strictEqual(sample.hasBracken, false);
  assert.strictEqual(tree.getSampleCounts(1790162, 'barcode39').krakenAssignedReads, undefined);
});

test('builds a generic-format sample independent of the tree', () => {
  const tree = new TaxonomyTree();
  const genericText = 'Escherichia coli\t120\nBacillus subtilis\t45\n';
  const sample = buildSample(
    'my-sample',
    { generic: { text: genericText, filename: 'weird.tsv', mapping: { nameColumn: 0, abundanceColumn: 1 } } },
    tree,
    parsers
  );
  assert.strictEqual(sample.kind, 'generic');
  assert.strictEqual(sample.genericRows.length, 2);
  assert.strictEqual(tree.size, 0);
});

report();
