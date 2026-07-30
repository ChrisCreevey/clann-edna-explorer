# Clann eDNA Explorer

Browser-only tool for exploring taxonomic classification results from eDNA
metabarcoding/metagenomic studies (Kraken2/Bracken, with a generic
tab-delimited fallback for other classifiers). Part of the
[Clann suite](https://chriscreevey.github.io/), alongside
[Clann Tree Viewer](https://chriscreevey.github.io/clann-tree-viewer/),
[Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/),
and [Clann Pangenome Explorer](https://chriscreevey.github.io/clann-pangenome-explorer/).

Vanilla HTML/CSS/JavaScript, no build step, no external dependencies.
Hosted on GitHub Pages. GPL-2.0.

See [`clann-edna-explorer-brief.md`](clann-edna-explorer-brief.md) for the
full design brief and [`PLAN.md`](PLAN.md) for the phased implementation
plan and Phase 1 investigation findings.

## Status

Phase 1 (investigation, data model, parsers, folder-based loading),
Phase 2 (single-sample parsing, read-summary card, rank-by-rank table,
Top-N bar chart, generic fallback with manual column mapping), and Phase 3
(Krona-style zoomable sunburst, Pavian-style Sankey diagram with a
configurable rank cutoff) are built. Later phases (multi-sample comparison,
diversity/similarity, exports) are not yet built — see `PLAN.md` §3.

## Running locally

No build step. Serve the directory with any static file server and open
`index.html`, e.g.:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## Running tests

Zero-dependency Node test suite, driven directly off real example files in
`test/fixtures/` (trimmed copies of `COI_bracken_outputs/`):

```bash
node test/run.js
```

## Project layout

```
index.html            entry point
styles/main.css        theme-aware (light/dark) stylesheet
src/parsers/           .bracken / .breport / generic parsers, content sniffer,
                        provenance capture, folder loader
src/model/              shared taxid-keyed taxonomy tree, sample builder,
                        read-summary stats, rank-table/Top-N computation,
                        nested-hierarchy builder for the visualisations
src/viz/                sunburst (Krona-style) and Sankey (Pavian-style)
                        layout math + SVG rendering
src/app.js              UI wiring (folder loading, tick-list, sample loading,
                        summary card, rank table, Top-N chart, sunburst,
                        Sankey, theme toggle)
test/                    zero-dependency test harness + tests
test/fixtures/           real example files used by the test suite
examples/                trimmed example run for the hosted demo
COI_bracken_outputs/     full original example run (7 barcodes) used during
                         development; not shipped to the hosted app
```

## Data model notes (Phase 1 findings)

`.breport`'s species-rank rows reconcile *exactly* with `.bracken`'s
`new_est_reads` column (verified against the example run) — they are
complementary views of the same Bracken re-estimated counts, not
independent pre/post datasets. See `PLAN.md` §1 for the full investigation
writeup, including the content-based format-detection rules and the
(currently unconfirmed) status of Galaxy-exported header/provenance blocks.

## Adding a new src/ file

Every file under `src/` is a plain (non-module) `<script src>` include, not
an ES module — there's no bundler. All of `src/`'s top-level declarations
therefore share **one JS global scope** across the whole page. To avoid
`let`/`const`/`function` name collisions between files (e.g. two files both
declaring a top-level `SVG_NS` or destructuring the same import name), wrap
every new file's body in an IIFE:

```js
(function () {
  'use strict';

  // ... file contents ...

  const xExports = { ... };
  if (typeof module !== 'undefined' && module.exports) module.exports = xExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.x = xExports;
  }
})();
```

Only the `window.ClannEDNA.<name>` export is visible to other files; expose
functions through that object, not as bare globals. `src/app.js` already
follows this pattern. (Every existing file was retrofitted with this
wrapper after a real collision — see git history around the Phase 3 commit
— so don't skip it for new files.)

## Performance ceiling

Not yet measured against a full multi-sample run — to be documented here
once Phase 5+ (multi-sample comparison) is built and profiled, per the
brief's requirement.
