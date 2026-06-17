import React, { useState, useMemo, useEffect, useRef, createContext, useContext } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceDot, ResponsiveContainer, Legend,
} from "recharts";
import {
  Flame, Droplets, Activity, GitBranch, Waves, BarChart3, Sparkles,
  Plus, Trash2, Settings2, Save, FolderOpen, FilePlus2, Gauge,
  AlertTriangle, CheckCircle2, X, Wrench, Send, Loader2, FileText,
  Building2, ClipboardList,
} from "lucide-react";

/* ============================================================
   EMBER — Fire Sprinkler Hydraulic Calculator  ·  DGA Consulting
   Hazen-Williams nodal network analysis (NFPA 13 methodology)
   Trees + gridded loops · US / metric · CMDA / CMSA / ESFR
   All internal math is canonical US units (gpm·psi·ft·in).
   ============================================================

   ROADMAP / FUTURE ENHANCEMENTS
   -----------------------------
   [ ] TRUE DN METRIC PIPE CATALOG.
       Today the pipe-size selector always lists Schedule-40 nominal
       inch sizes (1"–8"); in metric mode the internal diameter is only
       converted for display, not re-selected from a metric standard.
       Future: add a real DN catalog (ISO 6708 / EN 10255 / EN 10220),
       e.g. DN15, DN20, DN25, DN32, DN40, DN50, DN65, DN80, DN100,
       DN125, DN150, DN200, each with its true internal diameter (mm),
       and make the size dropdown units-aware — show DN labels when the
       app is in metric mode and inch labels in US mode (or let the user
       pick the catalog independently of the display units).
       Also requires a matching metric fitting equivalent-length table,
       since FITTINGS[] below is indexed 1:1 to the Sched-40 array.
       Implementation sketch: introduce a CATALOGS map
       { sched40:[...], dnEN10255:[...] }, store pipe.catalog + pipe.sizeIdx,
       and resolve internal diameter + fitting row from the chosen catalog
       in pipeGeom(). Solver math is unaffected (it consumes internal dia
       in inches; convert mm→in at the catalog boundary).
   [ ] Multiple supply sources / tanks.
   [ ] CSV / Excel export of node & pipe tables.
   [ ] Logo image upload for the PDF letterhead.
   ============================================================ */

/* ---------- Standalone / runtime config ----------
   In Claude.ai, the AI review and Save/Load use the artifact runtime
   directly. When this same component is served by the bundled Express
   backend (standalone mode), index.html sets
       window.__EMBER_API_BASE__ = "/api"
   which routes the AI request through a server-side proxy (so the
   Anthropic API key stays on the server) and persists projects to the
   backend's on-disk store instead. Detection is automatic. */
const API_BASE = (typeof window !== "undefined" && window.__EMBER_API_BASE__) || null;

/* ---------- Reference data (US units) ---------- */
// NOTE (roadmap): this is the only pipe catalog today. A true DN metric
// catalog (DN15–DN200, EN/ISO internal diameters) is planned — see the
// "TRUE DN METRIC PIPE CATALOG" item in the header roadmap block above.
const SCHED40 = [
  { nom: '1"', id: 1.049 }, { nom: '1¼"', id: 1.380 }, { nom: '1½"', id: 1.610 },
  { nom: '2"', id: 2.067 }, { nom: '2½"', id: 2.469 }, { nom: '3"', id: 3.068 },
  { nom: '4"', id: 4.026 }, { nom: '5"', id: 5.047 }, { nom: '6"', id: 6.065 },
  { nom: '8"', id: 7.981 },
];
// Internal diameters (in) for additional steel pipe schedules, indexed 1:1 with the
// nominal sizes in SCHED40 above. Because the NFPA 13 fitting equivalent-length table
// (FITTINGS) is keyed to nominal size, those equivalents apply across all steel schedules.
const SCHED = {
  sched40: { label: "Sched 40", id: SCHED40.map((s) => s.id) },
  sched10: { label: "Sched 10", id: [1.097, 1.442, 1.682, 2.157, 2.635, 3.260, 4.260, 5.295, 6.357, 8.249] },
  sched80: { label: "Sched 80", id: [0.957, 1.278, 1.500, 1.939, 2.323, 2.900, 3.826, 4.813, 5.761, 7.625] },
};
const MATERIALS = [
  { label: "Black / galv. steel", c: 120 },
  { label: "Cement-lined ductile", c: 140 },
  { label: "CPVC / plastic", c: 150 },
  { label: "Copper", c: 150 },
];
const FITTINGS = {
  e90:  { label: "90° elbow",       vals: [2, 3, 4, 5, 6, 7, 10, 12, 14, 18] },
  e45:  { label: "45° elbow",       vals: [1, 1, 2, 2, 3, 3, 4, 5, 7, 9] },
  tee:  { label: "Tee / cross",     vals: [5, 6, 8, 10, 12, 15, 20, 25, 30, 35] },
  gate: { label: "Gate valve",      vals: [0, 0, 0, 1, 1, 1, 2, 2, 3, 4] },
  bfly: { label: "Butterfly valve", vals: [0, 0, 0, 6, 7, 10, 12, 9, 10, 12] },
  chk:  { label: "Swing check",     vals: [5, 7, 9, 11, 14, 16, 22, 27, 32, 45] },
};
const COMMON_K = [5.6, 8.0, 11.2, 14.0, 16.8, 22.4, 25.2];
// hazard presets: density gpm/ft², typical remote area ft², default coverage/head ft²
const HAZARDS = {
  LH:  { label: "Light hazard", density: 0.10, area: 1500, cov: 200 },
  OH1: { label: "Ordinary hazard 1", density: 0.15, area: 1500, cov: 130 },
  OH2: { label: "Ordinary hazard 2", density: 0.20, area: 1500, cov: 130 },
  EH1: { label: "Extra hazard 1", density: 0.30, area: 2500, cov: 100 },
  EH2: { label: "Extra hazard 2", density: 0.40, area: 2500, cov: 100 },
  CUS: { label: "Custom", density: 0.20, area: 1500, cov: 130 },
};

/* ============================================================
   UNITS — canonical storage is US; convert only for display/input
   ============================================================ */
const FAC = { // multiply US → SI
  flow: 3.785411784, pressure: 0.0689475729, length: 0.3048, dia: 25.4,
  kfac: 14.4156, density: 40.7458, area: 0.09290304, vel: 0.3048,
};
const ULAB = {
  us: { flow: "gpm", pressure: "psi", length: "ft", dia: "in", density: "gpm/ft²", area: "ft²", vel: "ft/s", kfac: "gpm/psi½" },
  si: { flow: "L/min", pressure: "bar", length: "m", dia: "mm", density: "mm/min", area: "m²", vel: "m/s", kfac: "L/min/bar½" },
};
const UPREC = {
  us: { flow: 1, pressure: 1, length: 1, dia: 3, density: 3, area: 0, vel: 1, kfac: 1 },
  si: { flow: 0, pressure: 2, length: 2, dia: 1, density: 1, area: 1, vel: 2, kfac: 1 },
};
const toDisp = (sys, q, v) => (sys === "si" ? v * FAC[q] : v);
const toUS = (sys, q, v) => (sys === "si" ? v / FAC[q] : v);
const UnitsCtx = createContext({ sys: "us" });
const useUnits = () => useContext(UnitsCtx);
const lab = (sys, q) => ULAB[sys][q];

/* ============================================================
   HYDRAULICS
   ============================================================ */
const M = 1 / 1.85;
const EHEAD = 0.433; // psi per ft of water
const hwR = (C, d, Lt) => 4.52 * Lt / (Math.pow(C, 1.85) * Math.pow(d, 4.87)); // hf = R·Q^1.85
const velocity = (Q, d) => 0.4085 * Q / (d * d);
const fittingFactor = (C) => Math.pow(C / 120, 1.85);

function pipeGeom(pipe) {
  const sch = SCHED[pipe.schedule] || SCHED.sched40;
  const d = pipe.customId > 0 ? pipe.customId : sch.id[pipe.sizeIdx];
  let raw = 0;
  for (const key in FITTINGS) raw += (pipe.fittings?.[key] || 0) * FITTINGS[key].vals[pipe.sizeIdx];
  const adj = raw * fittingFactor(pipe.C);
  const Lt = pipe.length + adj;
  return { d, C: pipe.C, Lt, rawEquiv: raw, adjEquiv: adj, R: hwR(pipe.C, d, Lt) };
}

/* General nodal Newton-Raphson solver — trees AND gridded loops.
   opts.velocityPressure: when true, sprinkler discharge uses normal pressure
   Pn = Pt − Pv, with Pv = 0.001123·Q²/d⁴ from the dominant upstream (feeding)
   pipe (SFPE / NFPA 13). Pv is lagged within each Newton iteration, so the
   solver re-evaluates it as flows converge — exact on trees, a close
   approximation on grids. Default off (conservative, NFPA-permitted). */
function solveNetwork(ctx, Ps, warm, opts = {}) {
  const { ids, N, srcId, inc, unk, idx, n } = ctx;
  const vp = !!opts.velocityPressure;
  const HGLsrc = Ps + EHEAD * N[srcId].z;
  const HGL = {}; ids.forEach((id) => (HGL[id] = warm?.[id] ?? HGLsrc));
  HGL[srcId] = HGLsrc;

  const qf = (R, u) => Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / R, M);
  // velocity pressure from the largest inflowing pipe at this node
  const pvAt = (id) => {
    if (!vp) return 0;
    let qin = 0, dd = 0;
    for (const e of inc[id]) { const q = qf(e.R, HGL[e.o] - HGL[id]); if (q > qin) { qin = q; dd = e.d; } }
    return dd > 0 ? 0.001123 * qin * qin / Math.pow(dd, 4) : 0;
  };
  const dem = (id) => {
    const nd = N[id]; if (!(nd.k > 0 && nd.active)) return 0;
    return nd.k * Math.sqrt(Math.max(HGL[id] - EHEAD * nd.z - pvAt(id), 0));
  };

  for (let it = 0; it < 80; it++) {
    const f = new Array(n).fill(0);
    for (const id of unk) {
      let s = 0;
      for (const e of inc[id]) s += qf(e.R, HGL[id] - HGL[e.o]);
      s += dem(id);
      f[idx[id]] = s;
    }
    let norm = 0; for (const v of f) norm = Math.max(norm, Math.abs(v));
    if (norm < 1e-7) break;

    const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
    for (const id of unk) {
      const i = idx[id], nd = N[id];
      const P = HGL[id] - EHEAD * nd.z - pvAt(id);
      if (nd.k > 0 && nd.active && P > 0) A[i][i] += nd.k / (2 * Math.sqrt(P));
      for (const e of inc[id]) {
        const u = HGL[id] - HGL[e.o], au = Math.max(Math.abs(u), 1e-9);
        let g = M * Math.pow(au / e.R, M) / au;
        if (!isFinite(g) || g > 1e7) g = 1e7;
        A[i][i] += g;
        if (e.o !== srcId) A[i][idx[e.o]] -= g;
      }
      A[i][n] = -f[i];
    }
    // Gaussian elimination, partial pivot
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      const dgn = A[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const fr = A[r][c] / dgn;
        if (fr === 0) continue;
        for (let cc = c; cc <= n; cc++) A[r][cc] -= fr * A[c][cc];
      }
    }
    const dx = new Array(n);
    for (let i = 0; i < n; i++) dx[i] = A[i][n] / (A[i][i] || 1e-12);
    let lam = 1; const cap = Math.max(20, HGLsrc * 0.5);
    for (let i = 0; i < n; i++) if (Math.abs(dx[i]) > cap) lam = Math.min(lam, cap / Math.abs(dx[i]));
    for (const id of unk) HGL[id] += lam * dx[idx[id]];
  }

  const P = {}; ids.forEach((id) => (P[id] = HGL[id] - EHEAD * N[id].z));
  const Pn = {}; ids.forEach((id) => (Pn[id] = P[id] - pvAt(id))); // normal (discharge) pressure
  const spr = {}; ids.forEach((id) => (spr[id] = dem(id)));
  const totalQ = ids.reduce((s, id) => s + spr[id], 0);
  return { P, Pn, HGL, spr, totalQ };
}

/* density/area → required pressure at remote sprinkler */
function densityCalc(design, kGov) {
  const minQ = design.density * design.coverageArea;       // gpm per head
  const minP = Math.pow(minQ / (kGov || 5.6), 2);          // psi
  const nHeads = Math.ceil(design.designArea / design.coverageArea);
  // NFPA 13 remote-area length along the branch lines: L = 1.2·√A (rounded up to whole heads by the caller)
  const remoteLen = 1.2 * Math.sqrt(Math.max(design.designArea, 0));
  return { minQ, minP, nHeads, remoteLen };
}

/* pump boost quadratic ΔP(Q) through churn / rated / 150% */
function pumpBoost(pump) {
  const Qr = Math.max(pump.ratedFlow, 1);
  const a = pump.churnPressure;
  const c = (pump.p150 - pump.churnPressure - 1.5 * (pump.ratedPressure - pump.churnPressure)) / (0.75 * Qr * Qr);
  const b = (pump.ratedPressure - pump.churnPressure) / Qr - c * Qr;
  return (Q) => Math.max(a + b * Q + c * Q * Q, 0);
}
function supplyAvailFn(supply) {
  if (supply.type === "pump") {
    const p = supply.pump;
    const boost = pumpBoost(p);
    const suct = (Q) => p.suctionStatic - (p.suctionStatic - p.suctionResidual) * Math.pow(Math.max(Q, 0) / Math.max(p.suctionTestFlow, 1), 1.85);
    return (Q) => suct(Q) + boost(Q);
  }
  return (Q) => supply.static - (supply.static - supply.residual) * Math.pow(Math.max(Q, 0) / Math.max(supply.testFlow, 1), 1.85);
}

/* ---------- Core analysis ---------- */
function resolveMinPressure(project, activeSpr) {
  const d = project.design;
  if (project.systemType === "CMDA" && d.mode === "density") {
    const kGov = activeSpr.length ? Math.min(...activeSpr.map((s) => s.k)) : 5.6;
    return densityCalc(d, kGov).minP;
  }
  if (project.systemType === "CMSA" || project.systemType === "ESFR") return d.listingPressure;
  return d.minPressure;
}

function analyze(project) {
  const { nodes, pipes, supply } = project;
  const sources = nodes.filter((n) => n.type === "source");
  if (sources.length !== 1)
    return { error: sources.length === 0 ? "Add one source node (the water-supply connection)." : "Use exactly one source node." };

  const N = Object.fromEntries(nodes.map((n) => [n.id, { z: n.elevation, k: n.k, active: n.active, type: n.type, label: n.label }]));
  const ids = nodes.map((n) => n.id);
  const srcId = sources[0].id;
  const geom = {}; const inc = Object.fromEntries(ids.map((id) => [id, []]));
  const edges = [];
  for (const p of pipes) {
    if (!N[p.from] || !N[p.to] || p.from === p.to) continue;
    const g = pipeGeom(p); geom[p.id] = g;
    inc[p.from].push({ o: p.to, R: g.R, d: g.d }); inc[p.to].push({ o: p.from, R: g.R, d: g.d });
    edges.push({ id: p.id, a: p.from, b: p.to, g });
  }
  // connectivity
  const seen = new Set([srcId]); const stack = [srcId];
  while (stack.length) { const u = stack.pop(); for (const e of inc[u]) if (!seen.has(e.o)) { seen.add(e.o); stack.push(e.o); } }
  const disconnected = nodes.filter((n) => !seen.has(n.id));
  const looped = edges.filter((e) => seen.has(e.a) && seen.has(e.b)).length > seen.size - 1;

  const unk = ids.filter((id) => id !== srcId);
  const idx = Object.fromEntries(unk.map((id, i) => [id, i]));
  const ctx = { ids, N, srcId, inc, unk, idx, n: unk.length };

  const activeSpr = nodes.filter((n) => n.type === "sprinkler" && n.active && n.k > 0);
  const minP = resolveMinPressure(project, activeSpr);
  const availAt = supplyAvailFn(supply);
  const opts = { velocityPressure: !!project.design.velocityPressure };

  if (activeSpr.length === 0) {
    return { ok: true, noDemand: true, looped, disconnected, ids, N, srcId, edges, geom, minP };
  }

  // design search: source pressure so the min active-sprinkler discharge (normal)
  // pressure == minP (warm-started)
  let lo = minP, hi = minP + 3000, warm = null;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    const r = solveNetwork(ctx, mid, warm, opts); warm = r.HGL;
    const m = Math.min(...activeSpr.map((s) => r.Pn[s.id]));
    if (m < minP) lo = mid; else hi = mid;
  }
  const requiredPs = (lo + hi) / 2;
  const sol = solveNetwork(ctx, requiredPs, warm, opts);

  const totalQ = activeSpr.reduce((a, s) => a + sol.spr[s.id], 0);
  const pipeRows = edges.map((e) => {
    const Q = solveNetwork; // placeholder avoided
    const u = sol.HGL[e.a] - sol.HGL[e.b];
    const flow = Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M);
    return { id: e.id, a: e.a, b: e.b,
      label: `${N[e.a].label} → ${N[e.b].label}`,
      Q: Math.abs(flow), dir: flow >= 0 ? 1 : -1,
      d: e.g.d, C: e.g.C, Lt: e.g.Lt,
      loss: e.g.R * Math.pow(Math.abs(flow), 1.85), vel: velocity(Math.abs(flow), e.g.d) };
  });

  const demandQ = totalQ + (supply.hose || 0);
  const pAvail = availAt(demandQ);
  const margin = pAvail - requiredPs;

  return {
    ok: true, looped, disconnected, ids, N, srcId, edges, geom,
    P: sol.P, Pn: sol.Pn, spr: sol.spr, requiredPs, totalQ, pipeRows, activeSpr, minP,
    velocityPressure: opts.velocityPressure,
    supply: { availAt, demandQ, pAvail, margin },
  };
}

/* ---------- Schematic layout (general graph via BFS) ---------- */
function layout(res) {
  if (!res?.ids) return null;
  const { ids, srcId, edges } = res;
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  edges.forEach((e) => { adj[e.a].push(e.b); adj[e.b].push(e.a); });
  const depth = { [srcId]: 0 }, parent = {}, q = [srcId], seen = new Set([srcId]);
  const order = [srcId];
  while (q.length) { const u = q.shift(); for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); depth[v] = depth[u] + 1; parent[v] = u; order.push(v); q.push(v); } }
  ids.forEach((id) => { if (!(id in depth)) { depth[id] = 0; } });
  // y slots
  const children = {}; order.forEach((id) => (children[id] = []));
  order.forEach((id) => { if (parent[id] != null) children[parent[id]].push(id); });
  let leaf = 0; const y = {};
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    y[id] = children[id].length ? children[id].reduce((a, c) => a + y[c], 0) / children[id].length : leaf++;
  }
  ids.forEach((id) => { if (!(id in y)) y[id] = leaf++; });
  const maxDepth = Math.max(...ids.map((id) => depth[id]), 1);
  const maxY = Math.max(...ids.map((id) => y[id]), 1);
  const treeEdge = new Set(edges.filter((e) => parent[e.b] === e.a || parent[e.a] === e.b).map((e) => e.id));
  return { depth, y, maxDepth, maxY, treeEdge };
}

/* ============================================================
   PDF EXPORT (jsPDF + autotable, lazy-loaded from cdnjs)
   ============================================================ */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement("script");
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error("load " + src));
    document.head.appendChild(el);
  });
}
async function ensurePdfLibs() {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
}

function schematicSVGString(res, sys) {
  const lay = layout(res); if (!lay) return null;
  const { ids, srcId, edges, N, P } = res;
  const colW = 150, rowH = 60, padX = 70, padY = 40;
  const W = padX * 2 + lay.maxDepth * colW, H = padY * 2 + lay.maxY * rowH;
  const X = (id) => padX + lay.depth[id] * colW, Y = (id) => padY + lay.y[id] * rowH;
  const flowOf = (e) => {
    const u = res.HGL ? res.HGL[e.a] - res.HGL[e.b] : 0;
    return Math.abs(Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M));
  };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
  edges.forEach((e) => {
    const x1 = X(e.a), y1 = Y(e.a), x2 = X(e.b), y2 = Y(e.b);
    const dash = lay.treeEdge.has(e.id) ? "" : ` stroke-dasharray="5 4"`;
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9aa3b0" stroke-width="2.5"${dash}/>`;
    s += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" fill="#c2410c" font-size="9" font-family="monospace" text-anchor="middle">${(toDisp(sys, "flow", flowOf(e))).toFixed(UPREC[sys].flow)}</text>`;
  });
  ids.forEach((id) => {
    const x = X(id), y = Y(id), nd = N[id];
    const src = nd.type === "source", spr = nd.type === "sprinkler";
    const fill = src ? "#ea580c" : spr ? (nd.active ? "#0891b2" : "#e2e8f0") : "#94a3b8";
    if (src) s += `<rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="2" fill="${fill}"/>`;
    else s += `<circle cx="${x}" cy="${y}" r="${spr ? 7 : 4}" fill="${fill}" stroke="#475569"/>`;
    s += `<text x="${x}" y="${y - 12}" fill="#0f172a" font-size="10" font-weight="bold" text-anchor="middle">${nd.label}</text>`;
    if (P) s += `<text x="${x}" y="${y + 18}" fill="#475569" font-size="9" font-family="monospace" text-anchor="middle">${toDisp(sys, "pressure", P[id]).toFixed(UPREC[sys].pressure)}</text>`;
  });
  s += `</svg>`;
  return { svg: s, W, H };
}
function svgToPng(svgString, W, H) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const scale = 2; const c = document.createElement("canvas");
        c.width = W * scale; c.height = H * scale;
        const g = c.getContext("2d"); g.scale(scale, scale); g.drawImage(img, 0, 0);
        URL.revokeObjectURL(url); resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch { resolve(null); }
  });
}

async function exportPDF(project, res, sys) {
  await ensurePdfLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const PW = doc.internal.pageSize.getWidth();
  const PH = doc.internal.pageSize.getHeight();
  const MX = 40;
  const AMBER = [234, 88, 12], SLATE = [30, 41, 59], MUT = [100, 116, 139];
  const fmt = (q, v, dec) => (v == null || isNaN(v) ? "—" : toDisp(sys, q, v).toFixed(dec ?? UPREC[sys][q]));
  const U = (q) => lab(sys, q);

  /* header band */
  doc.setFillColor(...SLATE); doc.rect(0, 0, PW, 64, "F");
  doc.setFillColor(...AMBER); doc.rect(0, 64, PW, 3, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(18);
  doc.text(project.company || "DGA Consulting", MX, 30);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(203, 213, 225);
  doc.text("Fire Protection Engineering", MX, 46);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(255, 255, 255);
  doc.text("Hydraulic Calculation Report", PW - MX, 30, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(203, 213, 225);
  doc.text(`Units: ${sys === "us" ? "US (gpm·psi·ft)" : "Metric (L/min·bar·m)"}`, PW - MX, 46, { align: "right" });

  let yy = 92;
  const sectionHead = (t) => {
    doc.setFillColor(241, 245, 249); doc.rect(MX, yy - 12, PW - 2 * MX, 18, "F");
    doc.setTextColor(...SLATE); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
    doc.text(t.toUpperCase(), MX + 6, yy);
    yy += 16;
  };
  const kv = (pairs, cols = 2) => {
    doc.setFontSize(9.5);
    const colW = (PW - 2 * MX) / cols;
    pairs.forEach((p, i) => {
      const cx = MX + (i % cols) * colW;
      if (i % cols === 0 && i > 0) yy += 15;
      doc.setFont("helvetica", "bold"); doc.setTextColor(...MUT);
      doc.text(p[0] + ":", cx, yy);
      doc.setFont("helvetica", "normal"); doc.setTextColor(30, 41, 59);
      doc.text(String(p[1] ?? "—"), cx + Math.min(110, doc.getTextWidth(p[0] + ": ") + 6), yy);
    });
    yy += 22;
  };

  /* project info */
  sectionHead("Project Information");
  kv([
    ["Project", project.name], ["Project No.", project.projectNumber],
    ["Client", project.client], ["Location", project.location],
    ["Prepared by", project.preparedBy], ["PE / License", project.peNumber],
    ["Date", project.reportDate], ["System", project.systemType],
  ]);
  if (project.systemDesc) { doc.setFont("helvetica", "italic"); doc.setFontSize(9); doc.setTextColor(...MUT); doc.text(doc.splitTextToSize("System: " + project.systemDesc, PW - 2 * MX), MX, yy); yy += 18; }

  /* design basis */
  sectionHead("Design Basis");
  const d = project.design;
  const dPairs = [["System type", project.systemType]];
  if (project.systemType === "CMDA" && d.mode === "density") {
    const dc = densityCalc(d, res?.activeSpr?.length ? Math.min(...res.activeSpr.map((s) => s.k)) : 5.6);
    dPairs.push(["Hazard", HAZARDS[d.hazard]?.label || "Custom"]);
    dPairs.push([`Density`, `${fmt("density", d.density)} ${U("density")}`]);
    dPairs.push([`Coverage / head`, `${fmt("area", d.coverageArea)} ${U("area")}`]);
    dPairs.push([`Remote area`, `${fmt("area", d.designArea)} ${U("area")}`]);
    dPairs.push([`Design sprinklers`, dc.nHeads]);
    dPairs.push([`Min flow / head`, `${fmt("flow", dc.minQ)} ${U("flow")}`]);
  } else if (project.systemType !== "CMDA") {
    dPairs.push(["Design sprinklers", d.designSprinklers]);
  }
  dPairs.push([`Min remote pressure`, `${fmt("pressure", res?.minP)} ${U("pressure")}`]);
  kv(dPairs);

  /* water supply */
  sectionHead("Water Supply");
  const s = project.supply;
  const sPairs = [
    ["Source type", s.type === "pump" ? "Fire pump" : s.type === "hydrant" ? "Hydrant flow test" : "City / direct"],
    ["Test / ID", s.identifier], ["Test date", s.testDate],
    ["Tested by", s.testedBy], ["Location", s.sourceLocation],
  ];
  if (s.type === "pump") {
    const p = s.pump;
    sPairs.push([`Pump rated`, `${fmt("flow", p.ratedFlow)} ${U("flow")} @ ${fmt("pressure", p.ratedPressure)} ${U("pressure")}`]);
    sPairs.push([`Churn pressure`, `${fmt("pressure", p.churnPressure)} ${U("pressure")}`]);
    sPairs.push([`150% pressure`, `${fmt("pressure", p.p150)} ${U("pressure")}`]);
    sPairs.push([`Suction static/res`, `${fmt("pressure", p.suctionStatic)} / ${fmt("pressure", p.suctionResidual)} ${U("pressure")}`]);
  } else {
    sPairs.push([`Static`, `${fmt("pressure", s.static)} ${U("pressure")}`]);
    sPairs.push([`Residual`, `${fmt("pressure", s.residual)} ${U("pressure")} @ ${fmt("flow", s.testFlow)} ${U("flow")}`]);
  }
  sPairs.push([`Hose allowance`, `${fmt("flow", s.hose)} ${U("flow")}`]);
  if (s.supplyNotes) sPairs.push(["Notes", s.supplyNotes]);
  kv(sPairs);

  /* results summary */
  sectionHead("Results Summary");
  const ok = res?.ok && !res.noDemand;
  const margin = ok ? res.supply.margin : null;
  const pass = margin != null && margin >= 0;
  kv([
    [`Required pressure`, ok ? `${fmt("pressure", res.requiredPs)} ${U("pressure")}` : "—"],
    [`System demand`, ok ? `${fmt("flow", res.totalQ)} ${U("flow")} (+${fmt("flow", s.hose)} hose)` : "—"],
    [`Available supply`, ok ? `${fmt("pressure", res.supply.pAvail)} ${U("pressure")} @ ${fmt("flow", res.supply.demandQ)} ${U("flow")}` : "—"],
    [`Safety margin`, ok ? `${margin >= 0 ? "+" : ""}${fmt("pressure", margin)} ${U("pressure")}` : "—"],
  ]);
  if (ok) {
    doc.setFillColor(...(pass ? [22, 163, 74] : [220, 38, 38]));
    doc.roundedRect(MX, yy - 10, 150, 22, 3, 3, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(pass ? "PASS — supply meets demand" : "FAIL — demand exceeds supply", MX + 8, yy + 5);
    yy += 30;
  }

  /* schematic image */
  try {
    const sv = schematicSVGString(res, sys);
    if (sv) {
      const png = await svgToPng(sv.svg, sv.W, sv.H);
      if (png) {
        const maxW = PW - 2 * MX, scale = Math.min(maxW / sv.W, 1), w = sv.W * scale, h = sv.H * scale;
        if (yy + h > PH - 60) { doc.addPage(); yy = 60; }
        sectionHead("Network Schematic");
        doc.addImage(png, "PNG", MX, yy, w, h); yy += h + 14;
      }
    }
  } catch { /* skip image */ }

  /* tables */
  if (ok) {
    const nodeRows = res.ids.map((id) => {
      const nd = res.N[id];
      return [nd.label, nd.type, fmt("length", nd.z), fmt("pressure", res.P[id]), res.spr[id] > 0 ? fmt("flow", res.spr[id]) : "—"];
    });
    doc.autoTable({
      startY: yy + 4, margin: { left: MX, right: MX },
      head: [[`Node`, "Type", `Elev (${U("length")})`, `Pressure (${U("pressure")})`, `Discharge (${U("flow")})`]],
      body: nodeRows, theme: "grid", styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: SLATE, textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });
    const pipeRows = res.pipeRows.map((r) => [
      r.label, fmt("flow", r.Q), fmt("dia", r.d), r.C, fmt("length", r.Lt),
      fmt("pressure", r.loss), fmt("vel", r.vel) + (r.vel > 20 ? " !" : ""),
    ]);
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 14, margin: { left: MX, right: MX },
      head: [["Segment", `Flow (${U("flow")})`, `Ø (${U("dia")})`, "C", `Eq.len (${U("length")})`, `Loss (${U("pressure")})`, `Vel (${U("vel")})`]],
      body: pipeRows, theme: "grid", styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: SLATE, textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => { if (data.section === "body" && data.column.index === 6 && String(data.cell.raw).includes("!")) { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = "bold"; } },
    });
  }

  /* footer on every page */
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240); doc.line(MX, PH - 38, PW - MX, PH - 38);
    doc.setFontSize(7.5); doc.setTextColor(...MUT); doc.setFont("helvetica", "normal");
    doc.text("Hazen-Williams analysis per NFPA 13 methodology. To be reviewed and sealed by a licensed professional engineer.", MX, PH - 26);
    doc.text(`${project.company || "DGA Consulting"} · Generated by EMBER`, MX, PH - 15);
    doc.text(`Page ${i} of ${pages}`, PW - MX, PH - 15, { align: "right" });
  }
  const fname = (project.name || "hydraulic-calc").replace(/[^\w\-]+/g, "_") + ".pdf";
  doc.save(fname);
}

/* ============================================================
   small helpers
   ============================================================ */
let _uid = 100;
const uid = (p) => `${p}${_uid++}`;
const num = (v, d = 1) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d));
const round = (v, d) => (v == null || isNaN(v) ? v : +Number(v).toFixed(d));
function mkPipe(from, to, sizeIdx, length) {
  return { id: uid("p"), from, to, sizeIdx, schedule: "sched40", customId: 0, C: 120, length,
    fittings: { e90: 0, e45: 0, tee: 0, gate: 0, bfly: 0, chk: 0 } };
}
const today = () => new Date().toISOString().slice(0, 10);

/* ============================================================
   SIZER — parametric network generator (HydraCalc-style)
   Turns high-level inputs (layout, grid dimensions, pipe sizes, K, density)
   into a full node/pipe network the existing solver can analyze.
   Size selection is centralized in mkSeg, so an auto-size optimizer can
   later iterate sizeIdx per group to meet the demand/velocity targets.
   ============================================================ */
function defaultSizer() {
  return {
    layout: "tree",          // tree | grid | loop
    lines: 5,                // branch lines in the design area
    heads: 5,                // sprinklers per branch line
    sBranch: 12,             // spacing along a branch line (ft)
    sLine: 10,               // spacing between branch lines (ft)
    K: 5.6,                  // sprinkler K-factor
    density: 0.20,           // gpm/ft²
    elevation: 12,           // system height above supply (ft)
    feedLength: 20,          // riser / feed-main run to the first cross-main (ft)
    branch: { schedule: "sched40", sizeIdx: 1, C: 120 }, // 1¼"
    main:   { schedule: "sched40", sizeIdx: 6, C: 120 }, // 4"
    feed:   { schedule: "sched40", sizeIdx: 8, C: 120 }, // 6"
  };
}

function generateNetwork(spec) {
  const nodes = [], pipes = [];
  const mkSeg = (from, to, grp, len, extra = {}) => {
    const s = spec[grp];
    return { ...mkPipe(from, to, s.sizeIdx, round(Math.max(len, 0.1), 2)), schedule: s.schedule, C: s.C, ...extra };
  };
  const teeIn = { e90: 0, e45: 0, tee: 1, gate: 0, bfly: 0, chk: 0 }; // flow turned 90° into a branch
  const S = uid("n");
  nodes.push({ id: S, label: "Supply", type: "source", elevation: 0, k: 0, active: false });
  const z = spec.elevation;
  const lines = Math.max(1, spec.lines | 0), heads = Math.max(1, spec.heads | 0);

  // near-side cross-main, one junction per branch line
  const cmL = [];
  for (let i = 0; i < lines; i++) { const id = uid("n"); cmL.push(id); nodes.push({ id, label: `CM${i + 1}`, type: "junction", elevation: z, k: 0, active: false }); }
  pipes.push(mkSeg(S, cmL[0], "feed", spec.feedLength));               // riser / feed main
  for (let i = 1; i < lines; i++) pipes.push(mkSeg(cmL[i - 1], cmL[i], "main", spec.sLine));

  // far-side cross-main (gridded systems feed each branch line from both ends)
  const cmR = [];
  if (spec.layout === "grid") {
    for (let i = 0; i < lines; i++) { const id = uid("n"); cmR.push(id); nodes.push({ id, label: `CR${i + 1}`, type: "junction", elevation: z, k: 0, active: false }); }
    for (let i = 1; i < lines; i++) pipes.push(mkSeg(cmR[i - 1], cmR[i], "main", spec.sLine));
  }

  // branch lines with sprinklers
  for (let i = 0; i < lines; i++) {
    let prev = cmL[i];
    for (let j = 0; j < heads; j++) {
      const id = uid("n");
      nodes.push({ id, label: `${String.fromCharCode(65 + (i % 26))}${j + 1}`, type: "sprinkler", elevation: z, k: spec.K, active: true });
      pipes.push(mkSeg(prev, id, "branch", spec.sBranch, j === 0 ? { fittings: { ...teeIn } } : {}));
      prev = id;
    }
    if (spec.layout === "grid") pipes.push(mkSeg(prev, cmR[i], "branch", spec.sBranch)); // close the line loop
  }

  // looped feed: return main ties the far end of the cross-main back to the source
  if (spec.layout === "loop") pipes.push(mkSeg(cmL[lines - 1], S, "main", spec.feedLength + spec.sLine * (lines - 1)));

  return { nodes, pipes };
}

function sampleProject() {
  const S = "S", CM = "CM", A1 = "A1", A2 = "A2", A3 = "A3", B1 = "B1", B2 = "B2", B3 = "B3";
  return {
    name: "Sample — twin branch lines", projectNumber: "DGA-2025-001",
    client: "Sample Client LLC", location: "—", preparedBy: "", peNumber: "",
    company: "DGA Consulting", reportDate: today(), systemDesc: "Wet-pipe sprinkler system, ordinary hazard.",
    units: "us", systemType: "CMDA",
    design: { mode: "density", hazard: "OH2", density: 0.20, coverageArea: 130, designArea: 1500,
      designSprinklers: 12, listingPressure: 50, minPressure: 7, velocityPressure: false },
    sizer: defaultSizer(),
    nodes: [
      { id: S, label: "Supply", type: "source", elevation: 0, k: 0, active: false },
      { id: CM, label: "Cross main", type: "junction", elevation: 10, k: 0, active: false },
      { id: A1, label: "A1", type: "sprinkler", elevation: 10, k: 5.6, active: true },
      { id: A2, label: "A2", type: "sprinkler", elevation: 10, k: 5.6, active: true },
      { id: A3, label: "A3", type: "sprinkler", elevation: 10, k: 5.6, active: true },
      { id: B1, label: "B1", type: "sprinkler", elevation: 10, k: 5.6, active: true },
      { id: B2, label: "B2", type: "sprinkler", elevation: 10, k: 5.6, active: true },
      { id: B3, label: "B3", type: "sprinkler", elevation: 10, k: 5.6, active: true },
    ],
    pipes: [
      mkPipe(S, CM, 6, 15), mkPipe(CM, A1, 4, 8), mkPipe(A1, A2, 1, 10), mkPipe(A2, A3, 0, 10),
      mkPipe(CM, B1, 4, 8), mkPipe(B1, B2, 1, 10), mkPipe(B2, B3, 0, 10),
    ],
    supply: {
      type: "hydrant", identifier: "Hydrant H-12 / H-14", testDate: today(),
      testedBy: "City Water Dept.", sourceLocation: "Main St. & 1st Ave.", supplyNotes: "",
      static: 70, residual: 55, testFlow: 1000, hose: 100,
      pump: { ratedFlow: 1000, ratedPressure: 100, churnPressure: 115, p150: 65, suctionStatic: 70, suctionResidual: 55, suctionTestFlow: 1500 },
    },
  };
}
function blankProject() {
  const p = sampleProject();
  return { ...p, name: "Untitled", projectNumber: "", client: "", location: "", systemDesc: "",
    nodes: [{ id: uid("n"), label: "Supply", type: "source", elevation: 0, k: 0, active: false }], pipes: [] };
}

/* ============================================================
   STYLES
   ============================================================ */
const CSS = `
:root{
  --bg:#0B0E13;--panel:#141922;--panel2:#1B2230;--line:#2A323F;
  --txt:#E6EAF0;--mut:#8A94A6;--mut2:#5C6678;
  --fire:#FF7A1A;--water:#2BD4D9;--ok:#46D17F;--danger:#FF4D4D;--gold:#F5A623;
  --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  --sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box}
.ember{background:var(--bg);color:var(--txt);font-family:var(--sans);min-height:100%;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.ember button{font-family:inherit;cursor:pointer}
.eyebrow{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--mut);font-weight:600}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.hdr{display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#10151d,#0B0E13);flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px}
.brand .mark{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:radial-gradient(circle at 35% 30%,#3a2410,#160d06);border:1px solid #3a2a18;box-shadow:0 0 18px rgba(255,122,26,.25)}
.brand h1{font-size:17px;font-weight:800;letter-spacing:.04em;margin:0}
.brand .sub{font-size:11px;color:var(--mut)}
.pname{background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:7px 10px;font-size:13px;min-width:180px}
.spacer{flex:1}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:7px 11px;font-size:12.5px;font-weight:600;transition:.15s}
.btn:hover{border-color:#3b4658;background:#222b3a}
.btn.primary{background:linear-gradient(180deg,#ff8a2e,#e9650a);border-color:#ff8a2e;color:#1a0e03}
.btn.primary:hover{filter:brightness(1.06)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--gold);outline-offset:1px}
.useg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.useg button{background:var(--panel2);border:none;color:var(--mut);padding:7px 12px;font-size:12px;font-weight:700}
.useg button.on{background:var(--water);color:#04181a}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border-bottom:1px solid var(--line)}
.kpi{background:var(--panel);padding:15px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.kpi .lab{display:flex;align-items:center;gap:7px}
.kpi .val{font-family:var(--mono);font-size:28px;font-weight:700;line-height:1;letter-spacing:-.02em}
.kpi .unit{font-size:12px;color:var(--mut);font-weight:500;margin-left:4px}
.kpi.fire .val{color:var(--fire);text-shadow:0 0 22px rgba(255,122,26,.35)}
.kpi.water .val{color:var(--water);text-shadow:0 0 22px rgba(43,212,217,.3)}
.kpi .meta{font-size:11px;color:var(--mut)}
.tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px}
.tag.ok{background:rgba(70,209,127,.12);color:var(--ok);border:1px solid rgba(70,209,127,.3)}
.tag.bad{background:rgba(255,77,77,.12);color:var(--danger);border:1px solid rgba(255,77,77,.3)}
.tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid var(--line);background:var(--panel);overflow-x:auto}
.tab{display:inline-flex;align-items:center;gap:7px;padding:13px 14px;font-size:13px;font-weight:600;color:var(--mut);border:none;background:none;border-bottom:2px solid transparent;white-space:nowrap}
.tab:hover{color:var(--txt)}
.tab.active{color:var(--txt);border-bottom-color:var(--fire)}
.wrap{padding:18px;max-width:1180px;margin:0 auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin-bottom:16px;overflow:hidden}
.card>.head{display:flex;align-items:center;gap:9px;padding:12px 15px;border-bottom:1px solid var(--line)}
.card>.head h3{margin:0;font-size:13px;font-weight:700;letter-spacing:.02em}
.card>.head .desc{font-size:11.5px;color:var(--mut);margin-left:auto}
.card .body{padding:14px 15px}
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{text-align:left;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);font-weight:700;padding:8px 9px;border-bottom:1px solid var(--line)}
.tbl td{padding:6px 9px;border-bottom:1px solid #1e242f;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}
.cellinput{background:#0f141c;border:1px solid var(--line);color:var(--txt);border-radius:6px;padding:5px 7px;width:100%;font-size:12.5px;font-family:var(--mono)}
.cellinput.txt{font-family:var(--sans)}
.cellsel{background:#0f141c;border:1px solid var(--line);color:var(--txt);border-radius:6px;padding:5px 6px;font-size:12px;width:100%}
.iconbtn{background:none;border:1px solid var(--line);color:var(--mut);border-radius:6px;padding:5px;display:grid;place-items:center}
.iconbtn:hover{color:var(--danger);border-color:var(--danger)}
.chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 7px;border-radius:6px;border:1px solid var(--line);color:var(--mut)}
.chip.spr{color:var(--water);border-color:#1B7E82}.chip.src{color:var(--fire);border-color:#5a3a1a}
.toggle{width:34px;height:19px;border-radius:999px;border:1px solid var(--line);background:#0f141c;position:relative;transition:.15s;flex:none}
.toggle.on{background:rgba(43,212,217,.25);border-color:var(--water)}
.toggle .dot{position:absolute;top:1.5px;left:1.5px;width:14px;height:14px;border-radius:50%;background:var(--mut);transition:.15s}
.toggle.on .dot{left:16px;background:var(--water)}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:11px;color:var(--mut);font-weight:600}
.field input,.field select,.field textarea{background:#0f141c;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:8px 10px;font-size:13px;font-family:var(--mono)}
.field textarea{font-family:var(--sans);resize:vertical;min-height:54px}
.field .txt{font-family:var(--sans)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.schem{width:100%;background:#0c1016;border-radius:10px;border:1px solid var(--line)}
.chartbox{height:330px;width:100%}
.ai-resp{background:#0f141c;border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-size:13.5px;line-height:1.6;white-space:pre-wrap;min-height:80px}
.ai-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.ai-input{flex:1;min-width:220px;background:#0f141c;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:9px 11px;font-size:13px}
.overlay{position:fixed;inset:0;background:rgba(5,7,11,.7);display:grid;place-items:center;z-index:50;padding:16px}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:14px;width:100%;max-width:440px;max-height:90vh;overflow:auto}
.modal .mhead{display:flex;align-items:center;gap:9px;padding:14px 16px;border-bottom:1px solid var(--line)}
.modal .mbody{padding:16px}
.note{font-size:11.5px;color:var(--mut);display:flex;gap:7px;align-items:flex-start}
.derived{display:flex;gap:18px;flex-wrap:wrap;background:#0f141c;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:12px}
.derived .d{display:flex;flex-direction:column;gap:3px}
.derived .d .v{font-family:var(--mono);font-size:18px;font-weight:700;color:var(--gold)}
.derived .d .l{font-size:10.5px;color:var(--mut)}
.warnrow td{color:var(--gold)!important}
.addbar{display:flex;gap:8px;padding:11px 15px;border-top:1px solid var(--line)}
@media (max-width:760px){.kpis{grid-template-columns:1fr 1fr}.grid4,.grid3,.grid2{grid-template-columns:1fr 1fr}.kpi .val{font-size:23px}}
@media (max-width:480px){.grid4,.grid3,.grid2{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
`;

/* ============================================================
   COMPONENTS
   ============================================================ */
function NumField({ q, value, onChange, step = "any", className = "", placeholder }) {
  const { sys } = useUnits();
  const ref = useRef(null);
  const [txt, setTxt] = useState("");
  useEffect(() => {
    if (document.activeElement === ref.current) return;
    const d = value == null || isNaN(value) ? "" : round(toDisp(sys, q, value), UPREC[sys][q]);
    setTxt(d === "" ? "" : String(d));
  }, [value, sys, q]);
  return (
    <input ref={ref} className={className} type="number" step={step} value={txt} placeholder={placeholder}
      onChange={(e) => { setTxt(e.target.value); const v = parseFloat(e.target.value); onChange(isNaN(v) ? 0 : toUS(sys, q, v)); }} />
  );
}
function Toggle({ on, onChange }) {
  return <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)} aria-pressed={on} aria-label="Toggle flowing"><span className="dot" /></button>;
}
function TextField({ label, value, onChange, area, placeholder }) {
  return (
    <div className="field">
      <label>{label}</label>
      {area
        ? <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        : <input className="txt" value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />}
    </div>
  );
}

/* ---- Project / report metadata ---- */
function ProjectPanel({ project, update }) {
  const set = (patch) => update(patch);
  return (
    <>
      <div className="card">
        <div className="head"><Building2 size={15} color="var(--gold)" /><h3>Report details</h3>
          <span className="desc">Appears on the client-facing PDF</span></div>
        <div className="body">
          <div className="grid3">
            <TextField label="Company" value={project.company} onChange={(v) => set({ company: v })} />
            <TextField label="Project name" value={project.name} onChange={(v) => set({ name: v })} />
            <TextField label="Project number" value={project.projectNumber} onChange={(v) => set({ projectNumber: v })} />
            <TextField label="Client" value={project.client} onChange={(v) => set({ client: v })} />
            <TextField label="Location / address" value={project.location} onChange={(v) => set({ location: v })} />
            <TextField label="Report date" value={project.reportDate} onChange={(v) => set({ reportDate: v })} />
            <TextField label="Prepared by" value={project.preparedBy} onChange={(v) => set({ preparedBy: v })} />
            <TextField label="PE / license no." value={project.peNumber} onChange={(v) => set({ peNumber: v })} />
          </div>
          <div style={{ marginTop: 12 }}>
            <TextField label="System description" area value={project.systemDesc} onChange={(v) => set({ systemDesc: v })}
              placeholder="e.g. Wet-pipe system protecting warehouse, ESFR per listing…" />
          </div>
        </div>
      </div>
    </>
  );
}

/* ---- Design basis (system type + density/area or listing) ---- */
function DesignBasisPanel({ project, update, res }) {
  const { sys } = useUnits();
  const d = project.design;
  const setD = (patch) => update({ design: { ...d, ...patch } });
  const setHazard = (h) => { const hz = HAZARDS[h]; setD({ hazard: h, ...(h !== "CUS" ? { density: hz.density, designArea: hz.area, coverageArea: hz.cov } : {}) }); };
  const kGov = res?.activeSpr?.length ? Math.min(...res.activeSpr.map((s) => s.k)) : 5.6;
  const dc = densityCalc(d, kGov);
  const activeCount = project.nodes.filter((n) => n.type === "sprinkler" && n.active).length;
  const targetCount = project.systemType === "CMDA" ? dc.nHeads : d.designSprinklers;

  return (
    <div className="card">
      <div className="head"><ClipboardList size={15} color="var(--gold)" /><h3>Design basis</h3>
        <span className="desc">Sets the required pressure at the remote sprinkler</span></div>
      <div className="body">
        <div className="grid3">
          <div className="field">
            <label>System type</label>
            <select value={project.systemType} onChange={(e) => update({ systemType: e.target.value })}>
              <option value="CMDA">CMDA — control mode density/area</option>
              <option value="CMSA">CMSA — control mode specific application</option>
              <option value="ESFR">ESFR — early suppression fast response</option>
            </select>
          </div>
          {project.systemType === "CMDA" && (
            <div className="field">
              <label>Design method</label>
              <select value={d.mode} onChange={(e) => setD({ mode: e.target.value })}>
                <option value="density">Density / area (auto pressure)</option>
                <option value="direct">Direct minimum pressure</option>
              </select>
            </div>
          )}
        </div>

        {project.systemType === "CMDA" && d.mode === "density" && (
          <>
            <div className="grid4" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Hazard</label>
                <select value={d.hazard} onChange={(e) => setHazard(e.target.value)}>
                  {Object.entries(HAZARDS).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}
                </select>
              </div>
              <div className="field"><label>Density ({lab(sys, "density")})</label>
                <NumField q="density" value={d.density} onChange={(v) => setD({ density: v, hazard: "CUS" })} /></div>
              <div className="field"><label>Coverage / head ({lab(sys, "area")})</label>
                <NumField q="area" value={d.coverageArea} onChange={(v) => setD({ coverageArea: v })} /></div>
              <div className="field"><label>Remote area ({lab(sys, "area")})</label>
                <NumField q="area" value={d.designArea} onChange={(v) => setD({ designArea: v, hazard: "CUS" })} /></div>
            </div>
            <div className="derived">
              <div className="d"><span className="v">{num(toDisp(sys, "flow", dc.minQ), UPREC[sys].flow)}</span>
                <span className="l">min flow / head ({lab(sys, "flow")})</span></div>
              <div className="d"><span className="v">{num(toDisp(sys, "pressure", dc.minP), UPREC[sys].pressure)}</span>
                <span className="l">→ remote pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v">{dc.nHeads}</span><span className="l">design sprinklers</span></div>
              <div className="d"><span className="v">{num(toDisp(sys, "length", dc.remoteLen), UPREC[sys].length)}</span>
                <span className="l">1.2√A length ({lab(sys, "length")})</span></div>
              <div className="d"><span className="v" style={{ color: activeCount === targetCount ? "var(--ok)" : "var(--gold)" }}>{activeCount}</span>
                <span className="l">currently flowing</span></div>
            </div>
            <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
              <span>Remote pressure derived as P = (density × coverage ÷ K)², using the governing K = {kGov}. Mark {dc.nHeads} sprinklers as flowing to match the remote area.</span></div>
          </>
        )}

        {project.systemType === "CMDA" && d.mode === "direct" && (
          <div className="grid3" style={{ marginTop: 12, maxWidth: 360 }}>
            <div className="field"><label>Min remote pressure ({lab(sys, "pressure")})</label>
              <NumField q="pressure" value={d.minPressure} onChange={(v) => setD({ minPressure: v })} /></div>
          </div>
        )}

        {(project.systemType === "CMSA" || project.systemType === "ESFR") && (
          <>
            <div className="grid3" style={{ marginTop: 12 }}>
              <div className="field"><label>Design sprinklers (per listing)</label>
                <input type="number" className="txt" style={{ fontFamily: "var(--mono)" }} value={d.designSprinklers}
                  onChange={(e) => setD({ designSprinklers: +e.target.value })} /></div>
              <div className="field"><label>Min pressure / listing ({lab(sys, "pressure")})</label>
                <NumField q="pressure" value={d.listingPressure} onChange={(v) => setD({ listingPressure: v })} /></div>
            </div>
            <div className="derived">
              <div className="d"><span className="v">{num(toDisp(sys, "pressure", d.listingPressure), UPREC[sys].pressure)}</span>
                <span className="l">remote pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v">{d.designSprinklers}</span><span className="l">design sprinklers</span></div>
              <div className="d"><span className="v" style={{ color: activeCount === d.designSprinklers ? "var(--ok)" : "var(--gold)" }}>{activeCount}</span>
                <span className="l">currently flowing</span></div>
            </div>
            <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
              <span>{project.systemType} systems are designed by the number of operating sprinklers at the listed minimum pressure. Enter values from the sprinkler's listing.</span></div>
          </>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Velocity pressures</label>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Toggle on={!!d.velocityPressure} onChange={(v) => setD({ velocityPressure: v })} />
            <span style={{ fontSize: 12, color: "var(--mut)" }}>
              {d.velocityPressure
                ? "On — discharge uses normal pressure Pₙ = Pₜ − Pᵥ (Pᵥ = 0.001123·Q²/d⁴)"
                : "Off — total pressure at each orifice (NFPA-permitted, more conservative)"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- Nodes ---- */
function NodesEditor({ project, update }) {
  const { sys } = useUnits();
  const { nodes, pipes } = project;
  const setNode = (id, patch) => update({ nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
  const del = (id) => update({ nodes: nodes.filter((n) => n.id !== id), pipes: pipes.filter((p) => p.from !== id && p.to !== id) });
  const add = () => update({ nodes: [...nodes, { id: uid("n"), label: `N${nodes.length}`, type: "sprinkler", elevation: 0, k: 5.6, active: true }] });
  return (
    <div className="card">
      <div className="head"><GitBranch size={15} color="var(--water)" /><h3>Nodes</h3>
        <span className="desc">Sprinklers, junctions, and the supply point</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>Label</th><th>Type</th><th>Elev ({lab(sys, "length")})</th><th>K ({lab(sys, "kfac")})</th><th>Flowing</th><th></th></tr></thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td style={{ minWidth: 84 }}><input className="cellinput txt" value={n.label} onChange={(e) => setNode(n.id, { label: e.target.value })} /></td>
                <td style={{ minWidth: 106 }}>
                  <select className="cellsel" value={n.type} onChange={(e) => setNode(n.id, { type: e.target.value })}>
                    <option value="source">Supply</option><option value="junction">Junction</option><option value="sprinkler">Sprinkler</option>
                  </select>
                </td>
                <td style={{ width: 86 }}><NumField className="cellinput" q="length" value={n.elevation} onChange={(v) => setNode(n.id, { elevation: v })} /></td>
                <td style={{ width: 86 }}>{n.type === "sprinkler"
                  ? <NumField className="cellinput" q="kfac" value={n.k} onChange={(v) => setNode(n.id, { k: v })} />
                  : <span style={{ color: "var(--mut2)" }}>—</span>}</td>
                <td style={{ width: 56 }}>{n.type === "sprinkler"
                  ? <Toggle on={n.active} onChange={(v) => setNode(n.id, { active: v })} />
                  : <span style={{ color: "var(--mut2)" }}>—</span>}</td>
                <td style={{ width: 38 }}><button className="iconbtn" onClick={() => del(n.id)} aria-label="Delete"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="addbar"><button className="btn" onClick={add}><Plus size={14} /> Add node</button></div>
    </div>
  );
}

/* ---- Pipes ---- */
function PipesEditor({ project, update, openFittings }) {
  const { sys } = useUnits();
  const { nodes, pipes } = project;
  const setPipe = (id, patch) => update({ pipes: pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const del = (id) => update({ pipes: pipes.filter((p) => p.id !== id) });
  const add = () => update({ pipes: [...pipes, mkPipe(nodes[0]?.id, nodes[1]?.id || nodes[0]?.id, 3, 10)] });
  const opts = nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>);
  return (
    <div className="card">
      <div className="head"><Activity size={15} color="var(--fire)" /><h3>Pipes</h3>
        <span className="desc">Hazen-Williams · loops allowed</span></div>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>From</th><th>To</th><th>Size</th><th>Sched</th><th>Material (C)</th><th>Length ({lab(sys, "length")})</th><th>Fittings</th><th></th></tr></thead>
          <tbody>
            {pipes.map((p) => {
              const g = pipeGeom(p);
              return (
                <tr key={p.id}>
                  <td style={{ minWidth: 96 }}><select className="cellsel" value={p.from} onChange={(e) => setPipe(p.id, { from: e.target.value })}>{opts}</select></td>
                  <td style={{ minWidth: 96 }}><select className="cellsel" value={p.to} onChange={(e) => setPipe(p.id, { to: e.target.value })}>{opts}</select></td>
                  <td style={{ width: 78 }}><select className="cellsel" value={p.sizeIdx} onChange={(e) => setPipe(p.id, { sizeIdx: +e.target.value })}>
                    {SCHED40.map((s, i) => <option key={i} value={i}>{s.nom}</option>)}</select></td>
                  <td style={{ width: 92 }}><select className="cellsel" value={p.schedule || "sched40"} onChange={(e) => setPipe(p.id, { schedule: e.target.value })}>
                    {Object.entries(SCHED).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></td>
                  <td style={{ width: 128 }}><select className="cellsel" value={p.C} onChange={(e) => setPipe(p.id, { C: +e.target.value })}>
                    {MATERIALS.map((m, i) => <option key={i} value={m.c}>{m.label} · {m.c}</option>)}</select></td>
                  <td style={{ width: 80 }}><NumField className="cellinput" q="length" value={p.length} onChange={(v) => setPipe(p.id, { length: v })} /></td>
                  <td style={{ width: 104 }}><button className="chip" style={{ cursor: "pointer" }} onClick={() => openFittings(p.id)}>
                    <Wrench size={12} />{g.rawEquiv > 0 ? `+${num(toDisp(sys, "length", g.adjEquiv), UPREC[sys].length)}` : "none"}</button></td>
                  <td style={{ width: 38 }}><button className="iconbtn" onClick={() => del(p.id)} aria-label="Delete"><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="addbar"><button className="btn" onClick={add}><Plus size={14} /> Add pipe</button></div>
    </div>
  );
}

function FittingModal({ pipe, pipes, update, close }) {
  const { sys } = useUnits();
  if (!pipe) return null;
  const setF = (k, v) => update({ pipes: pipes.map((p) => p.id === pipe.id ? { ...p, fittings: { ...p.fittings, [k]: Math.max(0, v | 0) } } : p) });
  const g = pipeGeom(pipe);
  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead"><Wrench size={15} color="var(--gold)" /><h3 style={{ margin: 0, fontSize: 14 }}>Fittings & valves</h3>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--mut)" }}>{SCHED40[pipe.sizeIdx].nom}</span>
          <button className="iconbtn" onClick={close} style={{ marginLeft: 8 }}><X size={14} /></button></div>
        <div className="mbody">
          <table className="tbl" style={{ marginBottom: 14 }}>
            <thead><tr><th>Fitting</th><th>Each ({lab(sys, "length")})</th><th>Qty</th></tr></thead>
            <tbody>{Object.entries(FITTINGS).map(([k, f]) => (
              <tr key={k}><td>{f.label}</td>
                <td className="mono">{num(toDisp(sys, "length", f.vals[pipe.sizeIdx]), UPREC[sys].length)}</td>
                <td style={{ width: 86 }}><input className="cellinput" type="number" min="0" value={pipe.fittings?.[k] || 0} onChange={(e) => setF(k, +e.target.value)} /></td></tr>
            ))}</tbody>
          </table>
          <div className="note"><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
            <span>Equivalent length {num(toDisp(sys, "length", g.adjEquiv), UPREC[sys].length)} {lab(sys, "length")}, adjusted for C={pipe.C}. NFPA 13, Sched-40 values.</span></div>
        </div>
      </div>
    </div>
  );
}

/* ---- Sizer (parametric design tool) ---- */
function PipeSpec({ label, seg, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 6 }}>
        <select className="cellsel" value={seg.sizeIdx} onChange={(e) => onChange({ sizeIdx: +e.target.value })} aria-label={`${label} size`}>
          {SCHED40.map((s, i) => <option key={i} value={i}>{s.nom}</option>)}
        </select>
        <select className="cellsel" value={seg.schedule} onChange={(e) => onChange({ schedule: e.target.value })} aria-label={`${label} schedule`}>
          {Object.entries(SCHED).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="cellsel" value={seg.C} onChange={(e) => onChange({ C: +e.target.value })} aria-label={`${label} C-factor`}>
          {MATERIALS.map((m, i) => <option key={i} value={m.c}>C{m.c}</option>)}
        </select>
      </div>
    </div>
  );
}

const LAYOUTS = [
  { id: "tree", label: "Tree", desc: "Branch lines fed from one cross-main" },
  { id: "grid", label: "Gridded", desc: "Branch lines fed from cross-mains on both ends" },
  { id: "loop", label: "Looped", desc: "Cross-main looped back to the supply" },
];

function SizerPanel({ project, update, res }) {
  const { sys } = useUnits();
  const spec = project.sizer || defaultSizer();
  const setS = (patch) => update({ sizer: { ...spec, ...patch } });
  const setSeg = (grp, patch) => update({ sizer: { ...spec, [grp]: { ...spec[grp], ...patch } } });
  const intField = (v) => Math.max(1, parseInt(v, 10) || 1);

  const cov = Math.max(spec.sBranch * spec.sLine, 1);             // area per head ≈ S × L
  const minQ = spec.density * cov;
  const minP = Math.pow(minQ / (spec.K || 5.6), 2);
  const designArea = spec.lines * spec.heads * cov;
  const remoteLen = 1.2 * Math.sqrt(designArea);                  // NFPA 13 remote-area length
  const recHeadsPerLine = Math.max(1, Math.ceil(remoteLen / Math.max(spec.sBranch, 1)));

  const generate = () => {
    const { nodes, pipes } = generateNetwork(spec);
    update({
      nodes, pipes, systemType: "CMDA",
      design: { ...project.design, mode: "density", hazard: "CUS", density: spec.density,
        coverageArea: round(cov, 2), designArea: round(designArea, 2) },
    });
  };

  const maxVel = res?.ok && res.pipeRows?.length ? Math.max(...res.pipeRows.map((r) => r.vel)) : null;
  const margin = res?.ok && !res.noDemand ? res.supply.margin : null;
  const pass = margin != null && margin >= 0;

  return (
    <>
      <div className="card">
        <div className="head"><Wrench size={15} color="var(--fire)" /><h3>Sizer</h3>
          <span className="desc">Generate a network from layout & pipe sizes, then calculate</span></div>
        <div className="body">
          {/* layout */}
          <div className="field">
            <label>Layout</label>
            <div className="useg" role="group" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button key={l.id} className={spec.layout === l.id ? "on" : ""} title={l.desc}
                  onClick={() => setS({ layout: l.id })}>{l.label}</button>
              ))}
            </div>
            <span className="note" style={{ marginTop: 6 }}>{LAYOUTS.find((l) => l.id === spec.layout)?.desc}</span>
          </div>

          {/* grid dimensions */}
          <div className="grid4" style={{ marginTop: 14 }}>
            <div className="field"><label>Branch lines</label>
              <input type="number" min="1" className="txt" style={{ fontFamily: "var(--mono)" }} value={spec.lines}
                onChange={(e) => setS({ lines: intField(e.target.value) })} /></div>
            <div className="field"><label>Heads / line</label>
              <input type="number" min="1" className="txt" style={{ fontFamily: "var(--mono)" }} value={spec.heads}
                onChange={(e) => setS({ heads: intField(e.target.value) })} /></div>
            <div className="field"><label>Head spacing S ({lab(sys, "length")})</label>
              <NumField q="length" value={spec.sBranch} onChange={(v) => setS({ sBranch: v })} /></div>
            <div className="field"><label>Line spacing L ({lab(sys, "length")})</label>
              <NumField q="length" value={spec.sLine} onChange={(v) => setS({ sLine: v })} /></div>
          </div>

          {/* head + supply geometry */}
          <div className="grid4" style={{ marginTop: 12 }}>
            <div className="field"><label>K-factor</label>
              <input type="number" step="0.1" className="txt" style={{ fontFamily: "var(--mono)" }} value={spec.K}
                onChange={(e) => setS({ K: parseFloat(e.target.value) || 0 })} /></div>
            <div className="field"><label>Density ({lab(sys, "density")})</label>
              <NumField q="density" value={spec.density} onChange={(v) => setS({ density: v })} /></div>
            <div className="field"><label>System height ({lab(sys, "length")})</label>
              <NumField q="length" value={spec.elevation} onChange={(v) => setS({ elevation: v })} /></div>
            <div className="field"><label>Feed-main run ({lab(sys, "length")})</label>
              <NumField q="length" value={spec.feedLength} onChange={(v) => setS({ feedLength: v })} /></div>
          </div>

          {/* pipe sizes per group */}
          <div className="grid3" style={{ marginTop: 12 }}>
            <PipeSpec label="Branch line pipe" seg={spec.branch} onChange={(p) => setSeg("branch", p)} />
            <PipeSpec label="Cross-main pipe" seg={spec.main} onChange={(p) => setSeg("main", p)} />
            <PipeSpec label="Feed-main / riser pipe" seg={spec.feed} onChange={(p) => setSeg("feed", p)} />
          </div>

          {/* derived design basis */}
          <div className="derived">
            <div className="d"><span className="v">{num(toDisp(sys, "area", cov), UPREC[sys].area)}</span><span className="l">area / head ({lab(sys, "area")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "flow", minQ), UPREC[sys].flow)}</span><span className="l">min flow / head ({lab(sys, "flow")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "pressure", minP), UPREC[sys].pressure)}</span><span className="l">remote pressure ({lab(sys, "pressure")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "area", designArea), UPREC[sys].area)}</span><span className="l">design area ({lab(sys, "area")})</span></div>
            <div className="d"><span className="v">{recHeadsPerLine}</span><span className="l">heads/line per 1.2√A</span></div>
          </div>
          <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
            <span>Generating replaces the current nodes &amp; pipes and sets the design basis to density/area. The 1.2√A rule suggests {recHeadsPerLine} heads on each branch line in the remote area — you have {spec.heads}. Fine-tune anything afterward in the Network tab.</span></div>
        </div>
        <div className="addbar"><button className="btn primary" onClick={generate}><Wrench size={14} /> Generate &amp; calculate</button></div>
      </div>

      {res?.ok && !res.noDemand && (
        <div className="card">
          <div className="head"><Gauge size={15} color="var(--water)" /><h3>Sizer result</h3>
            <span className="desc">{res.looped ? "Gridded / looped — full nodal solution" : "Tree solution"}</span></div>
          <div className="body">
            <div className="derived">
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow)}</span><span className="l">system demand ({lab(sys, "flow")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure)}</span><span className="l">required pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--water)" }}>{num(toDisp(sys, "pressure", res.supply.pAvail), UPREC[sys].pressure)}</span><span className="l">available ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: margin == null ? "var(--mut)" : pass ? "var(--ok)" : "var(--danger)" }}>{margin == null ? "—" : (margin >= 0 ? "+" : "") + num(toDisp(sys, "pressure", margin), UPREC[sys].pressure)}</span><span className="l">margin ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: maxVel != null && maxVel > 32 ? "var(--danger)" : "var(--gold)" }}>{maxVel == null ? "—" : num(toDisp(sys, "vel", maxVel), UPREC[sys].vel)}</span><span className="l">max velocity ({lab(sys, "vel")})</span></div>
            </div>
            {maxVel != null && maxVel > 32 && (
              <div className="note" style={{ marginTop: 10 }}><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none" }} />
                <span>Peak velocity exceeds ~32 ft/s — consider upsizing the affected pipe group.</span></div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Schematic({ res }) {
  const { sys } = useUnits();
  const lay = useMemo(() => layout(res), [res]);
  if (!res?.ok || !lay) return null;
  const { ids, srcId, edges, N, P } = res;
  const colW = 150, rowH = 64, padX = 70, padY = 44;
  const W = padX * 2 + lay.maxDepth * colW, H = padY * 2 + lay.maxY * rowH;
  const X = (id) => padX + lay.depth[id] * colW, Y = (id) => padY + lay.y[id] * rowH;
  const flowOf = (e) => { const u = res.HGL ? res.HGL[e.a] - res.HGL[e.b] : 0; return Math.abs(Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M)); };
  return (
    <div className="card">
      <div className="head"><Waves size={15} color="var(--water)" /><h3>Network schematic</h3>
        <span className="desc">{res.looped ? "Gridded — dashed edges close loops" : "Pressures shown at each node"}</span></div>
      <div className="body" style={{ overflowX: "auto" }}>
        <svg className="schem" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, 900), height: Math.max(220, H + 10) }}>
          {edges.map((e) => {
            const x1 = X(e.a), y1 = Y(e.a), x2 = X(e.b), y2 = Y(e.b), loop = !lay.treeEdge.has(e.id);
            return <g key={e.id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={loop ? "#5C6678" : "#33414f"} strokeWidth="3" strokeDasharray={loop ? "6 5" : ""} />
              {res.HGL && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 5} fill="var(--fire)" fontSize="10" fontFamily="var(--mono)" textAnchor="middle">{num(toDisp(sys, "flow", flowOf(e)), UPREC[sys].flow)}</text>}
            </g>;
          })}
          {ids.map((id) => {
            const nd = N[id], x = X(id), y = Y(id), src = nd.type === "source", spr = nd.type === "sprinkler";
            const fill = src ? "#FF7A1A" : spr ? (nd.active ? "#2BD4D9" : "#1B2230") : "#39424f";
            const stroke = src ? "#ffb066" : spr ? "#2BD4D9" : "#5C6678";
            return <g key={id}>
              {src ? <rect x={x - 9} y={y - 9} width="18" height="18" rx="3" fill={fill} stroke={stroke} strokeWidth="1.5" />
                : <circle cx={x} cy={y} r={spr ? 8 : 5} fill={fill} stroke={stroke} strokeWidth="1.5" />}
              <text x={x} y={y - 14} fill="var(--txt)" fontSize="11" fontWeight="600" textAnchor="middle">{nd.label}</text>
              {P && <text x={x} y={y + 22} fill="var(--mut)" fontSize="10" fontFamily="var(--mono)" textAnchor="middle">{num(toDisp(sys, "pressure", P[id]), UPREC[sys].pressure)}</text>}
            </g>;
          })}
        </svg>
      </div>
    </div>
  );
}

/* ---- Water supply ---- */
function SupplyPanel({ project, update, res }) {
  const { sys } = useUnits();
  const s = project.supply;
  const setS = (patch) => update({ supply: { ...s, ...patch } });
  const setP = (patch) => update({ supply: { ...s, pump: { ...s.pump, ...patch } } });
  const chartData = useMemo(() => {
    if (!res?.ok || res.noDemand) return [];
    const maxQ = Math.max((s.type === "pump" ? s.pump.suctionTestFlow : s.testFlow) * 1.1, res.supply.demandQ * 1.4, 100);
    const a = res.supply.availAt; const pts = [];
    for (let i = 0; i <= 40; i++) { const q = (maxQ / 40) * i; pts.push({ q: round(toDisp(sys, "flow", q), 0), p: round(toDisp(sys, "pressure", a(q)), UPREC[sys].pressure) }); }
    return pts;
  }, [res, s, sys]);

  return (
    <>
      <div className="card">
        <div className="head"><Droplets size={15} color="var(--water)" /><h3>Water supply</h3>
          <span className="desc">Flow-test record defines the available curve</span></div>
        <div className="body">
          <div className="grid3">
            <div className="field"><label>Source type</label>
              <select value={s.type} onChange={(e) => setS({ type: e.target.value })}>
                <option value="hydrant">Hydrant flow test</option>
                <option value="city">City / direct connection</option>
                <option value="pump">Fire pump</option>
              </select></div>
          </div>
          <div className="grid4" style={{ marginTop: 12 }}>
            <TextField label="Test / record ID" value={s.identifier} onChange={(v) => setS({ identifier: v })} placeholder="Hydrant #, pump tag…" />
            <TextField label="Test date" value={s.testDate} onChange={(v) => setS({ testDate: v })} />
            <TextField label="Tested by" value={s.testedBy} onChange={(v) => setS({ testedBy: v })} />
            <TextField label="Source location" value={s.sourceLocation} onChange={(v) => setS({ sourceLocation: v })} />
          </div>

          {s.type !== "pump" ? (
            <div className="grid4" style={{ marginTop: 12 }}>
              <div className="field"><label>Static ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.static} onChange={(v) => setS({ static: v })} /></div>
              <div className="field"><label>Residual ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.residual} onChange={(v) => setS({ residual: v })} /></div>
              <div className="field"><label>Test flow ({lab(sys, "flow")})</label><NumField q="flow" value={s.testFlow} onChange={(v) => setS({ testFlow: v })} /></div>
              <div className="field"><label>Hose allowance ({lab(sys, "flow")})</label><NumField q="flow" value={s.hose} onChange={(v) => setS({ hose: v })} /></div>
            </div>
          ) : (
            <>
              <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Pump curve</div>
              <div className="grid4">
                <div className="field"><label>Rated flow ({lab(sys, "flow")})</label><NumField q="flow" value={s.pump.ratedFlow} onChange={(v) => setP({ ratedFlow: v })} /></div>
                <div className="field"><label>Rated pressure ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.pump.ratedPressure} onChange={(v) => setP({ ratedPressure: v })} /></div>
                <div className="field"><label>Churn ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.pump.churnPressure} onChange={(v) => setP({ churnPressure: v })} /></div>
                <div className="field"><label>150% flow pressure ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.pump.p150} onChange={(v) => setP({ p150: v })} /></div>
              </div>
              <div className="eyebrow" style={{ margin: "16px 0 8px" }}>Suction supply (city feeding pump)</div>
              <div className="grid4">
                <div className="field"><label>Static ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.pump.suctionStatic} onChange={(v) => setP({ suctionStatic: v })} /></div>
                <div className="field"><label>Residual ({lab(sys, "pressure")})</label><NumField q="pressure" value={s.pump.suctionResidual} onChange={(v) => setP({ suctionResidual: v })} /></div>
                <div className="field"><label>Test flow ({lab(sys, "flow")})</label><NumField q="flow" value={s.pump.suctionTestFlow} onChange={(v) => setP({ suctionTestFlow: v })} /></div>
                <div className="field"><label>Hose allowance ({lab(sys, "flow")})</label><NumField q="flow" value={s.hose} onChange={(v) => setS({ hose: v })} /></div>
              </div>
            </>
          )}
          <div style={{ marginTop: 12 }}><TextField label="Supply notes" area value={s.supplyNotes} onChange={(v) => setS({ supplyNotes: v })} /></div>
        </div>
      </div>

      {res?.ok && !res.noDemand && (
        <div className="card">
          <div className="head"><BarChart3 size={15} color="var(--fire)" /><h3>Demand vs. supply</h3>
            <span className="desc">Operating point must sit under the curve</span></div>
          <div className="body"><div className="chartbox">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 28, left: 6 }}>
                <CartesianGrid stroke="#222b38" />
                <XAxis dataKey="q" stroke="#5C6678" tick={{ fontSize: 11, fill: "#8A94A6" }}
                  label={{ value: `Flow (${lab(sys, "flow")})`, position: "bottom", offset: 6, fill: "#8A94A6", fontSize: 12 }} />
                <YAxis stroke="#5C6678" tick={{ fontSize: 11, fill: "#8A94A6" }}
                  label={{ value: `Pressure (${lab(sys, "pressure")})`, angle: -90, position: "insideLeft", fill: "#8A94A6", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#141922", border: "1px solid #2A323F", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#E6EAF0" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="p" name="Available supply" stroke="#2BD4D9" strokeWidth={2.5} dot={false} />
                <ReferenceDot x={round(toDisp(sys, "flow", res.supply.demandQ), 0)} y={round(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure)}
                  r={6} fill="#FF7A1A" stroke="#FFB066" strokeWidth={2} label={{ value: "Demand", position: "top", fill: "#FF7A1A", fontSize: 11 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div></div>
        </div>
      )}
    </>
  );
}

/* ---- Results ---- */
function ResultsPanel({ res }) {
  const { sys } = useUnits();
  if (!res) return null;
  if (res.error) return <div className="card"><div className="body"><div className="note"><AlertTriangle size={15} color="var(--gold)" style={{ flex: "none" }} /><span>{res.error}</span></div></div></div>;
  if (res.noDemand) return <div className="card"><div className="body"><div className="note"><AlertTriangle size={15} color="var(--gold)" style={{ flex: "none" }} /><span>No flowing sprinklers. Mark the sprinklers in your design area as flowing to run a demand calculation.</span></div></div></div>;
  return (
    <>
      <div className="card">
        <div className="head"><Gauge size={15} color="var(--water)" /><h3>Node pressures</h3><span className="desc">{res.activeSpr.length} flowing sprinklers</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Node</th><th>Type</th><th>Elev ({lab(sys, "length")})</th><th>Pressure ({lab(sys, "pressure")})</th><th>Discharge ({lab(sys, "flow")})</th></tr></thead>
            <tbody>{res.ids.map((id) => { const nd = res.N[id]; return (
              <tr key={id}><td style={{ fontWeight: 600 }}>{nd.label}</td>
                <td><span className={`chip ${nd.type === "source" ? "src" : nd.type === "sprinkler" ? "spr" : ""}`}>{nd.type}</span></td>
                <td className="mono">{num(toDisp(sys, "length", nd.z), UPREC[sys].length)}</td>
                <td className="mono" style={{ color: "var(--water)", fontWeight: 600 }}>{num(toDisp(sys, "pressure", res.P[id]), UPREC[sys].pressure)}</td>
                <td className="mono">{res.spr[id] > 0 ? num(toDisp(sys, "flow", res.spr[id]), UPREC[sys].flow) : "—"}</td></tr>); })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="head"><Activity size={15} color="var(--fire)" /><h3>Pipe flows</h3><span className="desc">Velocity over 20 ft/s ({num(toDisp(sys, "vel", 20), UPREC[sys].vel)} {lab(sys, "vel")}) flagged</span></div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Segment</th><th>Flow ({lab(sys, "flow")})</th><th>Ø ({lab(sys, "dia")})</th><th>C</th><th>Eq. len ({lab(sys, "length")})</th><th>Loss ({lab(sys, "pressure")})</th><th>Vel ({lab(sys, "vel")})</th></tr></thead>
            <tbody>{res.pipeRows.map((r) => (
              <tr key={r.id} className={r.vel > 20 ? "warnrow" : ""}>
                <td>{r.label}</td>
                <td className="mono">{num(toDisp(sys, "flow", r.Q), UPREC[sys].flow)}</td>
                <td className="mono">{num(toDisp(sys, "dia", r.d), UPREC[sys].dia)}</td>
                <td className="mono">{r.C}</td>
                <td className="mono">{num(toDisp(sys, "length", r.Lt), UPREC[sys].length)}</td>
                <td className="mono">{num(toDisp(sys, "pressure", r.loss), UPREC[sys].pressure)}</td>
                <td className="mono">{num(toDisp(sys, "vel", r.vel), UPREC[sys].vel)}{r.vel > 20 && " ⚠"}</td></tr>))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* ---- AI ---- */
async function callClaude(userMsg, system) {
  // Standalone: POST to the server proxy (key added server-side, same response shape).
  // Claude.ai: POST directly to the runtime-authenticated endpoint.
  const url = API_BASE ? `${API_BASE}/chat` : "https://api.anthropic.com/v1/messages";
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, system, messages: [{ role: "user", content: userMsg }] }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}
function summarizeForAI(project, res, sys) {
  const L = []; const u = (q) => lab(sys, q); const f = (q, v) => (v == null || isNaN(v) ? "—" : toDisp(sys, q, v).toFixed(UPREC[sys][q]));
  L.push(`Project: ${project.name} (${project.projectNumber}) — ${project.company}`);
  L.push(`System type: ${project.systemType}. Units: ${sys === "us" ? "US" : "metric"}.`);
  L.push(`Design: remote min pressure ${f("pressure", res?.minP)} ${u("pressure")}.`);
  if (project.systemType === "CMDA" && project.design.mode === "density")
    L.push(`Density/area: ${f("density", project.design.density)} ${u("density")} over ${f("area", project.design.designArea)} ${u("area")}.`);
  const s = project.supply;
  L.push(`Supply: ${s.type}${s.identifier ? " (" + s.identifier + ")" : ""}. ` +
    (s.type === "pump" ? `pump ${f("flow", s.pump.ratedFlow)} ${u("flow")} @ ${f("pressure", s.pump.ratedPressure)} ${u("pressure")}, churn ${f("pressure", s.pump.churnPressure)}.`
      : `static ${f("pressure", s.static)} / residual ${f("pressure", s.residual)} @ ${f("flow", s.testFlow)} ${u("flow")}.`) + ` Hose ${f("flow", s.hose)} ${u("flow")}.`);
  L.push("Nodes: " + project.nodes.map((n) => `${n.label}[${n.type}${n.type === "sprinkler" ? ` K${n.k}${n.active ? " flow" : ""}` : ""}]`).join(", "));
  if (res?.ok && !res.noDemand) {
    L.push(`RESULTS: required ${f("pressure", res.requiredPs)} ${u("pressure")}, demand ${f("flow", res.totalQ)} ${u("flow")} (+hose), available ${f("pressure", res.supply.pAvail)} ${u("pressure")}, margin ${f("pressure", res.supply.margin)} ${u("pressure")}.`);
    L.push(res.looped ? "Network is gridded (looped)." : "Network is a tree.");
    const fast = res.pipeRows.filter((r) => r.vel > 20).map((r) => `${r.label} ${r.vel.toFixed(1)}ft/s`);
    if (fast.length) L.push("High velocity: " + fast.join(", "));
  } else if (res?.error) L.push("Issue: " + res.error);
  return L.join("\n");
}
function AIPanel({ project, res }) {
  const { sys } = useUnits();
  const [resp, setResp] = useState(""); const [busy, setBusy] = useState(false); const [q, setQ] = useState("");
  const run = async (userMsg) => {
    setBusy(true); setResp("");
    const system = "You are a senior fire-protection engineer at a consulting firm reviewing a sprinkler hydraulic calculation. Be concise, technical, practical. Reference NFPA 13 concepts (density/area, velocity limits, safety margin, pipe sizing, CMDA/CMSA/ESFR) where relevant. Do not fabricate code section numbers. Use short paragraphs or tight bullets.";
    try { setResp((await callClaude(`${userMsg}\n\nCurrent calculation:\n${summarizeForAI(project, res, sys)}`, system)) || "No response."); }
    catch { setResp("The AI review couldn't run here. It works inside the Claude.ai artifact runtime, which routes the request securely without an API key."); }
    finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="head"><Sparkles size={15} color="var(--gold)" /><h3>AI engineer review</h3><span className="desc">Powered by Claude</span></div>
      <div className="body">
        <div className="ai-row">
          <button className="btn" disabled={busy} onClick={() => run("Review this design. Flag risks, undersized pipe, marginal pressure, and whether supply comfortably meets demand.")}><Flame size={14} /> Review design</button>
          <button className="btn" disabled={busy} onClick={() => run("Explain these results in plain language for a plan reviewer — what governs and is it acceptable?")}><Activity size={14} /> Explain results</button>
          <button className="btn" disabled={busy} onClick={() => run("Suggest specific pipe-size or layout changes to improve the safety margin without oversizing.")}><Wrench size={14} /> Optimize sizing</button>
        </div>
        <div className="ai-row">
          <input className="ai-input" placeholder="Ask about this calculation…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { run(q); setQ(""); } }} />
          <button className="btn primary" disabled={busy || !q.trim()} onClick={() => { run(q); setQ(""); }}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Ask</button>
        </div>
        <div className="ai-resp">{busy ? <span style={{ color: "var(--mut)" }}>Analyzing the network…</span> : resp || <span style={{ color: "var(--mut)" }}>Run a review or ask a question. The current network, supply, and results are sent as context.</span>}</div>
      </div>
    </div>
  );
}

/* ---- Save / Load ---- */
const hasClaudeStore = () => typeof window !== "undefined" && window.storage && typeof window.storage.set === "function";
const PFX = "ember:proj:";
/* Unified persistence: Claude.ai artifact storage, or the standalone backend.
   Both return the same shapes SaveLoad expects ({keys:[...]}, {value}). */
const store = {
  available: () => hasClaudeStore() || !!API_BASE,
  async list() {
    if (API_BASE) {
      const r = await fetch(`${API_BASE}/projects`);
      const j = await r.json();
      return { keys: (j.keys || []).map((k) => PFX + k) };
    }
    return window.storage.list(PFX);
  },
  async get(key) {
    if (API_BASE) {
      const r = await fetch(`${API_BASE}/projects/${encodeURIComponent(key.replace(PFX, ""))}`);
      if (!r.ok) return null;
      const j = await r.json();
      return { value: j.value };
    }
    return window.storage.get(key);
  },
  async set(key, value) {
    if (API_BASE) {
      await fetch(`${API_BASE}/projects/${encodeURIComponent(key.replace(PFX, ""))}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }),
      });
      return;
    }
    return window.storage.set(key, value, false);
  },
  async delete(key) {
    if (API_BASE) { await fetch(`${API_BASE}/projects/${encodeURIComponent(key.replace(PFX, ""))}`, { method: "DELETE" }); return; }
    return window.storage.delete(key);
  },
};
function SaveLoad({ project, setProject }) {
  const [open, setOpen] = useState(false); const [list, setList] = useState([]); const [name, setName] = useState(project.name);
  if (!store.available()) return null;
  const refresh = async () => { try { const r = await store.list(); setList(((r && r.keys) || []).map((k) => k.replace(PFX, ""))); } catch { setList([]); } };
  const doSave = async () => { try { await store.set(PFX + (name || "untitled"), JSON.stringify({ ...project, name: name || "untitled" })); await refresh(); } catch {} };
  const doLoad = async (k) => { try { const r = await store.get(PFX + k); if (r) { setProject(JSON.parse(r.value)); setOpen(false); } } catch {} };
  const doDel = async (k) => { try { await store.delete(PFX + k); await refresh(); } catch {} };
  return (
    <>
      <button className="btn" onClick={() => { setName(project.name); refresh(); setOpen(true); }}><Save size={14} /> Save / Load</button>
      {open && <div className="overlay" onClick={() => setOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="mhead"><FolderOpen size={15} color="var(--water)" /><h3 style={{ margin: 0, fontSize: 14 }}>Projects</h3>
            <button className="iconbtn" onClick={() => setOpen(false)} style={{ marginLeft: "auto" }}><X size={14} /></button></div>
          <div className="mbody">
            <div className="field" style={{ marginBottom: 10 }}><label>Save current as</label>
              <div style={{ display: "flex", gap: 8 }}><input className="txt" style={{ flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} />
                <button className="btn primary" onClick={doSave}><Save size={14} /> Save</button></div></div>
            <div className="eyebrow" style={{ margin: "14px 0 8px" }}>Saved projects</div>
            {list.length === 0 && <div className="note">No saved projects yet.</div>}
            {list.map((k) => <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #1e242f" }}>
              <FolderOpen size={14} color="var(--mut)" /><span style={{ flex: 1, fontSize: 13 }}>{k}</span>
              <button className="btn" onClick={() => doLoad(k)}>Load</button>
              <button className="iconbtn" onClick={() => doDel(k)}><Trash2 size={14} /></button></div>)}
          </div>
        </div>
      </div>}
    </>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function App() {
  const [project, setProject] = useState(sampleProject);
  const [tab, setTab] = useState("network");
  const [fittingId, setFittingId] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState("");

  const sys = project.units || "us";
  const update = (patch) => setProject((p) => ({ ...p, ...patch }));
  const res = useMemo(() => { try { return analyze(project); } catch (e) { return { error: String(e.message || e) }; } }, [project]);
  const margin = res?.ok && !res.noDemand ? res.supply.margin : null;
  const pass = margin != null && margin >= 0;

  const doExport = async () => {
    setPdfBusy(true); setPdfErr("");
    try { await exportPDF(project, res, sys); }
    catch (e) { setPdfErr("PDF export needs to load its library from the network. If you're offline or it's blocked, try again on a connection."); }
    finally { setPdfBusy(false); }
  };

  const tabs = [
    { id: "project", label: "Project", icon: Building2 },
    { id: "sizer", label: "Sizer", icon: Wrench },
    { id: "network", label: "Network", icon: GitBranch },
    { id: "supply", label: "Water supply", icon: Droplets },
    { id: "results", label: "Results", icon: Gauge },
    { id: "ai", label: "AI review", icon: Sparkles },
  ];

  return (
    <UnitsCtx.Provider value={{ sys }}>
      <div className="ember">
        <style>{CSS}</style>
        <div className="hdr">
          <div className="brand"><div className="mark"><Flame size={19} color="var(--fire)" /></div>
            <div><h1>EMBER</h1><div className="sub">DGA Consulting · sprinkler hydraulics</div></div></div>
          <input className="pname" value={project.name} onChange={(e) => update({ name: e.target.value })} aria-label="Project name" />
          <div className="spacer" />
          <div className="useg" role="group" aria-label="Units">
            <button className={sys === "us" ? "on" : ""} onClick={() => update({ units: "us" })}>US</button>
            <button className={sys === "si" ? "on" : ""} onClick={() => update({ units: "si" })}>Metric</button>
          </div>
          <button className="btn" onClick={() => setProject(sampleProject())}><FilePlus2 size={14} /> Sample</button>
          <button className="btn" onClick={() => setProject(blankProject())}><FilePlus2 size={14} /> New</button>
          <SaveLoad project={project} setProject={setProject} />
          <button className="btn primary" onClick={doExport} disabled={pdfBusy}>{pdfBusy ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} Export PDF</button>
        </div>

        <div className="kpis">
          <div className="kpi fire"><div className="lab eyebrow"><Gauge size={13} color="var(--fire)" /> Required pressure</div>
            <div className="val">{res?.ok && !res.noDemand ? num(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
            <div className="meta">at the supply connection</div></div>
          <div className="kpi fire"><div className="lab eyebrow"><Flame size={13} color="var(--fire)" /> System demand</div>
            <div className="val">{res?.ok && !res.noDemand ? num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow) : "—"}<span className="unit">{lab(sys, "flow")}</span></div>
            <div className="meta">{res?.ok && !res.noDemand ? `+${num(toDisp(sys, "flow", project.supply.hose), UPREC[sys].flow)} hose` : "no flowing heads"}</div></div>
          <div className="kpi water"><div className="lab eyebrow"><Droplets size={13} color="var(--water)" /> Available supply</div>
            <div className="val">{res?.ok && !res.noDemand ? num(toDisp(sys, "pressure", res.supply.pAvail), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
            <div className="meta">at {res?.ok && !res.noDemand ? num(toDisp(sys, "flow", res.supply.demandQ), UPREC[sys].flow) : "—"} {lab(sys, "flow")}</div></div>
          <div className="kpi"><div className="lab eyebrow"><CheckCircle2 size={13} color={pass ? "var(--ok)" : "var(--danger)"} /> Safety margin</div>
            <div className="val" style={{ color: margin == null ? "var(--mut)" : pass ? "var(--ok)" : "var(--danger)" }}>{margin == null ? "—" : (margin >= 0 ? "+" : "") + num(toDisp(sys, "pressure", margin), UPREC[sys].pressure)}<span className="unit">{lab(sys, "pressure")}</span></div>
            <div className="meta">{margin == null ? "—" : <span className={`tag ${pass ? "ok" : "bad"}`}>{pass ? <><CheckCircle2 size={11} /> Supply meets demand</> : <><AlertTriangle size={11} /> Demand exceeds supply</>}</span>}</div></div>
        </div>

        <div className="tabs">{tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}><t.icon size={14} /> {t.label}</button>)}</div>

        <div className="wrap">
          {pdfErr && <div className="card"><div className="body"><div className="note"><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none" }} /><span>{pdfErr}</span></div></div></div>}
          {res?.error && <div className="card"><div className="body"><div className="note"><AlertTriangle size={15} color="var(--gold)" style={{ flex: "none" }} /><span>{res.error}</span></div></div></div>}
          {res?.ok && res.disconnected?.length > 0 && <div className="card"><div className="body"><div className="note"><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none" }} /><span>Not connected to supply: {res.disconnected.map((n) => n.label).join(", ")}. These nodes are ignored.</span></div></div></div>}
          {res?.ok && res.looped && tab !== "project" && <div className="card"><div className="body"><div className="note"><Waves size={14} color="var(--water)" style={{ flex: "none" }} /><span>Gridded (looped) network — solved with the full nodal method.</span></div></div></div>}

          {tab === "project" && <ProjectPanel project={project} update={update} />}
          {tab === "sizer" && <>
            <SizerPanel project={project} update={update} res={res} />
            <Schematic res={res} />
          </>}
          {tab === "network" && <>
            <DesignBasisPanel project={project} update={update} res={res} />
            <NodesEditor project={project} update={update} />
            <PipesEditor project={project} update={update} openFittings={(id) => setFittingId(id)} />
            <Schematic res={res} />
          </>}
          {tab === "supply" && <SupplyPanel project={project} update={update} res={res} />}
          {tab === "results" && <ResultsPanel res={res} />}
          {tab === "ai" && <AIPanel project={project} res={res} />}
        </div>

        <FittingModal pipe={fittingId ? project.pipes.find((p) => p.id === fittingId) : null} pipes={project.pipes} update={update} close={() => setFittingId(null)} />
      </div>
    </UnitsCtx.Provider>
  );
}
