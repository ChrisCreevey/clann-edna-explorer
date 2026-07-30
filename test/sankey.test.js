const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { computeSankeyData, computeSankeyLayout } = require('../src/viz/sankey');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('sankey.js');

function loadTree(sampleFile = 'barcode39.breport', sampleId = 'barcode39') {
  const tree = new TaxonomyTree();
  parseBreport(read(sampleFile), tree, sampleId);
  return tree;
}

test('produces one column per requested rank, in order', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  assert.strictEqual(data.columns.length, 7);
  assert.deepStrictEqual(data.columns.map((c) => c.rank), ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
});

test('every link connects a node present in the adjacent columns, in rank order', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const rankIndex = new Map(['D', 'P', 'C', 'O', 'F', 'G', 'S'].map((r, i) => [r, i]));
  data.links.forEach((link) => {
    assert.ok(rankIndex.get(link.sourceRank) < rankIndex.get(link.targetRank));
  });
});

test('a narrower rank cutoff (e.g. just class -> species) still produces valid links', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['C', 'O', 'F', 'G', 'S']);
  assert.strictEqual(data.columns.length, 5);
  assert.ok(data.links.length > 0);
});

test('known species (Coccinella transversoguttata) appears in the species column', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  assert.ok(speciesCol.nodes.some((n) => n.taxid === 1790162));
});

test('layout: node heights are proportional to cladeReads within a column', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const layout = computeSankeyLayout(data, { width: 800, height: 400 });
  const speciesNodes = layout.nodes.filter((n) => n.rank === 'S');
  const sorted = speciesNodes.slice().sort((a, b) => b.cladeReads - a.cladeReads);
  for (let i = 1; i < sorted.length; i++) {
    const hPrev = sorted[i - 1].y1 - sorted[i - 1].y0;
    const hCur = sorted[i].y1 - sorted[i].y0;
    assert.ok(hPrev >= hCur - 1e-6);
  }
});

test('species column (454 taxa) is capped, with the remainder bucketed into "Other"', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  assert.strictEqual(speciesCol.nodes.length, 12); // default maxNodesPerColumn
  assert.ok(speciesCol.nodes.some((n) => String(n.taxid).startsWith('other:')));
});

test('no reads are lost through "Other" bucketing — node totals match link totals into that column', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  const nodeTotal = speciesCol.nodes.reduce((s, n) => s + n.cladeReads, 0);
  const linkTotal = data.links.filter((l) => l.targetRank === 'S').reduce((s, l) => s + l.value, 0);
  assert.strictEqual(nodeTotal, 567327);
  assert.strictEqual(linkTotal, 567327);
});

test('a custom maxNodesPerColumn is respected', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S'], { maxNodesPerColumn: 5 });
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  assert.strictEqual(speciesCol.nodes.length, 5);
});

test('layout: link geometry connects source right-edge to target left-edge', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const layout = computeSankeyLayout(data, { width: 700, height: 400, nodeWidth: 16 });
  layout.links.forEach((link) => {
    assert.ok(link.tx > link.sx, 'target column must be to the right of source column');
  });
});

test('an excluded species is dropped from its rank column, same as the rank table', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S'], {
    filters: { exclusionTerms: ['Coccinella transversoguttata'] },
  });
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  assert.ok(!speciesCol.nodes.some((n) => n.taxid === 1790162));
});

report();
