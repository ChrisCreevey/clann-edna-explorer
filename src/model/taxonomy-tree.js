// Flat, typed-array-backed taxonomy tree keyed by taxid, shared across all
// samples in a run (see PLAN.md §2 data model). Avoids one JS object per
// node so a multi-sample run stays cheap in memory.
//
// Nodes are appended in first-seen order and addressed by a dense integer
// index; `taxidToIndex` maps taxid -> index for O(1) lookup. Per-sample
// counts are kept in a Map on each node rather than a typed array, since the
// sample set is small (tens, not millions) and counts need arbitrary keys.

const RANK_SUFFIX_RE = /^([A-Za-z])([0-9]*)$/;

function canonicalRank(rawRankCode) {
  const m = RANK_SUFFIX_RE.exec(rawRankCode.trim());
  if (!m) return { letter: rawRankCode.trim(), sub: 0 };
  return { letter: m[1], sub: m[2] ? Number(m[2]) : 0 };
}

class TaxonomyTree {
  constructor() {
    this.taxid = [];
    this.name = [];
    this.rankLetter = [];
    this.rankSub = [];
    this.depth = [];
    this.parentIndex = [];
    this.perSample = []; // perSample[index] = Map<sampleId, {cladeReads, directReads, pctOfTotal, krakenAssignedReads?, addedReads?}>
    this.taxidToIndex = new Map();
  }

  get size() {
    return this.taxid.length;
  }

  getOrCreateNode(taxid, name, rawRankCode, depth, parentTaxid) {
    let idx = this.taxidToIndex.get(taxid);
    if (idx !== undefined) return idx;

    const { letter, sub } = canonicalRank(rawRankCode);
    idx = this.taxid.length;
    this.taxid.push(taxid);
    this.name.push(name);
    this.rankLetter.push(letter);
    this.rankSub.push(sub);
    this.depth.push(depth);
    this.parentIndex.push(
      parentTaxid === null ? -1 : this.taxidToIndex.get(parentTaxid) ?? -1
    );
    this.perSample.push(new Map());
    this.taxidToIndex.set(taxid, idx);
    return idx;
  }

  setSampleCounts(taxid, sampleId, counts) {
    const idx = this.taxidToIndex.get(taxid);
    if (idx === undefined) {
      throw new Error(`setSampleCounts: unknown taxid ${taxid}`);
    }
    const existing = this.perSample[idx].get(sampleId) || {};
    this.perSample[idx].set(sampleId, { ...existing, ...counts });
  }

  getSampleCounts(taxid, sampleId) {
    const idx = this.taxidToIndex.get(taxid);
    if (idx === undefined) return undefined;
    return this.perSample[idx].get(sampleId);
  }

  node(taxid) {
    const idx = this.taxidToIndex.get(taxid);
    if (idx === undefined) return null;
    return {
      taxid: this.taxid[idx],
      name: this.name[idx],
      rank: this.rankSub[idx] ? `${this.rankLetter[idx]}${this.rankSub[idx]}` : this.rankLetter[idx],
      depth: this.depth[idx],
      parentTaxid: this.parentIndex[idx] === -1 ? null : this.taxid[this.parentIndex[idx]],
    };
  }

  isLeafRank(taxid, leafRankLetter = 'S') {
    const idx = this.taxidToIndex.get(taxid);
    if (idx === undefined) return false;
    return this.rankLetter[idx] === leafRankLetter && this.rankSub[idx] === 0;
  }
}

const taxonomyTreeExports = { TaxonomyTree, canonicalRank };
if (typeof module !== 'undefined' && module.exports) module.exports = taxonomyTreeExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.taxonomyTree = taxonomyTreeExports;
}
