(function () {
  'use strict';

// Builds a nested hierarchy (root -> children[]) from the flat, taxid-keyed
// TaxonomyTree for one sample — the shape the sunburst and Sankey renderers
// both consume. Only nodes with counts recorded for `sampleId` are
// included; children are sorted by cladeReads descending so both
// visualisations draw largest-first.
//
// Only canonical-rank nodes (rankSub === 0: domain/kingdom/phylum/.../
// species) become hierarchy nodes — the "no-rank" filler clades NCBI
// taxonomy inserts between them (e.g. "cellular organisms",
// "Opisthokonta", "Bilateria", "Ecdysozoa" — rankSub 1, 2, 3...) are
// skipped, with each canonical node reparented to its nearest canonical
// ancestor (same technique src/viz/sankey.js uses for its rank columns).
// Reference Krona output for these samples (COI_bracken_outputs/*.krona.html)
// only ever draws canonical D/K/P/C/O/F/G/S rings for the same reason: a
// long run of single-child filler nodes each becoming their own
// full-circle ring adds many uninformative clicks before any real
// branching is visible, without showing anything a user can act on.

const { computeTreePruneMask } = typeof module !== 'undefined' && module.exports
  ? require('./filters')
  : window.ClannEDNA.filters;

/**
 * @param {import('./taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 * @param {{exclusionTerms?: string[], minAbundance?: {mode:'pct'|'reads', value:number}}} [filters]
 *   Global filters (see src/model/filters.js) — a matched/below-threshold
 *   node and its whole subtree are dropped, so this view stays consistent
 *   with the rank table and comparison charts, which read through the same
 *   filters.
 * @returns {object|null} nested root node, or null if the sample has no
 *   hierarchy (e.g. a bracken-only or generic sample)
 */
function buildHierarchyTree(tree, sampleId, filters = null) {
  const byIndex = new Map(); // treeIndex -> hierarchy node
  const pruned = computeTreePruneMask(tree, sampleId, filters);

  for (let i = 0; i < tree.size; i++) {
    if (pruned[i]) continue;
    if (tree.rankSub[i] !== 0) continue; // skip no-rank filler clades
    const counts = tree.perSample[i].get(sampleId);
    if (!counts) continue;
    byIndex.set(i, {
      taxid: tree.taxid[i],
      name: tree.name[i],
      rank: tree.rankLetter[i],
      depth: tree.depth[i],
      cladeReads: counts.cladeReads || 0,
      directReads: counts.directReads || 0,
      pctOfTotal: counts.pctOfTotal || 0,
      children: [],
      parent: null,
      _index: i,
    });
  }

  if (byIndex.size === 0) return null;

  // Nearest ancestor (walking up the real, unfiltered tree) that made it
  // into byIndex — i.e. the nearest included canonical-rank, non-pruned
  // ancestor, skipping over any filler/excluded nodes in between.
  function nearestIncludedAncestorIndex(i) {
    let idx = tree.parentIndex[i];
    while (idx !== -1) {
      if (byIndex.has(idx)) return idx;
      idx = tree.parentIndex[idx];
    }
    return -1;
  }

  let root = null;
  for (const [i, node] of byIndex) {
    const parentIdx = nearestIncludedAncestorIndex(i);
    const parentNode = parentIdx === -1 ? null : byIndex.get(parentIdx);
    if (parentNode) {
      parentNode.children.push(node);
      node.parent = parentNode;
    } else if (tree.depth[i] === 0) {
      // Root, or a bracken-only leaf with no ancestor chain (depth 0, no
      // parent in this sample's node set) — treat each as its own root and
      // fold multiple such roots under one synthetic root below.
      if (!root) {
        root = node;
      } else {
        root._extraRoots = root._extraRoots || [];
        root._extraRoots.push(node);
      }
    }
  }

  if (root && root._extraRoots) {
    const synthetic = {
      taxid: 0,
      name: 'root',
      rank: 'R',
      depth: -1,
      cladeReads: root.cladeReads + root._extraRoots.reduce((s, n) => s + n.cladeReads, 0),
      directReads: 0,
      pctOfTotal: 100,
      children: [root, ...root._extraRoots],
      parent: null,
    };
    delete root._extraRoots;
    synthetic.children.forEach((child) => {
      child.parent = synthetic;
    });
    root = synthetic;
  }

  // Renumber depth sequentially in the *filtered* hierarchy (root, then
  // +1 per canonical rank down to species) rather than leaving the raw
  // tree.depth values, which still count the skipped filler nodes and so
  // jump unpredictably (e.g. genus/species landing at depth 26/27 instead
  // of a plain 7/8) — depth is only ever consulted as "<= 0 means root",
  // but a meaningless absolute number is a trap for the next reader.
  reassignDepthRecursive(root, root.depth);

  sortChildrenRecursive(root);
  return root;
}

function reassignDepthRecursive(node, depth) {
  node.depth = depth;
  node.children.forEach((child) => reassignDepthRecursive(child, depth + 1));
}

function sortChildrenRecursive(node) {
  if (!node) return;
  node.children.sort((a, b) => b.cladeReads - a.cladeReads);
  node.children.forEach(sortChildrenRecursive);
}

const hierarchyExports = { buildHierarchyTree };
if (typeof module !== 'undefined' && module.exports) module.exports = hierarchyExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.hierarchy = hierarchyExports;
}
})();
