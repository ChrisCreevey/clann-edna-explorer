# Clann eDNA Explorer

# **Use it online here :** https://chriscreevey.github.io/clann-edna-explorer/

Citation: [![DOI](https://zenodo.org/badge/1317523442.svg)](https://doi.org/10.5281/zenodo.22662075)


A free, browser-based tool for exploring taxonomic classification results
from eDNA metabarcoding and metagenomic studies. Load your Kraken2/Bracken
output and get per-sample summaries, a Krona-style zoomable sunburst, a
Pavian-style Sankey diagram, and — once you've loaded more than one
sample — group-aware multi-sample comparison: a stacked composition
chart, an abundance heatmap, a presence/absence matrix, a diversity
summary, and a Bray-Curtis/Jaccard sample-similarity matrix.

Nothing is uploaded anywhere. Every parsing step, every chart, and every
export runs entirely in your browser — your data never leaves your
computer.

It's one of the [Clann suite](https://chriscreevey.github.io/) of
browser-based bioinformatics tools, alongside
[Clann Tree Viewer](https://chriscreevey.github.io/clann-tree-viewer/),
[Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/),
and [Clann Pangenome Explorer](https://chriscreevey.github.io/clann-pangenome-explorer/).

## Features

- **Per-sample view** — read-count summary (classified/unclassified, raw
  Kraken-assigned vs. Bracken-re-estimated counts where available), a
  sortable/searchable rank-by-rank abundance table, and a Top-N bar chart.
- **Taxonomic sunburst** — a zoomable, Krona-style radial view of the full
  taxonomy. Click a wedge to zoom in, click the centre to zoom out, and
  scroll to magnify without changing what's shown.
- **Sankey diagram** — read flow between taxonomic ranks, with a
  configurable rank range.
- **Multi-sample comparison** — assign samples to groups, then compare
  across the whole run: a stacked composition chart, an abundance
  heatmap, a presence/absence matrix, small-multiples sunbursts, a
  diversity summary (richness, Shannon, Simpson), and a Bray-Curtis/
  Jaccard sample-similarity matrix.
- **Filtering and search** — a live minimum-abundance threshold and a
  host/contaminant exclusion list, applied consistently everywhere; a
  non-destructive search that highlights matches across every view
  without hiding anything.
- **Taxon tagging** — flag taxa of interest (pathogens, indicator
  species, invasive species, …) by uploading a taxid/name list and/or
  typing keyword rules; tags are highlighted consistently across every
  table and diagram. Tagging is clade-aware: tagging a higher rank (e.g.
  "Chordata" as Host) also tags every taxon beneath it (e.g. "Homo
  sapiens"), all the way down to species; a more specific match further
  down the lineage overrides a broader ancestor's tag. Two-column
  `taxon-or-taxid, category` list, no header row — see
  [`examples/taxon-category-tags.tsv`](examples/taxon-category-tags.tsv).
- **Sample metadata** — join a CSV/TSV of per-sample metadata by ID, and
  optionally pre-populate group assignments from one of its columns.
  First column is the sample/barcode ID, header row required — see
  [`examples/sample-metadata.tsv`](examples/sample-metadata.tsv).
- **Exports** — every diagram exports as SVG (vector) or PNG (raster);
  the filtered table, the merged abundance matrix, and the diversity/
  similarity summaries export as CSV; and the whole comparison exports
  in [MicrobiomeAnalyst](https://www.microbiomeanalyst.ca/)'s documented
  format for downstream statistical analysis.

## Input files

Point the file picker at the output files for a run — select every file
at once (⇧-click, ⌘/Ctrl-click, or select-all). Files are identified by
their **content**, not their filename or extension, so exports with
generic names (e.g. from a Galaxy pipeline) still load correctly. The
chosen files open in the main pane for review before anything loads.

- **`.breport`** — a Kraken2/Bracken report: the full taxonomic
  hierarchy, one row per taxon, with clade and direct read counts at
  every rank.
- **`.bracken`** — Bracken's leaf-rank re-estimated abundance table.
  Loading both files for a sample merges them: the hierarchy comes from
  the `.breport`, and species-level counts are reconciled against the
  `.bracken` re-estimate.
- A run can mix samples that only have one file type or the other —
  each sample just needs at least one of the two.
- **Lineage TSV** — a hierarchy-aware format for tools that resolve their
  own taxonomy rather than running Kraken2/Bracken (e.g. BLAST/DIAMOND hits
  resolved against a taxonomy database). A tab-delimited file with a header
  row, `count` and `species` columns required, plus any of `superkingdom`,
  `kingdom`, `phylum`, `class`, `order`, `family`, `genus` (each optionally
  paired with a `<rank>_taxid` column). One row per unique resolved taxon
  path; a row with every rank column blank represents unclassified reads.
  Detected deterministically by its header (high confidence, no manual
  column mapping needed) and built into the same taxonomy tree as
  `.breport`, so it gets full rank views, sunburst, Sankey, and multi-sample
  comparison. See
  [`examples/blast-explorer-nanopore-sample.lineage.tsv`](examples/blast-explorer-nanopore-sample.lineage.tsv),
  produced by [Clann BLAST Explorer](https://chriscreevey.github.io/clann-blast-explorer/)'s
  "Download eDNA Explorer sample" export (BLAST/DIAMOND hits for 5
  Nanopore reads, resolved against its built-in taxonomy database) — load
  it here to see the format in action end to end.

### QIIME 2

QIIME 2's `FeatureTable[Frequency]` + `FeatureData[Taxonomy]` artifact pair
is supported, exported to plain text first (no in-browser `.qza`/HDF5
decoding yet — see "Planned" below):

```sh
qiime tools export --input-path table.qza --output-path exported-table
biom convert -i exported-table/feature-table.biom -o feature-table.tsv --to-tsv

qiime tools export --input-path taxonomy.qza --output-path exported-taxonomy
# produces exported-taxonomy/taxonomy.tsv directly, no extra conversion needed
```

Select both `feature-table.tsv` and `taxonomy.tsv` together (they're
identified by content, so the filenames above are just what `qiime tools
export` happens to produce by default). Unlike `.breport`/`.bracken`,
where each file is one sample, this pair loads **every sample column in
the feature table at once** — there's no per-file sample-name field for
these two rows in the file list, since the sample names come from the
feature table's own header. Features whose ID doesn't appear in
`taxonomy.tsv`, or whose taxon string resolves to no ranks at all (e.g.
`Unassigned`), are counted as unclassified reads for that sample rather
than dropped.

### Other taxonomy tables (best effort)

Any other tab-, comma- or semicolon-separated table that carries
taxonomy can be imported through a column-mapping step. The tool
suggests a role for every column — from its header name first, its
contents second — and shows the suggestion as a table (column names, a
role drop-down for each, and the first few rows) for you to confirm or
change:

- **Sample ID** — makes it a *long* table: one row per sample × taxon/OTU
  (e.g. a BOLD metabarcoding export, `kaiju2table` across several files).
- **Read count** — the count for that row. With no count column, each row
  counts as one read (e.g. a per-read assignment table).
- **Counts for one sample** — makes it a *wide* table: taxa as rows, one
  count column per sample (e.g. a DADA2/mothur OTU/ASV table).
- **Rank: superkingdom … species** — one column per rank, or instead
- **Lineage string** — a single column such as `k__Bacteria;p__…`,
  `k__…|p__…|s__…` (MetaPhlAn) or `Bacteria;Proteobacteria;…` (Kaiju).
  Prefixed levels (`k__`, `p__`, SILVA `D_0__` …) map to their rank;
  un-prefixed levels are read in order as superkingdom, phylum, class,
  order, family, genus, species.
- **Taxid: rank** — optional NCBI taxids for a rank; otherwise stable
  synthetic IDs are made from the lineage names.

With neither a Sample ID nor per-sample count columns, the whole file is
one sample, named in the file list. Blank, `NA`, `unassigned`,
`unclassified` and similar cells are treated as "not resolved at this
rank"; a row with nothing resolved counts as unclassified. Options cover
`Genus_species` underscores, species columns that hold only the epithet,
and MetaPhlAn-style tables where every clade's total is its own row (only
the most specific rows are counted). A live summary shows the layout,
number of samples, rows used and the most specific rank each row
reaches before you tick **Include**.

Imported tables are built into the same taxonomy tree as the native
formats, so they get the sunburst, Sankey and multi-sample comparison
views. The confirmed mapping is recorded in each sample's provenance, and
remembered in your browser for the next file with the same header row.

## Read-count scaling

Handled the same way regardless of input format: parsing always keeps
each sample's **raw read counts** as reported by the source tool
(Kraken2/Bracken's own counts, a Lineage TSV's `count` column, a QIIME 2
feature table's cell values) — nothing is rarefied or rescaled to a
common depth at load time. There's no rarefaction, CSS, or TMM-style
formal normalization anywhere in the tool.

Downstream, each view then works from either raw counts or each sample's
own relative proportions, depending on what the view is for:

- **Relative proportions** (depth-independent) — the abundance heatmap's
  colour, the stacked composition chart's default "% of sample" display,
  the per-sample rank table's "% of total" column, the diversity summary
  (richness/Shannon/Simpson), and Bray-Curtis distance (feeding both the
  sample-similarity matrix and the PCoA ordination plot).
- **Raw read counts** (depth-sensitive, by design where used) — the
  stacked composition chart has a "Read count" display toggle alongside
  its default "% of sample" view, for when bar height itself should show
  depth differences; and the Jaccard distance/presence-absence matrix,
  which call a taxon "present" once it clears a raw-read-count
  threshold, not a percentage. The heatmap's hover tooltip always shows
  both figures for a cell — its % of that sample's total (what the
  colour is based on) and the raw read count behind it.

CSV exports carry raw counts, not the percentages shown on screen where
applicable: the rank table export has both raw reads and
percent-of-total columns; the merged abundance matrix export is raw
counts only — deliberately not the percentages the heatmap is now
coloured from; the diversity summary export is proportion-based; the
similarity/distance matrix export is the distance values themselves
(Bray-Curtis proportion-based, Jaccard raw-count-threshold), not counts;
and the MicrobiomeAnalyst export is raw counts throughout, matching what
that tool expects.

One provenance subtlety when both `.breport` and `.bracken` are loaded
for a sample: species-rank counts become Bracken's statistically
re-estimated numbers, but genus-rank-and-above counts still come from
Kraken's original `.breport` clade assignments and aren't re-summed from
the corrected species values — so a genus total won't exactly equal the
sum of its (Bracken-corrected) species children in that case.

## Planned: native support for other classifiers

Right now, anything other than Kraken2/Bracken/Lineage TSV/QIIME 2 goes
through the column-mapping import above. A future update may add
dedicated parsers (no mapping step) for other common classifier outputs,
likely including:

- **Kaiju** (`kaiju2table` summary output)
- **Centrifuge**
- **MetaPhlAn**
- **QIIME 2** raw `.qza` artifacts read directly in-browser (no
  `qiime tools export`/`biom convert` step) — the feature table is HDF5
  inside a zip, so this needs an in-browser HDF5 reader; the plain-text
  export pair above works today without it.

If you use a classifier that isn't listed here and want it supported,
[open an issue](https://github.com/chriscreevey/clann-edna-explorer/issues/new/choose).

## Running it yourself

No build step, no dependencies — it's plain HTML/CSS/JavaScript. Clone
the repository and serve the directory with any static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Since it's a static site, you can
also host it on any static host (GitHub Pages, Netlify, an internal
web server, …), or just open `index.html` directly from disk in most
browsers.

## Funding

Part of **HoloR-Tools** from the [HoloRuminant](https://holoruminant.eu/) project. This tool was
developed with financial support from the European Union's Horizon 2020 research and innovation
programme under grant agreement N° 101000213-HoloRuminant.

This publication reflects the views only of the author, and not the European Commission (EC); the
EC is not liable for any use that may be made of the information contained herein.

## License

Free and open source under [GPL-2.0](LICENSE), developed by
[CreeveyLab](https://www.creeveylab.org/).
