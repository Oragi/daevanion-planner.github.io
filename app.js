/* Daevanion planner UI. Everything is live: any input re-plans and redraws immediately. */
(function () {
  'use strict';
  const { K, decodeClass, statWeights, plan, addNode, removeNode, summarise } = DVSolver;
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LEVELS = [['Off', 0], ['Low', .25], ['Normal', 1], ['High', 2]];
  const ROLES = ['Offense', 'Utility', 'Defense', 'Resource', 'Other'];
  const PATHS = { TW: '<game folder>\\AION2_TW\\Aion2\\Binaries\\Win64\\plugins\\daevanion\\presets.json',
                  EU: 'C:\\Games\\NCSoft\\AION 2\\Aion2\\Binaries\\Win64\\plugins\\daevanion\\presets.json' };
  const QUICK = { dps: { Offense: 1, Utility: 1, Defense: .25, Resource: 0, Other: 0 },
                  bal: { Offense: 1, Utility: 1, Defense: 1, Resource: .25, Other: .25 },
                  def: { Offense: .25, Utility: .25, Defense: 1, Resource: 1, Other: .25 } };
  const MAX_SKILLS = 10;

  const S = {
    build: 'TW', cls: 3, tab: 1, view: 'live', cmp: '', search: '', auto: true,
    gen: { tabs: [1, 2, 3, 4], points: 315, level: '', skills: [], cat: QUICK.dps, eff: {} },
    live: { nodes: {}, res: null }, presets: [], nextId: 1,
    file: { name: '', data: null, cid: '', chars: [] },
  };
  const memo = {};
  const build = (b = S.build) => DV.builds[b];
  const boardsOf = (b = S.build, c = S.cls) => memo[b + c] || (memo[b + c] = decodeClass(build(b), c));
  const className = (b, c) => (build(b).classes[c] || {}).n || '?';

  /* ---- generation ------------------------------------------------------- */
  const catMult = (cat, role) => (cat[role] != null ? cat[role] : 0);
  function prefsOf(b, g) {
    const p = {};
    for (const [k, , role] of build(b).stats) p[k] = g.eff[k] != null && g.eff[k] !== '' ? +g.eff[k] : catMult(g.cat, role);
    return p;
  }
  function generate(b, c, g) {
    const all = boardsOf(b, c), boards = {};
    for (const t of g.tabs) if (all[t]) boards[t] = all[t];
    const res = plan(boards, { budget: +g.points || 0, level: g.level === '' ? null : +g.level, targets: g.skills, weights: statWeights(boards, prefsOf(b, g)) });
    return { nodes: res.chosen, res };
  }
  const snapshot = g => JSON.parse(JSON.stringify(g));
  function regen() {
    const { nodes, res } = generate(S.build, S.cls, S.gen);
    S.live = { nodes, res };
    const txt = [];
    if (res.reached < S.gen.skills.length * S.gen.tabs.filter(t => boardsOf()[t]).length) txt.push(`Skills reached: ${res.reached}`);
    txt.push(...res.notes);
    $('notes').innerHTML = txt.map(esc).join('<br>');
  }
  function update(regenerate) {
    if (regenerate && S.auto) regen();
    render();
  }

  /* ---- presets model ------------------------------------------------------ */
  const setsFromArray = arr => { const o = {}; for (const [t, c, r] of arr) (o[t] || (o[t] = new Set())).add(K(r, c)); return o; };
  const arrayFromSets = o => { const out = []; for (const t of Object.keys(o).map(Number).sort((a, b) => a - b))
    for (const k of [...o[t]].sort((a, b) => a - b)) out.push([t, k & 63, k >> 6]); return out; };
  function addPreset(p) { p.id = 'p' + S.nextId++; p.include = p.include !== false; S.presets.push(p); return p; }
  const getPreset = id => id === 'live' ? { id: 'live', name: 'Live generator', build: S.build, cls: S.cls, nodes: S.live.nodes, params: S.gen }
    : S.presets.find(p => p.id === id);
  const shown = () => S.presets.filter(p => !p.char || p.char === S.file.cid);
  function pointsOf(p) {
    const bo = boardsOf(p.build || S.build, p.cls || S.cls); let n = 0, cost = 0, bad = 0;
    for (const t in p.nodes) for (const k of p.nodes[t]) { const nd = bo[t] && bo[t].nodes.get(k); if (nd) { n++; cost += nd.cost; } else bad++; }
    return { n, cost, bad };
  }
  const EXAMPLES = [
    { name: 'TW Ranger DPS', build: 'TW', cls: 3, gen: { tabs: [1, 2, 3, 4], points: 315, level: '', skills: ['Snipe', 'Burst Arrow', 'Deadshot', 'Tempest Shot'], cat: QUICK.dps, eff: {} } },
    { name: 'TW Cleric DPS', build: 'TW', cls: 7, gen: { tabs: [1, 2, 3, 4], points: 172, level: '', skills: ['Bolt', 'Judgment Thunder', 'Healing Light', 'Radiant Recovery'], cat: QUICK.dps, eff: {} } },
  ];

  /* ---- controls ------------------------------------------------------------ */
  function classIds(b) { return Object.keys(build(b).classes).map(Number).sort((a, c) => a - c); }
  function skillNames() {
    const out = new Map();
    for (const b of Object.values(boardsOf())) for (const n of b.nodes.values()) if (n.skill) out.set(n.skill, n.passive);
    return [...out].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  }
  function buildStatic() {
    $('buildSeg').innerHTML = Object.keys(DV.builds).map(b => `<button data-b="${b}">${b}</button>`).join('');
    $('cmp').innerHTML = '';
    syncBuild();
    $('cats').innerHTML = ROLES.map(r => `<span>${r}</span><select data-cat="${r}">${LEVELS.map(([l, v]) => `<option value="${v}">${l}</option>`).join('')}</select>`).join('');
  }
  function syncBuild() {
    for (const b of $('buildSeg').children) b.classList.toggle('on', b.dataset.b === S.build);
    $('cls').innerHTML = classIds(S.build).map(c => `<option value="${c}">${esc(className(S.build, c))}</option>`).join('');
    $('cls').value = S.cls;
    $('patch').textContent = build().patch + ' · generated ' + DV.generated;
    const tabs = Object.keys(build().tabs).map(Number);
    S.gen.tabs = S.gen.tabs.filter(t => tabs.includes(t));
    $('genTabs').innerHTML = tabs.map(t => `<label title="${esc(build().tabs[t].t)} · ${build().tabs[t].pool}"><input type="checkbox" data-gt="${t}"> ${t}</label>`).join(' ');
    $('eff').innerHTML = ROLES.map(r => build().stats.filter(s => s[2] === r).map(s =>
      `<span>${esc(s[1])} <span class="dim">${r}</span></span><input data-eff="${s[0]}" type="number" step="any" placeholder="cat">`).join('')).join('');
    buildSkills();
    syncControls();
  }
  function buildSkills() {
    const f = $('skFilter').value.toLowerCase();
    $('skills').innerHTML = skillNames().filter(([n]) => n.toLowerCase().includes(f)).map(([n, p]) =>
      `<label class="${p ? 'pas' : ''}"><input type="checkbox" data-sk="${esc(n)}" ${S.gen.skills.includes(n) ? 'checked' : ''}> ${esc(n)}${p ? ' <span class="tag">passive</span>' : ''}</label>`).join('');
  }
  function syncControls() {
    const g = S.gen;
    $('points').value = g.points; $('level').value = g.level; $('auto').checked = S.auto;
    document.querySelectorAll('[data-gt]').forEach(e => e.checked = g.tabs.includes(+e.dataset.gt));
    document.querySelectorAll('[data-cat]').forEach(e => e.value = g.cat[e.dataset.cat] != null ? g.cat[e.dataset.cat] : 0);
    document.querySelectorAll('[data-eff]').forEach(e => e.value = g.eff[e.dataset.eff] != null ? g.eff[e.dataset.eff] : '');
    document.querySelectorAll('[data-sk]').forEach(e => e.checked = g.skills.includes(e.dataset.sk));
    $('skCount').textContent = `(${g.skills.length}/${MAX_SKILLS})`;
  }
  function setBuildClass(b, c) {
    S.build = b; S.cls = c;
    S.gen.skills = S.gen.skills.filter(s => skillNames().some(x => x[0] === s));
    S.view = 'live'; S.cmp = '';
    if (!boardsOf()[S.tab]) S.tab = +Object.keys(boardsOf())[0];
    syncBuild(); update(true);
  }
  function loadParams(p) {
    S.build = p.build; S.cls = p.cls; S.gen = snapshot(p.params);
    syncBuild(); S.auto = true; $('auto').checked = true; update(true);
  }

  /* ---- events ---------------------------------------------------------------- */
  document.addEventListener('change', e => {
    const t = e.target, d = t.dataset || {};
    if (d.gt) { const n = +d.gt, s = new Set(S.gen.tabs); t.checked ? s.add(n) : s.delete(n); S.gen.tabs = [...s].sort((a, b) => a - b); update(true); }
    else if (d.cat) { S.gen.cat = { ...S.gen.cat, [d.cat]: +t.value }; update(true); }
    else if (d.sk) {
      const s = new Set(S.gen.skills); t.checked ? s.add(d.sk) : s.delete(d.sk);
      if (s.size > MAX_SKILLS) { t.checked = false; return; }
      S.gen.skills = [...s]; $('skCount').textContent = `(${s.size}/${MAX_SKILLS})`; update(true);
    }
    else if (d.inc) { const p = S.presets.find(x => x.id === d.inc); p.include = t.checked; renderPresets(); }
    else if (t.id === 'auto') { S.auto = t.checked; if (S.auto) update(true); }
    else if (t.id === 'cls') setBuildClass(S.build, +t.value);
    else if (t.id === 'cmp') { S.cmp = t.value; render(); }
    else if (t.id === 'upload') readFile(t.files[0]);
    else if (t.id === 'cidSel') { S.file.cid = t.value; $('cid').value = t.value; S.presets.forEach(p => p.char && (p.include = true)); render(); }
  });
  document.addEventListener('input', e => {
    const t = e.target, d = t.dataset || {};
    if (t.id === 'points') { S.gen.points = t.value; update(true); }
    else if (t.id === 'level') { S.gen.level = t.value; update(true); }
    else if (d.eff) { if (t.value === '') delete S.gen.eff[d.eff]; else S.gen.eff[d.eff] = +t.value; update(true); }
    else if (t.id === 'skFilter') buildSkills();
    else if (t.id === 'search') { S.search = t.value.trim().toLowerCase(); render(); }
    else if (t.id === 'cid') { S.file.cid = t.value.trim(); renderPresets(); renderFile(); }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('button,.nm,.n,.tab'); if (!t) return;
    const d = t.dataset || {};
    if (d.b) { const cs = classIds(d.b); setBuildClass(d.b, cs.includes(S.cls) ? S.cls : cs[0]); }
    else if (d.q) { S.gen.cat = { ...QUICK[d.q] }; S.gen.eff = {}; syncControls(); update(true); }
    else if (d.tab) { S.tab = +d.tab; render(); }
    else if (d.view) { selectView(d.view); }
    else if (d.del) { S.presets = S.presets.filter(p => p.id !== d.del); if (S.view === d.del) S.view = 'live'; if (S.cmp === d.del) S.cmp = ''; render(); }
    else if (d.ren) { const p = S.presets.find(x => x.id === d.ren), n = prompt('Preset name', p.name); if (n) { p.name = n; render(); } }
    else if (d.load) { loadParams(S.presets.find(x => x.id === d.load)); }
    else if (d.k) { edit(+d.k); }
    else if (t.id === 'btnUpload') $('upload').click();
    else if (t.id === 'btnNew') { S.file = { name: '', data: null, cid: $('cid').value.trim(), chars: [] }; S.presets = S.presets.filter(p => !p.char); render(); }
    else if (t.id === 'btnSave') savePreset();
    else if (t.id === 'btnDownload') download();
    else if (t.id === 'regen') { regen(); render(); }
    else if (t.id === 'copyPath') navigator.clipboard && navigator.clipboard.writeText(PATHS[S.build]);
  });
  document.addEventListener('mouseover', e => {
    const n = e.target.closest('.n'); if (!n) return;
    const nd = curBoard() && curBoard().nodes.get(+n.dataset.k); if (!nd) return;
    $('hover').innerHTML = `<b>${esc(nodeLabel(nd))}</b> · ${nd.centre ? 'start' : nd.cost + ' pt'} · row ${nd.r}, col ${nd.c}` +
      (nd.skill ? ` <span class="dim">${nd.passive ? 'passive' : 'active'} skill +1 level</span>` : '');
  });

  function selectView(id) {
    const p = getPreset(id); if (!p) return;
    if (p.build && (p.build !== S.build || p.cls !== S.cls)) { S.build = p.build; S.cls = p.cls; syncBuild(); }
    S.view = id; if (S.cmp === id) S.cmp = ''; render();
  }
  function curBoard() { return boardsOf()[S.tab]; }
  function edit(k) {
    const p = getPreset(S.view), b = curBoard(); if (!p || !b || !b.nodes.has(k)) return;
    if (S.view === 'live' && S.auto) { S.auto = false; $('auto').checked = false; }
    const sel = p.nodes[S.tab] || (p.nodes[S.tab] = new Set());
    sel.has(k) ? removeNode(b, sel, k) : addNode(b, sel, k);
    render();
  }
  function savePreset() {
    const p = getPreset('live'), n = prompt('Preset name', `${className(S.build, S.cls)} ${S.gen.points}pt`); if (!n) return;
    const copy = {}; for (const t in p.nodes) copy[t] = new Set(p.nodes[t]);
    const np = addPreset({ name: n, build: S.build, cls: S.cls, nodes: copy, params: snapshot(S.gen), src: 'new' });
    S.view = np.id; render();
  }

  /* ---- file in / out ------------------------------------------------------------ */
  function readFile(f) {
    if (!f) return;
    f.text().then(txt => {
      let d; try { d = JSON.parse(txt); } catch (e) { alert('Not valid JSON: ' + e.message); return; }
      if (!Array.isArray(d.characters)) { alert('No "characters" list: not a daevanion presets.json'); return; }
      S.presets = S.presets.filter(p => !p.char);
      S.file = { name: f.name, data: d, cid: d.characters[0] ? String(d.characters[0].character_id) : '', chars: d.characters.map(c => String(c.character_id)) };
      for (const c of d.characters) for (const p of c.presets || [])
        addPreset({ name: p.name, build: null, cls: null, nodes: setsFromArray(p.nodes || []), src: 'file', char: String(c.character_id) });
      S.presets.forEach(p => { if (p.char) { p.build = S.build; p.cls = S.cls; } });
      $('cid').value = S.file.cid; render();
    });
  }
  function outputJson() {
    const d = S.file.data ? JSON.parse(JSON.stringify(S.file.data)) : { characters: [], version: 1 };
    const cid = S.file.cid || '0', idv = /^\d+$/.test(cid) && cid.length < 16 ? +cid : cid;
    let entry = d.characters.find(c => String(c.character_id) === cid);
    if (!entry) { entry = { character_id: idv, presets: [] }; d.characters.push(entry); }
    const seen = new Set();
    entry.presets = shown().filter(p => p.include).map(p => {
      let n = p.name, i = 2; while (seen.has(n)) n = `${p.name} (${i++})`; seen.add(n);
      return { name: n, nodes: arrayFromSets(p.nodes) };
    });
    return JSON.stringify(d, null, 1) + '\n';
  }
  function download() {
    const txt = outputJson();
    if (window.showSaveFilePicker) {
      showSaveFilePicker({ suggestedName: 'presets.json', types: [{ accept: { 'application/json': ['.json'] } }] })
        .then(h => h.createWritable()).then(w => w.write(txt).then(() => w.close())).catch(() => {});
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' })); a.download = 'presets.json'; a.click();
  }

  /* ---- rendering ------------------------------------------------------------------- */
  const nodeLabel = n => n.centre ? 'Start' : n.skill ? n.skill : n.stats.map(s => `${s.label} +${s.v}`).join(', ');
  const nodeText = n => (nodeLabel(n) + ' ' + n.stats.map(s => s.role).join(' ')).toLowerCase();
  const matches = (n, q) => q.split(/\s+/).every(w => nodeText(n).includes(w));

  function renderFile() {
    $('fileInfo').textContent = S.file.name || 'new file';
    const sel = $('cidSel'); sel.hidden = S.file.chars.length < 2;
    sel.innerHTML = S.file.chars.map(c => `<option ${c === S.file.cid ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('savePath').textContent = PATHS[S.build];
    const n = shown().filter(p => p.include).length;
    $('dlInfo').textContent = `${n} selected` + (S.file.cid ? '' : ' · no character ID: uses 0');
  }
  function renderPresets() {
    const row = (id, p, live) => {
      const pt = pointsOf(p);
      return `<div class="p ${S.view === id ? 'on' : ''}">
        ${live ? '<span>⚡</span>' : `<input type="checkbox" data-inc="${id}" ${p.include ? 'checked' : ''}>`}
        <span class="nm" data-view="${id}" title="${esc(p.name)}">${esc(live ? 'Live generator' : p.name)}</span>
        <span class="dim">${pt.cost}pt${pt.bad ? ` <span class="warn" title="${pt.bad} nodes not on this class/build board">!${pt.bad}</span>` : ''}</span>
        ${live ? '' : `<span class="tag">${p.src}</span>${p.params ? `<button class="sm" data-load="${id}" title="Load its settings into the generator">⚙</button>` : ''}<button class="sm" data-ren="${id}">✎</button><button class="sm" data-del="${id}">✕</button>`}</div>`;
    };
    $('presets').innerHTML = row('live', getPreset('live'), true) + shown().map(p => row(p.id, p, false)).join('');
    const cur = $('cmp'), opts = [['', '— none —'], ['live', 'Live generator'], ...shown().map(p => [p.id, p.name])].filter(o => o[0] !== S.view);
    cur.innerHTML = opts.map(([v, n]) => `<option value="${v}" ${v === S.cmp ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }
  function render() {
    renderFile(); renderPresets();
    const p = getPreset(S.view), cmp = S.cmp && getPreset(S.cmp), boards = boardsOf(p.build || S.build, p.cls || S.cls);
    const q = S.search, sel = p.nodes, other = cmp ? cmp.nodes : null;

    // tabs with node counts and search hits
    $('bar').innerHTML = Object.keys(boards).map(t => {
      const b = boards[t], hit = q ? [...b.nodes.values()].filter(n => matches(n, q)).length : 0, c = sel[t] ? sel[t].size : 0;
      return `<button class="tab ${S.tab == t ? 'on' : ''}" data-tab="${t}">${esc(b.title)}<span class="pill">${c}</span>${q ? `<span class="pill hit" title="search matches">${hit}</span>` : ''}</button>`;
    }).join('') + `<span class="grow"></span><span id="pts"></span>`;

    // board
    const b = boards[S.tab];
    if (b) {
      const rs = [...b.nodes.values()].map(n => n.r), cs = [...b.nodes.values()].map(n => n.c), r0 = Math.min(...rs), c0 = Math.min(...cs);
      const A = sel[S.tab] || new Set(), B = other && other[S.tab] || new Set();
      $('board').style.gridTemplate = `repeat(${Math.max(...rs) - r0 + 1},var(--c)) / repeat(${Math.max(...cs) - c0 + 1},var(--c))`;
      let h = '';
      for (const n of b.nodes.values()) {
        const a = A.has(n.key), o = B.has(n.key), on = a || o;
        const right = b.nodes.get(K(n.r, n.c + 1)), down = b.nodes.get(K(n.r + 1, n.c));
        const lit = m => (A.has(n.key) && A.has(m.key)) || (cmp && B.has(n.key) && B.has(m.key));
        const cls = ['n', 'g' + Math.max(1, n.cost), n.skill ? 'sk' : n.stats[0] ? n.stats[0].role : '', n.passive ? 'pa' : '', n.centre ? 'ct' : '',
          on ? 'on' : '', cmp && a && !o ? 'cA' : '', cmp && o && !a ? 'cB' : '',
          right ? 'lr' + (lit(right) ? ' lo' : '') : '', down ? 'lb' + (lit(down) ? ' lo' : '') : '',
          q ? (matches(n, q) ? 'm' : 'dim') : ''].join(' ');
        h += `<div class="${cls}" data-k="${n.key}" style="grid-row:${n.r - r0 + 1};grid-column:${n.c - c0 + 1}"><i>${n.skill ? esc(n.skill.slice(0, 2)) : ''}</i></div>`;
      }
      $('board').innerHTML = h;
    } else $('board').innerHTML = '<span class="dim">This tab does not exist in this build.</span>';
    $('cmpLegend').innerHTML = cmp ? '<span><s style="background:#2fa36b"></s>only in view</span><span><s style="background:#e07b2c"></s>only in compare</span>' : '';

    // summary
    const targets = p.params ? p.params.skills : [], sum = summarise(boards, sel, targets), sumB = cmp ? summarise(boardsOf(cmp.build || S.build, cmp.cls || S.cls), other, cmp.params ? cmp.params.skills : []) : null;
    const cost = sum.tabs.reduce((a, t) => a + t.cost, 0), avail = p.params ? +p.params.points : +S.gen.points;
    const pts = $('pts'); pts.className = cost > avail ? 'warn' : 'dim'; pts.textContent = `${cost} / ${avail} points`;
    const used = sum.tabs.filter(t => t.nodes > 1 || sumB && (sumB.tabs.find(x => x.tab === t.tab) || {}).nodes > 1).map(t => t.tab);
    const tabHead = used.map(t => `<th>${t}</th>`).join('');
    let html = `<div class="card"><h2>${esc(p.name)}${cmp ? ' vs ' + esc(cmp.name) : ''}</h2><table><tr><th>Tab</th><th>Nodes</th><th>Points</th><th>Stat</th><th>Skill</th></tr>` +
      sum.tabs.filter(t => t.nodes > 1 || used.includes(t.tab)).map(t => `<tr><td>${esc(t.title)}</td><td>${t.nodes}</td><td>${t.cost}</td><td>${t.statNodes}</td><td>${t.skillNodes}</td></tr>`).join('') + '</table></div>';

    const keys = Object.values({ ...sum.stats, ...(sumB ? sumB.stats : {}) }).sort((a, c) => ROLES.indexOf(a.role) - ROLES.indexOf(c.role) || c.total - a.total);
    html += `<div class="card tw"><h2>Stats</h2><table><tr><th>Effect</th>${cmp ? '<th>View</th><th>Compare</th><th>Δ</th>' : tabHead + '<th>Total</th>'}</tr>` +
      keys.map(s => {
        const a = (sum.stats[s.k] || { total: 0, per: {} }), b2 = sumB ? (sumB.stats[s.k] || { total: 0 }) : null;
        if (b2) { const d = a.total - b2.total; return `<tr><td>${esc(s.label)}</td><td>${a.total || ''}</td><td>${b2.total || ''}</td><td class="${d > 0 ? 'up' : d < 0 ? 'dn' : ''}">${d > 0 ? '+' : ''}${d || ''}</td></tr>`; }
        return `<tr><td>${esc(s.label)}</td>${used.map(t => `<td>${a.per[t] || ''}</td>`).join('')}<td><b>${a.total}</b></td></tr>`;
      }).join('') + '</table></div>';

    const skills = sum.skills, skB = sumB ? sumB.skills : [], names = [...new Set([...skills, ...skB].map(s => s.name))];
    const find = (l, n) => l.find(s => s.name === n) || { total: 0, per: {} };
    html += `<div class="card tw"><h2>Skills &amp; passives (levels from nodes, incl. ones crossed on the way)</h2><table><tr><th>Skill</th><th></th>${cmp ? '<th>View</th><th>Compare</th>' : tabHead + '<th>Total</th>'}</tr>` +
      names.sort((x, y) => { const a = find(skills, x), b2 = find(skills, y); return (b2.target ? 1 : 0) - (a.target ? 1 : 0) || (find([...skills, ...skB], x).passive ? 1 : 0) - (find([...skills, ...skB], y).passive ? 1 : 0) || b2.total - a.total || x.localeCompare(y); }).map(n => {
        const a = find(skills, n), meta = [...skills, ...skB].find(s => s.name === n), b2 = find(skB, n);
        return `<tr class="${a.target ? 'tg' : ''}"><td>${esc(n)}</td><td class="dim">${meta.passive ? 'passive' : 'active'}${a.target ? ' ★' : ''}</td>` +
          (cmp ? `<td>${a.total || ''}</td><td>${b2.total || ''}</td>` : used.map(t => `<td>${a.per[t] || ''}</td>`).join('') + `<td><b>${a.total}</b></td>`) + '</tr>';
      }).join('') + '</table></div>';
    $('summary').innerHTML = html;
  }

  /* ---- init ---------------------------------------------------------------------------- */
  buildStatic();
  for (const ex of EXAMPLES) {
    const { nodes } = generate(ex.build, ex.cls, ex.gen);
    addPreset({ name: ex.name, build: ex.build, cls: ex.cls, nodes, params: snapshot(ex.gen), src: 'example' });
  }
  S.cls = 3; S.gen = snapshot(EXAMPLES[0].gen);
  syncBuild(); regen(); render();
})();
