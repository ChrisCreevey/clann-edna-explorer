// Generic taxa/sample x sample grid heatmap — shared by the abundance
// heatmap, presence/absence matrix, and sample-similarity matrix, since
// all three are "rows x columns, cell colour by value" with only the
// data and colour scale differing. Native SVG, no external charting
// dependency. Zoom/pan is intentionally out of scope for v1 — the grid
// scrolls inside a capped-height .scroll-panel like every other long list
// in this app (see styles/main.css); true SVG pan/zoom is a stretch goal
// noted in PLAN.md, not a v1 commitment.

(function () {
  'use strict';

  const HEATMAP_SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * Sequential colour scale: low values are pale, high values are a
   * saturated accent hue. Visible against both light and dark panel
   * backgrounds since lightness (not hue) carries the signal.
   */
  function sequentialColor(value, min, max, { hue = 152 } = {}) {
    if (max <= min) return `hsl(${hue}, 45%, 88%)`;
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const lightness = 88 - t * 55; // 88% (pale) -> 33% (saturated dark)
    return `hsl(${hue}, 55%, ${lightness}%)`;
  }

  function binaryColor(value) {
    return value ? 'hsl(152, 55%, 40%)' : 'hsl(0, 0%, 88%)';
  }

  /**
   * @param {HTMLElement} container
   * @param {{
   *   rowLabels: string[],
   *   colLabels: string[],
   *   matrix: number[][],           // matrix[row][col]
   *   colorFn?: (value:number, min:number, max:number) => string,
   *   colGroupColors?: string[],    // one CSS colour per column, for a group strip
   *   cellWidth?: number,
   *   cellHeight?: number,
   *   labelWidth?: number,
   *   showValues?: boolean,
   *   isRowHighlighted?: (label: string) => boolean,
   * }} spec
   */
  function renderHeatmapSVG(container, spec) {
    const {
      rowLabels,
      colLabels,
      matrix,
      colorFn = sequentialColor,
      colGroupColors = null,
      cellWidth = 28,
      cellHeight = 18,
      labelWidth: labelWidthOption,
      showValues = false,
      isRowHighlighted = null,
      tagForRow = null,
      colorForCategory = null,
    } = spec;

    container.innerHTML = '';

    let min = Infinity;
    let max = -Infinity;
    matrix.forEach((row) => row.forEach((v) => {
      if (v < min) min = v;
      if (v > max) max = v;
    }));
    if (!Number.isFinite(min)) { min = 0; max = 0; }

    // Font is 10px; ~6px/char is a safe monospace-ish upper bound for
    // proportional text at this size, used to size margins from the
    // actual label text so long "sample (group)" labels aren't clipped.
    const CHAR_WIDTH = 6;
    const longestRowLabelLen = rowLabels.reduce((max, l) => Math.max(max, l.length), 0);
    const labelWidth = labelWidthOption ?? Math.max(60, longestRowLabelLen * CHAR_WIDTH + 16);

    const groupStripHeight = colGroupColors ? 8 : 0;
    // The rightmost column's rotated label extends further right than the
    // grid itself (rotate(-60) around the top of the last column), so pad
    // the canvas width by the longest label's projected horizontal extent
    // to keep it from being clipped at the top-right edge. The same
    // rotated extent, projected vertically, sizes the header height so
    // long labels aren't clipped at the top either.
    const longestColLabelLen = colLabels.reduce((max, l) => Math.max(max, l.length), 0);
    const rotatedLabelLen = longestColLabelLen * CHAR_WIDTH;
    const rightPad = Math.ceil(rotatedLabelLen * Math.cos((60 * Math.PI) / 180)) + 8;
    const headerHeight = Math.max(50, Math.ceil(rotatedLabelLen * Math.sin((60 * Math.PI) / 180)) + 12);
    const width = labelWidth + colLabels.length * cellWidth + rightPad;
    const height = headerHeight + groupStripHeight + rowLabels.length * cellHeight + 4;

    const svg = document.createElementNS(HEATMAP_SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Column labels (rotated)
    colLabels.forEach((label, c) => {
      const x = labelWidth + c * cellWidth + cellWidth / 2;
      const text = document.createElementNS(HEATMAP_SVG_NS, 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', headerHeight - 4);
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', 'var(--text)');
      text.setAttribute('text-anchor', 'start');
      text.setAttribute('transform', `rotate(-60 ${x} ${headerHeight - 4})`);
      text.textContent = label;
      svg.appendChild(text);
    });

    // Group colour strip
    if (colGroupColors) {
      colLabels.forEach((_, c) => {
        const rect = document.createElementNS(HEATMAP_SVG_NS, 'rect');
        rect.setAttribute('x', labelWidth + c * cellWidth);
        rect.setAttribute('y', headerHeight);
        rect.setAttribute('width', cellWidth - 1);
        rect.setAttribute('height', groupStripHeight);
        rect.setAttribute('fill', colGroupColors[c] || 'transparent');
        svg.appendChild(rect);
      });
    }

    // Rows
    rowLabels.forEach((label, r) => {
      const y = headerHeight + groupStripHeight + r * cellHeight;

      const highlighted = isRowHighlighted && isRowHighlighted(label);
      const category = tagForRow && tagForRow(label);

      const rowLabelText = document.createElementNS(HEATMAP_SVG_NS, 'text');
      rowLabelText.setAttribute('x', labelWidth - 6);
      rowLabelText.setAttribute('y', y + cellHeight / 2 + 3);
      rowLabelText.setAttribute('font-size', '10');
      rowLabelText.setAttribute('fill', highlighted ? 'var(--accent)' : category ? colorForCategory(category) : 'var(--text)');
      rowLabelText.setAttribute('font-weight', highlighted || category ? 'bold' : 'normal');
      rowLabelText.setAttribute('text-anchor', 'end');
      rowLabelText.textContent = label;
      if (category) {
        const titleEl = document.createElementNS(HEATMAP_SVG_NS, 'title');
        titleEl.textContent = category;
        rowLabelText.appendChild(titleEl);
      }
      svg.appendChild(rowLabelText);

      matrix[r].forEach((value, c) => {
        const rect = document.createElementNS(HEATMAP_SVG_NS, 'rect');
        rect.setAttribute('x', labelWidth + c * cellWidth);
        rect.setAttribute('y', y);
        rect.setAttribute('width', cellWidth - 1);
        rect.setAttribute('height', cellHeight - 1);
        rect.setAttribute('fill', colorFn(value, min, max));
        if (highlighted) {
          rect.setAttribute('stroke', 'var(--accent)');
          rect.setAttribute('stroke-width', '2');
        }
        const title = document.createElementNS(HEATMAP_SVG_NS, 'title');
        title.textContent = `${label} × ${colLabels[c]}: ${Number.isInteger(value) ? value : value.toFixed(3)}`;
        rect.appendChild(title);
        svg.appendChild(rect);

        if (showValues && cellWidth >= 22) {
          const valueText = document.createElementNS(HEATMAP_SVG_NS, 'text');
          valueText.setAttribute('x', labelWidth + c * cellWidth + cellWidth / 2);
          valueText.setAttribute('y', y + cellHeight / 2 + 3);
          valueText.setAttribute('font-size', '8');
          valueText.setAttribute('text-anchor', 'middle');
          valueText.setAttribute('fill', '#111');
          valueText.style.pointerEvents = 'none';
          valueText.textContent = Number.isInteger(value) ? value : value.toFixed(2);
          svg.appendChild(valueText);
        }
      });
    });

    container.appendChild(svg);
  }

  const heatmapExports = { renderHeatmapSVG, sequentialColor, binaryColor };
  if (typeof module !== 'undefined' && module.exports) module.exports = heatmapExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.heatmap = heatmapExports;
  }
})();
