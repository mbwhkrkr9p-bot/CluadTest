/*
 * foam.js — a solid foam chuck-glider carved as ONE watertight mesh.
 *
 * The glider is described as a signed-distance field: a body-of-revolution fuselage,
 * a wing lofted from a NACA 4-digit section (taper, sweep, dihedral, incidence), a
 * tailplane and a fin, joined with a smooth union so the roots blend like moulded foam.
 * The surface is then extracted on a rectilinear grid with the surface-nets algorithm,
 * which produces a closed, connected mesh by construction. Grid spacing is the
 * resolution control: finer grids follow the airfoil and the fillets more closely.
 */
(function (root) {
  const isNode = typeof module === 'object' && module.exports;
  const A = isNode ? require('./aero.js') : root.AERO;
  const O = isNode ? require('./objects.js') : root.OBJECTS;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- airfoil section
  /** NACA 4-digit outline (unit chord), as a closed polygon: TE → upper → LE → lower → TE. */
  function nacaPolygon(m, p, t, n = 26) {
    const pts = [];
    const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const camber = (x) => {
      if (m === 0) return [0, 0];
      if (x < p) return [m / (p * p) * (2 * p * x - x * x), 2 * m / (p * p) * (p - x)];
      return [m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x), 2 * m / ((1 - p) ** 2) * (p - x)];
    };
    const station = (i) => 0.5 * (1 - Math.cos(Math.PI * i / n));   // cosine spacing, dense at the nose
    for (let i = n; i >= 0; i--) { const x = station(i), [yc, dy] = camber(x), th = Math.atan(dy), h = yt(x); pts.push([x - h * Math.sin(th), yc + h * Math.cos(th)]); }
    for (let i = 1; i <= n; i++) { const x = station(i), [yc, dy] = camber(x), th = Math.atan(dy), h = yt(x); pts.push([x + h * Math.sin(th), yc - h * Math.cos(th)]); }
    return pts;
  }
  /** Signed distance from (x, y) to a closed polygon: negative inside. */
  function sdPolygon(poly, x, y) {
    let d = Infinity, inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[j];
      const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
      const tt = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1e-12)));
      const dx = wx - ex * tt, dy = wy - ey * tt;
      const dd = dx * dx + dy * dy; if (dd < d) d = dd;
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * ex / ey) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(d);
  }

  // ---------------------------------------------------------------- components
  /**
   * Lifting surface lofted along the span (mirrored about z = 0).
   *   span, rootChord, tipChord, sweepDeg (of the quarter-chord line), dihedralDeg, incidenceDeg,
   *   x (quarter chord at the root), y (root height), section [m, p, t], vertical (fin: spans +y from y)
   */
  function surfaceSDF(o) {
    const poly = nacaPolygon(o.section[0], o.section[1], o.section[2]);
    const half = o.vertical ? o.span : o.span / 2;
    const tanS = Math.tan((o.sweepDeg || 0) * DEG);
    const cd = Math.cos((o.dihedralDeg || 0) * DEG), sd = Math.sin((o.dihedralDeg || 0) * DEG);
    const ci = Math.cos((o.incidenceDeg || 0) * DEG), si = Math.sin((o.incidenceDeg || 0) * DEG);
    const maxC = Math.max(o.rootChord, o.tipChord);
    // bounding box for early-out
    const bb = o.vertical
      ? { x0: o.x - maxC - half * Math.abs(tanS), x1: o.x + maxC, y0: o.y - maxC * 0.2, y1: o.y + half + maxC * 0.2, z0: -maxC * 0.3, z1: maxC * 0.3 }
      : { x0: o.x - maxC - half * Math.abs(tanS), x1: o.x + maxC, y0: o.y - maxC * 0.3 - half * Math.abs(sd), y1: o.y + maxC * 0.3 + half * Math.abs(sd), z0: -half, z1: half };
    return {
      bb,
      f(x, y, z) {
        let s, h;                       // s: spanwise station, h: normal-to-plane offset
        if (o.vertical) { s = y - o.y; h = z; }
        else { const za = Math.abs(z), yr = y - o.y; s = za * cd + yr * sd; h = yr * cd - za * sd; }
        const f = Math.max(0, Math.min(1, s / half));
        const c = o.rootChord + (o.tipChord - o.rootChord) * f;
        const xqc = o.x - s * tanS;
        // section frame: chordwise from the leading edge, incidence rotation about the quarter chord
        let dx = x - xqc, dh = h;
        const xr = dx * ci + dh * si, hr = -dx * si + dh * ci;
        const xi = 0.25 - xr / c, eta = hr / c;
        const d2 = sdPolygon(poly, xi, eta) * c;
        // spanwise caps: root at s = 0 is left open (it continues into the other half / the body)
        const dsOut = s - half;
        const dIn = o.vertical ? -s : -1;      // fin has a root plane at its base (inside the fuselage anyway)
        const cap = Math.max(dsOut, dIn);
        return cap > 0 ? Math.sqrt(Math.max(d2, 0) ** 2 + cap * cap) : Math.max(d2, cap);
      },
    };
  }
  /** Fuselage: body of revolution about the x axis, nose at x1, tail at x0. */
  function fuselageSDF(o) {
    const { x0, x1, radius, y = 0 } = o;
    const L = x1 - x0, xc = (x0 + x1) / 2;
    const r = (x) => {
      const u = (x - xc) / (L / 2);                         // -1 tail … +1 nose
      if (Math.abs(u) >= 1) return 0;
      const nose = Math.sqrt(1 - Math.pow(Math.max(0, u), 3));           // blunt rounded nose
      const tail = Math.pow(1 - Math.pow(Math.max(0, -u), 1.6), 0.75);   // long taper to the tail
      return radius * Math.min(nose, tail) * (0.55 + 0.45 * (u + 1) / 2);
    };
    return {
      bb: { x0: x0 - 0.01, x1: x1 + 0.01, y0: y - radius - 0.01, y1: y + radius + 0.01, z0: -radius - 0.01, z1: radius + 0.01 },
      f(x, yy, z) {
        const rho = Math.hypot(yy - y, z);
        if (x <= x0 || x >= x1) return Math.hypot(rho, Math.max(x0 - x, x - x1));
        return rho - r(x);
      },
    };
  }
  const smin = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k)); return (b + (a - b) * h) - k * h * (1 - h); };

  // ---------------------------------------------------------------- the foam glider
  const FOAM_DEFAULT = {
    span: 0.60, rootChord: 0.11, tipChord: 0.07, sweep: 4, dihedral: 5, incidence: 2, wingX: 0.06, wingY: 0.008,
    section: [0.04, 0.4, 0.12],                  // NACA 4412-ish: cambered, 12% thick — foam needs the thickness
    fuseX0: -0.27, fuseX1: 0.30, fuseR: 0.021,
    tailSpan: 0.24, tailChord: 0.07, tailX: -0.21, tailInc: 0, tailSection: [0, 0, 0.12],
    finHeight: 0.085, finRootChord: 0.075, finTipChord: 0.045, finX: -0.215, finSection: [0, 0, 0.11],
    fillet: 0.012,
  };
  function foamSDF(p) {
    const parts = [
      fuselageSDF({ x0: p.fuseX0, x1: p.fuseX1, radius: p.fuseR }),
      surfaceSDF({ span: p.span, rootChord: p.rootChord, tipChord: p.tipChord, sweepDeg: p.sweep, dihedralDeg: p.dihedral, incidenceDeg: p.incidence, x: p.wingX, y: p.wingY, section: p.section }),
      surfaceSDF({ span: p.tailSpan, rootChord: p.tailChord, tipChord: p.tailChord * 0.8, sweepDeg: 6, dihedralDeg: 0, incidenceDeg: p.tailInc, x: p.tailX, y: 0.004, section: p.tailSection }),
      surfaceSDF({ vertical: true, span: p.finHeight, rootChord: p.finRootChord, tipChord: p.finTipChord, sweepDeg: 25, x: p.finX, y: 0.0, section: p.finSection }),
    ];
    const k = p.fillet;
    const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const c of parts) { bb.x0 = Math.min(bb.x0, c.bb.x0); bb.x1 = Math.max(bb.x1, c.bb.x1); bb.y0 = Math.min(bb.y0, c.bb.y0); bb.y1 = Math.max(bb.y1, c.bb.y1); bb.z0 = Math.min(bb.z0, c.bb.z0); bb.z1 = Math.max(bb.z1, c.bb.z1); }
    return {
      bb,
      f(x, y, z) {
        let d = Infinity;
        for (const c of parts) {
          const b = c.bb;
          // cheap bound: distance to the component's box; skip if it cannot matter
          const ex = Math.max(b.x0 - x, 0, x - b.x1), ey = Math.max(b.y0 - y, 0, y - b.y1), ez = Math.max(b.z0 - z, 0, z - b.z1);
          const far = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (far > d + k) continue;
          const v = far > k ? far : c.f(x, y, z);
          d = d === Infinity ? v : smin(d, v, k);
        }
        return d;
      },
    };
  }

  // ---------------------------------------------------------------- surface nets on a rectilinear grid
  /**
   * Extract the zero level set of f on a grid with axis coordinate arrays xs, ys, zs.
   * One vertex per sign-changing cell (mean of its edge crossings); one quad per
   * sign-changing grid edge, oriented outward. Closed and connected by construction.
   */
  function surfaceNets(f, xs, ys, zs) {
    const nx = xs.length, ny = ys.length, nz = zs.length;
    const val = new Float32Array(nx * ny * nz);
    const id = (i, j, k) => (i * ny + j) * nz + k;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) val[id(i, j, k)] = f(xs[i], ys[j], zs[k]);
    const cnx = nx - 1, cny = ny - 1, cnz = nz - 1;
    const cellV = new Int32Array(cnx * cny * cnz).fill(-1);
    const cid = (i, j, k) => (i * cny + j) * cnz + k;
    const pos = [];
    // cube edges: pairs of corner indices; corner bits (x, y, z)
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cv = new Float32Array(8);
    for (let i = 0; i < cnx; i++) for (let j = 0; j < cny; j++) for (let k = 0; k < cnz; k++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = val[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; cv[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const [a, b] of edges) {
        if ((cv[a] < 0) === (cv[b] < 0)) continue;
        const t = cv[a] / (cv[a] - cv[b]);
        const ca = corners[a], cb = corners[b];
        sx += xs[i + ca[0]] + (xs[i + cb[0]] - xs[i + ca[0]]) * t;
        sy += ys[j + ca[1]] + (ys[j + cb[1]] - ys[j + ca[1]]) * t;
        sz += zs[k + ca[2]] + (zs[k + cb[2]] - zs[k + ca[2]]) * t;
        n++;
      }
      cellV[cid(i, j, k)] = pos.length / 3;
      pos.push(sx / n, sy / n, sz / n);
    }
    const idx = [];
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    };
    // edges along x at grid point (i,j,k) → (i+1,j,k): cells (i, j-1|j, k-1|k)
    for (let i = 0; i < cnx; i++) for (let j = 1; j < cny; j++) for (let k = 1; k < cnz; k++) {
      const a = val[id(i, j, k)], b = val[id(i + 1, j, k)];
      if ((a < 0) === (b < 0)) continue;
      quad(cellV[cid(i, j - 1, k - 1)], cellV[cid(i, j, k - 1)], cellV[cid(i, j, k)], cellV[cid(i, j - 1, k)], !(a < 0));
    }
    // edges along y: cells (i-1|i, j, k-1|k); loop +z then +x
    for (let i = 1; i < cnx; i++) for (let j = 0; j < cny; j++) for (let k = 1; k < cnz; k++) {
      const a = val[id(i, j, k)], b = val[id(i, j + 1, k)];
      if ((a < 0) === (b < 0)) continue;
      quad(cellV[cid(i - 1, j, k - 1)], cellV[cid(i - 1, j, k)], cellV[cid(i, j, k)], cellV[cid(i, j, k - 1)], !(a < 0));
    }
    // edges along z: cells (i-1|i, j-1|j, k); loop +x then +y
    for (let i = 1; i < cnx; i++) for (let j = 1; j < cny; j++) for (let k = 0; k < cnz; k++) {
      const a = val[id(i, j, k)], b = val[id(i, j, k + 1)];
      if ((a < 0) === (b < 0)) continue;
      quad(cellV[cid(i - 1, j - 1, k)], cellV[cid(i, j - 1, k)], cellV[cid(i, j, k)], cellV[cid(i - 1, j, k)], !(a < 0));
    }
    return { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) };
  }

  /** Axis coordinates: spacing h, refined to hFine inside [a, b]. */
  function axis(lo, hi, h, fine) {
    const out = [lo]; let x = lo;
    while (x < hi) { const step = fine && x + h > fine.a && x < fine.b ? fine.h : h; x = Math.min(hi, x + step); out.push(x); }
    return out;
  }

  /** Build the foam glider mesh at a resolution level (0 coarse … 2 fine). */
  function foamGliderMesh(level = 0, params) {
    const p = Object.assign({}, FOAM_DEFAULT, params || {});
    const sdf = foamSDF(p);
    const hx = [0.010, 0.0075, 0.005][level], hy = [0.0045, 0.0035, 0.0025][level], hz = [0.010, 0.0075, 0.005][level];
    const fineZ = { a: -(p.fuseR + 0.02), b: p.fuseR + 0.02, h: hy };      // fine across the fuselage and fin
    const m = 0.015;
    const xs = axis(sdf.bb.x0 - m, sdf.bb.x1 + m, hx);
    const ys = axis(sdf.bb.y0 - m, sdf.bb.y1 + m, hy);
    const zs = axis(sdf.bb.z0 - m, sdf.bb.z1 + m, hz, fineZ);
    const mesh = surfaceNets(sdf.f, xs, ys, zs);
    mesh.grid = { nx: xs.length, ny: ys.length, nz: zs.length };
    return mesh;
  }

  // register as a mesh sample: base(res) builds at that grid level, no subdivision afterwards
  O.MESH_CATALOG.foam = {
    label: 'Foam glider (solid)', blurb: 'A moulded foam chuck glider as one watertight solid: NACA 4412 wing, thick tail and fin, blended into a round body. Resolution sets the carving grid.',
    size: 60, mass: 30, res: 0, airfoil: 0.85, ballast: 0, gridRes: true,
    base: (res) => foamGliderMesh(res || 0),
    launch: { speed: 5, pitch: 2, roll: 0, spin: 0 }, viewDist: 1.7, color: 0xF2F0EA, glider: true,
  };

  Object.assign(O, { foamGliderMesh, foamSDF, surfaceNets, nacaPolygon, FOAM_DEFAULT });
})(typeof self !== 'undefined' ? self : this);
