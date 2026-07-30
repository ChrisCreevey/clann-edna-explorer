(function () {
  'use strict';

// Pavian-style Sankey: read flow through a configurable range of canonical
// taxonomic ranks (default domain -> species). Two stages, both pure and
// testable in Node: extracting the column/link data from the shared
// TaxonomyTree, then assigning pixel geometry to it. SVG drawing is the
// only DOM-dependent part (renderSankeySVG, at the bottom).

const { computeRankTable: rankTableComputeRankTable } = typeof module !== 'undefined' && module.exports
  ? require('../model/rank-table')
  : window.ClannEDNA.rankTable;

/**
 * Extract Sankey columns + links from the tree for one sample, restricted
 * to `rankLetters` (an ordered subset of RANK_ORDER -- the "rank cutoff").
 *
 * A node is only linked to its nearest *displayed-rank* ancestor; if no
 * such ancestor exists (e.g. the lineage skips the previous displayed
 * rank, or that ancestor itself didn't make the cut below), that node is
 * dropped from the diagram rather than mis-linked -- documented v1
 * simplification, see PLAN.md.
 *
 * Each column is capped at `maxNodesPerColumn` (largest by cladeReads); the
 * rest are simply left out rather than bucketed into an "Other" node -- a
 * group of unrelated small taxa doesn't mean anything as a single flow, so
 * hiding it is more honest than implying it's one thing. `grandTotal` (the
 * full, uncapped read total at the first displayed rank) is returned
 * alongside the columns so the layout can size every bar as a fraction of
 * the whole sample rather than of just what made it into each column --
 * see computeSankeyLayout. Each column also reports how many taxa and
 * reads it left out, so the caller can show a "N taxa / X% of reads not
 * shown" note instead of silently truncating.
 *
 * @param {import('../model/taxonomy-tree').TaxonomyTree} tree
 * @param {string} sampleId
 * @param {string[]} rankLetters - ordered, e.g. ['D','P','C','O','F','G','S']
 * @param {{maxNodesPerColumn?: number, filters?: object}} [options]
 *   `filters` is the global exclusion/abundance filter set (see
 *   src/model/filters.js) -- forwarded straight into computeRankTable so
 *   each column is built from the same filtered rows as the rank table and
 *   comparison views.
 */
function computeSankeyData(tree, sampleId, rankLetters, options = {}) {
  const maxNodesPerColumn = options.maxNodesPerColumn ?? 12;
  const filters = options.filters ?? null;

  // taxid -> true for a taxon that made the cut and is drawn
  const displayed = new Set();
  let grandTotal = 0;

  const columns = rankLetters.map((rank, i) => {
    const sortedRows = rankTableComputeRankTable(tree, sampleId, rank, '', filters).sort((a, b) => b.cladeReads - a.cladeReads);
    if (i === 0) grandTotal = sortedRows.reduce((s, r) => s + r.cladeReads, 0);
    const kept = sortedRows.slice(0, maxNodesPerColumn);
    const hidden = sortedRows.slice(kept.length);
    const nodes = kept.map((row) => ({ taxid: row.taxid, name: row.name, cladeReads: row.cladeReads }));
    kept.forEach((row) => displayed.add(row.taxid));
    return {
      rank,
      nodes,
      hiddenCount: hidden.length,
      hiddenReads: hidden.reduce((s, r) => s + r.cladeReads, 0),
    };
  });

  const rankIndexOf = new Map(rankLetters.map((r, i) => [r, i]));

  // Nearest ancestor (walking up the real tree) that is itself displayed at
  // an earlier rank column.
  function nearestDisplayedAncestor(treeIndex) {
    let idx = tree.parentIndex[treeIndex];
    while (idx !== -1) {
      const letter = tree.rankLetter[idx];
      if (rankIndexOf.has(letter) && tree.rankSub[idx] === 0 && displayed.has(tree.taxid[idx])) {
        return tree.taxid[idx];
      }
      idx = tree.parentIndex[idx];
    }
    return null;
  }

  const taxidToRank = new Map();
  columns.forEach((col) => col.nodes.forEach((n) => taxidToRank.set(n.taxid, col.rank)));

  const linkByKey = new Map();
  for (let colIdx = 1; colIdx < columns.length; colIdx++) {
    for (const node of columns[colIdx].nodes) {
      const treeIndex = tree.taxidToIndex.get(node.taxid);
      const parentTaxid = nearestDisplayedAncestor(treeIndex);
      if (parentTaxid === null) continue;
      const key = `${parentTaxid} ${node.taxid}`;
      linkByKey.set(key, {
        sourceRank: taxidToRank.get(parentTaxid),
        sourceTaxid: parentTaxid,
        targetRank: columns[colIdx].rank,
        targetTaxid: node.taxid,
        value: node.cladeReads,
      });
    }
  }

  // Reorder each column (after the first) so a node sits near its parent's
  // position in the previous column -- grouping siblings from the same
  // parent together, the same way the sunburst/hierarchy already groups a
  // clade's children. This is a single deterministic left-to-right pass
  // (not full barycenter relaxation), but since every node has exactly one
  // parent link it removes most of the crossings a plain
  // cladeReads-descending sort produces.
  for (let colIdx = 1; colIdx < columns.length; colIdx++) {
    const prevOrder = new Map(columns[colIdx - 1].nodes.map((n, i) => [n.taxid, i]));
    const parentOrderOf = new Map(); // targetTaxid -> order index of its parent
    for (const link of linkByKey.values()) {
      if (link.targetRank !== columns[colIdx].rank) continue;
      const order = prevOrder.get(link.sourceTaxid);
      if (order !== undefined) parentOrderOf.set(link.targetTaxid, order);
    }
    columns[colIdx].nodes.sort((a, b) => {
      const aOrder = parentOrderOf.get(a.taxid) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = parentOrderOf.get(b.taxid) ?? Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return b.cladeReads - a.cladeReads;
    });
  }

  return { columns, links: [...linkByKey.values()], grandTotal };
}

/**
 * Assign pixel geometry to columns/links: x per column, y0/y1 per node,
 * and matching y-ranges on each link's source/target ends (sub-ranges
 * within the node's height, ordered by link value descending, so bigger
 * flows sit on top).
 *
 * Every node's height is a fraction of `data.grandTotal` (the whole
 * sample's read count at the first rank), not of its own column's kept
 * total -- so a column that had to leave more taxa out (below the
 * abundance filter, or beyond the per-column cap) visibly covers less of
 * the column's height rather than being stretched to fill it. Columns
 * further right, at finer ranks, are expected to shrink this way as more
 * of the total becomes unresolved to individually-displayable taxa.
 */
function computeSankeyLayout(data, { width, height, nodeWidth = 16, nodePadding = 2 }) {
  const columns = data.columns.filter((c) => c.nodes.length > 0);
  const colCount = columns.length;
  const grandTotal = data.grandTotal || columns.reduce((max, c) => Math.max(max, c.nodes.reduce((s, n) => s + n.cladeReads, 0)), 0) || 1;

  // Every node's label is drawn to the right of its bar, so the last
  // column's labels would otherwise run past the canvas edge -- reserve
  // enough right-hand margin for the longest label in that column (same
  // approach as the heatmap's rotated-label padding).
  const lastColLabelLen = colCount > 0
    ? columns[colCount - 1].nodes.reduce((max, n) => Math.max(max, n.name.length), 0)
    : 0;
  const labelMargin = lastColLabelLen > 0 ? Math.min(width * 0.35, lastColLabelLen * 6 + 10) : 0;

  const colStep = colCount > 1 ? (width - nodeWidth - labelMargin) / (colCount - 1) : 0;

  const nodeGeometry = new Map(); // taxid -> {x, y0, y1, rank}

  columns.forEach((col, colIdx) => {
    const gaps = Math.max(0, col.nodes.length - 1);
    // Cap total padding at a quarter of the column height so a column with
    // many nodes (e.g. hundreds of species) degrades to tightly-packed bars
    // instead of producing negative bar heights.
    const effectivePadding = gaps > 0 ? Math.min(nodePadding, height / 4 / gaps) : 0;
    const availableHeight = height - effectivePadding * gaps;
    let y = 0;
    const x = colIdx * colStep;
    col.nodes.forEach((n) => {
      const h = (n.cladeReads / grandTotal) * availableHeight;
      nodeGeometry.set(n.taxid, { x, y0: y, y1: y + h, rank: col.rank, name: n.name, cladeReads: n.cladeReads });
      y += h + effectivePadding;
    });
  });

  // Sub-allocate each node's height across its outgoing/incoming links.
  const outCursor = new Map(); // taxid -> current y offset for outgoing links

  const sortedLinks = data.links.slice().sort((a, b) => b.value - a.value);
  const linkGeometry = sortedLinks.map((link) => {
    const source = nodeGeometry.get(link.sourceTaxid);
    const target = nodeGeometry.get(link.targetTaxid);
    if (!source || !target) return null;

    const sourceTotal = data.links
      .filter((l) => l.sourceTaxid === link.sourceTaxid)
      .reduce((s, l) => s + l.value, 0) || 1;

    const sourceHeight = (source.y1 - source.y0) * (link.value / sourceTotal);
    const sOff = outCursor.get(link.sourceTaxid) || 0;
    outCursor.set(link.sourceTaxid, sOff + sourceHeight);

    return {
      ...link,
      sx: source.x + nodeWidth,
      sy0: source.y0 + sOff,
      sy1: source.y0 + sOff + sourceHeight,
      tx: target.x,
      ty0: target.y0,
      ty1: target.y1,
    };
  }).filter(Boolean);

  return {
    nodeWidth,
    nodes: [...nodeGeometry.entries()].map(([taxid, g]) => ({ taxid, ...g })),
    links: linkGeometry,
  };
}

/**
 * Where each node's label should be drawn, and how tall the canvas needs
 * to be to fit all of them. Every node gets a label, including ones too
 * short to fit one centred on the bar — otherwise raising "max taxa shown
 * per rank" adds bars with no visible name. Labels are pushed down within
 * their column (nodes arrive top-to-bottom already, per
 * computeSankeyLayout) to keep a minimum gap from the previous label.
 * Pulled out as a pure function (no DOM) so the canvas-growth behaviour is
 * unit-testable, and so renderSankeySVG can size the SVG before drawing
 * anything — a column with many small bars packed near the bottom would
 * otherwise get its last few labels clipped by a fixed-height viewBox.
 *
 * @param {Array<{taxid, rank, y0, y1}>} nodes
 * @param {number} height - the diagram's nominal height, used as a floor
 * @param {{labelMinGap?: number, bottomPadding?: number}} [options]
 */
function computeSankeyLabelLayout(nodes, height, { labelMinGap = 11, bottomPadding = 6 } = {}) {
  const lastLabelYByRank = new Map();
  const labelYByTaxid = new Map();
  let maxLabelY = height;
  nodes.forEach((n) => {
    const barCenterY = (n.y0 + n.y1) / 2;
    const desiredLabelY = barCenterY + 3;
    const lastY = lastLabelYByRank.get(n.rank);
    const labelY = lastY !== undefined && desiredLabelY < lastY + labelMinGap ? lastY + labelMinGap : desiredLabelY;
    lastLabelYByRank.set(n.rank, labelY);
    labelYByTaxid.set(n.taxid, labelY);
    if (labelY > maxLabelY) maxLabelY = labelY;
  });
  return { labelYByTaxid, canvasHeight: maxLabelY + bottomPadding };
}

// ---- SVG rendering (DOM only) -----------------------------------------

const SANKEY_SVG_NS = 'http://www.w3.org/2000/svg';

function renderSankeySVG(container, layout, { width, height, isHighlighted = null, tagFor = null, colorForCategory = null }) {
  container.innerHTML = '';

  const { labelYByTaxid, canvasHeight } = computeSankeyLabelLayout(layout.nodes, height);

  const svg = document.createElementNS(SANKEY_SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${canvasHeight}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', canvasHeight);

  const linkGroup = document.createElementNS(SANKEY_SVG_NS, 'g');
  linkGroup.setAttribute('fill-opacity', '0.4');
  layout.links.forEach((link) => {
    const midX = (link.sx + link.tx) / 2;
    const path = document.createElementNS(SANKEY_SVG_NS, 'path');
    const d = [
      `M ${link.sx} ${link.sy0}`,
      `C ${midX} ${link.sy0}, ${midX} ${link.ty0}, ${link.tx} ${link.ty0}`,
      `L ${link.tx} ${link.ty1}`,
      `C ${midX} ${link.ty1}, ${midX} ${link.sy1}, ${link.sx} ${link.sy1}`,
      'Z',
    ].join(' ');
    path.setAttribute('d', d);
    path.setAttribute('fill', colorForName(link.sourceRank === null ? link.targetTaxid : link.sourceTaxid));
    const title = document.createElementNS(SANKEY_SVG_NS, 'title');
    title.textContent = `${link.value.toLocaleString()} reads`;
    path.appendChild(title);
    linkGroup.appendChild(path);
  });
  svg.appendChild(linkGroup);

  const nodeGroup = document.createElementNS(SANKEY_SVG_NS, 'g');
  const labelGroup = document.createElementNS(SANKEY_SVG_NS, 'g');

  layout.nodes.forEach((n) => {
    const rect = document.createElementNS(SANKEY_SVG_NS, 'rect');
    rect.setAttribute('x', n.x);
    rect.setAttribute('y', n.y0);
    rect.setAttribute('width', layout.nodeWidth);
    rect.setAttribute('height', Math.max(1, n.y1 - n.y0));
    rect.setAttribute('fill', colorForName(n.taxid));
    const highlighted = isHighlighted && isHighlighted(n.name, n.taxid);
    const category = tagFor && tagFor(n.name, n.taxid);
    rect.setAttribute('stroke', highlighted ? 'var(--accent)' : category ? colorForCategory(category) : 'var(--bg)');
    rect.setAttribute('stroke-width', highlighted || category ? '2.5' : '1');
    const title = document.createElementNS(SANKEY_SVG_NS, 'title');
    title.textContent = `${n.name} (${n.rank}) — ${n.cladeReads.toLocaleString()} reads${category ? ` [${category}]` : ''}`;
    rect.appendChild(title);
    nodeGroup.appendChild(rect);

    const barCenterY = (n.y0 + n.y1) / 2;
    const labelY = labelYByTaxid.get(n.taxid);

    // A thin leader line ties an offset label back to its bar so it's
    // still clear which name belongs to which segment.
    if (labelY - 3 !== barCenterY) {
      const leader = document.createElementNS(SANKEY_SVG_NS, 'line');
      leader.setAttribute('x1', n.x + layout.nodeWidth);
      leader.setAttribute('y1', barCenterY);
      leader.setAttribute('x2', n.x + layout.nodeWidth + 4);
      leader.setAttribute('y2', labelY - 3);
      leader.setAttribute('stroke', 'var(--muted)');
      leader.setAttribute('stroke-width', '0.5');
      labelGroup.appendChild(leader);
    }

    const label = document.createElementNS(SANKEY_SVG_NS, 'text');
    label.setAttribute('x', n.x + layout.nodeWidth + 4);
    label.setAttribute('y', labelY);
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', 'var(--text)');
    label.textContent = n.name;
    labelGroup.appendChild(label);
  });
  svg.appendChild(nodeGroup);
  svg.appendChild(labelGroup);

  container.appendChild(svg);
}

function colorForName(seed) {
  let hash = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

const sankeyExports = { computeSankeyData, computeSankeyLayout, computeSankeyLabelLayout, renderSankeySVG, colorForName };
if (typeof module !== 'undefined' && module.exports) module.exports = sankeyExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.sankey = sankeyExports;
}
})();
