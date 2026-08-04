// Stacked composition bar chart: one bar per sample, segments are the
// Top-N-across-all-samples taxa (see src/model/comparison.js
// computeStackedComposition) plus a per-sample "Other" bucket. Native SVG.

(function () {
  'use strict';

  const STACKED_BAR_SVG_NS = 'http://www.w3.org/2000/svg';

  function colorForTaxonName(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 55%, 55%)`;
  }

  /**
   * @param {HTMLElement} container
   * @param {{taxonNames: string[], series: Array<{sampleId: string, values: Array<{name:string, pct:number}>, otherPct: number}>}} data
   * @param {{width?: number, height?: number, sampleLabels?: Record<string,string>, isTaxonHighlighted?: (name:string) => boolean, onLegendClick?: (name:string) => void}} [options]
   */
  function renderStackedBarSVG(container, data, options = {}) {
    const width = options.width ?? Math.max(500, data.series.length * 70);
    const barGap = 12;
    const barWidth = Math.min(60, (width - barGap * (data.series.length + 1)) / data.series.length);
    const chartTop = 10;
    const chartHeight = options.chartHeight ?? 280;
    const labelFn = options.sampleLabels || ((id) => id);
    // Font is 10px; ~6px/char sizes the rotated (-60deg) label's vertical
    // extent from the actual "sample (group)" text so long group names
    // don't run into the legend below them.
    const CHAR_WIDTH = 6;
    const longestSampleLabelLen = data.series.reduce(
      (max, s) => Math.max(max, labelFn(s.sampleId).length), 0,
    );
    const sampleLabelHeight = Math.max(
      50,
      Math.ceil(longestSampleLabelLen * CHAR_WIDTH * Math.sin((60 * Math.PI) / 180)) + 16,
    );
    const isTaxonHighlighted = options.isTaxonHighlighted || null;
    const tagForTaxon = options.tagForTaxon || null;
    const colorForCategory = options.colorForCategory || null;
    const onLegendClick = options.onLegendClick || null;

    // Legend wraps into a grid beneath the sample labels instead of a
    // single row that can run off the right edge.
    const legendItems = [...data.taxonNames, 'Other'];
    const legendRowHeight = 16;
    const legendPadding = 8;
    const legendRows = [];
    {
      let row = [];
      let rowWidth = 0;
      legendItems.forEach((name) => {
        const itemWidth = Math.min(width - barGap * 2, name.length * 5.5 + 24);
        if (rowWidth + itemWidth > width - barGap * 2 && row.length) {
          legendRows.push(row);
          row = [];
          rowWidth = 0;
        }
        row.push({ name, itemWidth });
        rowWidth += itemWidth;
      });
      if (row.length) legendRows.push(row);
    }
    const legendHeight = legendPadding + legendRows.length * legendRowHeight;

    const height = options.height ?? (chartTop + chartHeight + sampleLabelHeight + legendHeight);

    container.innerHTML = '';
    const svg = document.createElementNS(STACKED_BAR_SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);

    data.series.forEach((sample, i) => {
      const x = barGap + i * (barWidth + barGap);
      let y = chartTop + chartHeight;

      const segments = [...sample.values, { name: 'Other', pct: sample.otherPct }];
      segments.forEach((seg) => {
        if (seg.pct <= 0) return;
        const segHeight = (seg.pct / 100) * chartHeight;
        y -= segHeight;
        const rect = document.createElementNS(STACKED_BAR_SVG_NS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barWidth);
        rect.setAttribute('height', segHeight);
        rect.setAttribute('fill', seg.name === 'Other' ? 'hsl(0, 0%, 60%)' : colorForTaxonName(seg.name));
        const category = seg.name !== 'Other' && tagForTaxon && tagForTaxon(seg.name);
        if (isTaxonHighlighted && isTaxonHighlighted(seg.name)) {
          rect.setAttribute('stroke', 'var(--accent)');
          rect.setAttribute('stroke-width', '2');
        } else if (category) {
          rect.setAttribute('stroke', colorForCategory(category));
          rect.setAttribute('stroke-width', '2');
        }
        const title = document.createElementNS(STACKED_BAR_SVG_NS, 'title');
        title.textContent = `${seg.name}: ${seg.pct.toFixed(2)}%${category ? ` [${category}]` : ''}`;
        rect.appendChild(title);
        svg.appendChild(rect);
      });

      const labelX = x + barWidth / 2;
      const labelY = chartTop + chartHeight + 8;
      const label = document.createElementNS(STACKED_BAR_SVG_NS, 'text');
      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--text)');
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('transform', `rotate(-60 ${labelX} ${labelY})`);
      label.textContent = labelFn(sample.sampleId);
      svg.appendChild(label);
    });

    // Legend: wraps into a grid so it never runs off the right edge.
    // Clicking an entry (not "Other" — it isn't a real taxon) highlights
    // that taxon consistently across every comparison view, which matters
    // most here: with many taxa, colours necessarily repeat, so the
    // legend alone can't tell two same-hued segments apart.
    const legendStartY = chartTop + chartHeight + sampleLabelHeight;
    legendRows.forEach((row, rowIndex) => {
      let legendX = barGap;
      const legendY = legendStartY + legendPadding + rowIndex * legendRowHeight;
      row.forEach(({ name, itemWidth }) => {
        const clickable = onLegendClick && name !== 'Other';
        const highlighted = isTaxonHighlighted && isTaxonHighlighted(name);
        const group = document.createElementNS(STACKED_BAR_SVG_NS, 'g');
        if (clickable) {
          group.style.cursor = 'pointer';
          group.addEventListener('click', () => onLegendClick(name));
        }

        const swatch = document.createElementNS(STACKED_BAR_SVG_NS, 'rect');
        swatch.setAttribute('x', legendX);
        swatch.setAttribute('y', legendY);
        swatch.setAttribute('width', 8);
        swatch.setAttribute('height', 8);
        swatch.setAttribute('fill', name === 'Other' ? 'hsl(0, 0%, 60%)' : colorForTaxonName(name));
        if (highlighted) {
          swatch.setAttribute('stroke', 'var(--accent)');
          swatch.setAttribute('stroke-width', '1.5');
        }
        group.appendChild(swatch);

        const text = document.createElementNS(STACKED_BAR_SVG_NS, 'text');
        text.setAttribute('x', legendX + 11);
        text.setAttribute('y', legendY + 8);
        text.setAttribute('font-size', '9');
        text.setAttribute('fill', highlighted ? 'var(--accent)' : 'var(--text)');
        if (highlighted) text.setAttribute('font-weight', 'bold');
        text.textContent = name;
        group.appendChild(text);

        if (clickable) {
          const title = document.createElementNS(STACKED_BAR_SVG_NS, 'title');
          title.textContent = highlighted ? `Click to clear the ${name} highlight` : `Click to highlight ${name} everywhere in this comparison`;
          group.appendChild(title);
        }

        svg.appendChild(group);
        legendX += itemWidth;
      });
    });

    container.appendChild(svg);
  }

  const stackedBarExports = { renderStackedBarSVG, colorForTaxonName };
  if (typeof module !== 'undefined' && module.exports) module.exports = stackedBarExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.stackedBar = stackedBarExports;
  }
})();
