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

test('only canonical-rank nodes appear — no-rank filler clades (e.g. "cellular organisms", "Bilateria") are collapsed out', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');

  function walk(node, visit) {
    visit(node);
    node.children.forEach((c) => walk(c, visit));
  }
  const canonicalRanks = new Set(['R', 'D', 'K', 'P', 'C', 'O', 'F', 'G', 'S']);
  let sawFiller = false;
  walk(root, (n) => {
    if (!canonicalRanks.has(n.rank)) sawFiller = true;
  });
  assert.ok(!sawFiller, 'every hierarchy node should be a canonical rank, not a no-rank filler clade');

  function find(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) {
      const found = find(c, name);
      if (found) return found;
    }
    return null;
  }
  assert.strictEqual(find(root, 'cellular organisms'), null);
  assert.strictEqual(find(root, 'Bilateria'), null);
  assert.ok(find(root, 'Insecta'), 'canonical-rank ancestors should still be present');
});

test('depth is renumbered sequentially in the filtered hierarchy, not left as the raw (gap-filled) tree depth', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const root = buildHierarchyTree(tree, 'barcode39');

  function walk(node, visit) {
    visit(node);
    node.children.forEach((c) => walk(c, visit));
  }
  walk(root, (n) => {
    n.children.forEach((c) => {
      assert.strictEqual(c.depth, n.depth + 1, `${c.name} should be exactly one deeper than its parent ${n.name}`);
    });
  });

  function find(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) {
      const found = find(c, name);
      if (found) return found;
    }
    return null;
  }
  // Insecta is 4 canonical ranks below root (D, K, P, C), whatever its raw
  // tree.depth happens to be once no-rank clades are counted.
  assert.strictEqual(find(root, 'Insecta').depth, root.depth + 4);
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

test('an excluded taxon and its whole subtree are dropped from the hierarchy', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const filters = { exclusionTerms: ['Coccinella transversoguttata'] };
  const root = buildHierarchyTree(tree, 'barcode39', filters);

  function find(node, taxid) {
    if (node.taxid === taxid) return node;
    for (const c of node.children) {
      const found = find(c, taxid);
      if (found) return found;
    }
    return null;
  }
  assert.strictEqual(find(root, 1790162), null);
});

test('a node below the minimum-abundance threshold is dropped along with its descendants', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  const unfiltered = buildHierarchyTree(tree, 'barcode39');

  function find(node, taxid) {
    if (node.taxid === taxid) return node;
    for (const c of node.children) {
      const found = find(c, taxid);
      if (found) return found;
    }
    return null;
  }
  const species = find(unfiltered, 1790162);
  const thresholdAboveSpecies = species.pctOfTotal + 1;

  const filtered = buildHierarchyTree(tree, 'barcode39', {
    minAbundance: { mode: 'pct', value: thresholdAboveSpecies },
  });
  assert.strictEqual(find(filtered, 1790162), null);
});

test('excluding a clade reduces every ancestor\'s cladeReads too, so children still sum to their parent (no sunburst gap)', () => {
  const tree = new TaxonomyTree();
  parseBreport(read('barcode39.breport'), tree, 'barcode39');
  parseBracken(read('barcode39.bracken'), tree, 'barcode39');

  const unfiltered = buildHierarchyTree(tree, 'barcode39');
  const filtered = buildHierarchyTree(tree, 'barcode39', { exclusionTerms: ['Chordata'] });

  // The excluded clade's own stored cladeReads (baked in at parse time)
  // must be subtracted from the root, not just dropped from the children
  // list — otherwise the root's angle span (still sized for the old,
  // larger total) leaves a gap where the excluded wedge used to be.
  assert.ok(filtered.cladeReads < unfiltered.cladeReads);
  const childSum = filtered.children.reduce((s, c) => s + c.cladeReads, 0);
  assert.strictEqual(childSum, filtered.cladeReads);

  function find(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) {
      const found = find(c, name);
      if (found) return found;
    }
    return null;
  }
  assert.strictEqual(find(filtered, 'Chordata'), null);
  assert.strictEqual(find(filtered, 'Xenopus lenduensis'), null); // a descendant of the excluded clade
});

report();
