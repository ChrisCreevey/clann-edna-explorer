const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { computeDiversity, computeDiversitySummary } = require('../src/model/diversity');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('diversity.js');

function loadTree() {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  return tree;
}

test('richness for barcode39 species rank matches the known row count (454)', () => {
  const tree = loadTree();
  const d = computeDiversity(tree, 'barcode39', 'S');
  assert.strictEqual(d.richness, 454);
  assert.strictEqual(d.totalReads, 567327);
});

test('shannon and simpson are both 0 for a single-species sample (no diversity)', () => {
  const tree = new TaxonomyTree();
  tree.getOrCreateNode(1, 'root', 'R', 0, null);
  tree.setSampleCounts(1, 's1', { cladeReads: 100, directReads: 0, pctOfTotal: 100 });
  tree.getOrCreateNode(2, 'Only species', 'S', 1, 1);
  tree.setSampleCounts(2, 's1', { cladeReads: 100, directReads: 100, pctOfTotal: 100 });
  const d = computeDiversity(tree, 's1', 'S');
  assert.strictEqual(d.richness, 1);
  assert.ok(Math.abs(d.shannon) < 1e-9);
  assert.ok(Math.abs(d.simpson) < 1e-9);
});

test('shannon and simpson are maximised for an even split across many species', () => {
  const tree = new TaxonomyTree();
  tree.getOrCreateNode(1, 'root', 'R', 0, null);
  tree.setSampleCounts(1, 's1', { cladeReads: 400, directReads: 0, pctOfTotal: 100 });
  for (let i = 0; i < 4; i++) {
    tree.getOrCreateNode(100 + i, `species${i}`, 'S', 1, 1);
    tree.setSampleCounts(100 + i, 's1', { cladeReads: 100, directReads: 100, pctOfTotal: 25 });
  }
  const d = computeDiversity(tree, 's1', 'S');
  assert.strictEqual(d.richness, 4);
  assert.ok(Math.abs(d.shannon - Math.log(4)) < 1e-9); // max Shannon for 4 even categories
  assert.ok(Math.abs(d.simpson - 0.75) < 1e-9); // 1 - 4*(0.25^2) = 0.75
});

test('a sample with no data at that rank returns all zeros, not NaN/throw', () => {
  const tree = loadTree();
  const d = computeDiversity(tree, 'barcode39', 'ZZ');
  assert.deepStrictEqual(d, { richness: 0, shannon: 0, simpson: 0, totalReads: 0 });
});

test('computeDiversitySummary aggregates per group with mean and range', () => {
  const tree = loadTree();
  const summary = computeDiversitySummary(
    tree,
    [
      { id: 'barcode39', group: 'Soil' },
      { id: 'barcode40', group: 'Soil' },
    ],
    'S'
  );
  assert.strictEqual(summary.perSample.length, 2);
  const soilAgg = summary.groupAggregates.get('Soil');
  assert.ok(soilAgg.richness.mean > 0);
  assert.ok(soilAgg.richness.min <= soilAgg.richness.mean);
  assert.ok(soilAgg.richness.max >= soilAgg.richness.mean);
});

report();
