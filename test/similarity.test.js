const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { brayCurtisDistance, jaccardDistance, computeDistanceMatrix } = require('../src/model/similarity');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('similarity.js');

test('bray-curtis distance is 0 for identical vectors', () => {
  assert.strictEqual(brayCurtisDistance([10, 20, 30], [10, 20, 30]), 0);
});

test('bray-curtis distance is 1 for completely disjoint vectors', () => {
  assert.strictEqual(brayCurtisDistance([10, 0, 0], [0, 0, 5]), 1);
});

test('bray-curtis distance is symmetric', () => {
  const a = [5, 10, 0, 20];
  const b = [0, 8, 3, 15];
  assert.strictEqual(brayCurtisDistance(a, b), brayCurtisDistance(b, a));
});

test('jaccard distance is 0 for identical presence sets', () => {
  assert.strictEqual(jaccardDistance([1, 5, 0], [2, 8, 0], 1), 0);
});

test('jaccard distance is 1 for disjoint presence sets', () => {
  assert.strictEqual(jaccardDistance([1, 0], [0, 1], 1), 1);
});

test('computeDistanceMatrix produces a symmetric matrix with a 0 diagonal', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  parseBreport(read('barcode42.breport'), tree, 'barcode42');
  const { matrix, sampleIds } = computeDistanceMatrix(tree, ['barcode39', 'barcode40', 'barcode42'], 'S', 'bray-curtis');

  assert.strictEqual(sampleIds.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(matrix[i][i], 0);
    for (let j = 0; j < 3; j++) {
      assert.strictEqual(matrix[i][j], matrix[j][i]);
    }
  }
});

test('a sample is maximally distant from itself under a relabeled duplicate is 0 distance (sanity)', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode39.breport'), tree, 'barcode39-dup');
  const { matrix } = computeDistanceMatrix(tree, ['barcode39', 'barcode39-dup'], 'S', 'bray-curtis');
  assert.strictEqual(matrix[0][1], 0);
});

report();
