const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { buildHierarchyTree } = require('../src/model/hierarchy');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');
const { parseBracken } = require('../src/parsers/bracken');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('hierarchy.js');

test('breport sample builds a single-rooted hierarchy matching total reads', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');
  assert.strictEqual(root.taxid, 1);
  assert.strictEqual(root.name, 'root');
  assert.strictEqual(root.cladeReads, 567493);
  assert.strictEqual(root.parent, null);
});

test('every descendant sums to <= its parent cladeReads (clade containment)', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');

  function check(node) {
    const childSum = node.children.reduce((s, c) => s + c.cladeReads, 0);
    assert.ok(childSum <= node.cladeReads + 1, `${node.name}: children sum ${childSum} > self ${node.cladeReads}`);
    node.children.forEach(check);
  }
  check(root);
});

test('children are sorted by cladeReads descending', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');
  function checkSorted(node) {
    for (let i = 1; i < node.children.length; i++) {
      assert.ok(node.children[i - 1].cladeReads >= node.children[i].cladeReads);
    }
    node.children.forEach(checkSorted);
  }
  checkSorted(root);
});

test('known species node is reachable via parent pointers back to root', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');

  function find(node, taxid) {
    if (node.taxid === taxid) return node;
    for (const c of node.children) {
      const found = find(c, taxid);
      if (found) return found;
    }
    return null;
  }
  const species = find(root, 1790162);
  assert.ok(species);
  let ancestor = species;
  let hops = 0;
  while (ancestor.parent) {
    ancestor = ancestor.parent;
    hops++;
  }
  assert.strictEqual(ancestor, root);
  assert.ok(hops > 0);
});

test('bracken-only sample (no ancestor chain) folds every leaf under one synthetic root', () => {
  const tree = new TaxonomyTree();
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');
  assert.strictEqual(root.name, 'root');
  assert.strictEqual(root.children.length, 454);
  assert.strictEqual(root.children.every((c) => c.parent === root), true);
});

test('sample with no data returns null rather than throwing', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'nonexistent-sample');
  assert.strictEqual(root, null);
});

report();
