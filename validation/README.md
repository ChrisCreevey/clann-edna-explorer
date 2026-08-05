# Validation: eDNA Explorer vs. independent R

`report.html` is a shareable, self-contained validation report that checks the app's computed
tables and diagrams against an **independent** R implementation (`vegan`, `ape`, `ggplot2`,
`pheatmap`, `plotly`) run on the same raw input files
(`test/fixtures/barcode39/40/42.breport` + `.bracken`).

Every R command used is shown in the report itself (code-folding, expanded by default).

## Reproducing it

1. Regenerate the app-side numbers (calls the app's own `src/model/*.js` code directly — not a
   re-implementation — and writes CSVs to `app_exports/csv/`):

   ```bash
   node validation/export_app_outputs.js
   ```

2. The app-side diagram SVGs in `app_exports/img/` were captured by loading the three fixtures
   into the running app and clicking each diagram's own "Export SVG" button. To recapture them,
   load `barcode39.breport`/`.bracken`, `barcode40.breport`/`.bracken`, and
   `barcode42.breport`/`.bracken` into the app and re-export each diagram over the matching file
   in `app_exports/img/`.

3. Knit the report:

   ```bash
   cd validation
   Rscript -e 'rmarkdown::render("report.Rmd", output_file = "report.html")'
   ```

   Requires: `vegan`, `ape`, `ggplot2`, `pheatmap`, `plotly`, `rmarkdown`, `knitr`, `dplyr`,
   `htmlwidgets`, `ggrepel`, `reshape2`.

## What's compared

| Section | App source | R method |
|---|---|---|
| Species-rank table | `computeRankTable` | custom `.breport`/`.bracken` parser |
| Diversity (richness, Shannon, Gini-Simpson) | `computeDiversitySummary` | `vegan::specnumber()`, `vegan::diversity()` |
| Bray-Curtis / Jaccard similarity | `computeDistanceMatrix` | `vegan::vegdist()` |
| PCoA ordination | `computePCoA` | `ape::pcoa()` |
| Composition / heatmap / presence-absence | `computeStackedComposition`, `buildAbundanceMatrix` | `ggplot2`, `pheatmap` |
| Sunburst / Sankey | `renderSunburstSVG`, `renderSankeySVG` | `plotly` (structural comparison only — not pixel-exact by design) |

## Known non-issues (documented in the report, not bugs)

- **Bray-Curtis** is computed on relative abundance (`decostand(x, "total")` first), matching
  the app's use of `pctOfTotal` rather than raw counts.
- **Jaccard** binarizes on a raw read-count threshold (default 1) before `vegdist`, matching the
  app's `presenceThreshold`.
- **PCoA axes** are only defined up to a sign flip — a mirrored plot between R and the app is
  expected, not a discrepancy.
- **Sunburst/Sankey** are structural comparisons; the app's hand-rolled SVG layout and plotly's
  layout will never be pixel-identical.
