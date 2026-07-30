// Sample metadata join (brief: "Sample metadata join by barcode/sample ID,
// used to label samples and, optionally, pre-populate the group dropdown
// from a metadata column"). A two-or-more-column CSV/TSV: first column is
// the sample/barcode ID, every other column is an arbitrary metadata
// field. Delimiter is sniffed (tab or comma) rather than assumed, matching
// this app's general "detect from content" convention.

(function () {
  'use strict';

  function detectDelimiter(firstLine) {
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    return tabCount >= commaCount ? '\t' : ',';
  }

  /**
   * @param {string} text
   * @returns {{idColumnName: string, fieldNames: string[], rowsById: Map<string, Record<string,string>>}}
   */
  function parseSampleMetadata(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) {
      return { idColumnName: '', fieldNames: [], rowsById: new Map() };
    }

    const delimiter = detectDelimiter(lines[0]);
    const header = lines[0].split(delimiter).map((h) => h.trim());
    const idColumnName = header[0] || 'id';
    const fieldNames = header.slice(1);

    const rowsById = new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter).map((c) => c.trim());
      if (cols.length < 1 || !cols[0]) continue;
      const row = {};
      fieldNames.forEach((name, idx) => {
        row[name] = cols[idx + 1] !== undefined ? cols[idx + 1] : '';
      });
      rowsById.set(cols[0], row);
    }

    return { idColumnName, fieldNames, rowsById };
  }

  /**
   * How many of `sampleIds` have a metadata row, and how many metadata
   * rows don't correspond to any loaded sample — surfaced to the user
   * rather than silently ignored, per this app's general convention.
   */
  function matchSummary(sampleIds, metadata) {
    const matched = sampleIds.filter((id) => metadata.rowsById.has(id));
    const unmatchedSamples = sampleIds.filter((id) => !metadata.rowsById.has(id));
    const unmatchedRows = [...metadata.rowsById.keys()].filter((id) => !sampleIds.includes(id));
    return { matched, unmatchedSamples, unmatchedRows };
  }

  const sampleMetadataExports = { parseSampleMetadata, matchSummary, detectDelimiter };
  if (typeof module !== 'undefined' && module.exports) module.exports = sampleMetadataExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.sampleMetadata = sampleMetadataExports;
  }
})();
