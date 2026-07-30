# Clann eDNA Explorer — scoping & implementation plan

Derived from `clann-edna-explorer-brief.md`, cross-checked against the real example data in `COI_bracken_outputs/`. This document turns the brief's nine build phases into an actionable plan, front-loaded with the Phase 1 investigation findings the brief calls for.

## 0. Repo conventions (matching the other three Clann tools)

- Vanilla HTML/CSS/JS, no build step, no dependencies, no bundler/package.json required to run.
- `index.html` + `styles/` + `src/` (plain `<script>` includes or ES modules loaded directly), matching Tree Viewer's layout (`src/`, `styles/`, `test/`, `examples/`).
- GPL-2.0 licence file.
- Theme-aware CSS (light/dark via `prefers-color-scheme` + a manual toggle, matching the other tools).
- GitHub Pages hosting at `chriscreevey.github.io/clann-edna-explorer/`.
- README documents architecture, performance ceiling, and any non-features (per brief's convention).
- `examples/` folder ships a trimmed copy of `COI_bracken_outputs/` (see licensing note below) so the hosted demo works standalone.

**Open point to resolve with Chris before/at kickoff:** repo name (`clann-edna-explorer` vs `clann-kraken-explorer`). Recommend keeping `clann-edna-explorer` — it matches the suite's task-based naming (Tree/BLAST/Pangenome), and v1 explicitly plans a generic fallback parser, so a Kraken-specific name would undersell that.

## 1. Phase 1 investigation — findings from the real example data

I ran the file-format investigation the brief calls for directly against `COI_bracken_outputs/barcode39.*` (and spot-checked the other six barcodes). Findings:

### `.bracken` ↔ `.breport` reconciliation — resolved

- `.bracken` (barcode39): 7 tab-delimited columns, header row present: `name, taxonomy_id, taxonomy_lvl, kraken_assigned_reads, added_reads, new_est_reads, fraction_total_reads`. Every row's `taxonomy_lvl` is `S` (species) — Bracken was run at species level for this dataset.
- `.breport` (barcode39): 6 tab-delimited columns, **no header row**: `pct_reads_rooted, reads_covered(clade), reads_assigned(direct), rank_code, taxid, indented_name`. Rank codes seen: `R, D, K, P, C, O, F, G, S`, with numeric suffixes (`R1`, `D1`, `K1`, `K2`, `K3`...) for unnamed intermediate nodes between major ranks — this suffix convention needs to be handled by the parser (strip trailing digits when mapping to a canonical rank, but preserve the depth for indentation/tree purposes).
- **Reconciliation confirmed empirically:** the `.breport` rows with `rank_code == "S"` reconcile *exactly* with `.bracken`'s `new_est_reads` column, both in aggregate and per-taxon. Sum of `reads_covered` over all `S` rows in barcode39.breport = 567327; sum of `new_est_reads` in barcode39.bracken = 567327 — exact match. Spot check on taxid 1790162 (*Coccinella transversoguttata*): breport reports 33764 reads at that node, bracken reports `new_est_reads` = 33764 — exact match.
- Conclusion for the internal data model: `.breport` carries the **post-Bracken re-estimated** counts at leaf rank already (Bracken rewrites the report file in place), not the raw Kraken assignment — so `.breport`'s `S`-level rows and `.bracken` are two views of the *same* re-estimated numbers, not independent pre/post datasets. The only extra information `.bracken` adds is `kraken_assigned_reads` and `added_reads` (i.e. the raw vs. re-estimated split) and `fraction_total_reads`; the only extra information `.breport` adds is the full ancestor hierarchy above species. **This settles brief open point #2**: treat them as complementary, not alternative, inputs — a sample can usefully have either alone (breport → hierarchy views only, bracken → leaf table only, no raw/re-estimated split) but having both is what unlocks the full single-sample view (raw vs. re-estimated bar, Sankey down to species, sunburst).
- Data model implication: build one taxonomy tree keyed by taxid from `.breport` (this is authoritative for hierarchy + re-estimated counts at every rank); when `.bracken` is also present for a sample, attach `kraken_assigned_reads` / `added_reads` as extra fields on that sample's leaf (species) nodes only. No separate "flat per-leaf-rank table" data structure is needed distinct from the tree — a `.bracken`-only sample is just a tree with only leaf-rank nodes populated (no ancestor chain), which is a strict subset of the general shape, simplifying the model versus the brief's tentative two-structure sketch.

### Header/provenance metadata — resolved for this dataset

- Neither `.bracken` nor `.breport` in the example set has any leading `#`-comment block or other provenance header (checked all 7 barcodes: zero `^#` lines in any file). No tool version, database, or original-sample-name metadata is present in these files.
- Per the brief's own instruction ("if no such convention is found, this becomes a documented non-feature"): **for command-line-generated Kraken2/Bracken output, header capture is a documented non-feature** — the collapsible provenance section in the read-summary card should render conditionally and simply not appear when nothing was captured, rather than showing an empty state.
- Caveat to carry into implementation: this was verified against command-line output only. The brief separately flags Galaxy exports may differ (e.g. `Galaxy123-[bracken_report].tabular` naming). Since no Galaxy-exported example file is present in `COI_bracken_outputs/`, the parser should still include a lightweight, harmless check for a leading `#`/`"`-prefixed block on load (cheap, and Galaxy tool wrappers commonly prepend one line of invocation metadata) — implemented so it degrades silently to "no header found" rather than misparsing, consistent with the brief's fallback design of the content-sniffer generally. Flag to Chris: if he has (or can get) one real Galaxy-exported `.bracken`/`.breport` pair, that closes this open question definitively; otherwise ship the non-feature as documented and revisit if a student reports a Galaxy file that doesn't load.

### Content-based format detection — sniffing rules

From the structural differences observed, first-N-lines sniffing can distinguish the three shapes reliably without relying on filename/extension:

| Signal (checked on first ~20 non-blank lines) | `.bracken` | `.breport` | generic fallback |
|---|---|---|---|
| Delimiter | tab | tab | tab (or sniff `,`/`;` too) |
| Column count | 7 | 6 | variable |
| Header row present | yes, literal `name\ttaxonomy_id\ttaxonomy_lvl\t...` | no | maybe |
| Column 1 type | text (taxon name) | numeric (percentage, 0–100, often with decimals) | unknown |
| Column 3 / rank-code column | single-letter rank code (`taxonomy_lvl`, e.g. `S`) present at fixed column 3 | rank code with optional trailing digits at fixed column 4 (`rank_code`, e.g. `S`, `D1`) | absent or irregular |
| Leading whitespace / indentation on name field | none | yes, on the last column, proportional to tree depth (this is the tree structure encoding) | none expected |
| Numeric columns are integers | mixed (reads = int, fraction = float) | reads = int, first col = float percentage | unknown |

Detection algorithm (deterministic, cheap, streamed — read first 20 lines only):
1. Split first non-blank line on tab; if column count is exactly 7 and matches the literal Bracken header string → `.bracken`, high confidence.
2. Else, if column count is exactly 6 across the first 20 lines, column 1 parses as a float in [0,100], column 4 matches `^[A-Z][0-9]*$`, column 5 parses as an integer (taxid) → `.breport`, high confidence.
3. Else, attempt generic fallback: require ≥2 tab-delimited columns, at least one column across the sample lines that's consistently numeric (candidate abundance column), and at least one column that's consistently non-numeric text (candidate taxon-name column). Report the sniffed candidate columns and confidence; if ambiguous, mark as "possible but unconfirmed" and require the student to confirm/remap manually before it's added to the tick-list as selected (this resolves brief open point on sniffing strictness — un-ambiguous cases auto-select, ambiguous ones default to unchecked + a manual-mapping affordance, never silently mis-parsed).
4. Files matching neither well enough (e.g. the `krona.html`, `sankey-*.html`, `*-Pavian.tsv` files also present in the example folder — see note below) are listed but disabled, with the specific failed check surfaced as the reason (e.g. "6 columns found but column 1 is not a 0–100 percentage").

**Note on extra files in `COI_bracken_outputs/`:** the folder also contains `*.b.krona.txt`, `*.krona.html`, `sankey-*.html`, `COI_Pavian_Sankey_reports.html`, and `*-report-*_Pavian.tsv` (an 8-column, quoted-string Pavian-native format) alongside the `.bracken`/`.breport` pairs and a `make_krona_plots.sh` script. These are pre-existing outputs from Chris running Krona/Pavian himself on this run — not inputs the tool needs to read. They're useful as **reference/ground-truth** for visual QA (does our Sankey/sunburst broadly agree with Pavian's and Krona's own renderings of the same data?) but should not be treated as supported input formats in v1. Worth keeping a couple of them in `test/` fixtures purely as an eyeball cross-check during Phase 3, not as parser targets.

### Folder-based loading — recommendation

Given the two-tier browser support split in the brief:
- Feature-detect the File System Access API (`window.showDirectoryPicker`); when available (Chromium), use it for true folder browsing with live re-scan.
- Fall back to `<input type="file" webkitdirectory>` everywhere else (Firefox, Safari) — single-shot folder select, functionally equivalent for this tool's purposes since re-scanning mid-session isn't a requirement here (metadata/tag files can be added via a separate plain file input regardless of path).
- Both feed the same downstream code path: a flat list of `File` objects → content-sniffed → tick-list UI. No behavioural difference between the two beyond how the initial file list is obtained, so this is a small isolated module or (`folder-loader.js`), not a fork in app architecture.

## 2. Data model (settled, informed by §1)

```
Run
 ├─ samples: Map<sampleId, Sample>
 ├─ groupNames: string[]              // from the comma-separated text box
 ├─ taxonCategories: Map<taxid|name, category>   // optional, from tag upload
 └─ hostExclusionList: Set<taxid|name>

Sample
 ├─ id, displayName
 ├─ group: string | "Exclude" | null
 ├─ metadata: Map<field, value>       // from optional sample metadata CSV
 ├─ provenance: {tool, db, origSampleName, command} | null   // header capture, likely null per §1
 ├─ tree: TaxonNode (root)            // from .breport, if present
 ├─ leafTable: BrackenRow[] | null    // from .bracken, if present — kraken_assigned_reads/added_reads/fraction_total_reads keyed by taxid, merged onto tree leaf nodes when both files present
 ├─ totalReads, classifiedReads
 └─ sourceFormat: "kraken2-bracken" | "generic"

TaxonNode  (flat, typed-array-backed store keyed by taxid, per the brief's perf requirement — not one JS object per node)
 ├─ taxid, name, rank, depth, parentTaxid
 └─ perSample: Map<sampleId, {cladeReads, directReads, pctOfTotal, krakenAssignedReads?, addedReads?}>
```

A single shared tree is built by taxid across all samples that provide `.breport` (so multi-sample comparison walks one tree, not N separate trees), with per-sample counts attached at each node — this directly satisfies the brief's flat/typed-array performance requirement and avoids re-merging trees per view.

## 3. Build phases (adopting the brief's 9 phases, Phase 1 now largely de-risked)

1. **Investigation and data model** — ✅ largely complete per §1 above; remaining open item is Galaxy-export confirmation (needs a real Galaxy file from Chris, or ship as documented non-feature).
2. **Single-sample parsing and summary** — bracken/breport parsers per §1's sniffing rules, generic fallback with manual column mapping, read-summary card, rank-by-rank table.
3. **Single-sample visualisation** — Krona-style sunburst + Pavian-style Sankey, native SVG/canvas. Use the example `krona.html`/`sankey-*.html` outputs as visual cross-checks, not code dependencies.
4. **Multi-sample loading and group assignment** — folder tick-list (§1), group text box + per-sample dropdown incl. Exclude, shared recalculation layer.
5. **Multi-sample comparison core + overview dashboard** — stacked composition bar, heatmap, presence/absence matrix, small-multiples Sankey/sunburst, overview stats + diversity plot.
6. **Diversity and similarity** — richness/Shannon/Simpson, Bray-Curtis/Jaccard + dendrogram/heatmap; NMDS/PCA explicitly deferred (brief flags as stretch goal — recommend keeping it out of v1 scope entirely rather than a simplified implementation, and documenting "use R/vegan" in the README, since a half-correct ordination is worse than none for a teaching tool).
7. **Filtering, search, exclusion lists** — rank/abundance filters, taxon search, host/contaminant exclusion list.
8. **Metadata mapping and category tagging** — sample metadata join, optional group pre-population from metadata column (manual assignment always wins), taxon category tagging.
9. **Staging exports, cross-links, site chrome** — MicrobiomeAnalyst 3-file export to spec (taxid-keyed rows recommended over sanitised names, to sidestep the collision-handling problem the brief flags in its open points — a name column can still be included as a human-readable extra field without being the join key), CSV/PNG/SVG exports, BLAST Explorer cross-link, About/FAQ/footer, responsive pass.

## 4. Recommendations on brief's open points

- **Repo name**: keep `clann-edna-explorer` (see §0).
- **bracken/breport as independent vs. required+optional inputs**: independent — confirmed complementary, not redundant (§1).
- **Default exclusion list**: ship empty by default with 2–3 common examples pre-populated as *disabled/greyed* suggestions (e.g. "Homo sapiens", "Bos taurus") the student can enable with one click, rather than either extreme — teaches the concept without hiding data by default.
- **NMDS/PCA**: out of v1 scope, documented pointer to R/vegan (§3.6).
- **Pavian's compare-table tab**: skip direct replication — the brief's heatmap + stacked-bar + presence/absence trio already covers its function more visually; add a plain sortable table export (already planned as CSV export) rather than a dedicated UI tab.
- **Saveable group assignments**: worth including cheaply — since group assignment is already just a JS object, add it as one extra column/section in the CSV/session export rather than building session save/restore infrastructure. Full session restore (re-loading files automatically) is out of scope; re-importing a previously-exported group-assignment CSV to reapply groups to a freshly-reloaded run is a low-cost middle ground.
- **Multiple simultaneous grouping schemes**: one active scheme at a time for v1, per the brief's own lean — retyping the group box is cheap and keeps every view's logic single-threaded through one `group` field per sample.
- **MicrobiomeAnalyst taxon key**: taxid, with taxon name carried as a non-key display column (see §3.9) — resolves the collision-handling problem cleanly since taxids are already the tree's primary key.
- **Counts vs. percentage at MicrobiomeAnalyst export**: always export counts (`new_est_reads`/`kraken_assigned_reads` depending on what's available), per spec's stated preference — don't offer a percentage variant for this specific export, to avoid a near-miss file that uploads but produces wrong statistics; percentage remains available in the plain CSV export.
- **Content-sniffing strictness**: "possible but unconfirmed" tier for the generic fallback, auto-accept for exact `.bracken`/`.breport` matches — see §1's detection algorithm.
- **Header metadata Galaxy vs. command-line**: document command-line as the confirmed non-feature; keep the sniffer's header check in place defensively; treat as an open item pending a real Galaxy sample file.

## 5. Suggested immediate next steps

1. Confirm repo name and create `clann-edna-explorer` skeleton matching Tree Viewer's `src/`/`styles/`/`test/`/`examples/` layout.
2. Copy a trimmed `COI_bracken_outputs/` subset (2–3 barcodes) into `examples/` for the hosted demo.
3. Implement the Phase 1 parsers (bracken, breport, generic fallback) and the shared taxid-keyed tree structure per §2, with unit tests in `test/` driven directly off the real barcode39–45 files already on disk.
4. Move to Phase 2 (single-sample summary UI) once parsers pass tests against all 7 example barcodes.

## Open question for Chris before proceeding

Do you have (or can you get) a genuinely Galaxy-exported `.bracken`/`.breport` pair? None of the seven example files show Galaxy's naming or header conventions, so that part of Phase 1 can't be closed from the data on hand — I'd rather flag it than guess at a format I can't verify.
