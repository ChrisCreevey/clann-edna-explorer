// Per-taxon detail (brief: "Per-taxon detail card: full lineage,
// abundance across all loaded samples, read counts, tags") — the anchor
// point for the BLAST Explorer cross-link ("taxa flagged as unexpected or
// worth verifying here could have representative reads pulled and
// BLASTed in Clann BLAST Explorer to confirm identification").

(function () {
  'use strict';

  /**
   * Full ancestor chain for a taxon, root-first, each with its own rank
   * and name (unlike microbiome-analyst-export.js's resolveRankNames,
   * this isn't limited to the 7 MicrobiomeAnalyst columns — it's every
   * node actually in the tree, including "no rank" intermediates, since
   * this is for a student reading the lineage, not a spec-constrained file).
   *
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {number} taxid
   * @returns {Array<{taxid:number, name:string, rank:string}>}
   */
  function buildLineage(tree, taxid) {
    const idx = tree.taxidToIndex.get(taxid);
    if (idx === undefined) return [];
    const chain = [];
    let cursor = idx;
    while (cursor !== -1) {
      chain.unshift({
        taxid: tree.taxid[cursor],
        name: tree.name[cursor],
        rank: tree.rankSub[cursor] ? `${tree.rankLetter[cursor]}${tree.rankSub[cursor]}` : tree.rankLetter[cursor],
      });
      cursor = tree.parentIndex[cursor];
    }
    return chain;
  }

  /**
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {number} taxid
   * @param {string[]} allSampleIds - every loaded sample, not just the
   *   currently-active or currently-included one, per the brief's
   *   "abundance across all loaded samples"
   */
  function computeTaxonDetail(tree, taxid, allSampleIds) {
    const idx = tree.taxidToIndex.get(taxid);
    if (idx === undefined) return null;

    const perSample = allSampleIds
      .map((sampleId) => {
        const counts = tree.perSample[idx].get(sampleId);
        return counts ? { sampleId, cladeReads: counts.cladeReads || 0, pctOfTotal: counts.pctOfTotal || 0 } : null;
      })
      .filter(Boolean);

    return {
      taxid,
      name: tree.name[idx],
      rank: tree.rankSub[idx] ? `${tree.rankLetter[idx]}${tree.rankSub[idx]}` : tree.rankLetter[idx],
      lineage: buildLineage(tree, taxid),
      perSample,
    };
  }

  const taxonDetailExports = { buildLineage, computeTaxonDetail };
  if (typeof module !== 'undefined' && module.exports) module.exports = taxonDetailExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.taxonDetail = taxonDetailExports;
  }
})();
