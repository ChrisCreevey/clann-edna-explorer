(function () {
  'use strict';

// Parser for the native "Lineage TSV" format: one row per taxon with its
// full per-row lineage (name + optional taxid per rank), header required.
// See PLAN.md / the format spec for the exact column contract. Unlike
// .breport (positional, hierarchy via indentation), each row here carries
// its own ancestor chain directly, so nodes are created rank-by-rank per
// row rather than tracked via a depth stack.

const RANKS = ['superkingdom', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];
const RANK_CODE = {
  superkingdom: 'D',
  kingdom: 'K',
  phylum: 'P',
  class: 'C',
  order: 'O',
  family: 'F',
  genus: 'G',
  species: 'S',
};

const ROOT_TAXID = 1;
const UNCLASSIFIED_TAXID = 0;

/**
 * Deterministic 32-bit FNV-1a hash of the full ancestor path string,
 * folded into a negative integer so it can never collide with a real
 * (always positive) NCBI taxid. Same path string always yields the same
 * number, both within one parse and across separate parses/files, so
 * same-named lineages merge into the same shared-tree node.
 */
function syntheticTaxid(pathString) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < pathString.length; i++) {
    hash ^= pathString.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // unsigned 32-bit, then negate+offset so a hash of 0 doesn't collide
  // with taxid 0 (reserved for "unclassified")
  return -((hash >>> 0) + 1);
}

function buildColumnIndex(headerCols) {
  const idx = {};
  headerCols.forEach((name, i) => {
    idx[name.trim().toLowerCase()] = i;
  });
  return idx;
}

function parseHeader(text) {
  const nlIdx = text.indexOf('\n');
  const headerLine = (nlIdx === -1 ? text : text.slice(0, nlIdx)).replace(/\r$/, '');
  return headerLine.split('\t');
}

/**
 * @param {string} text - full file contents
 * @param {import('../model/taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 * @param {{name: string, taxid: string}[]} [columnIndex] - unused positional
 *   arg kept for signature parity with the brief; the parser derives its
 *   own column map from the header so it's robust when called directly.
 * @returns {{ rowCount: number, totalReads: number }}
 */
function parseLineageTsv(text, tree, sampleId, columnIndex) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() === '') return { rowCount: 0, totalReads: 0 };

  const headerCols = parseHeader(text);
  const col = buildColumnIndex(headerCols);

  tree.getOrCreateNode(ROOT_TAXID, 'root', 'R', 0, null);

  const directReads = new Map(); // taxid -> accumulated direct reads
  const topLevelTaxids = new Set(); // taxids attached directly under root

  let rowCount = 0;
  let unclassifiedCount = 0;

  for (let li = 1; li < lines.length; li++) {
    const rawLine = lines[li];
    if (rawLine.trim() === '') continue;
    const cols = rawLine.split('\t');

    const countIdx = col['count'];
    const count = Number(countIdx !== undefined ? cols[countIdx] : undefined);
    if (!Number.isInteger(count) || count < 1) continue;

    const path = [];
    const nameParts = [];
    for (const rank of RANKS) {
      const nameIdx = col[rank];
      const name = nameIdx !== undefined ? (cols[nameIdx] || '').trim() : '';
      if (name === '') continue;
      nameParts.push(name.toLowerCase());

      const taxidIdx = col[`${rank}_taxid`];
      const taxidStr = taxidIdx !== undefined ? (cols[taxidIdx] || '').trim() : '';
      let taxid;
      let synthetic = false;
      if (taxidStr !== '' && /^-?\d+$/.test(taxidStr)) {
        taxid = Number(taxidStr);
      } else {
        taxid = syntheticTaxid(nameParts.join('|'));
        synthetic = true;
      }
      path.push({ rank, name, taxid, synthetic });
    }

    rowCount++;

    if (path.length === 0) {
      unclassifiedCount += count;
      continue;
    }

    let parentTaxid = ROOT_TAXID;
    for (let d = 0; d < path.length; d++) {
      const entry = path[d];
      tree.getOrCreateNode(entry.taxid, entry.name, RANK_CODE[entry.rank], d + 1, parentTaxid);
      if (entry.synthetic) {
        tree.synthetic = tree.synthetic || new Set();
        tree.synthetic.add(entry.taxid);
      }
      if (d === 0) topLevelTaxids.add(entry.taxid);
      parentTaxid = entry.taxid;
    }

    const leafTaxid = path[path.length - 1].taxid;
    directReads.set(leafTaxid, (directReads.get(leafTaxid) || 0) + count);
  }

  if (unclassifiedCount > 0) {
    tree.getOrCreateNode(UNCLASSIFIED_TAXID, 'unclassified', 'U', 0, null);
  }

  // Clade aggregation: nodes are appended in root-to-leaf order per row, so
  // every child's index exceeds its parent's, and a single backward pass
  // propagates each node's own direct reads up through every ancestor.
  const cladeReads = new Map(); // idx -> cladeReads
  for (let i = tree.size - 1; i >= 0; i--) {
    const taxid = tree.taxid[i];
    if (taxid === ROOT_TAXID || taxid === UNCLASSIFIED_TAXID) continue;
    const direct = directReads.get(taxid) || 0;
    const clade = direct + (cladeReads.get(i) || 0);
    if (clade === 0) continue;
    cladeReads.set(i, clade);
    const parentIdx = tree.parentIndex[i];
    if (parentIdx !== -1) {
      cladeReads.set(parentIdx, (cladeReads.get(parentIdx) || 0) + clade);
    }
  }

  let rootCladeReads = 0;
  for (const taxid of topLevelTaxids) {
    const idx = tree.taxidToIndex.get(taxid);
    rootCladeReads += cladeReads.get(idx) || 0;
  }

  const totalReads = rootCladeReads + unclassifiedCount;

  for (const [idx, clade] of cladeReads) {
    const taxid = tree.taxid[idx];
    tree.setSampleCounts(taxid, sampleId, {
      cladeReads: clade,
      directReads: directReads.get(taxid) || 0,
      pctOfTotal: totalReads > 0 ? (100 * clade) / totalReads : 0,
    });
  }

  tree.setSampleCounts(ROOT_TAXID, sampleId, {
    cladeReads: rootCladeReads,
    directReads: 0,
    pctOfTotal: totalReads > 0 ? (100 * rootCladeReads) / totalReads : 0,
  });

  if (unclassifiedCount > 0) {
    tree.setSampleCounts(UNCLASSIFIED_TAXID, sampleId, {
      cladeReads: unclassifiedCount,
      directReads: unclassifiedCount,
      pctOfTotal: totalReads > 0 ? (100 * unclassifiedCount) / totalReads : 0,
    });
  }

  return { rowCount, totalReads };
}

const lineageTsvExports = { parseLineageTsv, syntheticTaxid, RANKS, RANK_CODE };
if (typeof module !== 'undefined' && module.exports) module.exports = lineageTsvExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.lineageTsv = lineageTsvExports;
}
})();
