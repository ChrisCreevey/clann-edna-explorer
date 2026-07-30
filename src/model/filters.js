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

  const filtersExports = { parseExclusionList, isRowExcluded, applyExclusionList, applyMinAbundance, applyFilters, matchesSearch };
  if (typeof module !== 'undefined' && module.exports) module.exports = filtersExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.filters = filtersExports;
  }
})();
