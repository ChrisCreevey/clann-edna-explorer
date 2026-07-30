(function () {
  'use strict';

// Builds a Sample from parsed file(s) and attaches its data into the
// shared TaxonomyTree (see PLAN.md §2 data model). A sample may have a
// .breport, a .bracken, both, or a single generic-format file — never more
// than one of each, since pairing is by explicit user-assigned sample name
// (see src/app.js), not filename guessing (brief: names aren't trustworthy).

function guessSampleIdFromFilename(filename) {
  return filename.replace(/\.(bracken|breport|gz|zip|tabular|txt|tsv)$/gi, '').replace(/\.(bracken|breport)$/gi, '');
}

/**
 * @param {string} sampleId - user-confirmed/edited sample name, unique per run
 * @param {object} inputs
 * @param {{text: string, filename: string}} [inputs.breport]
 * @param {{text: string, filename: string}} [inputs.bracken]
 * @param {{text: string, filename: string, mapping: {nameColumn: number, abundanceColumn: number}}} [inputs.generic]
 * @param {import('./taxonomy-tree').TaxonomyTree} tree
 * @param {object} parsers - { parseBreport, parseBracken, parseGeneric, captureProvenance }
 */
function buildSample(sampleId, inputs, tree, parsers) {
  const { parseBreport, parseBracken, parseGeneric, captureProvenance } = parsers;

  const sample = {
    id: sampleId,
    displayName: sampleId,
    kind: inputs.generic ? 'generic' : 'tree',
    hasBreport: Boolean(inputs.breport),
    hasBracken: Boolean(inputs.bracken),
    provenance: null,
    genericRows: null,
    sourceFiles: [],
    group: null, // display-layer only — see src/model/groups.js; null = unassigned
  };

  if (inputs.breport) {
    parseBreport(inputs.breport.text, tree, sampleId);
    sample.sourceFiles.push(inputs.breport.filename);
    const prov = captureProvenance(inputs.breport.text);
    if (prov) sample.provenance = { ...(sample.provenance || {}), ...prov };
  }

  if (inputs.bracken) {
    parseBracken(inputs.bracken.text, tree, sampleId);
    sample.sourceFiles.push(inputs.bracken.filename);
    const prov = captureProvenance(inputs.bracken.text);
    if (prov) sample.provenance = { ...(sample.provenance || {}), ...prov };
  }

  if (inputs.generic) {
    const { rows } = parseGeneric(inputs.generic.text, inputs.generic.mapping);
    sample.genericRows = rows;
    sample.sourceFiles.push(inputs.generic.filename);
  }

  return sample;
}

const sampleExports = { buildSample, guessSampleIdFromFilename };
if (typeof module !== 'undefined' && module.exports) module.exports = sampleExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.sample = sampleExports;
}
})();
