(function () {
  'use strict';

// Builds a nested hierarchy (root -> children[]) from the flat, taxid-keyed
// TaxonomyTree for one sample — the shape the sunburst and Sankey renderers
// both consume. Only nodes with counts recorded for `sampleId` are
// included; children are sorted by cladeReads descending so both
// visualisations draw largest-first.

/**
 * @param {import('./taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 * @returns {object|null} nested root node, or null if the sample has no
 *   hierarchy (e.g. a bracken-only or generic sample)
 */
function buildHierarchyTree(tree, sampleId) {
  const byIndex = new Map(); // treeIndex -> hierarchy node

  for (let i = 0; i < tree.size; i++) {
    const counts = tree.perSample[i].get(sampleId);
    if (!counts) continue;
    byIndex.set(i, {
      taxid: tree.taxid[i],
      name: tree.name[i],
      rank: tree.rankSub[i] ? `${tree.rankLetter[i]}${tree.rankSub[i]}` : tree.rankLetter[i],
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

  let root = null;
  for (const [i, node] of byIndex) {
    const parentIdx = tree.parentIndex[i];
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

  sortChildrenRecursive(root);
  return root;
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
