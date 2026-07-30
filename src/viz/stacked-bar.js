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
   * @param {{width?: number, height?: number, sampleLabels?: Record<string,string>, isTaxonHighlighted?: (name:string) => boolean}} [options]
   */
  function renderStackedBarSVG(container, data, options = {}) {
    const width = options.width ?? Math.max(500, data.series.length * 70);
    const height = options.height ?? 360;
    const barGap = 12;
    const barWidth = Math.min(60, (width - barGap * (data.series.length + 1)) / data.series.length);
    const chartTop = 10;
    const chartHeight = height - 70;
    const labelFn = options.sampleLabels || ((id) => id);
    const isTaxonHighlighted = options.isTaxonHighlighted || null;

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
        if (isTaxonHighlighted && isTaxonHighlighted(seg.name)) {
          rect.setAttribute('stroke', 'var(--accent)');
          rect.setAttribute('stroke-width', '2');
        }
        const title = document.createElementNS(STACKED_BAR_SVG_NS, 'title');
        title.textContent = `${seg.name}: ${seg.pct.toFixed(2)}%`;
        rect.appendChild(title);
        svg.appendChild(rect);
      });

      const label = document.createElementNS(STACKED_BAR_SVG_NS, 'text');
      label.setAttribute('x', x + barWidth / 2);
      label.setAttribute('y', chartTop + chartHeight + 14);
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--text)');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = labelFn(sample.sampleId);
      svg.appendChild(label);
    });

    // Legend
    const legendY = chartTop + chartHeight + 34;
    let legendX = barGap;
    const legendItems = [...data.taxonNames, 'Other'];
    legendItems.forEach((name) => {
      const swatch = document.createElementNS(STACKED_BAR_SVG_NS, 'rect');
      swatch.setAttribute('x', legendX);
      swatch.setAttribute('y', legendY);
      swatch.setAttribute('width', 8);
      swatch.setAttribute('height', 8);
      swatch.setAttribute('fill', name === 'Other' ? 'hsl(0, 0%, 60%)' : colorForTaxonName(name));
      svg.appendChild(swatch);

      const text = document.createElementNS(STACKED_BAR_SVG_NS, 'text');
      text.setAttribute('x', legendX + 11);
      text.setAttribute('y', legendY + 8);
      text.setAttribute('font-size', '9');
      text.setAttribute('fill', 'var(--text)');
      text.textContent = name;
      svg.appendChild(text);

      legendX += name.length * 5.5 + 24;
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
