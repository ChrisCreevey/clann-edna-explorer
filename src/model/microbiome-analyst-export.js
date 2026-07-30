// MicrobiomeAnalyst structured export (brief: "MicrobiomeAnalyst export"),
// built to spec exactly rather than approximated — a near-miss file just
// fails on upload. Three tab-delimited files, generated together and kept
// in sync: an abundance table (counts, not proportions — MicrobiomeAnalyst
// prefers counts), a taxonomy mapping file (Kingdom..Species, blank where
// unresolved), and a metadata file (group assignment as the primary
// column). See https://www.microbiomeanalyst.ca/docs/DataFormat.xhtml.
//
// Rows are keyed by taxid (PLAN.md §4: "resolves the collision-handling
// problem cleanly since taxids are already the tree's primary key"); the
// taxon's name only appears as a human-readable value inside the
// taxonomy-mapping file's Species column, not as the row key itself.

(function () {
  'use strict';

  const { buildAbundanceMatrix } = typeof module !== 'undefined' && module.exports
    ? require('./comparison')
    : window.ClannEDNA.comparison;

  const MICROBIOME_ANALYST_RANKS = ['K', 'P', 'C', 'O', 'F', 'G', 'S'];
  const RANK_COLUMN_NAMES = ['Kingdom', 'Phylum', 'Class', 'Order', 'Family', 'Genus', 'Species'];
  const MISSING_VALUE_PLACEHOLDER = 'Unassigned';
  const MIN_REPLICATES_PER_GROUP = 3;

  /**
   * The spec restricts names to letters, numbers, and underscores.
   * Anything else is replaced with an underscore, one-for-one — no
   * collapsing of repeats, so the substitution stays predictable and
   * easy to explain to a student comparing before/after.
   */
  function sanitizeIdentifier(str) {
    return String(str).replace(/[^A-Za-z0-9_]/g, '_');
  }

  /**
   * Sanitizes a list of labels and resolves any collisions that the
   * sanitization itself introduces (e.g. "Soil A" and "Soil_A" would
   * otherwise both become "Soil_A") by appending _2, _3, ... — first
   * occurrence keeps the plain sanitized form.
   *
   * @returns {{map: Map<string,string>, changes: Array<{original:string, sanitized:string}>}}
   */
  function sanitizeAndDedupe(labels) {
    const used = new Set();
    const map = new Map();
    const changes = [];
    labels.forEach((original) => {
      if (map.has(original)) return;
      let candidate = sanitizeIdentifier(original);
      let suffix = 2;
      while (used.has(candidate)) {
        candidate = `${sanitizeIdentifier(original)}_${suffix}`;
        suffix++;
      }
      used.add(candidate);
      map.set(original, candidate);
      if (candidate !== original) changes.push({ original, sanitized: candidate });
    });
    return { map, changes };
  }

  /**
   * Walks from a taxon's own tree node up through its ancestors, filling
   * in the nearest name found for each of the 7 MicrobiomeAnalyst rank
   * columns (Kingdom..Species) — the taxon's *own* rank counts as filled
   * for that column too (e.g. a genus-level row has a blank Species cell
   * but a filled Genus cell), matching the spec's "maximum resolved rank"
   * treatment of blanks.
   *
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {number} treeIndex
   * @returns {Record<'K'|'P'|'C'|'O'|'F'|'G'|'S', string>}
   */
  function resolveRankNames(tree, treeIndex) {
    const found = { K: '', P: '', C: '', O: '', F: '', G: '', S: '' };
    let idx = treeIndex;
    while (idx !== -1) {
      const letter = tree.rankLetter[idx];
      if (tree.rankSub[idx] === 0 && MICROBIOME_ANALYST_RANKS.includes(letter) && !found[letter]) {
        found[letter] = tree.name[idx];
      }
      idx = tree.parentIndex[idx];
    }
    return found;
  }

  /**
   * @param {import('./taxonomy-tree').TaxonomyTree} tree
   * @param {string[]} sampleIds - already the *included* (non-excluded) samples, in display order
   * @param {string} rank - the rank the export is built at, e.g. 'S'
   * @param {Array<{id: string, group: string}>} samplesWithGroup - group for the metadata file's primary column
   * @param {{filters?: object}} [options]
   */
  function buildMicrobiomeAnalystExport(tree, sampleIds, rank, samplesWithGroup, options = {}) {
    const matrix = buildAbundanceMatrix(tree, sampleIds, rank, { valueField: 'cladeReads', filters: options.filters });

    const { map: sampleNameMap, changes: sampleNameChanges } = sanitizeAndDedupe(sampleIds);
    const groupLabels = samplesWithGroup.map((s) => s.group);
    const { map: groupLabelMap, changes: groupLabelChanges } = sanitizeAndDedupe(groupLabels);

    const sanitizedSampleNames = sampleIds.map((id) => sampleNameMap.get(id));

    // ---- Abundance table (#NAME) ----
    const abundanceLines = [['#NAME', ...sanitizedSampleNames].join('\t')];
    matrix.taxa.forEach((taxon, rowIdx) => {
      abundanceLines.push([String(taxon.taxid), ...matrix.matrix[rowIdx]].join('\t'));
    });
    const abundanceTableText = abundanceLines.join('\n') + '\n';

    // ---- Taxonomy mapping (#TAXONOMY) ----
    const taxonomyLines = [['#TAXONOMY', ...RANK_COLUMN_NAMES].join('\t')];
    matrix.taxa.forEach((taxon) => {
      const treeIndex = tree.taxidToIndex.get(taxon.taxid);
      const names = resolveRankNames(tree, treeIndex);
      taxonomyLines.push([String(taxon.taxid), ...MICROBIOME_ANALYST_RANKS.map((r) => names[r])].join('\t'));
    });
    const taxonomyMappingText = taxonomyLines.join('\n') + '\n';

    // ---- Metadata (#NAME, primary column = Group) ----
    const metadataLines = [['#NAME', 'Group'].join('\t')];
    const groupCounts = new Map();
    samplesWithGroup.forEach(({ id, group }) => {
      const sanitizedGroup = groupLabelMap.get(group) || MISSING_VALUE_PLACEHOLDER;
      const value = sanitizedGroup || MISSING_VALUE_PLACEHOLDER;
      metadataLines.push([sampleNameMap.get(id), value].join('\t'));
      groupCounts.set(value, (groupCounts.get(value) || 0) + 1);
    });
    const metadataText = metadataLines.join('\n') + '\n';

    // ---- Warnings (surfaced before export, never silently swallowed) ----
    const warnings = [];
    for (const [group, count] of groupCounts) {
      if (count < MIN_REPLICATES_PER_GROUP) {
        warnings.push(
          `Group "${group}" has only ${count} sample${count === 1 ? '' : 's'} — MicrobiomeAnalyst requires at least ${MIN_REPLICATES_PER_GROUP} replicates per group for its comparisons; this upload may later be rejected or a downstream test may fail.`
        );
      }
    }

    return {
      abundanceTableText,
      taxonomyMappingText,
      metadataText,
      taxonCount: matrix.taxa.length,
      sampleCount: sampleIds.length,
      warnings,
      sanitizationChanges: [...sampleNameChanges, ...groupLabelChanges],
    };
  }

  const microbiomeAnalystExportExports = { buildMicrobiomeAnalystExport, sanitizeIdentifier, sanitizeAndDedupe, resolveRankNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = microbiomeAnalystExportExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.microbiomeAnalystExport = microbiomeAnalystExportExports;
  }
})();
