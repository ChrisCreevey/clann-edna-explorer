const path = require('path');
const fs = require('fs');
const { test, report, assert } = require('./harness');
const { computePCoA, jacobiEigenDecomposition } = require('../src/model/ordination');
const { computeDistanceMatrix } = require('../src/model/similarity');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('ordination.js');

test('jacobiEigenDecomposition diagonalizes a simple symmetric matrix', () => {
  const { eigenvalues } = jacobiEigenDecomposition([
    [2, 1],
    [1, 2],
  ]);
  const sorted = eigenvalues.slice().sort((a, b) => a - b);
  assert.ok(Math.abs(sorted[0] - 1) < 1e-9);
  assert.ok(Math.abs(sorted[1] - 3) < 1e-9);
});

test('jacobiEigenDecomposition eigenvectors satisfy Av = lambda*v', () => {
  const a = [
    [4, 1, 0],
    [1, 3, 1],
    [0, 1, 2],
  ];
  const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(a);
  eigenvalues.forEach((lambda, i) => {
    const v = eigenvectors[i];
    for (let r = 0; r < a.length; r++) {
      const avR = a[r].reduce((s, val, c) => s + val * v[c], 0);
      assert.ok(Math.abs(avR - lambda * v[r]) < 1e-6, `row ${r} eigen residual too large`);
    }
  });
});

test('computePCoA returns null for fewer than 3 samples', () => {
  assert.strictEqual(computePCoA([[0, 1], [1, 0]]), null);
});

test('computePCoA places an identical pair of samples at the same point', () => {
  const distance = [
    [0, 0, 0.6],
    [0, 0, 0.6],
    [0.6, 0.6, 0],
  ];
  const result = computePCoA(distance, 2);
  assert.strictEqual(result.points.length, 3);
  assert.ok(Math.abs(result.points[0][0] - result.points[1][0]) < 1e-6);
  assert.ok(Math.abs(result.points[0][1] - result.points[1][1]) < 1e-6);
});

test('computePCoA variance-explained percentages sum to <= 100 and are non-negative', () => {
  const distance = [
    [0, 0.4, 0.7, 0.9],
    [0.4, 0, 0.5, 0.8],
    [0.7, 0.5, 0, 0.3],
    [0.9, 0.8, 0.3, 0],
  ];
  const result = computePCoA(distance, 2);
  result.varianceExplained.forEach((pct) => assert.ok(pct >= 0));
  assert.ok(result.varianceExplained.reduce((s, v) => s + v, 0) <= 100.0001);
});

test('computePCoA on real Bray-Curtis distances from fixture samples recovers a symmetric layout', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  parseBreport(read('barcode42.breport'), tree, 'barcode42');
  const { matrix, sampleIds } = computeDistanceMatrix(tree, ['barcode39', 'barcode40', 'barcode42'], 'S', 'bray-curtis');
  const result = computePCoA(matrix, 2);
  assert.strictEqual(result.points.length, sampleIds.length);
  result.points.forEach((p) => {
    assert.strictEqual(p.length, 2);
    p.forEach((coord) => assert.ok(Number.isFinite(coord)));
  });
});

report();
