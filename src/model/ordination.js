// Classical MDS (Principal Coordinates Analysis) on a sample-similarity
// distance matrix (see src/model/similarity.js). PCoA operates directly on
// distances, so Bray-Curtis's implicit relative-abundance normalization
// already protects it from sampling-depth artifacts — no separate
// rarefaction/relative-abundance step is needed before calling this.
//
// Eigendecomposition of the (small, n = sample count) symmetric
// double-centered matrix uses the classic cyclic Jacobi rotation method:
// simple, numerically stable for symmetric matrices, and needs no
// external linear-algebra dependency, which matters since this project has
// none.

(function () {
  'use strict';

  /**
   * Eigendecomposition of a symmetric matrix via cyclic Jacobi rotation.
   * @param {number[][]} matrix symmetric n x n
   * @returns {{eigenvalues: number[], eigenvectors: number[][]}} eigenvectors[i] is the i-th eigenvector (length n), paired with eigenvalues[i]
   */
  function jacobiEigenDecomposition(matrix, maxIter) {
    const n = matrix.length;
    const a = matrix.map((row) => row.slice());
    const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    const iterCap = maxIter || Math.max(200, n * n * 30);
    const tol = 1e-12;

    for (let iter = 0; iter < iterCap; iter++) {
      let off = 0;
      let p = 0;
      let q = 1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(a[i][j]) > off) {
            off = Math.abs(a[i][j]);
            p = i;
            q = j;
          }
        }
      }
      if (off < tol) break;

      const app = a[p][p];
      const aqq = a[q][q];
      const apq = a[p][q];
      const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
      const c = Math.cos(phi);
      const s = Math.sin(phi);

      for (let i = 0; i < n; i++) {
        const aip = a[i][p];
        const aiq = a[i][q];
        a[i][p] = c * aip - s * aiq;
        a[i][q] = s * aip + c * aiq;
      }
      for (let i = 0; i < n; i++) {
        const api = a[p][i];
        const aqi = a[q][i];
        a[p][i] = c * api - s * aqi;
        a[q][i] = s * api + c * aqi;
      }
      for (let i = 0; i < n; i++) {
        const vip = v[i][p];
        const viq = v[i][q];
        v[i][p] = c * vip - s * viq;
        v[i][q] = s * vip + c * viq;
      }
    }

    const eigenvalues = a.map((row, i) => row[i]);
    const eigenvectors = Array.from({ length: n }, (_, i) => v.map((row) => row[i]));
    return { eigenvalues, eigenvectors };
  }

  /**
   * Classical MDS / Principal Coordinates Analysis on a distance matrix.
   * @param {number[][]} distanceMatrix symmetric n x n, 0 diagonal
   * @param {number} [k=2] number of ordination axes to return
   * @returns {{points: number[][], varianceExplained: number[], eigenvalues: number[]} | null}
   *   points[i] is the k-length coordinate vector for sample i (same order as the input matrix);
   *   varianceExplained[d] is the percentage of total positive eigenvalue mass axis d captures.
   *   Returns null when there are fewer than 3 samples (an ordination isn't meaningful below that).
   */
  function computePCoA(distanceMatrix, k = 2) {
    const n = distanceMatrix.length;
    if (n < 3) return null;

    const d2 = distanceMatrix.map((row) => row.map((v) => v * v));
    const rowMeans = d2.map((row) => row.reduce((s, v) => s + v, 0) / n);
    const grandMean = rowMeans.reduce((s, v) => s + v, 0) / n;
    const b = d2.map((row, i) => row.map((v, j) => -0.5 * (v - rowMeans[i] - rowMeans[j] + grandMean)));

    const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(b);
    const order = eigenvalues
      .map((_, i) => i)
      .sort((a, c) => eigenvalues[c] - eigenvalues[a]);
    const totalPositive = eigenvalues.filter((v) => v > 0).reduce((s, v) => s + v, 0) || 1;

    const axes = order.slice(0, k).map((idx) => {
      const value = eigenvalues[idx];
      const scale = value > 0 ? Math.sqrt(value) : 0;
      return { vector: eigenvectors[idx], scale, pct: (100 * Math.max(0, value)) / totalPositive };
    });

    const points = Array.from({ length: n }, (_, i) => axes.map((axis) => axis.vector[i] * axis.scale));
    return {
      points,
      varianceExplained: axes.map((axis) => axis.pct),
      eigenvalues: order.map((i) => eigenvalues[i]),
    };
  }

  const ordinationExports = { computePCoA, jacobiEigenDecomposition };
  if (typeof module !== 'undefined' && module.exports) module.exports = ordinationExports;
  if (typeof window !== 'undefined') {
    window.ClannEDNA = window.ClannEDNA || {};
    window.ClannEDNA.ordination = ordinationExports;
  }
})();
