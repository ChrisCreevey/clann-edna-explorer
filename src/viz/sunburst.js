(function () {
  'use strict';

// Krona-style zoomable sunburst: pure layout math (testable in Node) plus
// an SVG renderer (DOM-only). No external Krona/charting dependency.

/**
 * Lay out one ring per depth level below `focus`, each child's angular
 * span proportional to its cladeReads share of its parent's cladeReads.
 * Returns a flat array of segments ready to draw as SVG donut-slice paths.
 *
 * @param {object} focus - hierarchy node (see hierarchy.js) to center on
 * @param {{maxDepth?: number, minAnglePct?: number}} [options]
 */
function computeSunburstSegments(focus, options = {}) {
  const maxDepth = options.maxDepth ?? 6;
  const minAnglePct = options.minAnglePct ?? 0.002; // hide slivers below 0.2%

  const segments = [];

  function recurse(node, depth, angleStart, angleEnd, parentTotal) {
    if (depth > 0) {
      segments.push({ node, depth, angleStart, angleEnd });
    }
    if (depth >= maxDepth) return;
    const total = node.cladeReads || 0;
    if (total <= 0 || node.children.length === 0) return;

    let cursor = angleStart;
    const span = angleEnd - angleStart;
    for (const child of node.children) {
      const fraction = child.cladeReads / total;
      if (fraction < minAnglePct) continue;
      const childSpan = span * fraction;
      recurse(child, depth + 1, cursor, cursor + childSpan, total);
      cursor += childSpan;
    }
  }

  recurse(focus, 0, 0, 2 * Math.PI, focus.cladeReads);
  return segments;
}

// ---- SVG rendering (DOM only) -----------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function arcPath(cx, cy, innerR, outerR, angleStart, angleEnd) {
  const full = angleEnd - angleStart >= 2 * Math.PI - 1e-6;
  if (full) angleEnd = angleStart + 2 * Math.PI - 1e-4; // avoid degenerate full-circle arc flag issues

  const point = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x0, y0] = point(outerR, angleStart);
  const [x1, y1] = point(outerR, angleEnd);
  const [x2, y2] = point(innerR, angleEnd);
  const [x3, y3] = point(innerR, angleStart);
  const largeArc = angleEnd - angleStart > Math.PI ? 1 : 0;

  return [
    `M ${x0} ${y0}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function colorForSunburstSeed(seed) {
  let hash = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

/**
 * Renders a zoomable sunburst into `container`. Clicking a segment zooms in
 * (re-centres on that node); clicking the center circle zooms out one
 * level. `onFocusChange(focusNode)` is called whenever focus changes, so
 * the caller can update a breadcrumb / other linked views.
 */
function renderSunburstSVG(container, root, options = {}) {
  const size = options.size ?? 480;
  const ringWidth = options.ringWidth ?? 32;
  const cx = size / 2;
  const cy = size / 2;
  const centerR = options.centerR ?? 28;

  let focus = options.initialFocus || root;

  function draw() {
    container.innerHTML = '';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', size);

    const segments = computeSunburstSegments(focus, { maxDepth: options.maxDepth ?? 6 });

    segments.forEach((seg) => {
      const innerR = centerR + (seg.depth - 1) * ringWidth;
      const outerR = innerR + ringWidth;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', arcPath(cx, cy, innerR, outerR, seg.angleStart, seg.angleEnd));
      path.setAttribute('fill', colorForSunburstSeed(seg.node.taxid));
      path.setAttribute('stroke', 'var(--bg)');
      path.setAttribute('stroke-width', '0.5');
      path.style.cursor = seg.node.children.length > 0 ? 'pointer' : 'default';

      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${seg.node.name} (${seg.node.rank}) — ${seg.node.cladeReads.toLocaleString()} reads, ${seg.node.pctOfTotal.toFixed(2)}%`;
      path.appendChild(title);

      if (seg.node.children.length > 0) {
        path.addEventListener('click', () => {
          focus = seg.node;
          draw();
          if (options.onFocusChange) options.onFocusChange(focus);
        });
      }
      svg.appendChild(path);
    });

    // Center circle: shows current focus name, click to zoom out.
    const center = document.createElementNS(SVG_NS, 'circle');
    center.setAttribute('cx', cx);
    center.setAttribute('cy', cy);
    center.setAttribute('r', centerR);
    center.setAttribute('fill', 'var(--bg-alt)');
    center.setAttribute('stroke', 'var(--border)');
    if (focus.parent) {
      center.style.cursor = 'pointer';
      center.addEventListener('click', () => {
        focus = focus.parent;
        draw();
        if (options.onFocusChange) options.onFocusChange(focus);
      });
    }
    svg.appendChild(center);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', cy);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', 'var(--text)');
    label.style.pointerEvents = 'none';
    label.textContent = focus.depth <= 0 ? 'root' : focus.name;
    svg.appendChild(label);

    container.appendChild(svg);
  }

  draw();
  return {
    zoomTo(node) {
      focus = node;
      draw();
    },
  };
}

const sunburstExports = { computeSunburstSegments, renderSunburstSVG, colorForSunburstSeed };
if (typeof module !== 'undefined' && module.exports) module.exports = sunburstExports;
if (typeof window !== 'undefined') {
  window.ClannEDNA = window.ClannEDNA || {};
  window.ClannEDNA.sunburst = sunburstExports;
}
})();
