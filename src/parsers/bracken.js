// Parser for .bracken files: tab-delimited, one row per leaf-rank taxon,
// with a literal header row.
//
// Columns: name, taxonomy_id, taxonomy_lvl, kraken_assigned_reads,
// added_reads, new_est_reads, fraction_total_reads.
//
// Per PLAN.md §1, new_est_reads reconciles exactly with the matching
// .breport leaf-rank row's cladeReads (verified against barcode39: sum and
// per-taxon match). So when a .breport for the same sample has already been
// parsed into the shared tree, this parser attaches the extra
// krakenAssignedReads/addedReads fields onto the existing node. When no
// .breport is present, it creates leaf-only nodes (no ancestor chain) —
// the tree degrades gracefully to a flat leaf-rank table in that case.

const EXPECTED_HEADER = [
  'name',
  'taxonomy_id',
  'taxonomy_lvl',
  'kraken_assigned_reads',
  'added_reads',
  'new_est_reads',
  'fraction_total_reads',
];

function parseBrackenLine(line) {
  const cols = line.split('\t');
  if (cols.length !== 7) return null;
  const [name, taxidStr, rankCode, krakenStr, addedStr, newEstStr, fractionStr] = cols;
  return {
    name: name.trim(),
    taxid: Number(taxidStr),
    rankCode: rankCode.trim(),
    krakenAssignedReads: Number(krakenStr),
    addedReads: Number(addedStr),
    newEstReads: Number(newEstStr),
    fractionTotalReads: Number(fractionStr),
  };
}

/**
 * Parse .bracken text and attach/merge leaf-rank counts into the shared
 * TaxonomyTree for `sampleId`.
 *
 * @param {string} text
 * @param {import('../model/taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 */
function parseBracken(text, tree, sampleId) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { rowCount: 0, totalReads: 0 };

  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const headerOk = header.length === 7 && header.every((h, i) => h === EXPECTED_HEADER[i]);
  const dataLines = headerOk ? lines.slice(1) : lines;

  let rowCount = 0;
  let totalReads = 0;

  for (const rawLine of dataLines) {
    if (rawLine.trim() === '') continue;
    const row = parseBrackenLine(rawLine);
    if (!row) continue;
    rowCount++;
    totalReads += row.newEstReads;

    // depth/parent unknown without a .breport for this sample — leaf node
    // with no ancestor chain, consistent with PLAN.md's "bracken-only
    // sample is a tree with only leaf-rank nodes populated" model.
    tree.getOrCreateNode(row.taxid, row.name, row.rankCode, 0, null);
    tree.setSampleCounts(row.taxid, sampleId, {
      cladeReads: row.newEstReads,
      directReads: row.newEstReads,
      pctOfTotal: row.fractionTotalReads * 100,
      krakenAssignedReads: row.krakenAssignedReads,
      addedReads: row.addedReads,
    });
  }

  return { rowCount, totalReads };
}

const brackenExports = { parseBracken, parseBrackenLine, EXPECTED_HEADER };
if (typeof module !== 'undefined' && module.exports) module.exports = brackenExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.bracken = brackenExports;
}
