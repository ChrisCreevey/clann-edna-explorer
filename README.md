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
Top-N bar chart, generic fallback with manual column mapping), Phase 3
(Krona-style zoomable sunburst, Pavian-style Sankey diagram with a
configurable rank cutoff), Phase 4 (comma-separated group text box,
per-sample group dropdown with Exclude, live recalculation with no
re-parse), and Phase 5 (overview dashboard with per-group run stats and a
diversity plot; multi-sample comparison — stacked composition bar chart,
abundance heatmap, presence/absence matrix, small-multiples sunburst,
diversity summary table, Bray-Curtis/Jaccard sample-similarity matrix, all
group-aware), Phase 7 (global minimum-abundance filter and
host/contaminant exclusion list — both applied centrally inside
computeRankTable so every view that reads through it recalculates
consistently; cross-view taxon search that highlights matches, rather than
filtering, in the single-sample table, Top-N chart, stacked composition
chart, abundance/presence heatmaps, sunburst, and Sankey), and — brought
forward from Phase 9 — the MicrobiomeAnalyst structured export (abundance
table, taxonomy mapping, metadata, all tab-delimited to spec) at the
bottom of the Multi-sample comparison section, wired to the exact same
included samples, rank, and filters currently on screen. Phase 8 (sample
metadata CSV/TSV join, keyed by sample ID, with an optional "pre-populate
groups from this column" that never overwrites a manual group choice;
taxon category tagging via an uploaded taxid/name → category list and/or
typed keyword rules, applied consistently across the rank table, Top-N
chart, sunburst, Sankey, and comparison heatmaps/stacked bar) is also
built. Phase 9 is now complete: every diagram (sunburst, Sankey, heatmaps,
stacked bar) exports as a self-contained SVG or PNG (CSS custom properties
resolved to concrete colours at export time, so the file looks right
outside this page too); the filtered rank table, the full merged
abundance matrix, and the diversity/similarity summaries export as CSV
with the current group assignment included as a column; a per-taxon
detail card (click any rank-table row) shows the full lineage and
abundance across every loaded sample, with a cross-link to
[Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/)
to verify an unexpected call; and the site now has full meta tags
(description, keywords, canonical, Open Graph, Twitter card,
WebApplication + FAQPage JSON-LD), an About & FAQ section, and a footer
matching the rest of the suite's convention (Feedback/GitHub/Star links).
See `PLAN.md` §3 for the full phase breakdown.

The exclusion list and abundance threshold apply to every rank-table-
derived view (single-sample table, Top-N chart, comparison heatmaps,
stacked composition, diversity, similarity) but *not* to the sunburst or
Sankey hierarchy views — removing a taxon from a hierarchy correctly would
mean subtracting its reads from every ancestor's clade total recursively,
which those two views don't do yet. This is a deliberate v1 scope
boundary, not an oversight; search highlighting (non-destructive) does
apply to the hierarchy views since it doesn't require recomputing sums.

NMDS/PCA ordination remains explicitly out of v1 scope (per PLAN.md's
open-points resolution) — sample similarity is a distance-matrix heatmap,
not a dimensionality-reduced plot. Hierarchical clustering of the heatmap's
row/column order is also not implemented; rows/columns are ordered by
total abundance / group membership only.

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
                        provenance capture, folder loader, sample metadata
                        CSV/TSV join (sample-metadata.js)
src/model/              shared taxid-keyed taxonomy tree, sample builder,
                        read-summary stats, rank-table/Top-N computation,
                        nested-hierarchy builder for the visualisations,
                        sample-group bookkeeping (groups.js), diversity
                        indices (diversity.js), cross-sample abundance
                        matrix + presence/absence + stacked composition
                        (comparison.js), Bray-Curtis/Jaccard distance
                        matrix (similarity.js), global abundance-threshold/
                        exclusion-list filtering + search matching
                        (filters.js), MicrobiomeAnalyst 3-file structured
                        export (microbiome-analyst-export.js), taxon
                        category tagging (tags.js), plain CSV exports
                        (csv-export.js), per-taxon lineage/cross-sample
                        detail (taxon-detail.js)
src/viz/                sunburst (Krona-style), Sankey (Pavian-style),
                        generic heatmap (heatmap.js — abundance,
                        presence/absence, and similarity all reuse it),
                        and stacked composition bar chart, all layout math
                        + SVG rendering; shared SVG/PNG diagram export
                        (svg-export.js) that bakes resolved CSS custom
                        properties into the exported file so it's portable
src/app.js              UI wiring: folder loading, tick-list, sample
                        loading, sample groups, overview dashboard,
                        multi-sample comparison, per-sample summary card,
                        rank table, Top-N chart, sunburst, Sankey, theme
                        toggle
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
