// Ordination scatterplot: one point per sample, positioned by its PCoA
// coordinates (see src/model/ordination.js). Shape encodes group (fixed
// meaning, changes as groups are reassigned); colour encodes whatever the
// caller resolved (group colour by default, or a selected metadata field —
// see the "Colour by" control in the overview dashboard). Native SVG, same
// conventions as heatmap.js/stacked-bar.js.

(function () {
  'use strict';

  const ORD_SVG_NS = 'http://www.w3.org/2000/svg';
  const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'];

  function appendShape(svg, shapeIndex, cx, cy, r, fill) {
    const shape = SHAPES[((shapeIndex % SHAPES.length) + SHAPES.length) % SHAPES.length];
    let node;
    if (shape === 'square') {
      node = document.createElementNS(ORD_SVG_NS, 'rect');
      node.setAttribute('x', cx - r);
      node.setAttribute('y', cy - r);
      node.setAttribute('width', r * 2);
      node.setAttribute('height', r * 2);
    } else if (shape === 'triangle') {
      node = document.createElementNS(ORD_SVG_NS, 'polygon');
      node.setAttribute('points', [[cx, cy - r], [cx - r, cy + r * 0.8], [cx + r, cy + r * 0.8]].map((p) => p.join(',')).join(' '));
    } else if (shape === 'diamond') {
      node = document.createElementNS(ORD_SVG_NS, 'polygon');
      node.setAttribute('points', [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]].map((p) => p.join(',')).join(' '));
    } else if (shape === 'cross') {
      node = document.createElementNS(ORD_SVG_NS, 'path');
      const w = r * 0.4;
      node.setAttribute(
        'd',
        `M ${cx - r} ${cy - w} H ${cx - w} V ${cy - r} H ${cx + w} V ${cy - w} H ${cx + r} V ${cy + w} H ${cx + w} V ${cy + r} H ${cx - w} V ${cy + w} H ${cx - r} Z`
      );
    } else if (shape === 'star') {
      node = document.createElementNS(ORD_SVG_NS, 'polygon');
      const points = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.45;
        points.push(`${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`);
      }
      node.setAttribute('points', points.join(' '));
    } else {
      node = document.createElementNS(ORD_SVG_NS, 'circle');
      node.setAttribute('cx', cx);
      node.setAttribute('cy', cy);
      node.setAttribute('r', r);
    }
    node.setAttribute('fill', fill);
    node.setAttribute('stroke', 'var(--panel)');
    node.setAttribute('stroke-width', '1');
    svg.appendChild(node);
    return node;
  }

  /**
   * @param {HTMLElement} container
   * @param {{points: Array<{sampleId:string,x:number,y:number,shapeIndex:number,color:string,tooltip?:string}>,
   *   xLabel:string, yLabel:string,
   *   shapeLegend?: Array<{label:string,shapeIndex:number}>,
   *   colorLegend?: {kind:'categorical',items:Array<{label:string,color:string}>} | {kind:'numeric',min:number,max:number,label:string,colorFn:(v:number)=>string} | null}} spec
   */
  function renderOrdinationSVG(container, spec) {
    const { points, xLabel, yLabel, shapeLegend = [], colorLegend = null, width = 560, pointRadius = 6 } = spec;

    container.innerHTML = '';
    const padding = { top: 20, right: 30, bottom: 46, left: 55 };
    const plotHeight = 360;
    const shapeLegendRows = shapeLegend.length ? Math.ceil(shapeLegend.length / 4) : 0;
    const legendHeight = shapeLegendRows * 18 + (colorLegend ? 40 : 0) + (shapeLegend.length || colorLegend ? 10 : 0);
    const height = padding.top + plotHeight + padding.bottom + legendHeight;

    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs, -0.01);
    const xMax = Math.max(...xs, 0.01);
    const yMin = Math.min(...ys, -0.01);
    const yMax = Math.max(...ys, 0.01);
    const xPad = (xMax - xMin) * 0.12 || 1;
    const yPad = (yMax - yMin) * 0.12 || 1;
    const xLo = xMin - xPad;
    const xHi = xMax + xPad;
    const yLo = yMin - yPad;
    const yHi = yMax + yPad;
    const plotWidth = width - padding.left - padding.right;
    const xScale = (v) => padding.left + ((v - xLo) / (xHi - xLo)) * plotWidth;
    const yScale = (v) => padding.top + plotHeight - ((v - yLo) / (yHi - yLo)) * plotHeight;

    const svg = document.createElementNS(ORD_SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);

    // Zero reference lines (PCoA axes are centred on zero by construction).
    [
      [xScale(0), padding.top, xScale(0), padding.top + plotHeight],
      [padding.left, yScale(0), padding.left + plotWidth, yScale(0)],
    ].forEach(([x1, y1, x2, y2]) => {
      const line = document.createElementNS(ORD_SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', 'var(--line)');
      line.setAttribute('stroke-dasharray', '2,2');
      svg.appendChild(line);
    });

    const axisBox = document.createElementNS(ORD_SVG_NS, 'rect');
    axisBox.setAttribute('x', padding.left);
    axisBox.setAttribute('y', padding.top);
    axisBox.setAttribute('width', plotWidth);
    axisBox.setAttribute('height', plotHeight);
    axisBox.setAttribute('fill', 'none');
    axisBox.setAttribute('stroke', 'var(--line)');
    svg.appendChild(axisBox);

    const xLabelEl = document.createElementNS(ORD_SVG_NS, 'text');
    xLabelEl.setAttribute('x', padding.left + plotWidth / 2);
    xLabelEl.setAttribute('y', padding.top + plotHeight + 30);
    xLabelEl.setAttribute('text-anchor', 'middle');
    xLabelEl.setAttribute('font-size', '11');
    xLabelEl.setAttribute('fill', 'var(--text)');
    xLabelEl.textContent = xLabel;
    svg.appendChild(xLabelEl);

    const yLabelEl = document.createElementNS(ORD_SVG_NS, 'text');
    yLabelEl.setAttribute('x', -(padding.top + plotHeight / 2));
    yLabelEl.setAttribute('y', 14);
    yLabelEl.setAttribute('text-anchor', 'middle');
    yLabelEl.setAttribute('font-size', '11');
    yLabelEl.setAttribute('fill', 'var(--text)');
    yLabelEl.setAttribute('transform', 'rotate(-90)');
    yLabelEl.textContent = yLabel;
    svg.appendChild(yLabelEl);

    points.forEach((p) => {
      const node = appendShape(svg, p.shapeIndex || 0, xScale(p.x), yScale(p.y), pointRadius, p.color || 'var(--accent)');
      const title = document.createElementNS(ORD_SVG_NS, 'title');
      title.textContent = p.tooltip || p.sampleId;
      node.appendChild(title);
    });

    let legendY = padding.top + plotHeight + padding.bottom - 8;
    if (shapeLegend.length) {
      let lx = padding.left;
      shapeLegend.forEach((item, i) => {
        if (i > 0 && i % 4 === 0) {
          lx = padding.left;
          legendY += 18;
        }
        appendShape(svg, item.shapeIndex, lx + 6, legendY + 5, 6, item.color || 'var(--muted)');
        const text = document.createElementNS(ORD_SVG_NS, 'text');
        text.setAttribute('x', lx + 16);
        text.setAttribute('y', legendY + 9);
        text.setAttribute('font-size', '10');
        text.setAttribute('fill', 'var(--text)');
        text.textContent = item.label;
        svg.appendChild(text);
        lx += 16 + item.label.length * 6 + 14;
      });
      legendY += 22;
    }

    if (colorLegend && colorLegend.kind === 'categorical') {
      let lx = padding.left;
      colorLegend.items.forEach((item) => {
        const swatch = document.createElementNS(ORD_SVG_NS, 'rect');
        swatch.setAttribute('x', lx);
        swatch.setAttribute('y', legendY);
        swatch.setAttribute('width', 8);
        swatch.setAttribute('height', 8);
        swatch.setAttribute('fill', item.color);
        svg.appendChild(swatch);
        const text = document.createElementNS(ORD_SVG_NS, 'text');
        text.setAttribute('x', lx + 11);
        text.setAttribute('y', legendY + 8);
        text.setAttribute('font-size', '10');
        text.setAttribute('fill', 'var(--text)');
        text.textContent = item.label;
        svg.appendChild(text);
        lx += 16 + item.label.length * 6 + 12;
      });
    } else if (colorLegend && colorLegend.kind === 'numeric') {
      const gradId = `ord-grad-${Math.random().toString(36).slice(2)}`;
      const defs = document.createElementNS(ORD_SVG_NS, 'defs');
      const grad = document.createElementNS(ORD_SVG_NS, 'linearGradient');
      grad.setAttribute('id', gradId);
      const stops = 8;
      for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        const stop = document.createElementNS(ORD_SVG_NS, 'stop');
        stop.setAttribute('offset', `${t * 100}%`);
        stop.setAttribute('stop-color', colorLegend.colorFn(colorLegend.min + t * (colorLegend.max - colorLegend.min)));
        grad.appendChild(stop);
      }
      defs.appendChild(grad);
      svg.appendChild(defs);

      const bar = document.createElementNS(ORD_SVG_NS, 'rect');
      bar.setAttribute('x', padding.left);
      bar.setAttribute('y', legendY);
      bar.setAttribute('width', 120);
      bar.setAttribute('height', 10);
      bar.setAttribute('fill', `url(#${gradId})`);
      svg.appendChild(bar);

      const minText = document.createElementNS(ORD_SVG_NS, 'text');
      minText.setAttribute('x', padding.left);
      minText.setAttribute('y', legendY + 22);
      minText.setAttribute('font-size', '9');
      minText.setAttribute('fill', 'var(--text)');
      minText.textContent = colorLegend.min.toFixed(2);
      svg.appendChild(minText);

      const maxText = document.createElementNS(ORD_SVG_NS, 'text');
      maxText.setAttribute('x', padding.left + 120);
      maxText.setAttribute('y', legendY + 22);
      maxText.setAttribute('text-anchor', 'end');
      maxText.setAttribute('font-size', '9');
      maxText.setAttribute('fill', 'var(--text)');
      maxText.textContent = colorLegend.max.toFixed(2);
      svg.appendChild(maxText);

      const label = document.createElementNS(ORD_SVG_NS, 'text');
      label.setAttribute('x', padding.left + 130);
      label.setAttribute('y', legendY + 9);
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'var(--text)');
      label.textContent = colorLegend.label || '';
      svg.appendChild(label);
    }

    container.appendChild(svg);
  }

  const ordinationPlotExports = { renderOrdinationSVG, SHAPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = ordinationPlotExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.ordinationPlot = ordinationPlotExports;
  }
})();
