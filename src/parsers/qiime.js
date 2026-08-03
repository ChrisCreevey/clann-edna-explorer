(function () {
  'use strict';

// Reader for QIIME2's two-artifact FeatureTable[Frequency] +
// FeatureData[Taxonomy] pair, exported to plain text outside the browser
// (see README/FAQ for the exact commands):
//   qiime tools export --input-path table.qza --output-path exported-table
//   biom convert -i exported-table/feature-table.biom -o feature-table.tsv --to-tsv
//   qiime tools export --input-path taxonomy.qza --output-path exported-taxonomy
// This is "Tier 1": both inputs are text, so no in-browser HDF5/zip
// decoding is needed. Reading a raw .qza (HDF5 biom inside a zip) directly
// is a possible Tier 2 later.
//
// taxonomy.tsv rows are converted into the same {rank, name, taxid, path}
// shape lineage-tsv.js already builds per row, then handed to its shared
// buildTreeFromLineageRows core — one call per sample column in the
// feature table.

const RANKS = ['superkingdom', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'];

// QIIME/Greengenes/SILVA taxon strings prefix each segment with a
// single-letter rank code. `d__`/`k__` are alternate domain/kingdom
// prefixes used by different reference databases (SILVA vs. Greengenes) —
// both map into RANKS positions and simply won't both appear in the same
// taxon string.
const QIIME_RANK_PREFIX = {
  d: 'superkingdom',
  k: 'kingdom',
  p: 'phylum',
  c: 'class',
  o: 'order',
  f: 'family',
  g: 'genus',
  s: 'species',
};

const QIIME_SEGMENT_RE = /^([A-Za-z])__(.*)$/;

const { buildTreeFromLineageRows, syntheticTaxid } =
  typeof module !== 'undefined' && module.exports ? require('./lineage-tsv') : window.ClannEDNA.lineageTsv;

/**
 * Parse a QIIME2 taxonomy.tsv (Feature ID / Taxon / Confidence, header
 * required) into a Map<featureId, {rank, name}[]> — a rank path in RANKS
 * order, empty segments (e.g. trailing `s__`) omitted.
 */
function parseQiimeTaxonomy(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const byFeatureId = new Map();
  if (lines.length < 2) return byFeatureId;

  for (let li = 1; li < lines.length; li++) {
    const cols = lines[li].split('\t');
    const featureId = (cols[0] || '').trim();
    const taxon = (cols[1] || '').trim();
    if (!featureId) continue;

    const path = [];
    for (const rawSegment of taxon.split(';')) {
      const m = QIIME_SEGMENT_RE.exec(rawSegment.trim());
      if (!m) continue;
      const rank = QIIME_RANK_PREFIX[m[1].toLowerCase()];
      const name = m[2].trim();
      if (!rank || name === '') continue;
      path.push({ rank, name });
    }
    byFeatureId.set(featureId, path);
  }

  return byFeatureId;
}

/**
 * Parse a `biom convert --to-tsv` feature table: an optional leading
 * comment line, then a header row (`#OTU ID` + one column per sample),
 * then one row per feature. Returns { sampleIds, rows: [{featureId,
 * counts: Map<sampleId, number>}] }.
 */
function parseQiimeBiomTsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  let headerIdx = -1;
  for (let i = 0; i < Math.min(2, lines.length); i++) {
    if (lines[i].trim().toLowerCase().startsWith('#otu id')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { sampleIds: [], rows: [] };

  const headerCols = lines[headerIdx].split('\t');
  const sampleIds = headerCols.slice(1).map((c) => c.trim());

  const rows = [];
  for (let li = headerIdx + 1; li < lines.length; li++) {
    const cols = lines[li].split('\t');
    const featureId = (cols[0] || '').trim();
    if (!featureId) continue;
    const counts = new Map();
    for (let c = 0; c < sampleIds.length; c++) {
      const value = Number(cols[c + 1]);
      if (Number.isFinite(value) && value > 0) counts.set(sampleIds[c], value);
    }
    rows.push({ featureId, counts });
  }

  return { sampleIds, rows };
}

/**
 * Build one sample per feature-table column, joining each feature's count
 * against its taxonomy path via `taxonomyByFeatureId` (from
 * parseQiimeTaxonomy). Features missing from the taxonomy map, or with an
 * empty rank path, are counted as unclassified reads for that sample —
 * same convention as lineage-tsv.js's gapped/empty rows.
 *
 * @param {string} biomTsvText
 * @param {Map<string, {rank:string, name:string}[]>} taxonomyByFeatureId
 * @param {import('../model/taxonomy-tree').TaxonomyTree} tree
 * @returns {{ sampleIds: string[], totalsBySample: Map<string, number> }}
 */
function buildQiimeSamples(biomTsvText, taxonomyByFeatureId, tree) {
  const { sampleIds, rows: featureRows } = parseQiimeBiomTsv(biomTsvText);

  // Resolve each feature's path once (taxid per rank) and reuse it across
  // every sample column, rather than re-hashing per sample.
  const resolvedPathByFeatureId = new Map();
  for (const { featureId } of featureRows) {
    if (resolvedPathByFeatureId.has(featureId)) continue;
    const rankPath = taxonomyByFeatureId.get(featureId) || [];
    const nameParts = [];
    const path = rankPath.map((entry) => {
      nameParts.push(entry.name.toLowerCase());
      return {
        rank: entry.rank,
        name: entry.name,
        taxid: syntheticTaxid(nameParts.join('|')),
        synthetic: true,
      };
    });
    resolvedPathByFeatureId.set(featureId, path);
  }

  const totalsBySample = new Map();

  for (const sampleId of sampleIds) {
    const rows = [];
    let unclassifiedCount = 0;
    for (const { featureId, counts } of featureRows) {
      const count = counts.get(sampleId);
      if (!count) continue;
      const path = resolvedPathByFeatureId.get(featureId);
      if (!path || path.length === 0) {
        unclassifiedCount += count;
        continue;
      }
      rows.push({ count, path });
    }
    const { totalReads } = buildTreeFromLineageRows(rows, unclassifiedCount, tree, sampleId);
    totalsBySample.set(sampleId, totalReads);
  }

  return { sampleIds, totalsBySample };
}

const qiimeExports = { parseQiimeTaxonomy, parseQiimeBiomTsv, buildQiimeSamples, RANKS, QIIME_RANK_PREFIX };
if (typeof module !== 'undefined' && module.exports) module.exports = qiimeExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.qiime = qiimeExports;
}
})();
