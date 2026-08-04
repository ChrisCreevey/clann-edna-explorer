(function () {
  'use strict';

// Rank-by-rank breakdown table and Top-N bucketing for a single tree-backed
// sample, plus the flat-row equivalent for generic-format samples.

const { applyFilters, computeTreePruneMask } = typeof module !== 'undefined' && module.exports
  ? require('./filters')
  : window.ClannEDNA.filters;

const RANK_ORDER = ['D', 'K', 'P', 'C', 'O', 'F', 'G', 'S'];

/**
 * Which canonical ranks (letter with no numeric suffix) actually have data
 * for this sample, in taxonomic order.
 */
// Root and unclassified rows aren't useful breakdown rows (root is always
// ~100%, and a bracken-only sample's leaf nodes are also created at depth 0
// since there's no ancestor chain to hang them from — so depth alone can't
// be used to exclude root; rank letter can).
const NON_BREAKDOWN_RANKS = new Set(['R', 'U']);

function computeAvailableRanks(tree, sampleId) {
  const present = new Set();
  for (let i = 0; i < tree.size; i++) {
    if (NON_BREAKDOWN_RANKS.has(tree.rankLetter[i])) continue;
    if (tree.rankSub[i] !== 0) continue;
    if (!tree.perSample[i].has(sampleId)) continue;
    present.add(tree.rankLetter[i]);
  }
  const ordered = RANK_ORDER.filter((r) => present.has(r));
  const extra = [...present].filter((r) => !RANK_ORDER.includes(r)).sort();
  return [...ordered, ...extra];
}

/**
 * Rows for every taxon at `rankLetter` present in `sampleId`, optionally
 * narrowed by a case-insensitive local name/taxid search term.
 *
 * `filters` (see src/model/filters.js) is the *global* minimum-abundance
 * threshold and host/contaminant exclusion list — applied first, before
 * the local `searchTerm`, since every other view (Top-N chart, comparison
 * heatmap/composition/diversity/similarity) reads through this same
 * function and must see the same filtered/renormalized rows regardless of
 * what's typed into any one table's own search box.
 *
 * The exclusion list is matched against the *whole ancestor chain*, not
 * just the rank being queried — excluding "Chordata" (a phylum) must drop
 * every chordate species from the species-rank table too, not just an
 * exact "Chordata" row at the phylum rank (which is all a same-rank-only
 * name match would ever catch). computeTreePruneMask already does this
 * ancestor-aware matching for the sunburst/Sankey and the overview's
 * excluded-read totals; reusing it here keeps every view's exclusion
 * semantics consistent. Minimum-abundance is deliberately left out of the
 * mask (only exclusionTerms is passed through) — it's applied afterward,
 * via applyFilters, as the existing display-only filter that hides a row
 * without pruning its subtree or affecting other rows' renormalization.
 *
 * @param {{minAbundance?: {mode: 'pct'|'reads', value: number}, exclusionTerms?: string[]}} [filters]
 */
function computeRankTable(tree, sampleId, rankLetter, searchTerm = '', filters = null) {
  if (NON_BREAKDOWN_RANKS.has(rankLetter)) return [];
  const term = searchTerm.trim().toLowerCase();
  const pruned = computeTreePruneMask(tree, sampleId, { exclusionTerms: filters && filters.exclusionTerms });
  const rows = [];
  for (let i = 0; i < tree.size; i++) {
    if (tree.rankLetter[i] !== rankLetter || tree.rankSub[i] !== 0) continue;
    if (pruned[i]) continue;
    const counts = tree.perSample[i].get(sampleId);
    if (!counts) continue;
    rows.push({
      taxid: tree.taxid[i],
      name: tree.name[i],
      cladeReads: counts.cladeReads || 0,
      directReads: counts.directReads || 0,
      pctOfTotal: counts.pctOfTotal || 0,
    });
  }

  const { rows: filteredRows } = applyFilters(rows, filters);

  if (!term) return filteredRows;
  return filteredRows.filter((r) => r.name.toLowerCase().includes(term) || String(r.taxid) === term);
}

function sortRows(rows, sortBy, direction = 'desc') {
  const sorted = rows.slice().sort((a, b) => {
    const va = a[sortBy];
    const vb = b[sortBy];
    if (typeof va === 'string') return direction === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return direction === 'asc' ? va - vb : vb - va;
  });
  return sorted;
}

/**
 * Buckets rows (already sorted by cladeReads desc) into the top N plus a
 * combined "Other" remainder.
 */
function computeTopN(rows, n) {
  const sorted = sortRows(rows, 'cladeReads', 'desc');
  const top = sorted.slice(0, n);
  const rest = sorted.slice(n);
  const otherReads = rest.reduce((sum, r) => sum + r.cladeReads, 0);
  const otherPct = rest.reduce((sum, r) => sum + r.pctOfTotal, 0);
  return {
    top,
    other: rest.length > 0 ? { name: 'Other', cladeReads: otherReads, pctOfTotal: otherPct, count: rest.length } : null,
  };
}

/**
 * Flat table for a generic-format sample (no hierarchy): name + abundance
 * rows, optionally filtered by search term. pctOfTotal is derived from the
 * sum of all row abundances since a generic report has no separate total.
 */
function computeGenericTable(genericRows, searchTerm = '') {
  const term = searchTerm.trim().toLowerCase();
  const total = genericRows.reduce((sum, r) => sum + r.abundance, 0);
  return genericRows
    .filter((r) => !term || r.name.toLowerCase().includes(term))
    .map((r) => ({
      name: r.name,
      cladeReads: r.abundance,
      pctOfTotal: total > 0 ? (100 * r.abundance) / total : 0,
    }));
}

const rankTableExports = { RANK_ORDER, computeAvailableRanks, computeRankTable, computeGenericTable, sortRows, computeTopN };
if (typeof module !== 'undefined' && module.exports) module.exports = rankTableExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.rankTable = rankTableExports;
}
})();
