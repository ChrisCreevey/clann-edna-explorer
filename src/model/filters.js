// Global filtering and search: the minimum-abundance threshold and the
// host/contaminant exclusion list (brief: "Filtering and search"), both
// applied centrally inside computeRankTable (src/model/rank-table.js) so
// every view that reads through it — the single-sample table, the Top-N
// chart, and every multi-sample comparison view — recalculates
// consistently with no per-view special-casing. Taxon search is a
// separate, non-destructive concept (highlighting matches, not removing
// them) — see matchesSearch, used directly by the renderers in src/viz/.

(function () {
  'use strict';

  /**
   * Splits a comma-or-newline-separated exclusion list into clean terms.
   */
  function parseExclusionList(text) {
    const seen = new Set();
    const terms = [];
    (text || '').split(/[,\n]/).forEach((raw) => {
      const term = raw.trim();
      if (!term || seen.has(term.toLowerCase())) return;
      seen.add(term.toLowerCase());
      terms.push(term);
    });
    return terms;
  }

  /**
   * A row matches an exclusion term on an exact (case-insensitive) name
   * match or an exact taxid match — not substring — so excluding "Bos
   * taurus" doesn't also silently sweep up an unrelated taxon whose name
   * happens to contain that string.
   */
  function isRowExcluded(row, exclusionTerms) {
    if (!exclusionTerms || exclusionTerms.length === 0) return false;
    const nameLower = row.name.toLowerCase();
    const taxidStr = String(row.taxid);
    return exclusionTerms.some((term) => term.toLowerCase() === nameLower || term === taxidStr);
  }

  /**
   * Removes excluded rows and *renormalizes* pctOfTotal against the
   * remaining reads — excluding a dominant contaminant (e.g. host reads)
   * should change what "100%" means for the rest of the community, unlike
   * the abundance threshold below, which is a display filter only.
   */
  function applyExclusionList(rows, exclusionTerms) {
    if (!exclusionTerms || exclusionTerms.length === 0) {
      return { rows, removedCount: 0, removedReads: 0 };
    }
    const kept = [];
    let removedCount = 0;
    let removedReads = 0;
    rows.forEach((row) => {
      if (isRowExcluded(row, exclusionTerms)) {
        removedCount++;
        removedReads += row.cladeReads;
      } else {
        kept.push(row);
      }
    });
    const newTotal = kept.reduce((s, r) => s + r.cladeReads, 0);
    const renormalized = kept.map((r) => ({
      ...r,
      pctOfTotal: newTotal > 0 ? (100 * r.cladeReads) / newTotal : 0,
    }));
    return { rows: renormalized, removedCount, removedReads };
  }

  /**
   * Minimum-abundance display filter — does NOT renormalize, since hiding
   * low-abundance noise shouldn't change what the remaining percentages
   * mean (unlike exclusion, which is a compositional correction).
   *
   * @param {'pct'|'reads'} mode
   */
  function applyMinAbundance(rows, { mode = 'pct', value = 0 } = {}) {
    if (!value || value <= 0) return rows;
    return mode === 'reads' ? rows.filter((r) => r.cladeReads >= value) : rows.filter((r) => r.pctOfTotal >= value);
  }

  /**
   * Applies exclusion then the abundance threshold, in that order (the
   * threshold should judge abundance among what's left after excluding
   * contaminants, not the original unfiltered total).
   */
  function applyFilters(rows, filters) {
    if (!filters) return { rows, removedCount: 0, removedReads: 0 };
    const { rows: afterExclusion, removedCount, removedReads } = applyExclusionList(rows, filters.exclusionTerms);
    const afterThreshold = applyMinAbundance(afterExclusion, filters.minAbundance);
    return { rows: afterThreshold, removedCount, removedReads };
  }

  /**
   * Non-destructive: does a name/taxid match the current search term, for
   * highlighting (not filtering) matches across every open view.
   */
  function matchesSearch(name, taxid, searchTerm) {
    const term = (searchTerm || '').trim().toLowerCase();
    if (!term) return false;
    return name.toLowerCase().includes(term) || String(taxid) === term;
  }

  /**
   * Per-node prune mask for a whole sample tree (used by the sunburst and
   * other hierarchy-based views, which can't run rows through
   * applyFilters() one rank at a time the way computeRankTable does).
   * A node is pruned if it — or any ancestor — matches an exclusion term,
   * or if its own pctOfTotal/cladeReads falls below the abundance
   * threshold. Thresholding an ancestor also prunes its descendants: their
   * cladeReads/pctOfTotal can only be smaller, so they can't clear a bar
   * their parent already missed. Requires that parents appear at a lower
   * tree index than their children (true for report-derived trees, since
   * getOrCreateNode resolves parentTaxid -> index before the child node is
   * created), so a single forward pass is enough — no separate ancestor
   * walk needed.
   *
   * @returns {Uint8Array} pruned[i] === 1 means don't show this node
   */
  function computeTreePruneMask(tree, sampleId, filters) {
    const size = tree.size;
    const pruned = new Uint8Array(size);
    if (!filters) return pruned;
    const exclusionTerms = (filters.exclusionTerms || []).map((t) => t.toLowerCase());
    const mode = (filters.minAbundance && filters.minAbundance.mode) || 'pct';
    const threshold = (filters.minAbundance && filters.minAbundance.value) || 0;
    if (exclusionTerms.length === 0 && threshold <= 0) return pruned;

    for (let i = 0; i < size; i++) {
      const parentIdx = tree.parentIndex[i];
      const ancestorPruned = parentIdx !== -1 && pruned[parentIdx] === 1;
      let selfPruned = false;
      if (!ancestorPruned) {
        if (exclusionTerms.length > 0) {
          const nameLower = tree.name[i].toLowerCase();
          const taxidStr = String(tree.taxid[i]);
          selfPruned = exclusionTerms.some((t) => t === nameLower || t === taxidStr);
        }
        if (!selfPruned && threshold > 0) {
          const counts = tree.perSample[i].get(sampleId);
          if (counts) {
            const value = mode === 'reads' ? counts.cladeReads || 0 : counts.pctOfTotal || 0;
            selfPruned = value < threshold;
          }
        }
      }
      pruned[i] = ancestorPruned || selfPruned ? 1 : 0;
    }
    return pruned;
  }

  const filtersExports = {
    parseExclusionList,
    isRowExcluded,
    applyExclusionList,
    applyMinAbundance,
    applyFilters,
    matchesSearch,
    computeTreePruneMask,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = filtersExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.filters = filtersExports;
  }
})();
