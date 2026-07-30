const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { parseBreport } = require('../src/parsers/breport');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('breport.js');

test('parses barcode39.breport and builds a connected tree', () => {
  const tree = new TaxonomyTree();
  const stats = parseBreport(read('barcode39.breport'), tree, 'barcode39');
  assert.strictEqual(stats.rowCount, 1970);
  assert.strictEqual(stats.totalReads, 567493);
  assert.ok(tree.size > 0);
});

test('root node has no parent and depth 0', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = tree.node(1);
  assert.ok(root);
  assert.strictEqual(root.parentTaxid, null);
  assert.strictEqual(root.depth, 0);
});

test('every non-root node has a resolvable parent', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  for (let i = 0; i < tree.size; i++) {
    if (tree.depth[i] === 0) continue;
    const parentIdx = tree.parentIndex[i];
    assert.ok(parentIdx !== -1, `node ${tree.taxid[i]} (${tree.name[i]}) has no parent`);
  }
});

test('known species node (Coccinella transversoguttata, taxid 1790162) matches raw file values', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const node = tree.node(1790162);
  assert.strictEqual(node.name, 'Coccinella transversoguttata');
  assert.strictEqual(node.rank, 'S');
  const counts = tree.getSampleCounts(1790162, 'barcode39');
  assert.strictEqual(counts.cladeReads, 33764);
  assert.strictEqual(counts.pctOfTotal, 5.95);
});

test('two samples merge into one shared tree keyed by taxid', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const sizeAfterFirst = tree.size;
  parseBreport(read('barcode40.breport'), tree, 'barcode40');
  // root (taxid 1) is shared, so total size should grow by less than the
  // full barcode40 row count, and both samples should have counts on root.
  assert.ok(tree.size >= sizeAfterFirst);
  const rootCountsA = tree.getSampleCounts(1, 'barcode39');
  const rootCountsB = tree.getSampleCounts(1, 'barcode40');
  assert.ok(rootCountsA && rootCountsB);
});

report();
