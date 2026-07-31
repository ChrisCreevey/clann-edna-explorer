const fs = require('fs');
const path = require('path');
const { test, report, assert } = require('./harness');
const { computeSunburstSegments, colorForSunburstNode } = require('../src/viz/sunburst');
const { buildHierarchyTree } = require('../src/model/hierarchy');
const { TaxonomyTree } = require('../src/model/taxonomy-tree');
const { parseBreport } = require('../src/parsers/breport');

const fixtures = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

console.log('sunburst.js');

function loadRoot(sampleFile = 'barcode39.breport', sampleId = 'barcode39') {
  const tree = new TaxonomyTree();
  parseBreport(read(sampleFile), tree, sampleId);
  return buildHierarchyTree(tree, sampleId);
}

test('depth-1 ring segments cover the full circle (0 to 2*PI) at the root', () => {
  const root = loadRoot();
  const segments = computeSunburstSegments(root, { maxDepth: 6 });
  const depth1 = segments.filter((s) => s.depth === 1);
  const totalAngle = depth1.reduce((s, seg) => s + (seg.angleEnd - seg.angleStart), 0);
  assert.ok(Math.abs(totalAngle - 2 * Math.PI) < 1e-6, `expected ~2*PI, got ${totalAngle}`);
});

test('a child\'s angular span is proportional to its share of the parent\'s cladeReads', () => {
  const root = loadRoot();
  const segments = computeSunburstSegments(root, { maxDepth: 6 });
  const depth1 = segments.filter((s) => s.depth === 1);
  // barcode39.breport root has exactly one depth-1 child (Eukaryota, ~100%)
  assert.strictEqual(depth1.length, 1);
  const span = depth1[0].angleEnd - depth1[0].angleStart;
  assert.ok(Math.abs(span - 2 * Math.PI) < 1e-3);
});

test('respects maxDepth — no segments deeper than the limit', () => {
  const root = loadRoot();
  const segments = computeSunburstSegments(root, { maxDepth: 3 });
  assert.ok(segments.every((s) => s.depth <= 3));
  assert.ok(segments.some((s) => s.depth === 3));
});

test('slivers below minAnglePct are dropped', () => {
  const root = loadRoot();
  const allSegments = computeSunburstSegments(root, { maxDepth: 6, minAnglePct: 0 });
  const filtered = computeSunburstSegments(root, { maxDepth: 6, minAnglePct: 0.05 });
  assert.ok(filtered.length < allSegments.length);
});

test('colorForSunburstNode: two nodes under the same top-level branch share a hue family', () => {
  const root = loadRoot();
  function find(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) {
      const found = find(c, name);
      if (found) return found;
    }
    return null;
  }
  const insecta = find(root, 'Insecta');
  const coleoptera = find(root, 'Coleoptera'); // Insecta -> ... -> Coleoptera, same branch
  const hue = (color) => Number(/hsl\((\d+)/.exec(color)[1]);
  const hueDiff = Math.abs(hue(colorForSunburstNode(insecta, 1)) - hue(colorForSunburstNode(coleoptera, 2)));
  assert.ok(hueDiff <= 12, `expected siblings within the same branch to share a hue family, got a ${hueDiff} degree difference`);
});

test('colorForSunburstNode: deeper rings within a branch get lighter, not a different colour', () => {
  const root = loadRoot();
  function find(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) {
      const found = find(c, name);
      if (found) return found;
    }
    return null;
  }
  const insecta = find(root, 'Insecta');
  const lightness = (color) => Number(/,\s*(\d+)%\)$/.exec(color)[1]);
  const shallow = lightness(colorForSunburstNode(insecta, 1));
  const deep = lightness(colorForSunburstNode(insecta, 5));
  assert.ok(deep > shallow, 'a deeper ring in the same branch should be lighter than a shallower one');
});

report();
