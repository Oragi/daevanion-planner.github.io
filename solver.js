/* Daevanion planner core: board decoding + the two-stage solver.
 * Port of scripts/daevanion/board_model.py + optimize.py. Pure functions, no DOM.
 *
 *   stage 1  exact node-weighted Steiner tree (Dreyfus-Wagner) per tab for every subset of
 *            the wanted skills, then a DP over the shared point pool picks the subsets.
 *   stage 2  greedy best score-per-point extension with what is left.
 */
(function (root) {
  'use strict';
  const K = (r, c) => r * 64 + c;            // node key inside a tab
  const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* ---- decoding -------------------------------------------------------- */
  function decodeBoard(build, classId, tab) {
    const B = build, T = B.tabs[tab], C = B.classes[classId] && B.classes[classId].t[tab];
    if (!T || !C) return null;
    const skillAt = new Map();
    for (let i = 0; i < C[1].length; i += 3) skillAt.set(K(C[1][i], C[1][i + 1]), B.skills[C[1][i + 2]]);
    const nodes = new Map(), L = T.L[C[0]];
    for (let i = 0; i < L.length; i += 4) {
      const r = L[i], c = L[i + 1], cost = L[i + 2], ref = L[i + 3], key = K(r, c);
      const n = { key, r, c, cost, tab, stats: [], skill: null, passive: false, centre: ref === -2 };
      if (ref >= 0) n.stats = B.sets[ref].map(([s, v]) => ({ k: B.stats[s][0], label: B.stats[s][1], role: B.stats[s][2], v }));
      if (ref === -1) { const s = skillAt.get(key); n.skill = s ? s[0] : '?'; n.passive = !!(s && s[1]); }
      nodes.set(key, n);
    }
    const centre = K(T.c[0], T.c[1]);
    for (const n of nodes.values()) n.nb = NB.map(([dr, dc]) => K(n.r + dr, n.c + dc)).filter(k => nodes.has(k));
    return { tab, title: T.t, lv: T.lv, pool: T.pool, centre, nodes };
  }

  function decodeClass(build, classId) {
    const boards = {};
    for (const t of Object.keys(build.tabs)) { const b = decodeBoard(build, classId, +t); if (b) boards[t] = b; }
    return boards;
  }

  /* ---- scoring ---------------------------------------------------------- */
  /* Weights are per raw unit. `prefs` = {stat: multiplier}. Each stat is normalised so that its
   * best value-per-point node scores exactly `multiplier` per point: 1 = as good as the best
   * node of any other stat at 1, so the multiplier compares effects fairly whatever their raw scale. */
  function statWeights(boards, prefs) {
    const best = {};
    for (const b of Object.values(boards)) for (const n of b.nodes.values()) if (n.cost)
      for (const s of n.stats) best[s.k] = Math.max(best[s.k] || 0, s.v / n.cost);
    const w = {};
    for (const k in best) w[k] = (prefs[k] || 0) / best[k];
    return w;
  }
  const scorer = w => n => { let t = 0; for (const s of n.stats) t += (w[s.k] || 0) * s.v; return t; };

  /* ---- small binary heap on (cost, negValue) ---------------------------- */
  class Heap {
    constructor() { this.a = []; }
    less(x, y) { return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]); }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1;
      while (i) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
    pop() { const a = this.a, top = a[0], last = a.pop();
      if (a.length) { a[0] = last; let i = 0;
        for (;;) { let l = 2 * i + 1, r = l + 1, m = i;
          if (l < a.length && this.less(a[l], a[m])) m = l;
          if (r < a.length && this.less(a[r], a[m])) m = r;
          if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
      return top; }
    get size() { return this.a.length; }
  }

  /* ---- reachability / level gate ----------------------------------------- */
  function reachable(board, allowed, start) {
    if (!allowed.has(start)) return new Set();
    const seen = new Set([start]), st = [start];
    while (st.length) for (const nb of board.nodes.get(st.pop()).nb) if (allowed.has(nb) && !seen.has(nb)) { seen.add(nb); st.push(nb); }
    return seen;
  }
  function usable(board, level) {
    if (level != null && level < board.lv) return new Set();
    return new Set(board.nodes.keys());
  }

  /* ---- stage 1: exact Steiner subsets ------------------------------------ */
  function steinerSubsets(board, targets, allowed, score) {
    const terms = [board.centre, ...targets];
    if (terms.some(t => !allowed.has(t))) return null;
    const keys = [...allowed].sort((a, b) => a - b), ix = new Map(keys.map((k, i) => [k, i])), n = keys.length;
    const wc = keys.map(k => board.nodes.get(k).cost), wv = keys.map(k => -score(board.nodes.get(k)));
    const edges = keys.map(k => board.nodes.get(k).nb.filter(x => ix.has(x)).map(x => ix.get(x)));
    const bits = terms.length, full = (1 << bits) - 1;
    const dc = [], dv = [], bk = [];
    for (let m = 0; m <= full; m++) { dc.push(new Float64Array(n).fill(Infinity)); dv.push(new Float64Array(n)); bk.push(new Int32Array(n).fill(-1)); }
    terms.forEach((t, i) => { const v = ix.get(t); dc[1 << i][v] = wc[v]; dv[1 << i][v] = wv[v]; });
    const lt = (c1, v1, c2, v2) => c1 < c2 || (c1 === c2 && v1 < v2);
    for (let mask = 1; mask <= full; mask++) {
      const C = dc[mask], V = dv[mask], B = bk[mask];
      for (let sub = (mask - 1) & mask; sub; sub = (sub - 1) & mask) {
        const other = mask ^ sub; if (sub >= other) continue;
        const lc = dc[sub], lv = dv[sub], rc = dc[other], rv = dv[other];
        for (let v = 0; v < n; v++) {
          if (lc[v] === Infinity || rc[v] === Infinity) continue;
          const cc = lc[v] + rc[v] - wc[v], cv = lv[v] + rv[v] - wv[v];
          if (lt(cc, cv, C[v], V[v])) { C[v] = cc; V[v] = cv; B[v] = sub << 1; }
        }
      }
      const h = new Heap();
      for (let v = 0; v < n; v++) if (C[v] !== Infinity) h.push([C[v], V[v], v]);
      while (h.size) {
        const [c, vv, u] = h.pop(); if (c !== C[u] || vv !== V[u]) continue;
        for (const v of edges[u]) {
          const cc = c + wc[v], cv = vv + wv[v];
          if (lt(cc, cv, C[v], V[v])) { C[v] = cc; V[v] = cv; B[v] = (u << 1) | 1; h.push([cc, cv, v]); }
        }
      }
    }
    const collect = (mask, v) => {
      const out = new Set(), st = [[mask, v]];
      while (st.length) { const [m, i] = st.pop(); out.add(keys[i]); const s = bk[m][i]; if (s < 0) continue;
        if (s & 1) st.push([m, s >> 1]); else { const sub = s >> 1; st.push([sub, i], [m ^ sub, i]); } }
      return out;
    };
    const res = [];
    for (let subset = 0; subset < (1 << targets.length); subset++) {
      const mask = (subset << 1) | 1; let bv = -1, bc = Infinity, bvv = 0;
      for (let v = 0; v < n; v++) if (lt(dc[mask][v], dv[mask][v], bc, bvv)) { bc = dc[mask][v]; bvv = dv[mask][v]; bv = v; }
      if (bv < 0) continue;
      const set = collect(mask, bv); let cost = 0, val = 0;
      for (const k of set) { const nd = board.nodes.get(k); cost += nd.cost; val += score(nd); }
      res.push({ hits: popcount(subset), cost, val, set });
    }
    return res;
  }
  const popcount = x => { let c = 0; for (; x; x &= x - 1) c++; return c; };

  /* ---- stage 2 helper: cheapest extensions of a selection ---------------- */
  function extend(board, sel, allowed, score) {
    const dist = new Map(), par = new Map(), h = new Heap();
    for (const k of sel) { dist.set(k, [0, 0]); par.set(k, null); h.push([0, 0, k]); }
    while (h.size) {
      const [c, v, u] = h.pop(), d = dist.get(u); if (d[0] !== c || d[1] !== v) continue;
      for (const nb of board.nodes.get(u).nb) {
        if (!allowed.has(nb) || sel.has(nb)) continue;
        const nd = board.nodes.get(nb), cc = c + nd.cost, cv = v - score(nd), o = dist.get(nb);
        if (!o || cc < o[0] || (cc === o[0] && cv < o[1])) { dist.set(nb, [cc, cv]); par.set(nb, u); h.push([cc, cv, nb]); }
      }
    }
    return { dist, path(k) { const p = []; for (let c = k; c != null && !sel.has(c); c = par.get(c)) p.push(c); return p.reverse(); } };
  }

  /* ---- the planner -------------------------------------------------------- */
  /* opts: {budget, level, targets:[skill names], weights:{stat:w}, fill:true}
   * returns {chosen:{tab:Set}, spent, reached, notes, stage1:{tab:count}} */
  function plan(boards, opts) {
    const score = scorer(opts.weights), notes = [], allowed = {}, options = {}, tabs = Object.keys(boards).map(Number).sort((a, b) => a - b);
    const want = opts.targets.map(s => s.toLowerCase());
    for (const t of tabs) {
      const b = boards[t]; allowed[t] = usable(b, opts.level);
      if (!allowed[t].size) { notes.push(`${b.title}: locked at level ${opts.level} (needs ${b.lv})`); continue; }
      const keys = [];
      for (const name of want) {
        const hit = [...b.nodes.values()].filter(n => n.skill && n.skill.toLowerCase() === name);
        if (!hit.length) notes.push(`${b.title}: no node for "${name}"`); else keys.push(...hit.map(n => n.key).sort((x, y) => x - y));
      }
      const centre = b.centre, cn = b.nodes.get(centre);
      const rows = [{ hits: 0, cost: 0, val: score(cn), set: new Set([centre]) }];
      const subs = keys.length ? steinerSubsets(b, keys, allowed[t], score) : null;
      if (subs) for (const s of subs) if (s.hits) rows.push(s);
      options[t] = rows;
    }
    let best = new Map([[0, { n: 0, val: 0, pick: {} }]]);
    for (const t of Object.keys(options).map(Number)) {
      const nxt = new Map();
      for (const [spent, cur] of best) for (const o of options[t]) {
        const tot = spent + o.cost; if (tot > opts.budget) continue;
        const n = cur.n + o.hits, val = cur.val + o.val, have = nxt.get(tot);
        if (!have || have.n < n || (have.n === n && have.val < val)) nxt.set(tot, { n, val, pick: { ...cur.pick, [t]: o.set } });
      }
      best = nxt;
    }
    if (!best.size) { notes.push('No allocation fits the point budget'); return { chosen: {}, spent: 0, reached: 0, notes, stage1: {} }; }
    let spent = -1, top = null;
    for (const [s, v] of best) if (!top || v.n > top.n || (v.n === top.n && (v.val > top.val || (v.val === top.val && s < spent)))) { top = v; spent = s; }
    const chosen = {}, stage1 = {};
    for (const t of tabs) { chosen[t] = new Set(top.pick[t] || []); stage1[t] = chosen[t].size; }
    spent = 0; for (const t of tabs) for (const k of chosen[t]) spent += boards[t].nodes.get(k).cost;

    if (opts.fill !== false) for (;;) {
      let move = null;
      for (const t of tabs) {
        if (!chosen[t].size) continue;
        const ex = extend(boards[t], chosen[t], allowed[t], score);
        for (const [k, [cost, negv]] of ex.dist) {
          if (chosen[t].has(k) || cost === 0 || cost > opts.budget - spent || -negv <= 0) continue;
          const ratio = -negv / cost, nd = boards[t].nodes.get(k);
          const cand = [ratio, -cost, -t, nd.r, nd.c];
          if (!move || cmp(cand, move.cand) > 0) move = { cand, t, cost, path: ex.path(k) };
        }
      }
      if (!move) break;
      for (const k of move.path) chosen[move.t].add(k);
      spent += move.cost;
    }
    return { chosen, spent, reached: top.n, notes, stage1 };
  }
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

  /* ---- manual edits --------------------------------------------------------- */
  /* Click an unselected node: take the cheapest connection from the selection. */
  function addNode(board, sel, key) {
    if (!sel.size) sel.add(board.centre);
    if (sel.has(key)) return;
    const ex = extend(board, sel, new Set(board.nodes.keys()), () => 0);
    for (const k of ex.path(key)) sel.add(k);
  }
  /* Remove a node and whatever it disconnects from the centre. */
  function removeNode(board, sel, key) {
    if (key === board.centre) return;
    sel.delete(key);
    const keep = reachable(board, sel, board.centre);
    for (const k of [...sel]) if (!keep.has(k)) sel.delete(k);
  }

  /* ---- summary ---------------------------------------------------------------- */
  function summarise(boards, chosen, targets) {
    const want = new Set(targets.map(s => s.toLowerCase())), stats = {}, skills = {}, tabs = [];
    for (const t of Object.keys(boards).map(Number).sort((a, b) => a - b)) {
      const sel = chosen[t] || new Set(), b = boards[t]; let cost = 0, statNodes = 0, skillNodes = 0;
      for (const k of sel) {
        const n = b.nodes.get(k); if (!n) continue; cost += n.cost;
        if (n.skill) { skillNodes++; const e = skills[n.skill] || (skills[n.skill] = { name: n.skill, passive: n.passive, target: want.has(n.skill.toLowerCase()), per: {}, total: 0 });
          e.per[t] = (e.per[t] || 0) + 1; e.total++; }
        else if (n.stats.length) statNodes++;
        for (const s of n.stats) { const e = stats[s.k] || (stats[s.k] = { k: s.k, label: s.label, role: s.role, per: {}, total: 0 });
          e.per[t] = (e.per[t] || 0) + s.v; e.total += s.v; }
      }
      tabs.push({ tab: t, title: b.title, nodes: sel.size, cost, statNodes, skillNodes });
    }
    return { tabs, stats, skills: Object.values(skills).sort((a, b) => b.target - a.target || a.passive - b.passive || b.total - a.total || a.name.localeCompare(b.name)) };
  }

  const api = { K, decodeClass, statWeights, plan, addNode, removeNode, reachable, summarise };
  if (typeof module !== 'undefined') module.exports = api; else root.DVSolver = api;
})(this);
