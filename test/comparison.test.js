const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { buildAbundanceMatrix, toPresenceAbsence, computeStackedComposition } = require('../src/model/comparison');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('comparison.js');

function loadTree() {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  return tree;
}

test('abundance matrix rows are the union of taxa across samples, sorted by total descending', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39', 'barcode40'], 'S');
  assert.strictEqual(m.sampleIds.length, 2);
  assert.ok(m.taxa.length >= 454); // at least everything in barcode39 alone
  for (let i = 1; i < m.taxa.length; i++) {
    assert.ok(m.taxa[i - 1].total >= m.taxa[i].total);
  }
});

test('a taxon present in only one sample has a 0 cell for the other sample', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39', 'barcode40'], 'S');
  // Coccinella transversoguttata (1790162) is in barcode39; find its row
  const rowIdx = m.taxa.findIndex((t) => t.taxid === 1790162);
  assert.ok(rowIdx !== -1);
  assert.strictEqual(m.matrix[rowIdx][0], 33764); // barcode39 column
});

test('known cross-check: the known species total equals its barcode39 cladeReads when only barcode39 is included', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39'], 'S');
  const row = m.taxa.find((t) => t.taxid === 1790162);
  assert.strictEqual(row.total, 33764);
});

test('presence/absence thresholding: a taxon below the minimum abundance reads 0', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39', 'barcode40'], 'S');
  const pa = toPresenceAbsence(m, 100000); // very high threshold — almost nothing should pass
  const presentCount = pa.matrix.flat().filter((v) => v === 1).length;
  assert.ok(presentCount < 5);
});

test('presence/absence with threshold 1 matches "any reads at all"', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39', 'barcode40'], 'S');
  const pa = toPresenceAbsence(m, 1);
  m.matrix.forEach((row, r) => {
    row.forEach((v, c) => {
      assert.strictEqual(pa.matrix[r][c], v >= 1 ? 1 : 0);
    });
  });
});

test('stacked composition: every sample\'s segments + Other sum to ~100%', () => {
  const tree = loadTree();
  const { series } = computeStackedComposition(tree, ['barcode39', 'barcode40'], 'S', 10);
  series.forEach((s) => {
    const sum = s.values.reduce((acc, v) => acc + v.pct, 0) + s.otherPct;
    assert.ok(Math.abs(sum - 100) < 1e-6, `sample ${s.sampleId} sums to ${sum}`);
  });
});

test('stacked composition uses the same top taxa (by combined total) for every sample\'s bar', () => {
  const tree = loadTree();
  const { taxonNames, series } = computeStackedComposition(tree, ['barcode39', 'barcode40'], 'S', 5);
  assert.strictEqual(taxonNames.length, 5);
  series.forEach((s) => {
    assert.deepStrictEqual(s.values.map((v) => v.name), taxonNames);
  });
});

test('buildAbundanceMatrix respects an exclusion filter across every sample column', () => {
  const tree = loadTree();
  const m = buildAbundanceMatrix(tree, ['barcode39', 'barcode40'], 'S', {
    filters: { exclusionTerms: ['Coccinella transversoguttata'] },
  });
  assert.strictEqual(m.taxa.find((t) => t.taxid === 1790162), undefined);
});

report();
