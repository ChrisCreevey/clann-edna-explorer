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

test('species column (454 taxa) is capped to the largest taxa, with the rest simply left out (no "Other" node)', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  assert.strictEqual(speciesCol.nodes.length, 12); // default maxNodesPerColumn
  assert.ok(!speciesCol.nodes.some((n) => String(n.taxid).startsWith('other:')));
  assert.strictEqual(speciesCol.hiddenCount, 454 - 12);
  assert.ok(speciesCol.hiddenReads > 0);
});

test('shown node reads plus hidden reads account for every species-rank read; links match the shown nodes exactly', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const speciesCol = data.columns.find((c) => c.rank === 'S');
  const nodeTotal = speciesCol.nodes.reduce((s, n) => s + n.cladeReads, 0);
  const linkTotal = data.links.filter((l) => l.targetRank === 'S').reduce((s, l) => s + l.value, 0);
  assert.strictEqual(nodeTotal + speciesCol.hiddenReads, 567327);
  assert.strictEqual(linkTotal, nodeTotal);
});

test('grandTotal is the full, uncapped read total at the first requested rank', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  assert.strictEqual(data.grandTotal, 567493);
});

test('layout: a column that leaves more reads out covers less of the canvas height than one that leaves less out', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const layout = computeSankeyLayout(data, { width: 900, height: 400 });
  const coverage = (rank) => {
    const nodes = layout.nodes.filter((n) => n.rank === rank);
    return Math.max(...nodes.map((n) => n.y1)) - Math.min(...nodes.map((n) => n.y0));
  };
  // Domain has almost nothing hidden; species has the most hidden (454 taxa
  // capped to 12) — its bars should cover noticeably less height, since
  // every bar is sized against the same grandTotal rather than
  // renormalized to fill each column.
  assert.ok(coverage('S') < coverage('D'), 'species column should cover less height than domain, not be stretched to fill the column');
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

test('layout reserves right-hand margin so the last column never reaches the canvas edge', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const layout = computeSankeyLayout(data, { width: 700, height: 400, nodeWidth: 16 });
  const lastColX = Math.max(...layout.nodes.map((n) => n.x));
  assert.ok(lastColX + layout.nodeWidth < 700, 'last column bars must leave room for their labels');
});

test('a node is ordered next to its largest incoming flow\'s parent position (fewer crossings than a size-only sort)', () => {
  const tree = loadTree();
  const data = computeSankeyData(tree, 'barcode39', ['D', 'P', 'C', 'O', 'F', 'G', 'S']);
  const genusCol = data.columns.find((c) => c.rank === 'G');
  const familyCol = data.columns.find((c) => c.rank === 'F');
  const familyOrder = new Map(familyCol.nodes.map((n, i) => [n.taxid, i]));

  const parentOrderOf = (genusTaxid) => {
    const link = data.links.find((l) => l.targetRank === 'G' && l.targetTaxid === genusTaxid);
    return link ? familyOrder.get(link.sourceTaxid) : undefined;
  };

  const orders = genusCol.nodes.map((n) => parentOrderOf(n.taxid)).filter((o) => o !== undefined);
  for (let i = 1; i < orders.length; i++) {
    assert.ok(orders[i] >= orders[i - 1], 'genus column should be grouped by parent family order, not just size');
  }
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
