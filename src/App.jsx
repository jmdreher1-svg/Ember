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

   IDEAS TO BEAT HYDRACALC (candidate differentiators)
   ---------------------------------------------------
   [x] NFPA-worksheet PDF (HydraCALC-style) export — title page, N^1.85 supply
       curve, node-to-node Hazen-Williams worksheet, flow summary, fittings.
   [x] Whole-system Sizer with a selectable remote-area factor (1.0/1.2/1.4)
       that auto-flags the operating area and highlights it on the plan.
   [ ] Live, real-time solve (already instant) + side-by-side scenario compare
       (e.g. wet vs dry +30% area, K=5.6 vs K=8.0) in one report.
   [ ] One-click code checks: velocity limits, max pressure (175 psi), C-factor
       per material, hose/inside-hose allowances by occupancy — with pass/fail.
   [ ] AI design review + plain-language plan-reviewer narrative (already wired).
   [ ] Peaking/auto-balance optimizer that minimizes pipe cost ($/ft catalog)
       instead of just velocity — true least-cost sizing.
   [ ] Cloud projects, shareable links, versioned revisions & audit trail.
   [ ] Import: .wxf/.sdf (HydraCALC), .dxf backgrounds, CAD round-trip.
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

  const mode = project.calcMode === "evaluate" ? "evaluate" : "design";
  const hose = supply.hose || 0;
  let requiredPs, warm = null;

  if (mode === "evaluate") {
    // FIELD / FORENSIC mode — no hydraulic design info available.
    // The as-built piping + heads + the water supply fix the operating point:
    // find the source pressure Ps where the pressure the supply can deliver at
    // the resulting total demand equals Ps itself,
    //     Ps = availAt( Q_system(Ps) + hose ).
    // availAt() decreases with flow and Q_system increases with Ps, so the
    // residual availAt(...) − Ps is strictly decreasing → bisection converges.
    let lo = 0, hi = Math.max(availAt(0), 1);
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2;
      const r = solveNetwork(ctx, mid, warm, opts); warm = r.HGL;
      const resid = availAt(r.totalQ + hose) - mid;
      if (resid > 0) lo = mid; else hi = mid;
    }
    requiredPs = (lo + hi) / 2;
  } else {
    // DESIGN search: source pressure so the min active-sprinkler discharge
    // (normal) pressure == minP (warm-started)
    let lo = minP, hi = minP + 3000;
    for (let i = 0; i < 64; i++) {
      const mid = (lo + hi) / 2;
      const r = solveNetwork(ctx, mid, warm, opts); warm = r.HGL;
      const m = Math.min(...activeSpr.map((s) => r.Pn[s.id]));
      if (m < minP) lo = mid; else hi = mid;
    }
    requiredPs = (lo + hi) / 2;
  }
  const sol = solveNetwork(ctx, requiredPs, warm, opts);

  const totalQ = activeSpr.reduce((a, s) => a + sol.spr[s.id], 0);
  const pipeRows = edges.map((e) => {
    const u = sol.HGL[e.a] - sol.HGL[e.b];
    const flow = Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M);
    return { id: e.id, a: e.a, b: e.b,
      label: `${N[e.a].label} → ${N[e.b].label}`,
      Q: Math.abs(flow), dir: flow >= 0 ? 1 : -1,
      d: e.g.d, C: e.g.C, Lt: e.g.Lt,
      loss: e.g.R * Math.pow(Math.abs(flow), 1.85), vel: velocity(Math.abs(flow), e.g.d) };
  });

  const demandQ = totalQ + hose;
  const pAvail = availAt(demandQ);
  const margin = pAvail - requiredPs;

  // Delivered ("as-evaluated") metrics — what the installed system actually
  // produces at the operating point. Primary outputs in evaluate mode; in
  // design mode they simply confirm the remote head sits at minP.
  const cov = project.design.coverageArea > 0 ? project.design.coverageArea : 0;
  let endHeadId = null, endHeadP = Infinity, endHeadQ = 0, minHeadQ = Infinity;
  for (const s of activeSpr) {
    const p = sol.Pn[s.id];
    if (p < endHeadP) { endHeadP = p; endHeadId = s.id; endHeadQ = sol.spr[s.id]; }
    if (sol.spr[s.id] < minHeadQ) minHeadQ = sol.spr[s.id];
  }
  if (!isFinite(endHeadP)) { endHeadP = 0; minHeadQ = 0; }
  const opArea = activeSpr.length * cov;
  const densityAvg = cov > 0 ? (totalQ / activeSpr.length) / cov : null;  // mean gpm/ft² over the operating area
  const densityMin = cov > 0 ? minHeadQ / cov : null;                     // worst (most-remote head) gpm/ft²

  return {
    ok: true, mode, looped, disconnected, ids, N, srcId, edges, geom,
    P: sol.P, Pn: sol.Pn, spr: sol.spr, HGL: sol.HGL, requiredPs, operatingPs: requiredPs,
    totalQ, pipeRows, activeSpr, minP, velocityPressure: opts.velocityPressure,
    endHeadId, endHeadP, endHeadQ, coverageArea: cov, opArea, densityAvg, densityMin,
    supply: { availAt, demandQ, pAvail, margin },
  };
}

/* ---------- Node path (NFPA "Final Calculations" ordering) ----------
   Trace each flow path from the most-remote sprinkler back toward the supply,
   exactly as a hand calc / HydraCALC worksheet walks the network. Returns
   ordered "blocks" (one contiguous remote→supply run each), so the worksheet
   prints branch by branch and the running total pressure ties to the solver. */
function nodePath(res) {
  if (!res?.ok || !res.edges?.length || !res.HGL) return null;
  const { ids, srcId, edges, N, HGL } = res;
  const adj = Object.fromEntries(ids.map((id) => [id, []]));
  edges.forEach((e) => { adj[e.a].push({ o: e.b, e }); adj[e.b].push({ o: e.a, e }); });
  // spanning tree from the source (parent = the neighbor one step closer to supply)
  const depth = { [srcId]: 0 }, parent = {}, parentEdge = {}, seen = new Set([srcId]), q = [srcId];
  while (q.length) {
    const u = q.shift();
    for (const { o, e } of adj[u]) if (!seen.has(o)) { seen.add(o); depth[o] = depth[u] + 1; parent[o] = u; parentEdge[o] = e; q.push(o); }
  }
  const flowOf = (e) => { const u = HGL[e.a] - HGL[e.b]; return Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M); };
  // deepest nodes first → start each path at a remote tip
  const order = ids.filter((id) => id !== srcId && seen.has(id)).sort((a, b) => depth[b] - depth[a]);
  const emitted = new Set();
  const blocks = [];
  for (const start of order) {
    if (!parentEdge[start] || emitted.has(parentEdge[start].id)) continue;
    let cur = start; const segs = []; let prevQt = 0;
    while (cur !== srcId && parentEdge[cur] && !emitted.has(parentEdge[cur].id)) {
      const e = parentEdge[cur]; emitted.add(e.id);
      const up = parent[cur];                         // node one step toward the supply
      const Qt = Math.abs(flowOf(e));
      const isLeaf = segs.length === 0;
      const Qa = isLeaf ? (res.spr[cur] || Qt) : Qt - prevQt; // flow picked up at this node
      segs.push({ from: cur, to: up, e, Qt, Qa });
      prevQt = Qt; cur = up;
    }
    if (segs.length) blocks.push({ segs, tie: cur });  // tie = where it joined an existing path (or the source)
  }
  return { blocks, depth, parent, parentEdge, flowOf };
}

/* Key points for the NFPA water-supply / demand graph (N^1.85 scale).
   C1/C2 = supply test points · D1 = elevation, D2 = system, D3 = system+hose. */
function supplyCurvePoints(res, project) {
  const s = project.supply;
  const availAt = supplyAvailFn(s);
  const staticP = availAt(0);
  const testFlow = s.type === "pump" ? s.pump.suctionTestFlow : s.testFlow;
  const testRes = availAt(testFlow);
  const demand = res?.ok && !res.noDemand ? res : null;
  let d1Elev = 0, d2Flow = 0, d2P = 0, d3Flow = 0, margin = null;
  if (demand) {
    const srcZ = res.N[res.srcId]?.z || 0;
    const elevs = res.activeSpr.map((sp) => res.N[sp.id]?.z ?? srcZ);
    d1Elev = EHEAD * (Math.max(srcZ, ...(elevs.length ? elevs : [srcZ])) - srcZ);
    d2Flow = res.totalQ; d2P = res.requiredPs;
    d3Flow = res.supply.demandQ; margin = res.supply.margin;
  }
  return { availAt, staticP, testFlow, testRes, d1Elev, d2Flow, d2P, d3Flow, margin, hasDemand: !!demand };
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

/* ---------- Plan (shop-drawing) layout ----------
   Top-down "as-built" coordinates. When the network carries real plan
   coordinates (x/y in feet — Sizer-generated), use them directly. Otherwise
   derive an orthogonal grid from the BFS schematic so any hand-built network
   still renders with right-angle routing. */
function planLayout(res, nodes) {
  if (!res?.ids?.length) return null;
  const { ids } = res;
  const byId = Object.fromEntries((nodes || []).map((n) => [n.id, n]));
  const hasCoords = ids.every((id) => {
    const n = byId[id];
    return n && Number.isFinite(n.x) && Number.isFinite(n.y);
  });
  const pos = {};
  if (hasCoords) {
    ids.forEach((id) => { const n = byId[id]; pos[id] = { x: n.x, y: n.y }; });
  } else {
    const lay = layout(res);
    if (!lay) return null;
    const COL = 16, ROW = 11; // representative ft spacing for derived grids
    ids.forEach((id) => { pos[id] = { x: (lay.depth[id] || 0) * COL, y: (lay.y[id] || 0) * ROW }; });
  }
  return { pos, isPlan: hasCoords };
}

/* Manhattan / right-angle route between two points: a straight run when the
   endpoints share a row or column, otherwise an L (horizontal leg, then
   vertical) so the drawing only ever shows 90° turns. */
function orthPath(a, b) {
  const EPS = 1e-6;
  if (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS) return [a, b];
  return [a, { x: b.x, y: a.y }, b];
}

/* Midpoint of a polyline's longest leg — where a dimension/size label reads best. */
function labelAnchor(path) {
  let best = null, bestLen = -1;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > bestLen) { bestLen = len; best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horiz: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) }; }
  }
  return best || { x: path[0].x, y: path[0].y, horiz: true };
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

function schematicSVGString(res, sys, project) {
  const lay = planLayout(res, project?.nodes); if (!lay) return null;
  const { ids, edges, N, P } = res;
  const pos = lay.pos;
  const pipeById = Object.fromEntries((project?.pipes || []).map((p) => [p.id, p]));
  const flowOf = (e) => {
    const u = res.HGL ? res.HGL[e.a] - res.HGL[e.b] : 0;
    return Math.abs(Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M));
  };
  // fit the plan bounds (including elbow points) into a sensible page image
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  edges.forEach((e) => orthPath(pos[e.a], pos[e.b]).forEach(acc));
  ids.forEach((id) => acc(pos[id]));
  if (!isFinite(minX)) return null;
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
  const PAD = 46;
  const sc = Math.max(Math.min(720 / spanX, 420 / spanY, 26), 5);
  const W = spanX * sc + 2 * PAD, H = spanY * sc + 2 * PAD;
  const X = (x) => PAD + (x - minX) * sc, Y = (y) => PAD + (y - minY) * sc;
  const ulab = lab(sys, "length"), tick = ulab === "ft" ? "'" : ` ${ulab}`;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>`;
  edges.forEach((e) => {
    const path = orthPath(pos[e.a], pos[e.b]);
    const pts = path.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
    const g = e.g, sw = Math.max(Math.min(g.d * 0.8, 6), 1.6);
    s += `<polyline points="${pts}" fill="none" stroke="#475569" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const pp = pipeById[e.id];
    const nom = pp ? SCHED40[pp.sizeIdx].nom : `${g.d.toFixed(2)}"`;
    const len = toDisp(sys, "length", pp ? pp.length : g.Lt).toFixed(UPREC[sys].length);
    const a = labelAnchor(path), lx = X(a.x), ly = Y(a.y) - 5;
    s += `<text x="${lx}" y="${ly}" fill="#0f172a" font-size="9" font-family="monospace" text-anchor="middle">${nom} · ${len}${tick}</text>`;
    if (res.HGL) s += `<text x="${lx}" y="${ly + 10}" fill="#c2410c" font-size="8.5" font-family="monospace" text-anchor="middle">${toDisp(sys, "flow", flowOf(e)).toFixed(UPREC[sys].flow)} ${lab(sys, "flow")}</text>`;
  });
  ids.forEach((id) => {
    const x = X(pos[id].x), y = Y(pos[id].y), nd = N[id];
    const src = nd.type === "source", spr = nd.type === "sprinkler";
    if (src) s += `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2" fill="#ea580c"/>`;
    else if (spr) s += `<circle cx="${x}" cy="${y}" r="6" fill="${nd.active ? "#0891b2" : "#e2e8f0"}" stroke="#475569"/>`;
    else s += `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" fill="#94a3b8" stroke="#475569"/>`;
    s += `<text x="${x}" y="${y - 11}" fill="#0f172a" font-size="9" font-weight="bold" text-anchor="middle">${nd.label}</text>`;
    if (P) s += `<text x="${x}" y="${y + 17}" fill="#475569" font-size="8.5" font-family="monospace" text-anchor="middle">${toDisp(sys, "pressure", P[id]).toFixed(UPREC[sys].pressure)}</text>`;
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
  const evalMode = project.calcMode === "evaluate";
  sectionHead(evalMode ? "As-Evaluated Results" : "Results Summary");
  const ok = res?.ok && !res.noDemand;
  const margin = ok ? res.supply.margin : null;
  const pass = margin != null && margin >= 0;
  if (evalMode) {
    kv([
      [`Expected flow`, ok ? `${fmt("flow", res.totalQ)} ${U("flow")} (+${fmt("flow", s.hose)} hose)` : "—"],
      [`End-head pressure`, ok ? `${fmt("pressure", res.endHeadP)} ${U("pressure")}` : "—"],
      [`Source pressure`, ok ? `${fmt("pressure", res.operatingPs)} ${U("pressure")} @ ${fmt("flow", res.supply.demandQ)} ${U("flow")}` : "—"],
      [`Avg density`, ok && res.densityAvg != null ? `${fmt("density", res.densityAvg)} ${U("density")}` : "—"],
      [`Remote-head density`, ok && res.densityMin != null ? `${fmt("density", res.densityMin)} ${U("density")}` : "—"],
      [`Operating area`, ok ? `${fmt("area", res.opArea)} ${U("area")}` : "—"],
    ]);
  } else {
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
  }

  /* schematic image */
  try {
    const sv = schematicSVGString(res, sys, project);
    if (sv) {
      const png = await svgToPng(sv.svg, sv.W, sv.H);
      if (png) {
        const maxW = PW - 2 * MX, scale = Math.min(maxW / sv.W, 1), w = sv.W * scale, h = sv.H * scale;
        if (yy + h > PH - 60) { doc.addPage(); yy = 60; }
        sectionHead("Plan View — Shop Drawing");
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
   NFPA / HydraCALC-STYLE WORKSHEET PDF
   The format AHJs and plan reviewers expect: title page, water-supply
   curve, the node-to-node "Final Calculations: Hazen-Williams" worksheet,
   a flow summary (supply + node analysis), and the fittings legend.
   ============================================================ */
// NFPA fitting legend abbreviations, keyed to EMBER's FITTINGS map.
const FIT_ABBR = { e90: "E", e45: "F", tee: "T", gate: "G", bfly: "BV", chk: "S" };
const FIT_NAME = {
  e90: "90° Standard Elbow", e45: "45° Elbow", tee: "90° Flow thru Tee",
  gate: "Gate Valve", bfly: "Butterfly Valve", chk: "Swing Check",
};

async function exportHydraCalcPDF(project, res, sys) {
  await ensurePdfLibs();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const PW = doc.internal.pageSize.getWidth();   // 612
  const PH = doc.internal.pageSize.getHeight();  // 792
  const ML = 40, MR = PW - 40;
  /* modern palette — slate ink, amber accent, teal water */
  const AMBER = [234, 88, 12], AMBER_SOFT = [254, 237, 222];
  const SLATE = [30, 41, 59], TEAL = [13, 117, 146];
  const INK = [17, 24, 39], GRAY = [100, 116, 139], LINE = [203, 213, 225];
  const ZEBRA = [248, 250, 252], OKC = [22, 163, 74], BADC = [220, 38, 38];
  const fmt = (q, v, dec) => (v == null || isNaN(v) ? "" : toDisp(sys, q, v).toFixed(dec ?? UPREC[sys][q]));
  const U = (q) => lab(sys, q);
  const company = project.company || "DGA Consulting";
  const job = project.name || "Hydraulic Calculation";
  const dateStr = project.reportDate || today();
  const evalMode = project.calcMode === "evaluate";
  let pageNo = 0;

  /* a small stylized flame mark (matches the on-screen brand) */
  const flameMark = (cx, baseY, h, color = AMBER, inner = [255, 178, 92]) => {
    doc.setFillColor(...color); doc.triangle(cx - h * 0.32, baseY, cx + h * 0.32, baseY, cx, baseY - h, "F");
    doc.setFillColor(...inner); doc.triangle(cx - h * 0.16, baseY, cx + h * 0.16, baseY, cx, baseY - h * 0.55, "F");
  };

  /* shared modern header band + section title on every content page */
  const startPage = (title, first = false) => {
    if (!first) doc.addPage();
    pageNo += 1;
    doc.setFillColor(...SLATE); doc.rect(0, 0, PW, 50, "F");
    doc.setFillColor(...AMBER); doc.rect(0, 50, PW, 3, "F");
    flameMark(ML + 9, 35, 20);
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("EMBER", ML + 24, 25);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(203, 213, 225);
    doc.text(company.toUpperCase(), ML + 24, 36);
    doc.setFontSize(8); doc.setTextColor(226, 232, 240);
    doc.text(job, MR, 20, { align: "right" });
    doc.setFontSize(7.5); doc.setTextColor(203, 213, 225);
    doc.text(`Page ${pageNo}   ·   ${dateStr}`, MR, 33, { align: "right" });
    doc.setTextColor(...SLATE); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(title, ML, 76);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.line(ML, 84, MR, 84);
    doc.setLineWidth(0.5); doc.setTextColor(...INK);
    return 102; // first content y
  };
  const footer = (revLike) => {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(ML, PH - 34, MR, PH - 34);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text(revLike || "Hazen-Williams analysis per NFPA 13 methodology · to be reviewed and sealed by a licensed professional engineer.", ML, PH - 22);
    doc.text(`${company} · EMBER`, ML, PH - 12);
    doc.text(`Page ${pageNo}`, MR, PH - 12, { align: "right" });
    doc.setTextColor(...INK);
  };
  /* rounded status / value pill */
  const chip = (x, y, text, fill, tcol = [255, 255, 255], w) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    const ww = w || doc.getTextWidth(text) + 18;
    doc.setFillColor(...fill); doc.roundedRect(x, y - 11, ww, 16, 3, 3, "F");
    doc.setTextColor(...tcol); doc.text(text, x + ww / 2, y, { align: "center" });
    doc.setTextColor(...INK);
    return ww;
  };

  /* ---------- 1 · COVER ---------- */
  pageNo = 1;
  // thin slate + amber masthead rule
  doc.setFillColor(...SLATE); doc.rect(0, 0, PW, 7, "F");
  doc.setFillColor(...AMBER); doc.rect(0, 7, PW, 2.5, "F");
  // flame + wordmark
  flameMark(PW / 2, 190, 76);
  doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
  doc.text("EMBER", PW / 2, 234, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(13); doc.setTextColor(...GRAY);
  doc.text("Hydraulic Calculation Report", PW / 2, 256, { align: "center" });
  doc.setFontSize(9.5); doc.setTextColor(...AMBER);
  doc.text(evalMode ? "FIELD EVALUATION  ·  as-built · NFPA 13 methodology" : `${project.systemType || "CMDA"}  ·  NFPA 13 methodology`, PW / 2, 272, { align: "center" });
  doc.setTextColor(...INK);

  // project information card
  const jbX = PW / 2 - 215, jbW = 430, jbY = 300;
  const info = [
    ["Job Name", job],
    ["Project No.", project.projectNumber || "—"],
    ["Client", project.client || "—"],
    ["Drawing", project.drawingNumber || "—"],
    ["Location", project.location || "—"],
    ["Remote Area", project.systemType === "CMDA" && project.design.mode === "density"
      ? `${fmt("area", project.design.designArea)} ${U("area")}  (factor ${project.sizer?.remoteAreaFactor ?? 1.2})` : "—"],
    ["Prepared by", project.preparedBy || "—"],
    ["PE / License", project.peNumber || "—"],
    ["Date", dateStr],
  ];
  const rowH = 19, jbH = 24 + info.length * rowH + 8;
  doc.setDrawColor(...LINE); doc.setLineWidth(1);
  doc.roundedRect(jbX, jbY, jbW, jbH, 5, 5, "S");
  doc.setFillColor(...SLATE); doc.roundedRect(jbX, jbY, jbW, 24, 5, 5, "F"); doc.rect(jbX, jbY + 14, jbW, 10, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(9.5);
  doc.text("PROJECT INFORMATION", jbX + 14, jbY + 16);
  let iy = jbY + 24 + 14;
  doc.setFontSize(9.5);
  info.forEach(([k, v], i) => {
    if (i % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(jbX + 1, iy - 12, jbW - 2, rowH, "F"); }
    doc.setFont("helvetica", "bold"); doc.setTextColor(...GRAY); doc.text(k, jbX + 14, iy);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...INK); doc.text(String(v || "—"), jbX + 140, iy);
    iy += rowH;
  });

  // results banner (KPIs)
  const okCover = res?.ok && !res.noDemand;
  if (okCover) {
    const by = jbY + jbH + 30;
    let kpis;
    if (evalMode) {
      chip(PW / 2 - 70, by, "AS-EVALUATED RESULTS", SLATE, [255, 255, 255], 140);
      kpis = [
        ["EXPECTED FLOW", `${fmt("flow", res.totalQ)} ${U("flow")}`, SLATE],
        ["END-HEAD P", `${fmt("pressure", res.endHeadP)} ${U("pressure")}`, SLATE],
        ["SOURCE P", `${fmt("pressure", res.operatingPs)} ${U("pressure")}`, SLATE],
        ["DENSITY", res.densityAvg != null ? `${fmt("density", res.densityAvg)}` : "—", AMBER],
      ];
    } else {
      const margin = res.supply.margin, pass = margin >= 0;
      chip(PW / 2 - 95, by, pass ? "PASS — SUPPLY MEETS DEMAND" : "FAIL — DEMAND EXCEEDS SUPPLY", pass ? OKC : BADC, [255, 255, 255], 190);
      kpis = [
        ["REQUIRED", `${fmt("pressure", res.requiredPs)} ${U("pressure")}`, SLATE],
        ["DEMAND", `${fmt("flow", res.totalQ)} ${U("flow")}`, SLATE],
        ["AVAILABLE", `${fmt("pressure", res.supply.pAvail)} ${U("pressure")}`, SLATE],
        ["MARGIN", `${margin >= 0 ? "+" : ""}${fmt("pressure", margin)} ${U("pressure")}`, pass ? OKC : BADC],
      ];
    }
    const cw = jbW / 4, ky = by + 22;
    kpis.forEach(([k, v, col], i) => {
      const cx = jbX + i * cw;
      doc.setFillColor(...(i === 3 && !evalMode ? (res.supply.margin >= 0 ? [236, 253, 243] : [254, 242, 242]) : ZEBRA));
      doc.roundedRect(cx + 3, ky, cw - 6, 48, 3, 3, "F");
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...GRAY);
      doc.text(k, cx + cw / 2, ky + 16, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(...col);
      doc.text(v, cx + cw / 2, ky + 35, { align: "center" });
    });
    doc.setTextColor(...INK);
  }
  footer("Hydraulic Calculations by EMBER · DGA Consulting fire-protection engineering");

  /* ---------- 2 · WATER SUPPLY CURVE ---------- */
  if (res?.ok) {
    let yy = startPage("Water Supply Curve");
    const sp = supplyCurvePoints(res, project);
    const s = project.supply;
    // two summary cards (City Water Supply · System Demand)
    const cardW = (MR - ML - 16) / 2, cardH = 90;
    const drawCard = (x, title, rows, accent) => {
      doc.setDrawColor(...LINE); doc.setLineWidth(0.8);
      doc.roundedRect(x, yy, cardW, cardH, 4, 4, "S");
      doc.setFillColor(...accent); doc.rect(x, yy + 4, 3.5, cardH - 8, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(...SLATE);
      doc.text(title, x + 14, yy + 18);
      doc.setDrawColor(...LINE); doc.setLineWidth(0.5); doc.line(x + 14, yy + 24, x + cardW - 12, yy + 24);
      doc.setFontSize(8.5);
      rows.forEach(([k, v], i) => {
        const ry = yy + 39 + i * 13;
        doc.setFont("helvetica", "normal"); doc.setTextColor(...GRAY); doc.text(k, x + 14, ry);
        doc.setFont("helvetica", "bold"); doc.setTextColor(...INK); doc.text(String(v || "—"), x + cardW - 14, ry, { align: "right" });
      });
      doc.setTextColor(...INK);
    };
    drawCard(ML, "City Water Supply", [
      [`C1 — Static (${U("pressure")})`, fmt("pressure", sp.staticP)],
      [`C2 — Residual (${U("pressure")})`, fmt("pressure", sp.testRes)],
      [`C2 — Test flow (${U("flow")})`, fmt("flow", sp.testFlow)],
    ], TEAL);
    drawCard(ML + cardW + 16, evalMode ? "System Demand (as-built)" : "System Demand", [
      [`D1 — Elevation (${U("pressure")})`, fmt("pressure", sp.d1Elev)],
      [`D2 — System (${U("flow")} @ ${U("pressure")})`, `${fmt("flow", sp.d2Flow)} @ ${fmt("pressure", sp.d2P)}`],
      [`Hose allowance (${U("flow")})`, fmt("flow", s.hose)],
      [`D3 — Demand (${U("flow")})`, fmt("flow", sp.d3Flow)],
      evalMode
        ? [`Operating pressure (${U("pressure")})`, fmt("pressure", res.operatingPs)]
        : [`Safety margin (${U("pressure")})`, sp.margin == null ? "—" : `${sp.margin >= 0 ? "+" : ""}${fmt("pressure", sp.margin)}`],
    ], AMBER);
    yy += cardH + 22;

    // ---- graph (flow axis on the N^1.85 scale) ----
    const gx = ML + 36, gy = yy + 4, gw = MR - gx - 6, gh = PH - gy - 74;
    const flowD = (v) => toDisp(sys, "flow", v), pD = (v) => toDisp(sys, "pressure", v);
    const pPeak = Math.max(pD(sp.staticP), pD(sp.d2P), 10) * 1.1;
    const pTicks = niceTicks(pPeak, 8);
    const pTop = pTicks[pTicks.length - 1] || pPeak;
    const qPeak = Math.max(flowD(sp.testFlow) * 1.05, flowD(sp.d3Flow) * 1.2, 100);
    const qTicks = niceTicks(qPeak, 9);
    const qMaxDisp = qTicks[qTicks.length - 1] || qPeak;     // top flow tick — also the plot's right edge
    const qTop = Math.pow(qMaxDisp, HW_N);
    const PX = (qDisp) => gx + (Math.pow(Math.max(qDisp, 0), HW_N) / qTop) * gw;
    const PY = (pDisp) => gy + gh - (Math.min(Math.max(pDisp, 0), pTop) / pTop) * gh;
    const clampX = (x) => Math.max(gx, Math.min(gx + gw, x));   // keep every drawn point inside the plot
    // plot background + grid
    doc.setFillColor(...ZEBRA); doc.rect(gx, gy, gw, gh, "F");
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    pTicks.forEach((t) => { const y = PY(t); doc.line(gx, y, gx + gw, y); doc.text(String(Math.round(t)), gx - 6, y + 2.5, { align: "right" }); });
    let lastTx = -99;
    qTicks.forEach((t) => { if (t <= 0) return; const x = PX(t); doc.line(x, gy, x, gy + gh); if (x - lastTx >= 24) { doc.text(String(Math.round(t)), x, gy + gh + 12, { align: "center" }); lastTx = x; } });
    // frame + axis titles
    doc.setDrawColor(...SLATE); doc.setLineWidth(1); doc.rect(gx, gy, gw, gh);
    doc.setTextColor(...SLATE); doc.setFontSize(8.5); doc.setFont("helvetica", "bold");
    doc.text(`FLOW ( ${U("flow")} ) — N^1.85 SCALE`, gx + gw / 2, gy + gh + 28, { align: "center" });
    doc.text(`PRESSURE ( ${U("pressure")} )`, gx - 26, gy + gh / 2, { align: "center", angle: 90 });
    doc.setFont("helvetica", "normal");
    // supply curve — sampled only across the plotted flow range, so it never leaves the box
    const qMaxUS = toUS(sys, "flow", qMaxDisp);
    doc.setDrawColor(...TEAL); doc.setLineWidth(1.8); let prev = null;
    for (let i = 0; i <= 60; i++) {
      const qUS = (qMaxUS / 60) * i;
      const pt = { x: clampX(PX(flowD(qUS))), y: PY(pD(sp.availAt(qUS))) };
      if (prev) doc.line(prev.x, prev.y, pt.x, pt.y);
      prev = pt;
    }
    const mark = (qDisp, pDisp, tag, fill, dx = 5, dy = -4) => {
      const x = clampX(PX(qDisp)), y = PY(pDisp);
      doc.setFillColor(...fill); doc.circle(x, y, 2.6, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...SLATE);
      doc.text(tag, Math.min(x + dx, gx + gw - 14), Math.max(y + dy, gy + 8));
      doc.setFont("helvetica", "normal"); doc.setTextColor(...INK);
    };
    mark(flowD(0), pD(sp.staticP), "C1", TEAL);
    mark(flowD(sp.testFlow), pD(sp.testRes), "C2", TEAL);
    if (sp.hasDemand) {
      doc.setDrawColor(...AMBER); doc.setLineWidth(1.1);
      doc.line(clampX(PX(flowD(0))), PY(pD(sp.d1Elev)), clampX(PX(flowD(sp.d2Flow))), PY(pD(sp.d2P)));
      mark(flowD(0), pD(sp.d1Elev), "D1", AMBER, 5, 12);
      mark(flowD(sp.d2Flow), pD(sp.d2P), "D2", AMBER);
      mark(flowD(sp.d3Flow), pD(sp.d2P), "D3", AMBER, 5, 13);
    }
    // legend (top-right, inside the plot)
    const lgW = 138, lgX = gx + gw - lgW - 8, lgY = gy + 16, lgH = sp.hasDemand ? 32 : 18;
    doc.setFillColor(255, 255, 255); doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
    doc.roundedRect(lgX, lgY - 11, lgW, lgH, 3, 3, "FD");
    doc.setDrawColor(...TEAL); doc.setLineWidth(1.8); doc.line(lgX + 8, lgY, lgX + 26, lgY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...INK);
    doc.text("Available supply", lgX + 32, lgY + 2.5);
    if (sp.hasDemand) {
      doc.setDrawColor(...AMBER); doc.setLineWidth(1.1); doc.line(lgX + 8, lgY + 14, lgX + 26, lgY + 14);
      doc.text("System demand", lgX + 32, lgY + 16.5);
    }
    footer();
  }

  /* ---------- 3 · PLAN VIEW — SHOP DRAWING (diagram for the node-to-node analysis) ---------- */
  if (res?.ok && !res.noDemand) {
    try {
      const sv = schematicSVGString(res, sys, project);
      const png = sv ? await svgToPng(sv.svg, sv.W, sv.H) : null;
      if (png) {
        let yy = startPage("Plan View — Shop Drawing");
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...GRAY);
        doc.text("Node-to-node layout for the calculations that follow. Pipe labels show nominal size · length · flow; node labels show pressure.",
          ML, yy, { maxWidth: MR - ML });
        yy += 16;
        const availH = PH - yy - 96;
        const scale = Math.min((MR - ML) / sv.W, availH / sv.H);
        const w = sv.W * scale, h = sv.H * scale, ix = ML + ((MR - ML) - w) / 2;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.8); doc.rect(ix - 4, yy - 4, w + 8, h + 8, "S");
        doc.addImage(png, "PNG", ix, yy, w, h);
        yy += h + 28;
        // legend
        let lx = ML;
        const legendItem = (draw, label) => {
          draw(lx); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
          doc.text(label, lx + 16, yy);
          lx += doc.getTextWidth(label) + 50;
        };
        legendItem((x) => { doc.setFillColor(234, 88, 12); doc.rect(x, yy - 8, 10, 10, "F"); }, "Supply / source");
        legendItem((x) => { doc.setFillColor(8, 145, 178); doc.circle(x + 5, yy - 3, 5, "F"); }, "Flowing sprinkler");
        legendItem((x) => { doc.setFillColor(148, 163, 184); doc.rect(x + 1, yy - 7, 8, 8, "F"); }, "Junction");
        doc.setTextColor(...INK);
        footer();
      }
    } catch { /* diagram is best-effort; skip if it can't be rasterized */ }
  }

  /* ---------- 4 · FINAL CALCULATIONS : HAZEN-WILLIAMS ---------- */
  const path = nodePath(res);
  if (res?.ok && !res.noDemand && path) {
    const pipeById = Object.fromEntries((project.pipes || []).map((p) => [p.id, p]));
    // column anchors (pt). number columns right-aligned at the x given.
    const C = { node: ML, elev: ML + 50, kfac: ML + 122, q: ML + 178, nom: ML + 188, fit: ML + 224,
      equiv: ML + 296, plt: ML + 354, cf: ML + 398, ppf: ML + 446, note: ML + 452 };
    const RH = 11; // row height
    let yy = startPage("Final Calculations : Hazen-Williams");
    const colHead = () => {
      doc.setFillColor(241, 245, 249); doc.rect(ML, yy - 9, MR - ML, 30, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(7.6); doc.setTextColor(...SLATE);
      const r1 = yy, r2 = yy + 9, r3 = yy + 18;
      doc.text("Node1", C.node, r1); doc.text("to", C.node, r2); doc.text("Node2", C.node, r3);
      doc.text("Elev1", C.elev, r1); doc.text("Elev2", C.elev, r3);
      doc.text("K", C.kfac, r1, { align: "right" }); doc.text("Fact", C.kfac, r3, { align: "right" });
      doc.text("Qa", C.q, r1, { align: "right" }); doc.text("Qt", C.q, r3, { align: "right" });
      doc.text("Nom", C.nom, r1); doc.text("Act", C.nom, r3);
      doc.text("Fitting", C.fit, r1); doc.text("or", C.fit, r2); doc.text("Eqiv", C.fit, r3);
      doc.text("Pipe", C.plt, r1, { align: "right" }); doc.text("Ftngs", C.plt, r2, { align: "right" }); doc.text("Total", C.plt, r3, { align: "right" });
      doc.text("Len", C.equiv, r3, { align: "right" });
      doc.text("CFact", C.cf, r1, { align: "right" }); doc.text("Pf/Ft", C.cf, r3, { align: "right" });
      doc.text("Pt", C.ppf, r1, { align: "right" }); doc.text("Pe", C.ppf, r2, { align: "right" }); doc.text("Pf", C.ppf, r3, { align: "right" });
      doc.text("Notes", C.note + 22, r2);
      yy = r3 + 6;
      doc.setLineWidth(1.2); doc.setDrawColor(...SLATE); doc.line(ML, yy, MR, yy); yy += 12;
      doc.setFont("courier", "normal"); doc.setFontSize(7.4); doc.setTextColor(...INK);
    };
    colHead();
    let segIdx = 0;
    const ensure = (h) => { if (yy + h > PH - 56) { footer(); yy = startPage("Final Calculations : Hazen-Williams"); colHead(); } };
    const R = (x, y, t) => { if (t !== "" && t != null) doc.text(String(t), x, y, { align: "right" }); };
    const L = (x, y, t) => { if (t !== "" && t != null) doc.text(String(t), x, y); };

    for (const block of path.blocks) {
      for (const seg of block.segs) {
        ensure(RH * 3 + 4);
        if (segIdx++ % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(ML, yy - 9, MR - ML, RH * 3 + 3, "F"); }
        const e = seg.e, pp = pipeById[e.id];
        const n1 = seg.from, n2 = seg.to;
        const z1 = res.N[n1].z, z2 = res.N[n2].z;
        const g = e.g;
        const Qt = seg.Qt, Qa = seg.Qa;
        // fittings present on this pipe
        const fitList = [];
        for (const k in FITTINGS) {
          const cnt = pp?.fittings?.[k] || 0;
          if (cnt > 0) { const each = FITTINGS[k].vals[pp.sizeIdx] * fittingFactor(pp.C); fitList.push({ ab: (cnt > 1 ? cnt : "") + FIT_ABBR[k], eq: cnt * each }); }
        }
        const ftngsTot = fitList.reduce((a, f) => a + f.eq, 0);
        const pipeLen = pp ? pp.length : (g.Lt - g.adjEquiv);
        const Pt1 = res.P[n1], Pt2 = res.P[n2];
        const Pe = EHEAD * (z1 - z2);
        const Pf = g.R * Math.pow(Qt, HW_N);
        const PfFt = g.Lt > 0 ? Pf / g.Lt : 0;
        const vel = velocity(Qt, g.d);
        const y1 = yy, y2 = yy + RH, y3 = yy + RH * 2;
        // row 1
        L(C.node, y1, res.N[n1].label);
        R(C.elev, y1, fmt("length", z1, 0));
        R(C.kfac, y1, res.N[n1].type === "sprinkler" ? fmt("kfac", res.N[n1].k) : "");
        R(C.q, y1, fmt("flow", Math.abs(Qa) < 5e-3 ? 0 : Qa, 2));
        L(C.nom, y1, pp ? SCHED40[pp.sizeIdx].nom.replace(/"/g, "") : g.d.toFixed(2));
        if (fitList[0]) { L(C.fit, y1, fitList[0].ab); R(C.equiv, y1, fitList[0].eq.toFixed(3)); }
        R(C.plt, y1, fmt("length", pipeLen, 3));
        R(C.cf, y1, pp ? pp.C : g.C);
        R(C.ppf, y1, fmt("pressure", Pt1, 3));
        // row 2 (mid)
        L(C.node, y2, "to");
        if (fitList[1]) { L(C.fit, y2, fitList[1].ab); R(C.equiv, y2, fitList[1].eq.toFixed(3)); }
        if (ftngsTot > 0) R(C.plt, y2, fmt("length", ftngsTot, 3));
        R(C.ppf, y2, fmt("pressure", Pe, 1));
        // row 3
        L(C.node, y3, res.N[n2].label);
        R(C.elev, y3, fmt("length", z2, 0));
        R(C.q, y3, fmt("flow", Qt, 2));
        L(C.nom, y3, fmt("dia", g.d, 3));
        R(C.plt, y3, fmt("length", g.Lt, 3));
        R(C.cf, y3, PfFt.toFixed(4));
        R(C.ppf, y3, fmt("pressure", Pf, 3));
        L(C.note, y3, `Vel = ${fmt("vel", vel, 2)}`);
        // extra fitting rows (3+) rare — fold remaining into note
        if (fitList.length > 2) L(C.note, y2, fitList.slice(2).map((f) => f.ab).join(" "));
        yy = y3 + RH + 3;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(ML, yy - 8, MR, yy - 8);
      }
      // tie-in / junction summary line: accumulated flow, pressure, effective K
      ensure(RH * 2 + 4);
      doc.setFillColor(...AMBER_SOFT); doc.rect(ML, yy - 9, MR - ML, RH * 2 + 7, "F");
      const tie = block.tie;
      const lastSeg = block.segs[block.segs.length - 1];
      const tieQ = lastSeg.Qt, tieP = res.P[tie];
      const isSrc = tie === res.srcId;
      const kEff = tieP > 0 ? tieQ / Math.sqrt(tieP) : 0;
      doc.setFont("courier", "normal"); doc.setFontSize(7.4);
      if (isSrc && (project.supply.hose || 0) > 0) {
        R(C.q, yy, fmt("flow", project.supply.hose, 2));
        L(C.note, yy, `Qa = ${fmt("flow", project.supply.hose, 2)}`);
      }
      L(C.node, yy + RH, res.N[tie].label);
      R(C.q, yy + RH, fmt("flow", isSrc ? res.supply.demandQ : tieQ, 2));
      R(C.ppf, yy + RH, fmt("pressure", tieP, 3));
      L(C.note, yy + RH, `K Factor = ${(isSrc && res.supply.demandQ > 0 ? res.supply.demandQ / Math.sqrt(Math.max(tieP, 1e-6)) : kEff).toFixed(2)}`);
      yy += RH * 2 + 4;
      doc.setDrawColor(...INK); doc.setLineWidth(0.6); doc.line(ML, yy - 6, MR, yy - 6); yy += 6;
    }
    footer();
  }

  /* ---------- 5 · FLOW SUMMARY (design info + supply + node analysis) ---------- */
  if (res?.ok && !res.noDemand) {
    let yy = startPage("Flow Summary — NFPA");
    // section title helper (amber underline)
    const subHead = (t, w) => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...SLATE);
      doc.text(t, ML, yy); yy += 6;
      doc.setDrawColor(...AMBER); doc.setLineWidth(1.4); doc.line(ML, yy, ML + (w || 110), yy); yy += 14;
    };

    /* --- Hydraulic Design Information / As-Evaluated Results --- */
    const d = project.design;
    const kGov = res.activeSpr?.length ? Math.min(...res.activeSpr.map((x) => x.k)) : 5.6;
    const di = [];
    if (evalMode) {
      subHead("As-Evaluated Results", 150);
      di.push([`Expected flow`, `${fmt("flow", res.totalQ)} ${U("flow")}`]);
      di.push([`End-head pressure`, `${fmt("pressure", res.endHeadP)} ${U("pressure")}`]);
      di.push([`Source pressure`, `${fmt("pressure", res.operatingPs)} ${U("pressure")}`]);
      di.push([`Avg density`, res.densityAvg != null ? `${fmt("density", res.densityAvg)} ${U("density")}` : "—"]);
      di.push([`Remote-head density`, res.densityMin != null ? `${fmt("density", res.densityMin)} ${U("density")}` : "—"]);
      di.push([`Coverage / head`, `${fmt("area", d.coverageArea)} ${U("area")}`]);
      di.push([`Operating area`, `${fmt("area", res.opArea)} ${U("area")}`]);
      di.push([`Flowing heads`, String(res.activeSpr.length)]);
      di.push([`Governing K-factor`, fmt("kfac", kGov)]);
      di.push([`Hose allowance`, `${fmt("flow", project.supply.hose)} ${U("flow")}`]);
      di.push([`Velocity pressures`, res.velocityPressure ? "Included (Pn)" : "Not included"]);
    } else {
      subHead("Hydraulic Design Information", 168);
      di.push(["System type", project.systemType]);
      if (project.systemType === "CMDA" && d.mode === "density") {
        const dc = densityCalc(d, kGov);
        di.push([`Density`, `${fmt("density", d.density)} ${U("density")}`]);
        di.push([`Coverage / head`, `${fmt("area", d.coverageArea)} ${U("area")}`]);
        di.push([`Remote (design) area`, `${fmt("area", d.designArea)} ${U("area")}`]);
        di.push([`Design sprinklers`, String(dc.nHeads)]);
        di.push([`Min flow / head`, `${fmt("flow", dc.minQ)} ${U("flow")}`]);
      } else {
        di.push([`Design sprinklers`, String(d.designSprinklers)]);
      }
      di.push([`Min remote pressure`, `${fmt("pressure", res.minP)} ${U("pressure")}`]);
      di.push([`Governing K-factor`, fmt("kfac", kGov)]);
      di.push([`Hose allowance`, `${fmt("flow", project.supply.hose)} ${U("flow")}`]);
      di.push([`Velocity pressures`, res.velocityPressure ? "Included (Pn)" : "Not included"]);
    }
    const diColW = (MR - ML) / 2;
    di.forEach((p, i) => {
      const cx = ML + (i % 2) * diColW, ry = yy + Math.floor(i / 2) * 15;
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...GRAY); doc.text(p[0] + ":", cx, ry);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...INK); doc.text(String(p[1]), cx + 128, ry);
    });
    yy += Math.ceil(di.length / 2) * 15 + 18;

    /* --- Supply Analysis --- */
    subHead("Supply Analysis", 96);
    const sa = supplyCurvePoints(res, project);
    const saCols = [["Source", ML + 6], ["Static", ML + 108], ["Residual", ML + 172], ["Test Flow", ML + 240],
      ["Available", ML + 325], ["Demand", ML + 408], [evalMode ? "Source P" : "Required", ML + 488]];
    doc.setFillColor(...SLATE); doc.rect(ML, yy - 10, MR - ML, 15, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
    saCols.forEach(([t, x]) => doc.text(t, x, yy));
    yy += 18; doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    const saVals = [project.supply.type === "pump" ? "PUMP" : "SUPPLY", fmt("pressure", sa.staticP), fmt("pressure", sa.testRes),
      fmt("flow", sa.testFlow), fmt("pressure", res.supply.pAvail), fmt("flow", res.supply.demandQ), fmt("pressure", res.requiredPs)];
    saCols.forEach(([t, x], i) => doc.text(String(saVals[i]), x, yy));
    yy += 16;
    if (evalMode) {
      chip(ML + 6, yy, `OPERATING POINT  ·  ${fmt("flow", res.supply.demandQ)} ${U("flow")} @ ${fmt("pressure", res.operatingPs)} ${U("pressure")}`, SLATE);
    } else {
      const pass = res.supply.margin >= 0;
      chip(ML + 6, yy, pass ? `PASS  ·  margin +${fmt("pressure", res.supply.margin)} ${U("pressure")}`
        : `FAIL  ·  ${fmt("pressure", res.supply.margin)} ${U("pressure")} short`, pass ? OKC : BADC);
    }
    yy += 28;

    /* --- Node Analysis --- */
    subHead("Node Analysis", 88);
    const naCols = [["Node", ML + 6], [`Elev (${U("length")})`, ML + 96], [`K (${U("kfac")})`, ML + 180],
      [`Pressure (${U("pressure")})`, ML + 278], [`Discharge (${U("flow")})`, ML + 392], ["Notes", ML + 494]];
    const naHead = () => {
      doc.setFillColor(...SLATE); doc.rect(ML, yy - 10, MR - ML, 15, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(255, 255, 255);
      naCols.forEach(([t, x]) => doc.text(t, x, yy));
      yy += 17; doc.setTextColor(...INK); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    };
    naHead();
    let zi = 0;
    for (const id of res.ids) {
      if (yy > PH - 54) { footer(); yy = startPage("Flow Summary — NFPA"); naHead(); }
      if (zi % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(ML, yy - 9, MR - ML, 13, "F"); }
      const nd = res.N[id];
      doc.setTextColor(...INK);
      doc.text(nd.label, ML + 6, yy);
      doc.text(fmt("length", nd.z, 1), ML + 96, yy);
      doc.text(nd.type === "sprinkler" ? fmt("kfac", nd.k) : "—", ML + 180, yy);
      doc.text(fmt("pressure", res.P[id], 2), ML + 278, yy);
      doc.text(res.spr[id] > 0 ? fmt("flow", res.spr[id], 2) : "—", ML + 392, yy);
      doc.text(nd.type === "sprinkler" ? (nd.active ? "flowing" : "closed") : nd.type, ML + 494, yy);
      yy += 13; zi++;
    }
    footer();
  }

  /* ---------- 6 · FITTINGS USED + UNITS SUMMARY ---------- */
  {
    let yy = startPage("Fittings & Units Summary");
    // which fitting types are actually used?
    const used = new Set();
    (project.pipes || []).forEach((p) => { for (const k in FITTINGS) if ((p.fittings?.[k] || 0) > 0) used.add(k); });
    const usedKeys = Object.keys(FITTINGS).filter((k) => used.has(k));
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...SLATE);
    doc.text("Fitting Legend", ML, yy); yy += 6;
    doc.setDrawColor(...AMBER); doc.setLineWidth(1.4); doc.line(ML, yy, ML + 86, yy); yy += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    doc.text("Equivalent pipe length (ft) by nominal size — Sched 40, C = 120", ML, yy + 8); yy += 18;
    // header band
    const dCols = SCHED40.map((s, i) => ML + 204 + i * 34);
    doc.setFillColor(...SLATE); doc.rect(ML, yy - 10, MR - ML, 15, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    doc.text("Abbrev.", ML + 4, yy); doc.text("NFPA 13 Fitting", ML + 48, yy);
    SCHED40.forEach((s, i) => doc.text(s.nom.replace(/"/g, ""), dCols[i], yy, { align: "center" }));
    yy += 16; doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(...INK);
    (usedKeys.length ? usedKeys : Object.keys(FITTINGS)).forEach((k, ri) => {
      if (ri % 2 === 1) { doc.setFillColor(...ZEBRA); doc.rect(ML, yy - 9, MR - ML, 13, "F"); }
      doc.setFont("helvetica", "bold"); doc.setTextColor(...AMBER); doc.text(FIT_ABBR[k], ML + 4, yy);
      doc.setFont("helvetica", "normal"); doc.setTextColor(...INK); doc.text(FIT_NAME[k], ML + 48, yy);
      FITTINGS[k].vals.forEach((v, i) => doc.text(String(v), dCols[i], yy, { align: "center" }));
      yy += 13;
    });
    yy += 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...SLATE);
    doc.text("Units Summary", ML, yy); yy += 6;
    doc.setDrawColor(...AMBER); doc.setLineWidth(1.4); doc.line(ML, yy, ML + 86, yy); yy += 16;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...INK);
    const units = sys === "us"
      ? [["Diameter", "Inches"], ["Length", "Feet"], ["Flow", "US Gallons per Minute (gpm)"], ["Pressure", "Pounds per Square Inch (psi)"]]
      : [["Diameter", "Millimeters"], ["Length", "Meters"], ["Flow", "Liters per Minute (L/min)"], ["Pressure", "Bar"]];
    units.forEach(([k, v]) => { doc.setFont("helvetica", "bold"); doc.setTextColor(...GRAY); doc.text(k + ":", ML, yy); doc.setFont("helvetica", "normal"); doc.setTextColor(...INK); doc.text(v, ML + 90, yy); yy += 14; });
    yy += 14;
    doc.setFontSize(7.5); doc.setTextColor(...GRAY);
    const note = "Note: The fitting legend lists equivalent pipe lengths for fitting types of various diameters. Equivalent lengths shown are standard for Sched 40 pipe and C factors of 120; values are adjusted in the calculation for C factors other than 120 per NFPA 13.";
    doc.text(doc.splitTextToSize(note, MR - ML), ML, yy);
    footer();
  }

  const fname = (project.name || "hydraulic-calc").replace(/[^\w\-]+/g, "_") + "_NFPA.pdf";
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
/* round "nice" axis ticks (1·2·5 steps) spanning 0..max */
function niceTicks(max, target = 6) {
  if (!(max > 0)) return [0];
  const step0 = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const n = step0 / mag;
  const step = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * mag;
  const out = [];
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(round(v, 4));
  return out;
}
/* Hazen-Williams flow exponent — water-supply curves are linear on an N^1.85 axis */
const HW_N = 1.85;

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
    remoteArea: 1500,        // target design (remote) area within the whole system (ft²)
    remoteAreaFactor: 1.2,   // NFPA 13 along-branch shape factor (heads/line = factor·√A ÷ spacing)
    elevation: 12,           // system height above supply (ft)
    feedLength: 20,          // riser / feed-main run to the first cross-main (ft)
    branch: { schedule: "sched40", sizeIdx: 1, C: 120 }, // 1¼"
    main:   { schedule: "sched40", sizeIdx: 6, C: 120 }, // 4"
    feed:   { schedule: "sched40", sizeIdx: 8, C: 120 }, // 6"
    vLimit: 32,              // auto-size velocity ceiling (ft/s)
    autoSizeOnGen: false,    // run auto-size automatically after Generate
  };
}

/* Auto-size: choose the smallest pipe size per segment that keeps velocity
   within the limit, then relieve the highest-loss segments until the supply
   margin is met. Works per-pipe, so branch lines step down toward the tip and
   mains/feed grow as flow accumulates. Keeps each pipe's schedule and C. */
function autoSize(project, { vLimit = 32, marginTarget = 0 } = {}) {
  const maxIdx = SCHED40.length - 1;
  let pipes = project.pipes.map((p) => ({ ...p, customId: 0, sizeIdx: 0 }));
  const solve = (pp) => { try { return analyze({ ...project, pipes: pp }); } catch { return null; } };
  // phase 1 — satisfy the velocity ceiling
  for (let it = 0; it < 12; it++) {
    const r = solve(pipes);
    if (!r?.ok || r.noDemand) return project.pipes;           // nothing to size against
    const v = Object.fromEntries(r.pipeRows.map((pr) => [pr.id, pr.vel]));
    let changed = false;
    pipes = pipes.map((p) => {
      if ((v[p.id] || 0) > vLimit && p.sizeIdx < maxIdx) { changed = true; return { ...p, sizeIdx: p.sizeIdx + 1 }; }
      return p;
    });
    if (!changed) break;
  }
  // phase 2 — meet the supply margin by upsizing the highest-loss segments
  for (let it = 0; it < 12; it++) {
    const r = solve(pipes);
    if (!r?.ok || r.noDemand) break;
    if (r.supply.margin >= marginTarget) break;
    const av = r.pipeRows.filter((pr) => { const p = pipes.find((x) => x.id === pr.id); return p && p.sizeIdx < maxIdx; });
    if (!av.length) break;                                     // everything maxed out
    const cut = av.map((l) => l.loss).sort((a, b) => b - a)[Math.min(av.length - 1, Math.floor(av.length * 0.3))];
    const bump = new Set(av.filter((l) => l.loss >= cut).map((l) => l.id));
    pipes = pipes.map((p) => (bump.has(p.id) ? { ...p, sizeIdx: p.sizeIdx + 1 } : p));
  }
  return pipes;
}

/* Remote (design) area geometry from the spec. The number of sprinklers along
   each branch line in the operating area is factor·√A ÷ branch spacing (NFPA 13,
   default factor 1.2), rounded up to whole heads; the number of contributing
   branch lines follows from the remaining area. Both are clamped to the system
   the user laid out. Returns the actual rectangle that gets flagged "flowing". */
function remoteAreaDims(spec) {
  const lines = Math.max(1, spec.lines | 0), heads = Math.max(1, spec.heads | 0);
  const sB = Math.max(spec.sBranch, 1), sL = Math.max(spec.sLine, 1);
  const cov = sB * sL;
  const factor = spec.remoteAreaFactor || 1.2;
  const A = Math.max(spec.remoteArea || cov, cov);
  const headsRemote = Math.min(heads, Math.max(1, Math.ceil((factor * Math.sqrt(A)) / sB)));
  const linesRemote = Math.min(lines, Math.max(1, Math.ceil((A / cov) / headsRemote)));
  const actualArea = headsRemote * linesRemote * cov;
  const branchLen = factor * Math.sqrt(A);          // 1.2√A length along branch lines
  return { headsRemote, linesRemote, actualArea, cov, branchLen, factor, A,
    firstLine: lines - linesRemote, firstHead: heads - headsRemote };
}

function generateNetwork(spec) {
  const nodes = [], pipes = [];
  const ra = remoteAreaDims(spec);
  const mkSeg = (from, to, grp, len, extra = {}) => {
    const s = spec[grp];
    return { ...mkPipe(from, to, s.sizeIdx, round(Math.max(len, 0.1), 2)), schedule: s.schedule, C: s.C, ...extra };
  };
  const teeIn = { e90: 0, e45: 0, tee: 1, gate: 0, bfly: 0, chk: 0 }; // flow turned 90° into a branch
  const z = spec.elevation;
  const lines = Math.max(1, spec.lines | 0), heads = Math.max(1, spec.heads | 0);
  // plan (top-down, as-built) geometry in feet — the cross-main runs as a
  // vertical column at x=0, branch lines extend horizontally to the right, and
  // the feed main enters from the left. These x/y feed the orthogonal plan view.
  const sB = Math.max(spec.sBranch, 1), sL = Math.max(spec.sLine, 1), feed = Math.max(spec.feedLength, 1);

  const S = uid("n");
  nodes.push({ id: S, label: "Supply", type: "source", elevation: 0, k: 0, active: false, x: -feed, y: 0 });

  // near-side cross-main, one junction per branch line
  const cmL = [];
  for (let i = 0; i < lines; i++) { const id = uid("n"); cmL.push(id); nodes.push({ id, label: `CM${i + 1}`, type: "junction", elevation: z, k: 0, active: false, x: 0, y: i * sL }); }
  pipes.push(mkSeg(S, cmL[0], "feed", spec.feedLength));               // riser / feed main
  for (let i = 1; i < lines; i++) pipes.push(mkSeg(cmL[i - 1], cmL[i], "main", spec.sLine));

  // far-side cross-main (gridded systems feed each branch line from both ends)
  const cmR = [];
  if (spec.layout === "grid") {
    const xR = (heads + 1) * sB;
    for (let i = 0; i < lines; i++) { const id = uid("n"); cmR.push(id); nodes.push({ id, label: `CR${i + 1}`, type: "junction", elevation: z, k: 0, active: false, x: xR, y: i * sL }); }
    for (let i = 1; i < lines; i++) pipes.push(mkSeg(cmR[i - 1], cmR[i], "main", spec.sLine));
  }

  // branch lines with sprinklers
  for (let i = 0; i < lines; i++) {
    let prev = cmL[i];
    for (let j = 0; j < heads; j++) {
      const id = uid("n");
      // only the most-remote rectangle (far branch lines × tip heads) flows
      const inRemote = i >= ra.firstLine && j >= ra.firstHead;
      nodes.push({ id, label: `${String.fromCharCode(65 + (i % 26))}${j + 1}`, type: "sprinkler", elevation: z, k: spec.K, active: inRemote, x: (j + 1) * sB, y: i * sL });
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
    client: "Sample Client LLC", location: "—", drawingNumber: "FP-101", preparedBy: "", peNumber: "",
    company: "DGA Consulting", reportDate: today(), systemDesc: "Wet-pipe sprinkler system, ordinary hazard.",
    units: "us", systemType: "CMDA", calcMode: "design",
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
.planscroll{overflow:auto;background:#0c1016;border:1px solid var(--line);border-radius:10px;max-height:620px}
.planstage{position:relative}
.planstage .schem{border:none;border-radius:0}
.pipepop{position:absolute;transform:translateX(-50%);z-index:5;background:var(--panel2);border:1px solid var(--fire);border-radius:10px;padding:10px 11px;width:216px;box-shadow:0 12px 30px rgba(0,0,0,.55)}
.pipepop .pophead{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:700;color:var(--fire);margin-bottom:9px}
.pipepop .poprow{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:8px;margin-bottom:7px}
.pipepop .poprow label{font-size:10.5px;color:var(--mut);font-weight:600}
.pipepop .popnote{font-size:10px;color:var(--mut);margin-top:7px;font-family:var(--mono);line-height:1.4}
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
            <TextField label="Drawing no." value={project.drawingNumber} onChange={(v) => set({ drawingNumber: v })} />
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

/* ---- Design basis (system type + density/area or listing) ----
   In "design" mode this sets the required pressure at the remote sprinkler.
   In "evaluate" (field) mode the density/area are unknown OUTPUTS — the panel
   collects only the coverage/head and reports what the as-built system delivers. */
function DesignBasisPanel({ project, update, res }) {
  const { sys } = useUnits();
  const d = project.design;
  const evalMode = project.calcMode === "evaluate";
  const ok = res?.ok && !res.noDemand;
  const setD = (patch) => update({ design: { ...d, ...patch } });
  const setHazard = (h) => { const hz = HAZARDS[h]; setD({ hazard: h, ...(h !== "CUS" ? { density: hz.density, designArea: hz.area, coverageArea: hz.cov } : {}) }); };
  const kGov = res?.activeSpr?.length ? Math.min(...res.activeSpr.map((s) => s.k)) : 5.6;
  const dc = densityCalc(d, kGov);
  const activeCount = project.nodes.filter((n) => n.type === "sprinkler" && n.active).length;
  const targetCount = project.systemType === "CMDA" ? dc.nHeads : d.designSprinklers;

  if (evalMode) {
    return (
      <div className="card">
        <div className="head"><ClipboardList size={15} color="var(--gold)" /><h3>Field evaluation basis</h3>
          <span className="desc">No design data assumed — results come from the as-built system + supply</span></div>
        <div className="body">
          <div className="grid3">
            <div className="field"><label>Coverage / head ({lab(sys, "area")})</label>
              <NumField q="area" value={d.coverageArea} onChange={(v) => setD({ coverageArea: v })} /></div>
          </div>
          <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
            <span>Build the as-built piping (Network or Sizer tab), enter each sprinkler's <b>K-factor</b>, and the water-supply flow test (Water supply tab). Mark the operating sprinklers as <b>flowing</b> — that set is the operating area. EMBER finds the operating point where the system demand meets the supply curve, then reports the delivered flow, end-head pressure, and density. <b>Coverage / head</b> is the floor area each head protects (≈ branch spacing × line spacing); it converts head flow into density (gpm/ft²).</span></div>
          {ok ? (
            <div className="derived">
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow)}</span><span className="l">expected flow ({lab(sys, "flow")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "pressure", res.endHeadP), UPREC[sys].pressure)}</span><span className="l">end-head pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--water)" }}>{num(toDisp(sys, "pressure", res.operatingPs), UPREC[sys].pressure)}</span><span className="l">source pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--gold)" }}>{res.densityAvg != null ? num(toDisp(sys, "density", res.densityAvg), UPREC[sys].density) : "—"}</span><span className="l">avg density ({lab(sys, "density")})</span></div>
              <div className="d"><span className="v">{res.densityMin != null ? num(toDisp(sys, "density", res.densityMin), UPREC[sys].density) : "—"}</span><span className="l">remote-head density ({lab(sys, "density")})</span></div>
              <div className="d"><span className="v">{activeCount}</span><span className="l">flowing heads</span></div>
            </div>
          ) : (
            <div className="note" style={{ marginTop: 10 }}><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none", marginTop: 1 }} />
              <span>Mark the operating sprinklers as flowing (Network tab) to run the evaluation.</span></div>
          )}
          <div className="field" style={{ marginTop: 14 }}>
            <label>Velocity pressures</label>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Toggle on={!!d.velocityPressure} onChange={(v) => setD({ velocityPressure: v })} />
              <span style={{ fontSize: 12, color: "var(--mut)" }}>
                {d.velocityPressure ? "On — discharge uses normal pressure Pₙ = Pₜ − Pᵥ" : "Off — total pressure at each orifice (more conservative)"}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
  const [sizing, setSizing] = useState(false);
  const hasNet = (project.pipes || []).length > 0;
  const autoSizeNow = () => {
    setSizing(true);
    // defer so the spinner paints before the synchronous solve loop runs
    setTimeout(() => { update({ pipes: autoSize(project, { vLimit: spec.vLimit || 32, marginTarget: 0 }) }); setSizing(false); }, 10);
  };

  const cov = Math.max(spec.sBranch * spec.sLine, 1);             // area per head ≈ S × L
  const minQ = spec.density * cov;
  const minP = Math.pow(minQ / (spec.K || 5.6), 2);
  const systemArea = spec.lines * spec.heads * cov;               // the whole laid-out system
  const ra = remoteAreaDims(spec);                                // the operating (remote) rectangle
  const remoteLen = ra.branchLen;                                 // factor·√A length along branch lines

  const generate = () => {
    const { nodes, pipes } = generateNetwork(spec);
    const design = { ...project.design, mode: "density", hazard: "CUS", density: spec.density,
      coverageArea: round(cov, 2), designArea: round(ra.actualArea, 2) };
    if (spec.autoSizeOnGen) {
      setSizing(true);
      const next = { ...project, nodes, pipes, systemType: "CMDA", design };
      setTimeout(() => {
        update({ nodes, pipes: autoSize(next, { vLimit: spec.vLimit || 32, marginTarget: 0 }), systemType: "CMDA", design });
        setSizing(false);
      }, 10);
    } else {
      update({ nodes, pipes, systemType: "CMDA", design });
    }
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

          {/* pipe sizes per group + auto-size ceiling */}
          <div className="grid3" style={{ marginTop: 12 }}>
            <PipeSpec label="Branch line pipe" seg={spec.branch} onChange={(p) => setSeg("branch", p)} />
            <PipeSpec label="Cross-main pipe" seg={spec.main} onChange={(p) => setSeg("main", p)} />
            <PipeSpec label="Feed-main / riser pipe" seg={spec.feed} onChange={(p) => setSeg("feed", p)} />
          </div>
          <div className="grid2" style={{ marginTop: 12, maxWidth: 460 }}>
            <div className="field"><label>Auto-size velocity limit ({lab(sys, "vel")})</label>
              <NumField q="vel" value={spec.vLimit} onChange={(v) => setS({ vLimit: v })} /></div>
            <div className="field"><label>Auto-size on generate</label>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <Toggle on={!!spec.autoSizeOnGen} onChange={(v) => setS({ autoSizeOnGen: v })} />
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{spec.autoSizeOnGen ? "Generate then size in one click" : "Generate at the sizes above"}</span>
              </div>
            </div>
          </div>

          {/* remote (design) area — the operating rectangle inside the whole system */}
          <div className="eyebrow" style={{ margin: "18px 0 8px" }}>Remote (design) area</div>
          <div className="grid3" style={{ maxWidth: 560 }}>
            <div className="field"><label>Design area ({lab(sys, "area")})</label>
              <NumField q="area" value={spec.remoteArea} onChange={(v) => setS({ remoteArea: v })} /></div>
            <div className="field"><label>Remote area factor</label>
              <select value={spec.remoteAreaFactor} onChange={(e) => setS({ remoteAreaFactor: parseFloat(e.target.value) })}>
                <option value={1.0}>1.0 — square area</option>
                <option value={1.2}>1.2 — NFPA 13 default (1.2√A)</option>
                <option value={1.4}>1.4 — elongated / extra-stretched</option>
              </select></div>
            <div className="field"><label>Remote rectangle</label>
              <div className="cellinput" style={{ display: "flex", alignItems: "center", height: 38 }}>{ra.linesRemote} lines × {ra.headsRemote} heads</div></div>
          </div>

          {/* derived design basis */}
          <div className="derived">
            <div className="d"><span className="v">{num(toDisp(sys, "area", cov), UPREC[sys].area)}</span><span className="l">area / head ({lab(sys, "area")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "flow", minQ), UPREC[sys].flow)}</span><span className="l">min flow / head ({lab(sys, "flow")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "pressure", minP), UPREC[sys].pressure)}</span><span className="l">remote pressure ({lab(sys, "pressure")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "area", systemArea), UPREC[sys].area)}</span><span className="l">whole system ({lab(sys, "area")})</span></div>
            <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "area", ra.actualArea), UPREC[sys].area)}</span><span className="l">remote area ({lab(sys, "area")})</span></div>
            <div className="d"><span className="v">{num(toDisp(sys, "length", remoteLen), UPREC[sys].length)}</span><span className="l">{spec.remoteAreaFactor}√A length ({lab(sys, "length")})</span></div>
            <div className="d"><span className="v">{ra.linesRemote * ra.headsRemote}</span><span className="l">flowing heads</span></div>
          </div>
          <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
            <span>The whole {spec.lines}×{spec.heads} system is drawn, and the most-remote <b>{ra.linesRemote} lines × {ra.headsRemote} heads</b> ({num(toDisp(sys, "area", ra.actualArea), UPREC[sys].area)} {lab(sys, "area")}) are flagged as flowing — the operating area. {spec.remoteAreaFactor}√A puts {ra.headsRemote} heads on each branch line in that area. Generating replaces the current nodes &amp; pipes and sets the design basis to density/area. <b>Auto-size</b> then sizes every segment to hold velocity under the limit and keep the supply margin positive. Fine-tune anything afterward in the Network or Plan tabs.</span></div>
        </div>
        <div className="addbar">
          <button className="btn primary" onClick={generate}><Wrench size={14} /> Generate &amp; calculate</button>
          <button className="btn" onClick={autoSizeNow} disabled={sizing || !hasNet} title={hasNet ? "Size every pipe to meet velocity & margin" : "Generate a network first"}>
            {sizing ? <Loader2 size={14} className="spin" /> : <Activity size={14} />} Auto-size pipes</button>
        </div>
      </div>

      {res?.ok && !res.noDemand && (
        <div className="card">
          <div className="head"><Gauge size={15} color="var(--water)" /><h3>{project.calcMode === "evaluate" ? "Field evaluation result" : "Sizer result"}</h3>
            <span className="desc">{res.looped ? "Gridded / looped — full nodal solution" : "Tree solution"}</span></div>
          <div className="body">
            {project.calcMode === "evaluate" ? (
              <div className="derived">
                <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow)}</span><span className="l">expected flow ({lab(sys, "flow")})</span></div>
                <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "pressure", res.endHeadP), UPREC[sys].pressure)}</span><span className="l">end-head pressure ({lab(sys, "pressure")})</span></div>
                <div className="d"><span className="v" style={{ color: "var(--water)" }}>{num(toDisp(sys, "pressure", res.operatingPs), UPREC[sys].pressure)}</span><span className="l">source pressure ({lab(sys, "pressure")})</span></div>
                <div className="d"><span className="v" style={{ color: "var(--gold)" }}>{res.densityAvg != null ? num(toDisp(sys, "density", res.densityAvg), UPREC[sys].density) : "—"}</span><span className="l">avg density ({lab(sys, "density")})</span></div>
                <div className="d"><span className="v" style={{ color: maxVel != null && maxVel > 32 ? "var(--danger)" : "var(--gold)" }}>{maxVel == null ? "—" : num(toDisp(sys, "vel", maxVel), UPREC[sys].vel)}</span><span className="l">max velocity ({lab(sys, "vel")})</span></div>
              </div>
            ) : (
              <div className="derived">
                <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow)}</span><span className="l">system demand ({lab(sys, "flow")})</span></div>
                <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure)}</span><span className="l">required pressure ({lab(sys, "pressure")})</span></div>
                <div className="d"><span className="v" style={{ color: "var(--water)" }}>{num(toDisp(sys, "pressure", res.supply.pAvail), UPREC[sys].pressure)}</span><span className="l">available ({lab(sys, "pressure")})</span></div>
                <div className="d"><span className="v" style={{ color: margin == null ? "var(--mut)" : pass ? "var(--ok)" : "var(--danger)" }}>{margin == null ? "—" : (margin >= 0 ? "+" : "") + num(toDisp(sys, "pressure", margin), UPREC[sys].pressure)}</span><span className="l">margin ({lab(sys, "pressure")})</span></div>
                <div className="d"><span className="v" style={{ color: maxVel != null && maxVel > 32 ? "var(--danger)" : "var(--gold)" }}>{maxVel == null ? "—" : num(toDisp(sys, "vel", maxVel), UPREC[sys].vel)}</span><span className="l">max velocity ({lab(sys, "vel")})</span></div>
              </div>
            )}
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

/* ---- Plan view: top-down as-built shop drawing, editable on the drawing ---- */
function PlanDrawing({ res, project, update }) {
  const { sys } = useUnits();
  const [sel, setSel] = useState(null);                       // selected pipe id
  const lay = useMemo(() => planLayout(res, project.nodes), [res, project.nodes]);
  if (!res?.ok || !lay) return null;
  const { ids, edges, N, P } = res;
  const pos = lay.pos;
  const pipeById = Object.fromEntries((project.pipes || []).map((p) => [p.id, p]));
  const setPipe = (id, patch) => update({ pipes: project.pipes.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const flowOf = (e) => { const u = res.HGL ? res.HGL[e.a] - res.HGL[e.b] : 0; return Math.abs(Math.sign(u) * Math.pow(Math.max(Math.abs(u), 1e-12) / e.g.R, M)); };

  // fit plan bounds (incl. elbow points) into pixels at a uniform scale
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acc = (p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); };
  edges.forEach((e) => orthPath(pos[e.a], pos[e.b]).forEach(acc));
  ids.forEach((id) => acc(pos[id]));
  if (!isFinite(minX)) return null;
  const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
  const PAD = 58;
  const sc = Math.max(Math.min(820 / spanX, 560 / spanY, 30), 6); // px per ft
  const W = spanX * sc + 2 * PAD, H = spanY * sc + 2 * PAD;
  const X = (x) => PAD + (x - minX) * sc, Y = (y) => PAD + (y - minY) * sc;

  // remote (operating) area = bounding box of the flowing sprinklers
  const activeIds = ids.filter((id) => N[id].type === "sprinkler" && N[id].active);
  let rmin = null;
  if (activeIds.length) {
    let aMinX = Infinity, aMinY = Infinity, aMaxX = -Infinity, aMaxY = -Infinity;
    activeIds.forEach((id) => { const p = pos[id]; aMinX = Math.min(aMinX, p.x); aMinY = Math.min(aMinY, p.y); aMaxX = Math.max(aMaxX, p.x); aMaxY = Math.max(aMaxY, p.y); });
    rmin = { x: X(aMinX) - 16, y: Y(aMinY) - 16, w: (aMaxX - aMinX) * sc + 32, h: (aMaxY - aMinY) * sc + 32, count: activeIds.length };
  }

  const selPipe = sel ? pipeById[sel] : null;
  const selEdge = sel ? edges.find((e) => e.id === sel) : null;
  const selAnchor = selEdge ? labelAnchor(orthPath(pos[selEdge.a], pos[selEdge.b])) : null;

  return (
    <div className="card">
      <div className="head"><Waves size={15} color="var(--water)" /><h3>Plan view — shop drawing</h3>
        <span className="desc">Top-down · click a pipe to size it on the drawing</span></div>
      <div className="body">
        <div className="planscroll">
          <div className="planstage" style={{ width: W, height: H }}>
            <svg className="schem" viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block" }}
              onClick={() => setSel(null)}>
              {/* north arrow — orient the as-built */}
              <g transform={`translate(${W - 28},30)`}>
                <line x1="0" y1="13" x2="0" y2="-9" stroke="#5C6678" strokeWidth="1.5" />
                <path d="M0,-13 L4,-5 L-4,-5 Z" fill="#8A94A6" />
                <text x="0" y="25" fill="#8A94A6" fontSize="9" textAnchor="middle" fontFamily="var(--mono)">N</text>
              </g>
              {/* remote (operating) area highlight — the flowing sprinklers */}
              {rmin && (
                <g>
                  <rect x={rmin.x} y={rmin.y} width={rmin.w} height={rmin.h} rx="6"
                    fill="rgba(255,122,26,.08)" stroke="var(--fire)" strokeWidth="1.4" strokeDasharray="6 4" />
                  <text x={rmin.x + 6} y={rmin.y - 6} fill="var(--fire)" fontSize="10" fontWeight="700" fontFamily="var(--mono)">
                    Remote area · {rmin.count} heads
                  </text>
                </g>
              )}
              {edges.map((e) => {
                const path = orthPath(pos[e.a], pos[e.b]);
                const pts = path.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
                const g = e.g, sw = Math.max(Math.min(g.d * 0.9, 9), 2), on = sel === e.id;
                const a = labelAnchor(path), lx = X(a.x), ly = Y(a.y);
                const pp = pipeById[e.id];
                const nom = pp ? SCHED40[pp.sizeIdx].nom : `${g.d.toFixed(2)}"`;
                const len = pp ? num(toDisp(sys, "length", pp.length), UPREC[sys].length) : "—";
                const flow = res.HGL ? num(toDisp(sys, "flow", flowOf(e)), UPREC[sys].flow) : null;
                const lab1 = `${nom} · ${len} ${lab(sys, "length")}`;
                const bw = lab1.length * 6.3 + 12;
                return (
                  <g key={e.id} style={{ cursor: "pointer" }} onClick={(ev) => { ev.stopPropagation(); setSel(on ? null : e.id); }}>
                    <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(sw + 12, 16)} />
                    <polyline points={pts} fill="none" stroke={on ? "var(--fire)" : "#5C6678"} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
                    <g transform={`translate(${lx},${ly})`}>
                      <rect x={-bw / 2} y={-22} width={bw} height={flow != null ? 30 : 17} rx="3" fill="#0c1016" stroke={on ? "var(--fire)" : "#2A323F"} />
                      <text x="0" y={-11} fill={on ? "var(--fire)" : "var(--txt)"} fontSize="10" fontFamily="var(--mono)" textAnchor="middle">{lab1}</text>
                      {flow != null && <text x="0" y={1} fill="var(--fire)" fontSize="9.5" fontFamily="var(--mono)" textAnchor="middle">{flow} {lab(sys, "flow")}</text>}
                    </g>
                  </g>
                );
              })}
              {ids.map((id) => {
                const x = X(pos[id].x), y = Y(pos[id].y), nd = N[id];
                const src = nd.type === "source", spr = nd.type === "sprinkler";
                return (
                  <g key={id}>
                    {src ? <rect x={x - 8} y={y - 8} width="16" height="16" rx="2" fill="#FF7A1A" stroke="#ffb066" strokeWidth="1.5" />
                      : spr ? <circle cx={x} cy={y} r="7" fill={nd.active ? "#2BD4D9" : "#1B2230"} stroke="#2BD4D9" strokeWidth="1.5" />
                      : <rect x={x - 5} y={y - 5} width="10" height="10" fill="#39424f" stroke="#5C6678" strokeWidth="1.5" />}
                    <text x={x} y={y - 13} fill="var(--txt)" fontSize="10.5" fontWeight="600" textAnchor="middle">{nd.label}</text>
                    {P && <text x={x} y={y + 19} fill="var(--mut)" fontSize="9.5" fontFamily="var(--mono)" textAnchor="middle">{num(toDisp(sys, "pressure", P[id]), UPREC[sys].pressure)}</text>}
                  </g>
                );
              })}
            </svg>
            {selPipe && selAnchor && (
              <div className="pipepop" style={{ left: X(selAnchor.x), top: Y(selAnchor.y) + 14 }} onClick={(e) => e.stopPropagation()}>
                <div className="pophead"><span>{`${N[selEdge.a].label} → ${N[selEdge.b].label}`}</span>
                  <button className="iconbtn" onClick={() => setSel(null)} aria-label="Close" style={{ padding: 3 }}><X size={12} /></button></div>
                <div className="poprow"><label>Size</label>
                  <select className="cellsel" value={selPipe.sizeIdx} onChange={(e) => setPipe(sel, { sizeIdx: +e.target.value })}>
                    {SCHED40.map((s, i) => <option key={i} value={i}>{s.nom}</option>)}</select></div>
                <div className="poprow"><label>Sched</label>
                  <select className="cellsel" value={selPipe.schedule || "sched40"} onChange={(e) => setPipe(sel, { schedule: e.target.value })}>
                    {Object.entries(SCHED).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
                <div className="poprow"><label>Material</label>
                  <select className="cellsel" value={selPipe.C} onChange={(e) => setPipe(sel, { C: +e.target.value })}>
                    {MATERIALS.map((m, i) => <option key={i} value={m.c}>{m.label} · {m.c}</option>)}</select></div>
                <div className="poprow"><label>Length ({lab(sys, "length")})</label>
                  <NumField className="cellinput" q="length" value={selPipe.length} onChange={(v) => setPipe(sel, { length: v })} /></div>
                <div className="popnote">Ø {num(toDisp(sys, "dia", selEdge.g.d), UPREC[sys].dia)} {lab(sys, "dia")} · eq. len {num(toDisp(sys, "length", selEdge.g.Lt), UPREC[sys].length)} {lab(sys, "length")}</div>
              </div>
            )}
          </div>
        </div>
        <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} style={{ flex: "none", marginTop: 1 }} />
          <span>Top-down as-built view with 90° pipe routing. Click any pipe to edit its diameter, schedule, material, and length right on the drawing — edits feed straight into the calculation.</span></div>
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
  // Water-supply graph on the fire-protection N^1.85 scale: the flow axis is
  // plotted to the 1.85 power so the Hazen-Williams supply curve
  // (P = static − k·Q^1.85) renders as a straight line, as on N1.85 graph paper.
  const chart = useMemo(() => {
    if (!res?.ok || res.noDemand) return { data: [], ticks: [0], maxQx: 1 };
    const maxQ = Math.max((s.type === "pump" ? s.pump.suctionTestFlow : s.testFlow) * 1.1, res.supply.demandQ * 1.4, 100);
    const a = res.supply.availAt, pts = [];
    for (let i = 0; i <= 40; i++) {
      const q = (maxQ / 40) * i, qd = round(toDisp(sys, "flow", q), 0);
      pts.push({ q: qd, qx: Math.pow(qd, HW_N), p: round(toDisp(sys, "pressure", a(q)), UPREC[sys].pressure) });
    }
    const maxQd = toDisp(sys, "flow", maxQ);
    const ticks = niceTicks(maxQd).map((v) => round(Math.pow(v, HW_N), 4));
    return { data: pts, ticks, maxQx: Math.pow(maxQd, HW_N) };
  }, [res, s, sys]);
  const chartData = chart.data;
  const qxFmt = (v) => num(Math.pow(Math.max(v, 0), 1 / HW_N), 0);

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
            <span className="desc">N¹·⁸⁵ scale — supply plots as a straight line</span></div>
          <div className="body"><div className="chartbox">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 28, left: 6 }}>
                <CartesianGrid stroke="#222b38" />
                <XAxis dataKey="qx" type="number" scale="linear" domain={[0, chart.maxQx]} ticks={chart.ticks} tickFormatter={qxFmt}
                  stroke="#5C6678" tick={{ fontSize: 11, fill: "#8A94A6" }} allowDataOverflow
                  label={{ value: `Flow (${lab(sys, "flow")}) — N¹·⁸⁵ scale`, position: "bottom", offset: 6, fill: "#8A94A6", fontSize: 12 }} />
                <YAxis stroke="#5C6678" tick={{ fontSize: 11, fill: "#8A94A6" }}
                  label={{ value: `Pressure (${lab(sys, "pressure")})`, angle: -90, position: "insideLeft", fill: "#8A94A6", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#141922", border: "1px solid #2A323F", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#E6EAF0" }}
                  labelFormatter={(v) => `${qxFmt(v)} ${lab(sys, "flow")}`}
                  formatter={(val) => [`${val} ${lab(sys, "pressure")}`, "Available supply"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="linear" dataKey="p" name="Available supply" stroke="#2BD4D9" strokeWidth={2.5} dot={false} />
                <ReferenceDot x={round(Math.pow(toDisp(sys, "flow", res.supply.demandQ), HW_N), 4)} y={round(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure)}
                  r={6} fill="#FF7A1A" stroke="#FFB066" strokeWidth={2} label={{ value: project.calcMode === "evaluate" ? "Operating point" : "Demand", position: "top", fill: "#FF7A1A", fontSize: 11 }} />
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
      {res.mode === "evaluate" && (
        <div className="card">
          <div className="head"><Gauge size={15} color="var(--fire)" /><h3>As-evaluated results</h3>
            <span className="desc">Delivered by the as-built system at the supply's operating point</span></div>
          <div className="body">
            <div className="derived">
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow)}</span><span className="l">expected flow ({lab(sys, "flow")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--fire)" }}>{num(toDisp(sys, "pressure", res.endHeadP), UPREC[sys].pressure)}</span><span className="l">end-head pressure ({lab(sys, "pressure")}){res.endHeadId ? ` · ${res.N[res.endHeadId].label}` : ""}</span></div>
              <div className="d"><span className="v" style={{ color: "var(--water)" }}>{num(toDisp(sys, "pressure", res.operatingPs), UPREC[sys].pressure)}</span><span className="l">source pressure ({lab(sys, "pressure")})</span></div>
              <div className="d"><span className="v" style={{ color: "var(--gold)" }}>{res.densityAvg != null ? num(toDisp(sys, "density", res.densityAvg), UPREC[sys].density) : "—"}</span><span className="l">avg density ({lab(sys, "density")})</span></div>
              <div className="d"><span className="v">{res.densityMin != null ? num(toDisp(sys, "density", res.densityMin), UPREC[sys].density) : "—"}</span><span className="l">remote-head density ({lab(sys, "density")})</span></div>
              <div className="d"><span className="v">{num(toDisp(sys, "area", res.opArea), UPREC[sys].area)}</span><span className="l">operating area ({lab(sys, "area")})</span></div>
            </div>
            {res.densityAvg == null && (
              <div className="note" style={{ marginTop: 10 }}><Settings2 size={14} color="var(--gold)" style={{ flex: "none", marginTop: 1 }} />
                <span>Set <b>coverage / head</b> in the Field evaluation basis (Network tab) to report density (gpm/ft²).</span></div>
            )}
          </div>
        </div>
      )}
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
  const evalMode = project.calcMode === "evaluate";
  L.push(`System type: ${project.systemType}. Units: ${sys === "us" ? "US" : "metric"}. Mode: ${evalMode ? "FIELD EVALUATION (deriving delivered flow/pressure/density from the as-built system + supply; no design data given)" : "design"}.`);
  if (!evalMode) {
    L.push(`Design: remote min pressure ${f("pressure", res?.minP)} ${u("pressure")}.`);
    if (project.systemType === "CMDA" && project.design.mode === "density")
      L.push(`Density/area: ${f("density", project.design.density)} ${u("density")} over ${f("area", project.design.designArea)} ${u("area")}.`);
  } else {
    L.push(`Coverage / head: ${f("area", project.design.coverageArea)} ${u("area")}.`);
  }
  const s = project.supply;
  L.push(`Supply: ${s.type}${s.identifier ? " (" + s.identifier + ")" : ""}. ` +
    (s.type === "pump" ? `pump ${f("flow", s.pump.ratedFlow)} ${u("flow")} @ ${f("pressure", s.pump.ratedPressure)} ${u("pressure")}, churn ${f("pressure", s.pump.churnPressure)}.`
      : `static ${f("pressure", s.static)} / residual ${f("pressure", s.residual)} @ ${f("flow", s.testFlow)} ${u("flow")}.`) + ` Hose ${f("flow", s.hose)} ${u("flow")}.`);
  L.push("Nodes: " + project.nodes.map((n) => `${n.label}[${n.type}${n.type === "sprinkler" ? ` K${n.k}${n.active ? " flow" : ""}` : ""}]`).join(", "));
  if (res?.ok && !res.noDemand) {
    if (evalMode) {
      L.push(`RESULTS (as-evaluated at the operating point): expected flow ${f("flow", res.totalQ)} ${u("flow")} (+hose ${f("flow", res.supply.demandQ - res.totalQ)} → ${f("flow", res.supply.demandQ)} total), source/operating pressure ${f("pressure", res.operatingPs)} ${u("pressure")}, end-head (most remote) pressure ${f("pressure", res.endHeadP)} ${u("pressure")}.`);
      L.push(`Delivered density: avg ${f("density", res.densityAvg)} ${u("density")}, remote-head min ${f("density", res.densityMin)} ${u("density")} over ${f("area", res.opArea)} ${u("area")} (${res.activeSpr.length} flowing heads).`);
    } else {
      L.push(`RESULTS: required ${f("pressure", res.requiredPs)} ${u("pressure")}, demand ${f("flow", res.totalQ)} ${u("flow")} (+hose), available ${f("pressure", res.supply.pAvail)} ${u("pressure")}, margin ${f("pressure", res.supply.margin)} ${u("pressure")}.`);
    }
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
  const [pdfStyle, setPdfStyle] = useState("nfpa");   // nfpa (HydraCALC worksheet) | report (branded)

  const sys = project.units || "us";
  const evalMode = project.calcMode === "evaluate";
  const update = (patch) => setProject((p) => ({ ...p, ...patch }));
  const res = useMemo(() => { try { return analyze(project); } catch (e) { return { error: String(e.message || e) }; } }, [project]);
  const margin = res?.ok && !res.noDemand ? res.supply.margin : null;
  const pass = margin != null && margin >= 0;
  const okRes = res?.ok && !res.noDemand;

  const doExport = async () => {
    setPdfBusy(true); setPdfErr("");
    try { await (pdfStyle === "nfpa" ? exportHydraCalcPDF(project, res, sys) : exportPDF(project, res, sys)); }
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
          <div className="useg" role="group" aria-label="Calculation mode"
            title="Design — set density/area, solve for required pressure.  Field eval — derive delivered flow, end-head pressure & density from the as-built piping + water supply (no design data needed).">
            <button className={!evalMode ? "on" : ""} onClick={() => update({ calcMode: "design" })}>Design</button>
            <button className={evalMode ? "on" : ""} onClick={() => update({ calcMode: "evaluate" })}>Field eval</button>
          </div>
          <button className="btn" onClick={() => setProject(sampleProject())}><FilePlus2 size={14} /> Sample</button>
          <button className="btn" onClick={() => setProject(blankProject())}><FilePlus2 size={14} /> New</button>
          <SaveLoad project={project} setProject={setProject} />
          <select className="pname" style={{ minWidth: 0, padding: "7px 8px", fontSize: 12 }} value={pdfStyle}
            onChange={(e) => setPdfStyle(e.target.value)} aria-label="PDF style" title="PDF output style">
            <option value="nfpa">NFPA worksheet</option>
            <option value="report">Branded report</option>
          </select>
          <button className="btn primary" onClick={doExport} disabled={pdfBusy}>{pdfBusy ? <Loader2 size={14} className="spin" /> : <FileText size={14} />} Export PDF</button>
        </div>

        {evalMode ? (
          <div className="kpis">
            <div className="kpi fire"><div className="lab eyebrow"><Flame size={13} color="var(--fire)" /> Expected flow</div>
              <div className="val">{okRes ? num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow) : "—"}<span className="unit">{lab(sys, "flow")}</span></div>
              <div className="meta">{okRes ? `+${num(toDisp(sys, "flow", project.supply.hose), UPREC[sys].flow)} hose → ${num(toDisp(sys, "flow", res.supply.demandQ), UPREC[sys].flow)} total` : "no flowing heads"}</div></div>
            <div className="kpi fire"><div className="lab eyebrow"><Gauge size={13} color="var(--fire)" /> End-head pressure</div>
              <div className="val">{okRes ? num(toDisp(sys, "pressure", res.endHeadP), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
              <div className="meta">{okRes ? `most-remote head${res.endHeadId ? " · " + res.N[res.endHeadId].label : ""}` : "—"}</div></div>
            <div className="kpi water"><div className="lab eyebrow"><Droplets size={13} color="var(--water)" /> Delivered density</div>
              <div className="val">{okRes && res.densityAvg != null ? num(toDisp(sys, "density", res.densityAvg), UPREC[sys].density) : "—"}<span className="unit">{lab(sys, "density")}</span></div>
              <div className="meta">{okRes && res.densityMin != null ? `remote min ${num(toDisp(sys, "density", res.densityMin), UPREC[sys].density)}` : "set coverage / head"}</div></div>
            <div className="kpi water"><div className="lab eyebrow"><Droplets size={13} color="var(--water)" /> Source pressure</div>
              <div className="val">{okRes ? num(toDisp(sys, "pressure", res.operatingPs), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
              <div className="meta">operating point on supply curve</div></div>
          </div>
        ) : (
          <div className="kpis">
            <div className="kpi fire"><div className="lab eyebrow"><Gauge size={13} color="var(--fire)" /> Required pressure</div>
              <div className="val">{okRes ? num(toDisp(sys, "pressure", res.requiredPs), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
              <div className="meta">at the supply connection</div></div>
            <div className="kpi fire"><div className="lab eyebrow"><Flame size={13} color="var(--fire)" /> System demand</div>
              <div className="val">{okRes ? num(toDisp(sys, "flow", res.totalQ), UPREC[sys].flow) : "—"}<span className="unit">{lab(sys, "flow")}</span></div>
              <div className="meta">{okRes ? `+${num(toDisp(sys, "flow", project.supply.hose), UPREC[sys].flow)} hose` : "no flowing heads"}</div></div>
            <div className="kpi water"><div className="lab eyebrow"><Droplets size={13} color="var(--water)" /> Available supply</div>
              <div className="val">{okRes ? num(toDisp(sys, "pressure", res.supply.pAvail), UPREC[sys].pressure) : "—"}<span className="unit">{lab(sys, "pressure")}</span></div>
              <div className="meta">at {okRes ? num(toDisp(sys, "flow", res.supply.demandQ), UPREC[sys].flow) : "—"} {lab(sys, "flow")}</div></div>
            <div className="kpi"><div className="lab eyebrow"><CheckCircle2 size={13} color={pass ? "var(--ok)" : "var(--danger)"} /> Safety margin</div>
              <div className="val" style={{ color: margin == null ? "var(--mut)" : pass ? "var(--ok)" : "var(--danger)" }}>{margin == null ? "—" : (margin >= 0 ? "+" : "") + num(toDisp(sys, "pressure", margin), UPREC[sys].pressure)}<span className="unit">{lab(sys, "pressure")}</span></div>
              <div className="meta">{margin == null ? "—" : <span className={`tag ${pass ? "ok" : "bad"}`}>{pass ? <><CheckCircle2 size={11} /> Supply meets demand</> : <><AlertTriangle size={11} /> Demand exceeds supply</>}</span>}</div></div>
          </div>
        )}

        <div className="tabs">{tabs.map((t) => <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}><t.icon size={14} /> {t.label}</button>)}</div>

        <div className="wrap">
          {pdfErr && <div className="card"><div className="body"><div className="note"><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none" }} /><span>{pdfErr}</span></div></div></div>}
          {res?.error && <div className="card"><div className="body"><div className="note"><AlertTriangle size={15} color="var(--gold)" style={{ flex: "none" }} /><span>{res.error}</span></div></div></div>}
          {res?.ok && res.disconnected?.length > 0 && <div className="card"><div className="body"><div className="note"><AlertTriangle size={14} color="var(--gold)" style={{ flex: "none" }} /><span>Not connected to supply: {res.disconnected.map((n) => n.label).join(", ")}. These nodes are ignored.</span></div></div></div>}
          {res?.ok && res.looped && tab !== "project" && <div className="card"><div className="body"><div className="note"><Waves size={14} color="var(--water)" style={{ flex: "none" }} /><span>Gridded (looped) network — solved with the full nodal method.</span></div></div></div>}

          {tab === "project" && <ProjectPanel project={project} update={update} />}
          {tab === "sizer" && <>
            <SizerPanel project={project} update={update} res={res} />
            <PlanDrawing res={res} project={project} update={update} />
          </>}
          {tab === "network" && <>
            <DesignBasisPanel project={project} update={update} res={res} />
            <NodesEditor project={project} update={update} />
            <PipesEditor project={project} update={update} openFittings={(id) => setFittingId(id)} />
            <PlanDrawing res={res} project={project} update={update} />
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
