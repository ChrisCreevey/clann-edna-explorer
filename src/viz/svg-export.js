// Shared "export this diagram" utility for every SVG-based view (sunburst,
// Sankey, heatmaps, stacked bar) — brief: "Export any diagram (Sankey,
// sunburst, heatmap) as PNG or SVG".
//
// Every renderer in this app sets colours as CSS custom properties
// (fill="var(--accent)", etc) so the diagram re-themes live with the
// light/dark toggle. That's exactly what makes a *saved* SVG file broken
// on its own: var(--accent) only resolves inside this page's DOM, where
// :root defines it. Opened standalone (double-clicked, dropped into
// another app), there's nothing to resolve it against. So export doesn't
// just serialize the live <svg> — it walks a clone and bakes every
// var(...) reference into the concrete resolved colour first, using
// getComputedStyle on the *live* element (which does the resolution for
// us), so the exported file looks identical wherever it's opened next.

(function () {
  'use strict';

  const COLOR_ATTRS = ['fill', 'stroke', 'color', 'stop-color'];

  /**
   * Recursively bakes resolved colours from `liveEl` onto `cloneEl` for
   * every attribute in COLOR_ATTRS that references a CSS custom property.
   * `liveEl` and `cloneEl` must be structurally identical (clone was made
   * with cloneNode(true) from liveEl) so they can be walked in lockstep.
   */
  function bakeComputedColors(liveEl, cloneEl) {
    if (liveEl.nodeType !== 1) return; // element nodes only
    const computed = window.getComputedStyle(liveEl);
    COLOR_ATTRS.forEach((attr) => {
      const raw = liveEl.getAttribute(attr);
      if (raw && raw.includes('var(')) {
        const cssProp = attr === 'stop-color' ? 'color' : attr;
        const resolved = computed[cssProp] || computed.getPropertyValue(cssProp);
        if (resolved) cloneEl.setAttribute(attr, resolved);
      }
    });
    const liveChildren = liveEl.children;
    const cloneChildren = cloneEl.children;
    for (let i = 0; i < liveChildren.length; i++) {
      bakeComputedColors(liveChildren[i], cloneChildren[i]);
    }
  }

  /**
   * Produces a portable, self-contained SVG string from a live <svg>
   * element: resolved colours baked in, explicit width/height (falling
   * back to the viewBox size so the file isn't 100%-sized to nothing when
   * opened outside a flex/grid container), an opaque background rect
   * matching the page's current --bg so it isn't invisible on a white
   * background, and the XML namespace declared for standalone use.
   */
  function serializeSvgForExport(svgEl) {
    const clone = svgEl.cloneNode(true);
    bakeComputedColors(svgEl, clone);

    const viewBox = svgEl.getAttribute('viewBox');
    const [, , vbWidth, vbHeight] = viewBox ? viewBox.split(/\s+/).map(Number) : [0, 0, svgEl.clientWidth, svgEl.clientHeight];
    clone.setAttribute('width', vbWidth);
    clone.setAttribute('height', vbHeight);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

    const bg = window.getComputedStyle(document.body).getPropertyValue('--bg') || getComputedStyle(document.documentElement).backgroundColor;
    const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bgRect.setAttribute('x', '0');
    bgRect.setAttribute('y', '0');
    bgRect.setAttribute('width', String(vbWidth));
    bgRect.setAttribute('height', String(vbHeight));
    bgRect.setAttribute('fill', bg.trim() || '#ffffff');
    clone.insertBefore(bgRect, clone.firstChild);

    return { text: new XMLSerializer().serializeToString(clone), width: vbWidth, height: vbHeight };
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadSvgAsFile(svgEl, filename) {
    const { text } = serializeSvgForExport(svgEl);
    triggerDownload(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), filename);
  }

  /**
   * Rasterizes via an offscreen <canvas> at `scale`x the SVG's own pixel
   * size (2x by default — sharp enough for a slide or a report without
   * producing an unreasonably large file for what's usually a fairly
   * simple diagram).
   */
  function downloadSvgAsPng(svgEl, filename, scale = 2) {
    const { text, width, height } = serializeSvgForExport(svgEl);
    const svgBlob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) triggerDownload(blob, filename);
      }, 'image/png');
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  /**
   * Convenience: builds a small "SVG | PNG" button pair for a given
   * container's <svg> child, looked up at click time so it always exports
   * whatever is currently rendered (diagrams redraw in place on filter/
   * rank changes).
   */
  function createExportButtons(getContainer, baseFilename) {
    const wrap = document.createElement('div');
    wrap.className = 'diagram-export-row';
    const makeBtn = (label, handler) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        const svg = getContainer().querySelector('svg');
        if (svg) handler(svg);
      });
      return btn;
    };
    wrap.appendChild(makeBtn('Export SVG', (svg) => downloadSvgAsFile(svg, `${baseFilename}.svg`)));
    wrap.appendChild(makeBtn('Export PNG', (svg) => downloadSvgAsPng(svg, `${baseFilename}.png`)));
    return wrap;
  }

  const svgExportExports = { downloadSvgAsFile, downloadSvgAsPng, createExportButtons, serializeSvgForExport };
  if (typeof module !== 'undefined' && module.exports) module.exports = svgExportExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.svgExport = svgExportExports;
  }
})();
