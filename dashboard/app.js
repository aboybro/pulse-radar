// Pulse Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan, a live-token reference view, and a model tab with a sandbox
// that re-ranks the board live. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var main = document.getElementById('board');
  if (!DATA || !main) return;

  var params = new URLSearchParams(window.location.search);
  var state = {
    q: '', category: 'all', chain: 'all', sort: 'implied', watch: false,
    tab: 'board', selected: null,
    sandbox: { growth: DATA.model.growth_weight, breadth: DATA.model.breadth_step, anchor: 1 },
    sandboxOn: false,
  };
  var shot = params.get('shot');
  if (shot === 'filtered') { state.category = 'Lending'; state.sort = 'tvl'; }
  if (shot === 'detail') { state.selected = DATA.rows[0] ? DATA.rows[0].slug : null; }

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // The model in one function, so the page recomputes a row from the snapshot figures and checks
  // the number board.json carries: the page's code and the board's data are the same arithmetic.
  function impliedOf(row, m) {
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var extra = Math.min(Math.max(row.chains.length - 1, 0), m.breadth_max_chains);
    var breadth = 1 + m.breadth_step * extra;
    return Math.max(1, Math.round(row.tvl_usd * row.anchor * momentum * maturity * breadth));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The watchlist flag comes from the snapshot itself, carried in data.js: a row at or above the
  // floor is not automatically on the watchlist (the house rule also excludes wrapped, staked and
  // bridged products), so the page never guesses it from TVL alone.
  function isWatch(row) { return row.watchlist === true; }

  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      sel.appendChild(el('option', { value: v, text: v }));
    });
  }
  var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
  var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
  fillSelect('cat', cats);
  fillSelect('chain', chains);
  // Keep the toolbar controls in sync with the state (a ?shot= view sets them, not the user).
  document.getElementById('cat').value = state.category;
  document.getElementById('sort').value = state.sort;

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.watch && !isWatch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var sorters = {
      implied: function (a, b) { return sbImplied(b) - sbImplied(a); },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    };
    rows.sort(sorters[state.sort] || sorters.implied);
    return rows;
  }

  // Sandbox-adjusted implied value: the sliders scale the model's own inputs, never the ranking.
  function sbImplied(row) {
    if (!state.sandboxOn) return row.implied_value_usd;
    var m = Object.assign({}, DATA.model, {
      growth_weight: state.sandbox.growth,
      breadth_step: state.sandbox.breadth,
    });
    var copy = Object.assign({}, row, { anchor: row.anchor * state.sandbox.anchor });
    return impliedOf(copy, m);
  }

  function renderMeta() {
    document.getElementById('meta').textContent =
      'Snapshot ' + DATA.as_of + ' · ' + DATA.rows.length + ' pre-token protocols · floor ' + fmtUsd(DATA.floor_usd) + ' · model ' + DATA.model_version;
    var top = DATA.rows[0];
    var sum = DATA.rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var stats = document.getElementById('stats');
    stats.innerHTML = '';
    [
      ['Watchlist', DATA.watchlist_size + ' protocols'],
      ['Board', DATA.rows.length + ' ranked rows'],
      ['Top implied value', top ? fmtUsd(top.implied_value_usd) : 'n/a'],
      ['Board total', fmtUsd(sum)],
      ['Global anchor', DATA.global_anchor.toFixed(3) + '× TVL'],
      ['Live reference', DATA.live_size + ' tokens trading'],
    ].forEach(function (s) {
      stats.appendChild(el('div', { 'class': 'stat' }, el('b', { text: s[1] }), el('span', { text: s[0] })));
    });
    if (top) stats.children[2].querySelector('span').textContent = 'Top implied value · ' + top.name;
  }

  function renderBoard() {
    main.innerHTML = '';
    var rows = filteredRows();
    document.getElementById('count').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
    if (!rows.length) { main.appendChild(el('div', { 'class': 'empty', text: 'No protocol matches this filter. Loosen the search or clear a filter.' })); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return sbImplied(r); }));
    var table = el('table');
    var head = el('tr');
    ['#', 'Protocol', 'Category', 'TVL', '7d', 'Age', 'Implied value', ''].forEach(function (h, i) {
      head.appendChild(el('th', { 'class': i >= 3 ? 'num' : '', text: h }));
    });
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    rows.forEach(function (r) {
      var implied = sbImplied(r);
      var tr = el('tr', { 'class': state.selected === r.slug ? 'sel' : '', onclick: function () { select(r.slug); } });
      var growthCls = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
      tr.appendChild(el('td', { 'class': 'rank num', text: String(r.rank) }));
      var nameCell = el('td', { 'class': 'name' });
      nameCell.appendChild(el('b', { text: r.name }));
      nameCell.appendChild(el('span', { 'class': 'badge ' + (isWatch(r) ? 'watch' : 'early'), text: isWatch(r) ? 'WATCHLIST' : 'EARLY' }));
      nameCell.appendChild(el('span', { text: ' ' + r.chains.slice(0, 3).join(' · ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }));
      tr.appendChild(nameCell);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num ' + growthCls, text: fmtPct(r.change_7d) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtAge(r.age_days) }));
      var val = el('td', { 'class': 'num' });
      val.appendChild(el('b', { text: fmtUsd(implied) }));
      val.appendChild(el('div', { 'class': 'bar' }, el('i', { style: 'width:' + Math.max(2, Math.round((implied / max) * 100)) + '%' })));
      tr.appendChild(val);
      tr.appendChild(el('td', { 'class': 'num' }, el('button', { 'class': 'farm', text: 'Farm →', onclick: function (e) { e.stopPropagation(); select(r.slug); } })));
      body.appendChild(tr);
    });
    table.appendChild(body);
    main.appendChild(table);
    main.appendChild(el('p', { style: 'color:var(--dim);font-size:13px', text: state.sandboxOn ? 'Sandbox is on: implied values use your slider settings, not the submitted model.' : 'Implied value = TVL × category anchor × momentum × maturity × breadth. Click a row for its farm plan and model breakdown.' }));
  }

  function renderLive() {
    main.innerHTML = '';
    main.appendChild(el('p', { style: 'color:var(--dim)', text: 'These protocols already have a token trading. Their market caps are the market’s own values — and the source of every category anchor on the board. They are never ranked as pre-token.' }));
    var table = el('table');
    var head = el('tr');
    ['Protocol', 'Category', 'TVL', 'Market cap', 'mcap / TVL', '7d'].forEach(function (h, i) {
      head.appendChild(el('th', { 'class': i >= 2 ? 'num' : '', text: h }));
    });
    table.appendChild(el('thead', {}, head));
    var body = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { 'class': 'name' }, el('b', { text: r.name }), el('span', { text: ' ' + r.chains.slice(0, 3).join(' · ') })));
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.tvl_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtUsd(r.mcap_usd) }));
      tr.appendChild(el('td', { 'class': 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(3) + '×' : 'n/a' }));
      tr.appendChild(el('td', { 'class': 'num', text: fmtPct(r.change_7d) }));
      body.appendChild(tr);
    });
    table.appendChild(body);
    main.appendChild(table);
  }

  function renderModel() {
    main.innerHTML = '';
    var wrap = el('div');
    var panel = el('div', { 'class': 'panel' });
    panel.appendChild(el('h2', { text: 'The model — pulse-1' }));
    panel.appendChild(el('p', { text: 'Every row is priced from the snapshot’s own figures. The anchor is the market’s verdict on the protocol’s category: the median market-cap-to-TVL ratio of the live-token protocols in that category, in this same snapshot. A category with too few live tokens falls back to the global median.' }));
    panel.appendChild(el('div', { 'class': 'formula', text: 'implied = TVL × anchor × momentum × maturity × breadth\nmomentum = 1 + clamp(7d growth, −50%, +100%) / 100 × 0.6\nmaturity = 0.70 + min(age, 1095d) / 1095 × 0.30   (age unknown: 365d)\nbreadth  = 1 + 0.04 × min(chains − 1, 5)' }));
    wrap.appendChild(panel);

    var anchors = el('div', { 'class': 'panel' });
    anchors.appendChild(el('h2', { text: 'Category anchors (computed from this snapshot)' }));
    var table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { 'class': 'num', text: 'Anchor' }), el('th', { 'class': 'num', text: 'Live tokens' }))));
    var body = el('tbody');
    DATA.anchors.forEach(function (a) {
      body.appendChild(el('tr', {}, el('td', { text: a.category }), el('td', { 'class': 'num', text: a.multiple.toFixed(3) + '×' }), el('td', { 'class': 'num', text: String(a.samples) })));
    });
    table.appendChild(body);
    anchors.appendChild(table);
    anchors.appendChild(el('p', { text: 'Global anchor (fallback): ' + DATA.global_anchor.toFixed(3) + '× TVL. Anchors are clamped to 0.03×–1.20×.' }));
    wrap.appendChild(anchors);

    var sb = el('div', { 'class': 'panel' });
    sb.appendChild(el('h2', { text: 'Sandbox — change the model, re-rank the board' }));
    sb.appendChild(el('p', { text: 'Move a slider and the Board tab re-ranks with your settings. The submitted board keeps the stated model; the sandbox is for the reader to test it.' }));
    var grid = el('div', { 'class': 'sandbox' });
    var sliders = [
      ['growth', 'Growth weight', 0, 1.5, 0.05, state.sandbox.growth],
      ['breadth', 'Breadth per extra chain', 0, 0.1, 0.01, state.sandbox.breadth],
      ['anchor', 'Anchor scale', 0.5, 2, 0.05, state.sandbox.anchor],
    ];
    sliders.forEach(function (s) {
      var lab = el('label', { text: s[1] + ': ' });
      var out = el('output', { text: Number(s[5]).toFixed(2) });
      var input = el('input', { type: 'range', min: String(s[2]), max: String(s[3]), step: String(s[4]), value: String(s[5]) });
      input.addEventListener('input', function () {
        state.sandbox[s[0]] = parseFloat(input.value);
        out.textContent = parseFloat(input.value).toFixed(2);
        state.sandboxOn = true;
      });
      lab.appendChild(out);
      lab.appendChild(input);
      grid.appendChild(lab);
    });
    sb.appendChild(grid);
    sb.appendChild(el('button', { 'class': 'farm', text: 'Apply sandbox to the board', onclick: function () { state.sandboxOn = true; setTab('board'); } }));
    sb.appendChild(el('span', { text: ' ' }));
    sb.appendChild(el('button', { 'class': 'farm', text: 'Reset to the submitted model', onclick: function () { state.sandbox = { growth: DATA.model.growth_weight, breadth: DATA.model.breadth_step, anchor: 1 }; state.sandboxOn = false; render(); } }));
    wrap.appendChild(sb);
    main.appendChild(wrap);
  }

  function select(slug) {
    state.selected = slug;
    renderDrawer();
    if (state.tab === 'board') renderBoard();
  }

  function renderDrawer() {
    var drawer = document.getElementById('drawer');
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) { drawer.hidden = true; drawer.innerHTML = ''; return; }
    drawer.hidden = false;
    drawer.innerHTML = '';
    drawer.appendChild(el('button', { 'class': 'close', text: '✕ Close', onclick: function () { state.selected = null; renderDrawer(); renderBoard(); } }));
    drawer.appendChild(el('h2', { text: '#' + row.rank + ' ' + row.name }));
    drawer.appendChild(el('p', { style: 'color:var(--dim)', text: (row.category || 'Uncategorized') + ' · ' + row.chains.join(', ') + ' · listed ' + (row.listed_at || 'unknown') }));
    var kv = el('div', { 'class': 'kv' });
    [
      ['Implied value', fmtUsd(row.implied_value_usd)],
      ['TVL', fmtUsd(row.tvl_usd)],
      ['7d growth', fmtPct(row.change_7d)],
      ['Age', fmtAge(row.age_days)],
      ['Category anchor', row.anchor.toFixed(3) + '× TVL'],
      ['Momentum', '×' + row.momentum_multiplier.toFixed(2)],
      ['Maturity', '×' + row.maturity_multiplier.toFixed(2)],
      ['Breadth', '×' + row.breadth_multiplier.toFixed(2)],
    ].forEach(function (pair) {
      kv.appendChild(el('div', {}, el('span', { text: pair[0] }), el('b', { text: pair[1] })));
    });
    drawer.appendChild(kv);
    drawer.appendChild(el('p', { 'class': 'note', text: 'Check the arithmetic: ' + fmtUsd(row.tvl_usd) + ' × ' + row.anchor.toFixed(3) + ' × ' + row.momentum_multiplier.toFixed(2) + ' × ' + row.maturity_multiplier.toFixed(2) + ' × ' + row.breadth_multiplier.toFixed(2) + ' = ' + fmtUsd(row.implied_value_usd) + '. The anchor is the median mcap/TVL of live tokens in this category.' }));
    drawer.appendChild(el('h3', { text: 'How to farm it' }));
    var steps = el('ol', { 'class': 'steps' });
    row.farm_steps.forEach(function (s) {
      var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
      var li = el('li');
      if (m) {
        li.appendChild(document.createTextNode(m[1]));
        li.appendChild(el('span', { 'class': 'ct', text: 'Cost: ' + m[2] + ' · Time: ' + m[3] }));
      } else {
        li.appendChild(document.createTextNode(s));
      }
      steps.appendChild(li);
    });
    drawer.appendChild(steps);
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    document.getElementById('toolbar').style.display = tab === 'board' ? '' : 'none';
    document.getElementById('stats').style.display = tab === 'board' ? '' : 'none';
    if (tab === 'board') renderBoard();
    else if (tab === 'live') renderLive();
    else renderModel();
  }

  function render() {
    renderMeta();
    setTab(state.tab);
    renderDrawer();
  }

  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
  });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  document.getElementById('cat').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
  document.getElementById('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });

  render();
  window.__shotReady = true;
})();
