/* ============================================================
 * 울타리 치기 · DEVIL'S FENCE — app
 * ============================================================ */
(function () {
  'use strict';

  var S = window.DFSolver;
  var GEN = window.DFGen;
  var PRESETS = window.DF_PRESETS || { stages: {}, bank: [] };
  var NS = 'http://www.w3.org/2000/svg';

  var STAGES = [
    { id: 's1', name: '수련의 방', sub: '5 × 5 · 입문', R: 5, C: 5, diff: 'easy' },
    { id: 's2', name: '유배지 예선', sub: '7 × 7 · 기본', R: 7, C: 7, diff: 'normal' },
    { id: 's3', name: '유배지 본선', sub: '10 × 10 · 심화', R: 10, C: 10, diff: 'normal' },
    { id: 's4', name: '심연의 문', sub: '12 × 12 · 고난도', R: 12, C: 12, diff: 'hard' },
    { id: 's5', name: '신의 시험', sub: '15 × 15 · 최종', R: 15, C: 15, diff: 'hard' }
  ];
  var SIZES = [5, 7, 10, 12, 15];
  var DIFFS = [
    { key: 'easy', label: '쉬움' },
    { key: 'normal', label: '보통' },
    { key: 'hard', label: '어려움' }
  ];

  var LS = {
    records: 'df.v1.records',
    unlocked: 'df.v1.unlocked',
    opts: 'df.v1.opts',
    save: 'df.v1.save'
  };

  var st = {
    screen: 'home',
    puzzle: null,
    geom: null,
    clues: null,
    board: null,       // Uint8Array edge states
    history: [],
    future: [],
    mode: 'cycle',
    marks: [],         // checkpoints
    elapsed: 0,
    startAt: 0,
    timerId: null,
    running: false,
    won: false,
    mode_: 'stage',
    stageId: null,
    hint: null,
    drag: null,
    opts: { warn: true, sound: true },
    records: {},
    unlocked: 1,
    freeSel: { size: 10, diff: 'normal' },
    saveTimer: 0,
    els: {}
  };

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function fmtTime(ms) {
    if (ms == null || isNaN(ms)) return '--:--';
    var t = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtTimeLong(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(t / 60), s = t % 60;
    return m + '분 ' + (s < 10 ? '0' : '') + s + '초';
  }
  function readJSON(key, dflt) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }
  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  /* ---------------- sound ---------------- */
  var actx = null;
  function sfx(kind) {
    if (!st.opts.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t = actx.currentTime;
      var o = actx.createOscillator(), gnode = actx.createGain();
      o.connect(gnode); gnode.connect(actx.destination);
      var vol = 0.05;
      if (kind === 'line') { o.type = 'triangle'; o.frequency.setValueAtTime(560, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05); vol = 0.05; }
      else if (kind === 'x') { o.type = 'sine'; o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(250, t + 0.05); vol = 0.035; }
      else if (kind === 'err') { o.type = 'sawtooth'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.16); vol = 0.05; }
      else if (kind === 'hint') { o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1180, t + 0.12); vol = 0.045; }
      else if (kind === 'mark') { o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(760, t + 0.1); vol = 0.045; }
      gnode.gain.setValueAtTime(vol, t);
      gnode.gain.exponentialRampToValueAtTime(0.0008, t + (kind === 'win' ? 0.5 : 0.14));
      o.start(t); o.stop(t + 0.5);
      if (kind === 'win') {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          var oo = actx.createOscillator(), gg = actx.createGain();
          oo.type = 'sine'; oo.frequency.value = f;
          oo.connect(gg); gg.connect(actx.destination);
          var tt = t + i * 0.11;
          gg.gain.setValueAtTime(0.0001, tt);
          gg.gain.exponentialRampToValueAtTime(0.06, tt + 0.02);
          gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.45);
          oo.start(tt); oo.stop(tt + 0.5);
        });
      }
    } catch (e) { }
  }

  /* ---------------- modals ---------------- */
  function openModal(opts) {
    var root = $('modalRoot');
    root.innerHTML = '';
    var veil = el('div', 'modal-veil');
    var box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    var head = el('div', 'modal-head');
    head.appendChild(el('h3', null, opts.title || ''));
    if (opts.closable !== false) {
      var x = el('button', 'icon-btn x', '✕');
      x.onclick = closeModal;
      head.appendChild(x);
    }
    box.appendChild(head);
    var body = el('div', 'modal-body');
    if (opts.node) body.appendChild(opts.node);
    else body.innerHTML = opts.body || '';
    box.appendChild(body);
    if (opts.actions && opts.actions.length) {
      var foot = el('div', 'modal-foot');
      opts.actions.forEach(function (a) {
        var b = el('button', 'btn ' + (a.kind || 'ghost'), a.label);
        b.onclick = function () { if (a.onClick) a.onClick(); };
        foot.appendChild(b);
      });
      box.appendChild(foot);
    }
    root.appendChild(veil);
    root.appendChild(box);
    root.classList.add('open');
    veil.onclick = function () { if (opts.closable !== false) closeModal(); };
    return box;
  }
  function closeModal() {
    var root = $('modalRoot');
    root.classList.remove('open');
    root.innerHTML = '';
  }

  /* ---------------- board ---------------- */
  function buildBoard(puzzle) {
    var R = puzzle.R, C = puzzle.C;
    var g = S.geom(R, C);
    var svg = $('board');
    svg.innerHTML = '';
    var padTop = 0.42, padBottom = 0.42;
    svg.setAttribute('viewBox', (-0.42) + ' ' + (-0.42) + ' ' + (C + 0.84) + ' ' + (R + 0.84));

    var defs = svgEl('defs');
    defs.innerHTML =
      '<linearGradient id="loopGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + C + '" y2="' + R + '">' +
      '<stop offset="0%" stop-color="#ff6a49"/><stop offset="38%" stop-color="#c81c3c"/>' +
      '<stop offset="70%" stop-color="#e0334b"/><stop offset="100%" stop-color="#ffab63"/></linearGradient>' +
      '<linearGradient id="winGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + C + '" y2="' + R + '">' +
      '<stop offset="0%" stop-color="#fff1cd"/><stop offset="50%" stop-color="#ffd685"/>' +
      '<stop offset="100%" stop-color="#ffb073"/></linearGradient>';
    svg.appendChild(defs);

    var gCells = svgEl('g', { 'class': 'cells' });
    var gGrid = svgEl('g', { 'class': 'grid' });
    var gX = svgEl('g', { 'class': 'xs' });
    var gLines = svgEl('g', { 'class': 'lines' });
    var gWarn = svgEl('g', { 'class': 'warns' });
    var gHint = svgEl('g', { 'class': 'hints' });

    var cellEls = new Array(R * C);
    var edgeEls = new Array(g.N);

    for (var r = 0; r < R; r++) {
      for (var c = 0; c < C; c++) {
        var i = r * C + c;
        var cg = svgEl('g', { 'class': 'cell' });
        var k = puzzle.clues[r][c];
        if (k != null && k >= 0) {
          cg.setAttribute('class', 'cell n');
          cg.appendChild(svgEl('rect', { x: c + 0.15, y: r + 0.15, width: 0.70, height: 0.70, rx: 0.16, 'class': 'cplate' }));
          var tx = svgEl('text', { x: c + 0.5, y: r + 0.5, 'class': 'num' });
          tx.textContent = k;
          cg.appendChild(tx);
        }
        gCells.appendChild(cg);
        cellEls[i] = cg;
      }
    }

    // vertex dots
    for (var vr = 0; vr <= R; vr++) {
      for (var vc = 0; vc <= C; vc++) {
        gGrid.appendChild(svgEl('circle', { cx: vc, cy: vr, r: 0.032, 'class': 'bdot' }));
      }
    }

    // edges
    for (var e = 0; e < g.N; e++) {
      var eg = svgEl('g', { 'class': 'edge', 'data-e': e, 'data-s': '0' });
      var x1, y1, x2, y2;
      if (g.eH[e]) { x1 = g.eCol[e]; y1 = g.eRow[e]; x2 = x1 + 1; y2 = y1; }
      else { x1 = g.eCol[e]; y1 = g.eRow[e]; x2 = x1; y2 = y1 + 1; }
      if (g.eH[e]) {
        eg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'e-on' }));
        eg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'e-core' }));
      } else {
        eg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'e-on' }));
        eg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'e-core' }));
      }
      // X mark at midpoint
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, s2 = 0.115;
      var xa = svgEl('line', { x1: mx - s2, y1: my - s2, x2: mx + s2, y2: my + s2, 'class': 'e-x' });
      var xb = svgEl('line', { x1: mx + s2, y1: my - s2, x2: mx - s2, y2: my + s2, 'class': 'e-x2' });
      eg.appendChild(xa);
      eg.appendChild(xb);
      gLines.appendChild(eg);
      edgeEls[e] = eg;
    }

    svg.appendChild(gCells);
    svg.appendChild(gGrid);
    svg.appendChild(gX);
    svg.appendChild(gLines);
    svg.appendChild(gHint);
    svg.appendChild(gWarn);

    var hover = svgEl('line', { id: 'hoverLine' });
    svg.appendChild(hover);

    st.board = new Uint8Array(g.N);
    st.geom = g;
    st.els = {
      svg: svg, cellEls: cellEls, edgeEls: edgeEls, gWarn: gWarn, gHint: gHint,
      gCells: gCells, hover: hover, R: R, C: C, g: g
    };
    layoutBoard();
  }

  function layoutBoard() {
    var area = $('boardArea');
    var frame = $('boardFrame');
    if (!st.els.svg) return;
    var aw = area.clientWidth - 16;
    var panel = $('hintPanel');
    var panelH = (panel && !panel.classList.contains('hidden') && window.innerWidth < 1100) ? panel.offsetHeight + 18 : 0;
    var ah = area.clientHeight - 16 - panelH;
    var size = Math.max(140, Math.min(aw, ah));
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';
  }

  function fitHintSpace(open) {
    var area = $('boardArea');
    var panel = $('hintPanel');
    if (!area || !panel) return;
    if (open && window.innerWidth < 1100) {
      area.style.paddingBottom = (panel.offsetHeight + 20) + 'px';
    } else {
      area.style.paddingBottom = '';
    }
    layoutBoard();
  }

  function hideHintPanel() {
    $('hintPanel').classList.add('hidden');
    clearHintHighlights();
    fitHintSpace(false);
  }

  /* 클리어 판정이 성립한 렌더에서 onWin()이 st.won을 뒤늦게 true로 바꾸기 때문에,
     툴바 잠금을 한 곳에 모아 판정 직후에도 다시 맞춘다. (cleared인데 복원·초기화가 눌리던 문제) */
  function syncToolbar() {
    if (!$('btnUndo')) return;
    $('btnUndo').disabled = st.history.length === 0 || st.won;
    $('btnRedo').disabled = st.future.length === 0 || st.won;
    $('btnRestore').disabled = st.marks.length === 0 || st.won;
    $('btnReset').disabled = !!st.won;
    $('btnRestore').innerHTML = '↩️ <span>복원' + (st.marks.length ? ' ' + st.marks.length : '') + '</span>';
  }

  function render() {
    var e = st.els;
    if (!e.svg) return;
    var an = S.analyze(st.board, e.g, st.clues);
    var i, n = e.R * e.C;
    for (i = 0; i < n; i++) {
      var cg = e.cellEls[i];
      var done = an.clueOk[i] === 1 && st.clues[i] > 0;
      var over = an.clueOver[i] > 0;
      if (done) cg.classList.add('done'); else cg.classList.remove('done');
      if (over && st.opts.warn) cg.classList.add('over'); else cg.classList.remove('over');
    }
    for (var ed = 0; ed < e.g.N; ed++) {
      var s = st.board[ed];
      var node = e.edgeEls[ed];
      var cur = node.getAttribute('data-s');
      var want = s === 1 ? '1' : (s === 2 ? '2' : '0');
      if (cur !== want) node.setAttribute('data-s', want);
    }
    // vertex warnings
    e.gWarn.innerHTML = '';
    if (st.opts.warn) {
      for (var q = 0; q < an.vertexBad.length; q++) {
        var v = an.vertexBad[q];
        var vr = Math.floor(v / (e.C + 1)), vc = v % (e.C + 1);
        e.gWarn.appendChild(svgEl('circle', { cx: vc, cy: vr, r: 0.11, 'class': 'vertWarn show' }));
      }
      // 숫자는 다 맞았는데 울타리가 끊겨 있으면, 끊긴 교차점을 금색으로 짚어 준다
      if (an.unsolvedClues === 0 && an.cellViolations.length === 0 && an.deadEnds.length) {
        for (var q2 = 0; q2 < an.deadEnds.length; q2++) {
          var v2 = an.deadEnds[q2];
          var vr2 = Math.floor(v2 / (e.C + 1)), vc2 = v2 % (e.C + 1);
          e.gWarn.appendChild(svgEl('circle', { cx: vc2, cy: vr2, r: 0.13, 'class': 'vertOpen show' }));
        }
      }
    }
    // stats
    $('statLeft').textContent = an.unsolvedClues;
    var errCount = an.cellViolations.length + an.vertexBad.length;
    $('statErr').textContent = errCount;
    $('statLine').textContent = an.lineCount;
    $('statErrWrap').classList.toggle('warn', errCount > 0);
    $('statLeftWrap').classList.toggle('warn', false);
    syncToolbar();

    if (an.win && !st.won) onWin(an);
    if (st.won) syncToolbar();
    if (errCount > 0 && st.opts.warn && !st.lastErrBeep) {
      st.lastErrBeep = true; sfx('err');
      setTimeout(function () { st.lastErrBeep = false; }, 400);
    }
    scheduleSave();
  }

  /* ---------------- input ---------------- */
  var EDGE_HIT = 0.44;

  function toBoard(evt) {
    var svg = st.els.svg;
    var rect = svg.getBoundingClientRect();
    var vb = svg.viewBox.baseVal;
    var x = vb.x + (evt.clientX - rect.left) / rect.width * vb.width;
    var y = vb.y + (evt.clientY - rect.top) / rect.height * vb.height;
    return { x: x, y: y };
  }

  function hitEdge(x, y) {
    var R = st.els.R, C = st.els.C, g = st.els.g;
    var rH = Math.round(y), cH = Math.floor(x), dH = Math.abs(y - rH);
    var okH = (rH >= 0 && rH <= R && cH >= 0 && cH < C);
    var cV = Math.round(x), rV = Math.floor(y), dV = Math.abs(x - cV);
    var okV = (cV >= 0 && cV <= C && rV >= 0 && rV < R);
    if (okH && dH <= EDGE_HIT && (!okV || dH <= dV)) return g.H(rH, cH);
    if (okV && dV <= EDGE_HIT) return g.V(rV, cV);
    return -1;
  }

  function valueFor(id) {
    var cur = st.board[id];
    switch (st.mode) {
      case 'line': return 1;
      case 'cross': return 2;
      case 'erase': return 0;
      default:
        if (cur === 0) return 1;
        if (cur === 1) return 2;
        return 0;
    }
  }

  function setEdge(id, val) {
    if (id < 0) return false;
    if (st.board[id] === val) return false;
    st.board[id] = val;
    return true;
  }

  function beginEdit() {
    st.snapshot = st.board.slice();
    st.edited = false;
  }
  function commitEdit() {
    if (!st.edited) return;
    st.history.push(st.snapshot);
    if (st.history.length > 400) st.history.shift();
    st.future.length = 0;
    st.edited = false;
    clearHintHighlights();
    render();
  }

  function onPointerDown(evt) {
    if (st.won) return;
    if (evt.button === 2) return;
    if (!st.running) startTimer();
    var pt = toBoard(evt);
    var id = hitEdge(pt.x, pt.y);
    if (id < 0) return;
    evt.preventDefault();
    try { st.els.svg.setPointerCapture(evt.pointerId); } catch (e) { }
    beginEdit();
    st.drag = { value: valueFor(id), touched: {}, last: pt, edge: id, pointerId: evt.pointerId };
    st.drag.touched[id] = 1;
    if (setEdge(id, st.drag.value)) { st.edited = true; sfx(st.drag.value === 1 ? 'line' : (st.drag.value === 2 ? 'x' : 'x')); }
    render();
  }

  function sampleAndApply(from, to) {
    var steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.18));
    for (var q = 1; q <= steps; q++) {
      var x = from.x + (to.x - from.x) * q / steps;
      var y = from.y + (to.y - from.y) * q / steps;
      var id = hitEdge(x, y);
      if (id < 0 || st.drag.touched[id]) continue;
      st.drag.touched[id] = 1;
      if (setEdge(id, st.drag.value)) {
        st.edited = true;
        sfx(st.drag.value === 1 ? 'line' : 'x');
      }
    }
  }

  function onPointerMove(evt) {
    var pt = toBoard(evt);
    if (st.drag && st.drag.pointerId === evt.pointerId) {
      sampleAndApply(st.drag.last, pt);
      st.drag.last = pt;
      render();
      return;
    }
    if (evt.pointerType === 'mouse') {
      var id = hitEdge(pt.x, pt.y);
      var hl = st.els.hover;
      if (id >= 0) {
        var g = st.els.g;
        var x1, y1, x2, y2;
        if (st.els.g.eH[id]) { x1 = g.eCol[id]; y1 = g.eRow[id]; x2 = x1 + 1; y2 = y1; }
        else { x1 = g.eCol[id]; y1 = g.eRow[id]; x2 = x1; y2 = y1 + 1; }
        hl.setAttribute('x1', x1); hl.setAttribute('y1', y1);
        hl.setAttribute('x2', x2); hl.setAttribute('y2', y2);
        hl.classList.add('show');
      } else hl.classList.remove('show');
    }
  }

  function onPointerUp(evt) {
    if (st.drag && st.drag.pointerId === evt.pointerId) {
      st.drag = null;
      commitEdit();
    }
  }

  function onContextMenu(evt) {
    evt.preventDefault();
    if (st.won) return;
    var pt = toBoard(evt);
    var id = hitEdge(pt.x, pt.y);
    if (id < 0) return;
    beginEdit();
    var cur = st.board[id];
    if (cur === 2) { st.board[id] = 0; }
    else { st.board[id] = 2; }
    st.edited = true;
    sfx('x');
    commitEdit();
  }

  /* ---------------- hints ---------------- */
  function clearHintHighlights() {
    if (!st.els.gHint) return;
    st.els.gHint.innerHTML = '';
    for (var e = 0; e < st.els.edgeEls.length; e++) {
      st.els.edgeEls[e].removeAttribute('data-hl');
    }
    st.hint = null;
  }

  function showHint() {
    if (!st.running) startTimer();
    if (st.won) { toast('이미 완성된 울타리입니다'); return; }
    var h = S.hint(st.board, st.els.g, st.clues, st.puzzle.solution);
    clearHintHighlights();
    var panel = $('hintPanel');
    if (!h) { toast('지금은 힌트가 없습니다'); return; }
    st.hint = h;
    sfx('hint');

    var title = $('hintTitle'), body = $('hintBody'), apply = $('hintApply');
    apply.style.display = 'none';

    if (h.kind === 'error') {
      title.textContent = h.title;
      body.textContent = h.detail;
      h.cells.forEach(function (i) {
        var r = Math.floor(i / st.els.C), c = i % st.els.C;
        var ring = svgEl('rect', { x: c + 0.1, y: r + 0.1, width: 0.8, height: 0.8, rx: 0.16, 'class': 'cellRing show' });
        st.els.gHint.appendChild(ring);
      });
      h.verts.forEach(function (v) {
        var vr = Math.floor(v / (st.els.C + 1)), vc = v % (st.els.C + 1);
        st.els.gHint.appendChild(svgEl('circle', { cx: vc, cy: vr, r: 0.12, 'class': 'vertWarn show' }));
      });
    } else if (h.kind === 'wrong') {
      title.textContent = h.title;
      body.textContent = h.detail;
      h.edges.forEach(function (ed) {
        var g2 = st.els.g;
        var x1, y1, x2, y2;
        if (g2.eH[ed]) { x1 = g2.eCol[ed]; y1 = g2.eRow[ed]; x2 = x1 + 1; y2 = y1; }
        else { x1 = g2.eCol[ed]; y1 = g2.eRow[ed]; x2 = x1; y2 = y1 + 1; }
        st.els.gHint.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': 'wrongLine' }));
      });
    } else {
      title.textContent = h.title;
      body.textContent = h.detail;
      apply.style.display = '';
      (h.changes || []).forEach(function (ch) {
        var id = ch.edge;
        if (ch.value === 2) {
          var gx, gy;
          if (st.els.g.eH[id]) { gx = st.els.g.eCol[id] + 0.5; gy = st.els.g.eRow[id]; }
          else { gx = st.els.g.eCol[id]; gy = st.els.g.eRow[id] + 0.5; }
          var d2 = 0.15;
          st.els.gHint.appendChild(svgEl('line', { x1: gx - d2, y1: gy - d2, x2: gx + d2, y2: gy + d2, id: 'hintLine', 'class': 'show' }));
          st.els.gHint.appendChild(svgEl('line', { x1: gx - d2, y1: gy + d2, x2: gx + d2, y2: gy - d2, id: 'hintLine', 'class': 'show' }));
          return;
        }
        if (st.els.g.eH[id]) {
          st.els.gHint.appendChild(svgEl('line', {
            x1: st.els.g.eCol[id], y1: st.els.g.eRow[id], x2: st.els.g.eCol[id] + 1, y2: st.els.g.eRow[id],
            id: 'hintLine', 'class': 'show'
          }));
        } else {
          st.els.gHint.appendChild(svgEl('line', {
            x1: st.els.g.eCol[id], y1: st.els.g.eRow[id], x2: st.els.g.eCol[id], y2: st.els.g.eRow[id] + 1,
            id: 'hintLine', 'class': 'show'
          }));
        }
      });
      if (h.cell != null) {
        var rr = Math.floor(h.cell / st.els.C), cc = h.cell % st.els.C;
        st.els.gHint.appendChild(svgEl('rect', { x: cc + 0.09, y: rr + 0.09, width: 0.82, height: 0.82, rx: 0.17, 'class': 'cellRing show' }));
      }
      if (h.vert != null) {
        var vrr = Math.floor(h.vert / (st.els.C + 1)), vcc = h.vert % (st.els.C + 1);
        st.els.gHint.appendChild(svgEl('circle', { cx: vcc, cy: vrr, r: 0.12, 'class': 'cellRing show' }));
      }
    }
    panel.classList.remove('hidden');
    requestAnimationFrame(function () { fitHintSpace(true); });
  }

  function applyHint() {
    var h = st.hint;
    if (st.won) return;
    if (!h || !h.changes) return;
    beginEdit();
    h.changes.forEach(function (ch) { if (setEdge(ch.edge, ch.value)) st.edited = true; });
    sfx('line');
    commitEdit();
    hideHintPanel();
  }

  /* ---------------- timer / game flow ---------------- */
  function startTimer() {
    if (st.running) return;
    st.running = true;
    st.startAt = Date.now() - st.elapsed;
    clearInterval(st.timerId);
    st.timerId = setInterval(function () {
      if (!st.running) return;
      st.elapsed = Date.now() - st.startAt;
      $('timer').textContent = fmtTime(st.elapsed);
    }, 250);
  }
  function pauseTimer() {
    if (!st.running) return;
    st.elapsed = Date.now() - st.startAt;
    st.running = false;
    clearInterval(st.timerId);
    $('timer').textContent = fmtTime(st.elapsed);
  }
  function resetTimer() {
    clearInterval(st.timerId);
    st.running = false; st.elapsed = 0; st.startAt = 0;
    $('timer').textContent = '00:00';
  }

  function startPuzzle(puzzle, opts) {
    st.puzzle = puzzle;
    st.clues = GEN.flatClues(puzzle);
    st.won = false;
    st.history = [];
    st.future = [];
    st.marks = [];
    st.hint = null;
    st.mode_ = opts.mode;
    st.stageId = opts.stageId || null;
    st.boardName = opts.name || '';
    st.boardSub = opts.sub || (puzzle.R + ' × ' + puzzle.C);
    $('hintPanel').classList.add('hidden');
    $('boardArea').style.paddingBottom = '';
    showScreen('game');
    buildBoard(puzzle);
    $('hudMode').textContent = st.boardName;
    $('hudSub').textContent = st.boardSub;
    $('timer').textContent = '00:00';
    resetTimer();
    st.els.svg.classList.remove('cleared');
    render();
    startTimer();
    saveNow();
  }

  function showScreen(which) {
    st.screen = which;
    $('screen-home').classList.toggle('hidden', which !== 'home');
    $('screen-game').classList.toggle('hidden', which !== 'game');
    if (which === 'home') {
      renderHome();
      if (st.els.svg) layoutBoard();
    } else {
      requestAnimationFrame(layoutBoard);
    }
  }

  function leaveGame(silent) {
    pauseTimer();
    if (!silent && !st.won && st.puzzle && countSet() > 0) {
      openModal({
        title: '판을 나갈까요?',
        body: '<p style="margin:0;font-size:13.5px;line-height:1.65;color:#c8c3b8">진행 상황은 자동 저장됩니다. 홈에서 <b>이어하기</b>로 돌아올 수 있어요.</p>',
        actions: [
          { label: '계속 풀기', kind: 'ghost', onClick: closeModal },
          { label: '나가기', kind: 'primary', onClick: function () { closeModal(); saveNow(); showScreen('home'); } }
        ]
      });
      return;
    }
    showScreen('home');
  }

  function countSet() {
    var n = 0;
    for (var i = 0; i < st.board.length; i++) if (st.board[i]) n++;
    return n;
  }

  /* ---------------- win ---------------- */
  function onWin(an) {
    st.won = true;
    pauseTimer();
    var e = st.els;
    var inside = S.insideCells(st.board, e.g);
    inside.forEach(function (i) {
      var r = Math.floor(i / e.C), c = i % e.C;
      var rect = svgEl('rect', { x: c + 0.06, y: r + 0.06, width: 0.88, height: 0.88, rx: 0.14, 'class': 'insidePlate' });
      rect.style.transitionDelay = (Math.random() * 0.5).toFixed(2) + 's';
      e.gCells.insertBefore(rect, e.gCells.firstChild);
    });
    e.svg.classList.add('cleared');
    sfx('win');
    clearSave();

    var time = st.elapsed;
    var recKey = st.mode_ === 'stage' ? st.stageId : null;
    var record = null, isBest = false;
    if (recKey) {
      st.records[recKey] = st.records[recKey] || { best: null, clears: 0 };
      record = st.records[recKey];
      record.clears = (record.clears || 0) + 1;
      if (record.best == null || time < record.best) { record.best = time; isBest = true; }
      writeJSON(LS.records, st.records);
      var idx = STAGES.findIndex(function (s) { return s.id === recKey; });
      if (idx >= 0 && st.unlocked < idx + 2 && idx + 2 <= STAGES.length) {
        st.unlocked = idx + 2;
        writeJSON(LS.unlocked, st.unlocked);
      }
    } else {
      st.freeBest = st.freeBest || {};
      var fk = st.puzzle.R + 'x' + st.puzzle.C + '-' + st.puzzle.meta.difficulty;
      var fb = st.freeBest[fk];
      if (fb == null || time < fb) { st.freeBest[fk] = time; isBest = true; writeJSON('df.v1.freeBest', st.freeBest); }
      renderChips();
      record = { best: st.freeBest[fk], clears: 1 };
    }

    setTimeout(function () {
      var node = el('div', 'clear-card');
      node.innerHTML =
        '<div class="clear-kicker">Fence Complete</div>' +
        '<div class="clear-title">울타리 완성</div>' +
        '<div style="font-size:12.5px;color:#9aa0ad;letter-spacing:.04em">' + (st.boardName || '') + ' · ' + st.boardSub + '</div>' +
        '<div class="clear-stats">' +
        '<div class="clear-stat"><b>' + fmtTime(time) + '</b><small>소요 시간</small></div>' +
        '<div class="clear-stat"><b>' + (record && record.best != null ? fmtTime(record.best) : '--:--') + '</b><small>최고 기록</small></div>' +
        '<div class="clear-stat"><b>' + an.lineCount + '</b><small>울타리 선</small></div>' +
        '</div>' +
        (isBest ? '<div class="record-flag">NEW RECORD</div>' : '');

      var actions = [];
      var stageIdx = st.mode_ === 'stage' ? STAGES.findIndex(function (s) { return s.id === st.stageId; }) : -1;
      if (stageIdx >= 0 && stageIdx + 1 < STAGES.length) {
        actions.push({
          label: '다음 스테이지 →', kind: 'primary', onClick: function () {
            closeModal();
            var nx = STAGES[stageIdx + 1];
            var pz = PRESETS.stages[nx.id];
            if (!pz) { toast('다음 스테이지를 준비 중입니다'); return; }
            startPuzzle(pz, { mode: 'stage', stageId: nx.id, name: nx.name, sub: nx.sub });
          }
        });
      }
      actions.push({
        label: st.mode_ === 'stage' ? '다시 도전' : '새 퍼즐', kind: stageIdx >= 0 ? 'ghost' : 'primary', onClick: function () {
          closeModal();
          if (st.mode_ === 'stage') retryStage();
          else startFreePlay();
        }
      });
      actions.push({ label: '홈으로', kind: 'ghost', onClick: function () { closeModal(); showScreen('home'); } });
      openModal({ title: '클리어', node: node, actions: actions });
    }, 950);
  }

  function retryStage() {
    var s = STAGES.find(function (x) { return x.id === st.stageId; });
    if (!s) return;
    var pz = PRESETS.stages[s.id];
    if (!pz) { toast('퍼즐을 불러올 수 없습니다'); return; }
    startPuzzle(pz, { mode: 'stage', stageId: s.id, name: s.name, sub: s.sub });
  }

  /* ---------------- free play ---------------- */
  function bankFor(R, C, diff) {
    if (!PRESETS.bank) return [];
    return PRESETS.bank.filter(function (p) { return p.R === R && p.C === C && p.meta.difficulty === diff; });
  }

  function startFreePlay() {
    var R = st.freeSel.size, C = st.freeSel.size, diff = st.freeSel.diff;
    var bank = bankFor(R, C, diff);
    var label = DIFFS.find(function (d) { return d.key === diff; }).label;
    var name = '자유 플레이 · ' + R + ' × ' + C + ' · ' + label;
    var needLive = R <= 10;

    if (!needLive && bank.length) {
      var pick = bank[Math.floor(Math.random() * bank.length)];
      startPuzzle(pick, { mode: 'free', name: name, sub: R + ' × ' + C + ' · ' + label });
      return;
    }

    var ov = $('genOverlay');
    ov.classList.add('show');
    $('genText').textContent = '퍼즐 생성 중 · ' + R + ' × ' + C + ' (' + label + ')';
    GEN.setTimeBudget(needLive ? (R >= 10 ? 3200 : 5000) : 12000);
    setTimeout(function () {
      GEN.generateAsync(R, C, diff, (Math.random() * 1e9) | 0, function (p) {
        $('genText').textContent = '유일해 검증 중… ' + Math.round(p * 100) + '%';
      }).then(function (pz) {
        ov.classList.remove('show');
        if (!pz) {
          if (bank.length) {
            startPuzzle(bank[Math.floor(Math.random() * bank.length)], { mode: 'free', name: name, sub: R + ' × ' + C + ' · ' + label });
          } else toast('생성 실패 · 다시 시도해 주세요');
          return;
        }
        startPuzzle(pz, { mode: 'free', name: name, sub: R + ' × ' + C + ' · ' + label });
      }).catch(function () {
        ov.classList.remove('show');
        toast('퍼즐 생성에 실패했습니다');
      });
    }, 60);
  }

  /* ---------------- checkpoints ---------------- */
  function markCheckpoint() {
    if (st.won) return;
    st.marks.push({ st: st.board.slice(), time: st.elapsed, label: '분기 ' + (st.marks.length + 1) });
    if (st.marks.length > 6) st.marks.shift();
    sfx('mark');
    render();
    toast('📌 분기 저장 · 지금 상태를 기억했습니다');
  }
  function restoreCheckpoint() {
    if (st.won) { toast('완성된 울타리는 되돌릴 수 없습니다'); return; }
    if (!st.marks.length) { toast('저장된 분기가 없습니다'); return; }
    var m = st.marks.pop();
    beginEdit();
    st.board = m.st.slice();
    st.edited = true;
    commitEdit();
    render();
    toast('↩️ 분기 시점으로 복원했습니다');
  }

  /* ---------------- save / resume ---------------- */
  function scheduleSave() {
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    if (!st.puzzle || st.won) return;
    var e = st.els;
    if (!e.svg) return;
    var b64 = '';
    try { b64 = btoa(String.fromCharCode.apply(null, st.board)); } catch (err) { b64 = ''; }
    writeJSON(LS.save, {
      at: Date.now(),
      mode: st.mode_,
      stageId: st.stageId,
      name: st.boardName,
      sub: st.boardSub,
      puzzle: { R: st.puzzle.R, C: st.puzzle.C, clues: st.puzzle.clues, solution: st.puzzle.solution, meta: st.puzzle.meta },
      board: b64,
      elapsed: st.elapsed
    });
  }
  function clearSave() {
    try { localStorage.removeItem(LS.save); } catch (e) { }
  }
  function resumeSaved() {
    var s = readJSON(LS.save, null);
    if (!s || !s.puzzle) { toast('이어할 판이 없습니다'); return; }
    var b64 = s.board || '';
    startPuzzle(s.puzzle, { mode: s.mode, stageId: s.stageId, name: s.name, sub: s.sub });
    if (b64) {
      try {
        var raw = atob(b64);
        for (var i = 0; i < raw.length && i < st.board.length; i++) st.board[i] = raw.charCodeAt(i);
      } catch (e) { }
    }
    st.elapsed = s.elapsed || 0;
    st.startAt = Date.now() - st.elapsed;
    $('timer').textContent = fmtTime(st.elapsed);
    render();
    saveNow();
  }

  /* ---------------- home ---------------- */
  function renderHome() {
    var list = $('stageList');
    list.innerHTML = '';
    var cleared = 0;
    STAGES.forEach(function (s, idx) {
      var rec = st.records[s.id];
      if (rec && rec.clears) cleared++;
      var locked = idx + 1 > st.unlocked;
      var row = el('div', 'stage' + (locked ? ' locked' : '') + (rec && rec.clears ? ' cleared' : ''));
      row.innerHTML =
        '<div class="stage-num">' + (locked ? '🔒' : (rec && rec.clears ? '✓' : idx + 1)) + '</div>' +
        '<div><div class="stage-name">' + s.name + '</div><div class="stage-meta">' + s.sub + '</div></div>' +
        '<div class="stage-best">' + (rec && rec.best != null ? fmtTime(rec.best) : (locked ? '' : '도전')) +
        (rec && rec.best != null ? '<small>BEST</small>' : '') + '</div>';
      row.onclick = function () {
        if (locked) { toast('앞 스테이지를 먼저 클리어하세요'); return; }
        var pz = PRESETS.stages[s.id];
        if (!pz) { toast('퍼즐을 준비 중입니다'); return; }
        startPuzzle(pz, { mode: 'stage', stageId: s.id, name: s.name, sub: s.sub });
      };
      list.appendChild(row);
    });
    $('homeProgress').textContent = '진행 ' + cleared + ' / ' + STAGES.length;
    var total = 0, cnt = 0;
    Object.keys(st.records).forEach(function (k) {
      if (st.records[k].best != null) { total += st.records[k].best; cnt++; }
    });
    $('homeTotal').textContent = cnt ? '베스트 합 ' + fmtTime(total) : '기록 없음';

    // resume button
    var foot = document.querySelector('.home-foot');
    var old = $('btnResume');
    if (old) old.remove();
    var s = readJSON(LS.save, null);
    if (s && s.puzzle) {
      var rb = el('button', 'btn gold', '⏵ 이어하기 · ' + (s.name || '') + ' ' + fmtTime(s.elapsed || 0));
      rb.id = 'btnResume';
      rb.onclick = resumeSaved;
      foot.insertBefore(rb, foot.firstChild);
    }
  }

  function renderChips() {
    var sc = $('sizeChips');
    sc.innerHTML = '';
    SIZES.forEach(function (n) {
      var b = el('button', 'chip' + (st.freeSel.size === n ? ' active' : ''), n + '×' + n);
      b.onclick = function () { st.freeSel.size = n; renderChips(); };
      sc.appendChild(b);
    });
    var dc = $('diffChips');
    dc.innerHTML = '';
    DIFFS.forEach(function (d) {
      var b = el('button', 'chip' + (st.freeSel.diff === d.key ? ' active' : ''), d.label);
      b.onclick = function () { st.freeSel.diff = d.key; renderChips(); };
      dc.appendChild(b);
    });
    var fk = st.freeSel.size + 'x' + st.freeSel.size + '-' + st.freeSel.diff;
    var fb = st.freeBest ? st.freeBest[fk] : null;
    var note = $('freeNote');
    if (note) {
      note.textContent = fb != null
        ? '이 조합 최고 기록 ' + fmtTime(fb) + ' · 모든 판은 유일해 검증을 통과합니다.'
        : '모든 판은 유일해 검증을 통과합니다. 5×5~10×10은 즉석 생성, 12×12·15×15는 검증된 퍼즐 풀에서 출제됩니다.';
    }
  }

  /* ---------------- guide ---------------- */
  function miniFig(spec) {
    var n = spec.n || 3;
    var pad = 0.32, W = n + pad * 2;
    var p = [];
    p.push('<svg viewBox="0 0 ' + W + ' ' + W + '" xmlns="http://www.w3.org/2000/svg">');
    p.push('<defs><linearGradient id="mg' + (miniFig._i = (miniFig._i || 0) + 1) + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="#ff9a72"/><stop offset="100%" stop-color="#e33a58"/></linearGradient></defs>');
    var gid = 'mg' + miniFig._i;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        p.push('<rect x="' + (pad + c) + '" y="' + (pad + r) + '" width="1" height="1" fill="rgba(255,255,255,.025)" stroke="rgba(255,255,255,.05)" stroke-width="0.02"/>');
      }
    }
    (spec.clues || []).forEach(function (cl) {
      p.push('<text x="' + (pad + cl.c + 0.5) + '" y="' + (pad + cl.r + 0.5) + '" fill="' + (cl.dim ? '#8d93a1' : '#e9c987') +
        '" font-size="0.46" font-family="sans-serif" font-weight="700" text-anchor="middle" dominant-baseline="central">' + cl.v + '</text>');
    });
    (spec.ring || []).forEach(function (cl) {
      p.push('<rect x="' + (pad + cl.c + 0.06) + '" y="' + (pad + cl.r + 0.06) + '" width="0.88" height="0.88" rx="0.16" fill="none" stroke="#f7e6bd" stroke-width="0.05" opacity=".8"/>');
    });
    (spec.lines || []).forEach(function (ln) {
      var x1, y1, x2, y2;
      if (ln[0] === 'h') { x1 = pad + ln[2]; y1 = pad + ln[1]; x2 = x1 + 1; y2 = y1; }
      else { x1 = pad + ln[2]; y1 = pad + ln[1]; x2 = x1; y2 = y1 + 1; }
      p.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#f4715f" stroke-width="0.13" stroke-linecap="round"/>');
      p.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#ffd9a6" stroke-width="0.045" stroke-linecap="round"/>');
    });
    (spec.xs || []).forEach(function (x) {
      var x1, y1, x2, y2;
      if (x[0] === 'h') { x1 = pad + x[2] + 0.5; y1 = pad + x[1]; x2 = x1; y2 = y1; }
      else { x1 = pad + x[2]; y1 = pad + x[1] + 0.5; x2 = x1; y2 = y1; }
      p.push('<line x1="' + (x1 - 0.1) + '" y1="' + (y1 - 0.1) + '" x2="' + (x1 + 0.1) + '" y2="' + (y1 + 0.1) + '" stroke="#8b93a6" stroke-width="0.055" stroke-linecap="round"/>');
      p.push('<line x1="' + (x1 - 0.1) + '" y1="' + (y1 + 0.1) + '" x2="' + (x1 + 0.1) + '" y2="' + (y1 - 0.1) + '" stroke="#8b93a6" stroke-width="0.055" stroke-linecap="round"/>');
    });
    for (var vr = 0; vr <= n; vr++) {
      for (var vc = 0; vc <= n; vc++) {
        p.push('<circle cx="' + (pad + vc) + '" cy="' + (pad + vr) + '" r="0.035" fill="rgba(233,201,135,.35)"/>');
      }
    }
    p.push('</svg>');
    return p.join('');
  }

  var GUIDE = {
    rules: [
      {
        t: '숫자만큼 선을 긋는다',
        d: '칸 안의 숫자는 <b>그 칸을 둘러싼 울타리 선의 개수</b>입니다. 0이면 네 변 모두 X, 3이면 네 변 중 세 개가 선입니다.',
        fig: { clues: [{ r: 1, c: 1, v: 2 }], lines: [['h', 1, 1], ['v', 1, 2]], xs: [['h', 2, 1], ['v', 1, 1]] , ring:[{r:1,c:1}]}
      },
      {
        t: '선은 하나의 닫힌 고리',
        d: '모든 선은 끊김 없이 이어져 <b>단 하나의 닫힌 고리</b>를 이뤄야 합니다. 열린 끝, 갈라짐, 작은 고리가 두 개 이상이면 실패입니다.',
        fig: { clues: [], lines: [['h', 0, 0], ['h', 0, 1], ['v', 0, 2], ['v', 1, 2], ['h', 2, 0], ['h', 2, 1], ['v', 0, 0], ['v', 1, 0]] }
      },
      {
        t: '한 점에서는 0개 또는 2개',
        d: '격자의 한 점에 선이 들어오는 개수는 <b>0개 아니면 2개</b>. 세 개가 모이면 갈라지고, 한 개면 끊긴 선이 됩니다.',
        fig: { clues: [{ r: 0, c: 0, v: 1 }], lines: [['h', 0, 0], ['v', 0, 0]], xs: [['h', 1, 0], ['v', 0, 1]] }
      }
    ],
    techs: [
      {
        t: '0 주변은 전부 X',
        d: '0이 적힌 칸의 네 변은 모두 X입니다. 0 옆 칸의 변 하나가 지워지면 그 옆의 3은 자동으로 확정되는 경우가 많습니다.',
        fig: { clues: [{ r: 1, c: 1, v: 0 }], xs: [['h', 1, 1], ['h', 2, 1], ['v', 1, 1], ['v', 1, 2]], ring: [{ r: 1, c: 1 }] }
      },
      {
        t: '0 옆의 3',
        d: '3 옆에 0이 붙어 있으면, 둘이 공유하는 변은 X. 3이 쓸 수 있는 나머지 세 변이 모두 선이 됩니다.',
        fig: { clues: [{ r: 1, c: 1, v: 3 }, { r: 0, c: 1, v: 0 }], xs: [['h', 1, 1]], lines: [['v', 1, 1], ['v', 1, 2], ['h', 2, 1]] }
      },
      {
        t: '모서리의 1과 3',
        d: '모서리 칸의 1은 안쪽 두 변이 X. 모서리 칸의 3은 바깥 두 변이 반드시 선입니다.',
        fig: { clues: [{ r: 0, c: 0, v: 3 }], lines: [['h', 0, 0], ['v', 0, 0]] }
      },
      {
        t: '3 – 3 대각선',
        d: '대각선으로 마주 본 두 3은, 사이에 낀 두 변이 반드시 선입니다.',
        fig: { clues: [{ r: 0, c: 0, v: 3 }, { r: 1, c: 1, v: 3 }, { r: 0, c: 1, v: 2, dim: true }, { r: 1, c: 0, v: 2, dim: true }], lines: [['h', 1, 0], ['v', 0, 1]] , ring:[{r:0,c:0},{r:1,c:1}]}
      },
      {
        t: '3 – 3 인접',
        d: '변을 맞댄 두 3은, 그 변의 양 끝에서 뻗어 나가는 두 변이 반드시 선입니다.',
        fig: { clues: [{ r: 0, c: 0, v: 3 }, { r: 0, c: 1, v: 3 }], lines: [['v', 0, 0], ['v', 0, 2]], ring:[{r:0,c:0},{r:0,c:1}] }
      },
      {
        t: '한 점 0 / 2 규칙',
        d: '한 점에 선이 하나도 없는데 남은 변이 하나뿐이면 그 변은 X. 반대로 선이 하나 들어왔는데 남은 변이 하나뿐이면 그 변은 선입니다.',
        fig: { clues: [{ r: 0, c: 0, v: 2 }], lines: [['h', 0, 0]], xs: [['v', 0, 1]], ring: [{ r: 0, c: 0 }] }
      },
      {
        t: '가정법 + 분기 저장',
        d: '막히면 한 변을 <b>선</b> 또는 <b>X</b>로 가정해 끝까지 밀어 보세요. 모순이 나오면 가정이 틀린 것. 📌 분기로 지금 상태를 저장하고 시작하면 한 번에 되돌릴 수 있습니다.',
        fig: { clues: [{ r: 1, c: 1, v: 2 }], lines: [['v', 1, 2]], xs: [['h', 2, 1]], ring: [{ r: 1, c: 1 }] }
      }
    ]
  };

  function openGuide() {
    var node = el('div');
    var html = '<p class="guide-lead">데블스 플랜 3 유배지 매치 <b>울타리 치기</b>(슬리더링크). 숫자를 모두 만족시키면서 단 하나의 닫힌 고리를 완성하면 클리어입니다.</p>';
    html += '<div class="guide-section">기본 규칙</div><div class="rule-grid">';
    GUIDE.rules.forEach(function (it) {
      html += '<div class="rule"><figure>' + miniFig(it.fig) + '</figure><div><h4>' + it.t + '</h4><p>' + it.d + '</p></div></div>';
    });
    html += '</div><div class="guide-section">핵심 공략</div><div class="rule-grid">';
    GUIDE.techs.forEach(function (it) {
      html += '<div class="rule"><figure>' + miniFig(it.fig) + '</figure><div><h4>' + it.t + '</h4><p>' + it.d + '</p></div></div>';
    });
    html += '</div>';
    node.innerHTML = html;
    openModal({
      title: '📜 규칙 · 공략 가이드', node: node,
      actions: [{ label: '닫기', kind: 'ghost', onClick: closeModal }]
    });
  }

  /* ---------------- options ---------------- */
  function openOptions() {
    var node = el('div');
    function row(title, desc, key) {
      var r = el('div', 'opt-row');
      var txt = el('div', 'opt-text', '<b>' + title + '</b><small>' + desc + '</small>');
      var sw = el('div', 'switch' + (st.opts[key] ? ' on' : ''));
      sw.onclick = function () {
        st.opts[key] = !st.opts[key];
        sw.classList.toggle('on', st.opts[key]);
        writeJSON(LS.opts, st.opts);
        render();
      };
      r.appendChild(txt); r.appendChild(sw);
      return r;
    }
    node.appendChild(row('실시간 오류 경고', '숫자를 넘긴 칸과 갈라진 교차점을 빨갛게 표시합니다. 방송 실전 모드에서는 꺼 두세요.', 'warn'));
    node.appendChild(row('사운드 효과', '선을 그을 때와 완성했을 때의 짧은 효과음.', 'sound'));
    var reset = el('div', 'opt-row');
    reset.innerHTML = '<div class="opt-text"><b>기록 초기화</b><small>스테이지 최고 기록과 진행도를 지웁니다.</small></div>';
    var rb = el('button', 'btn ghost', '초기화');
    rb.onclick = function () {
      st.records = {}; st.unlocked = 1; st.freeBest = {};
      writeJSON(LS.records, {}); writeJSON(LS.unlocked, 1); writeJSON('df.v1.freeBest', {});
      renderHome();
      toast('기록을 초기화했습니다');
    };
    reset.appendChild(rb);
    node.appendChild(reset);
    openModal({
      title: '⚙️ 옵션', node: node,
      actions: [{ label: '닫기', kind: 'gold', onClick: function () { closeModal(); renderHome(); } }]
    });
  }

  /* ---------------- wiring ---------------- */
  function bind() {
    var svg = $('board');
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', function () { st.drag = null; commitEdit(); });
    svg.addEventListener('pointerleave', function () { if (st.els.hover) st.els.hover.classList.remove('show'); });
    svg.addEventListener('contextmenu', onContextMenu);

    $('btnBack').onclick = function () { leaveGame(false); };
    $('btnUndo').onclick = function () {
      if (st.won) { toast('완성된 울타리는 되돌릴 수 없습니다'); return; }
      if (!st.history.length) return;
      st.future.push(st.board.slice());
      st.board = st.history.pop();
      render();
      sfx('x');
    };
    $('btnRedo').onclick = function () {
      if (st.won) { toast('완성된 울타리는 되돌릴 수 없습니다'); return; }
      if (!st.future.length) return;
      st.history.push(st.board.slice());
      st.board = st.future.pop();
      render();
    };
    $('btnHint').onclick = showHint;
    $('hintApply').onclick = applyHint;
    $('hintClose').onclick = hideHintPanel;
    $('btnMark').onclick = markCheckpoint;
    $('btnRestore').onclick = restoreCheckpoint;
    $('btnReset').onclick = function () {
      if (st.won) { toast('이미 완성된 판입니다'); return; }
      openModal({
        title: '판을 초기화할까요?',
        body: '<p style="margin:0;font-size:13.5px;line-height:1.65;color:#c8c3b8">지금까지 그은 선과 X가 모두 지워집니다. (분기 저장은 유지)</p>',
        actions: [
          { label: '취소', kind: 'ghost', onClick: closeModal },
          {
            label: '초기화', kind: 'primary', onClick: function () {
              closeModal();
              beginEdit();
              st.board = new Uint8Array(st.els.g.N);
              st.edited = true;
              commitEdit();
              resetTimer();
              startTimer();
              st.els.svg.classList.remove('cleared');
            }
          }
        ]
      });
    };
    $('btnGuide').onclick = openGuide;
    $('btnGuideHome').onclick = openGuide;
    $('btnOptions').onclick = openOptions;
    $('btnOptionsHome').onclick = openOptions;
    $('btnFreeStart').onclick = startFreePlay;

    Array.prototype.forEach.call(document.querySelectorAll('#modeGroup .mode'), function (b) {
      b.onclick = function () {
        st.mode = b.getAttribute('data-mode');
        Array.prototype.forEach.call(document.querySelectorAll('#modeGroup .mode'), function (x) {
          x.classList.toggle('active', x === b);
        });
        saveOptsSoon();
        toast(b.textContent + ' 모드');
      };
    });

    window.addEventListener('resize', layoutBoard);
    if (window.ResizeObserver) {
      new ResizeObserver(layoutBoard).observe($('boardArea'));
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('modalRoot').classList.contains('open')) closeModal();
        else hideHintPanel();
        return;
      }
      if (st.screen !== 'game') return;
      var meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) $('btnRedo').click(); else $('btnUndo').click();
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault(); $('btnRedo').click();
      } else if (!meta && (e.key === 'h' || e.key === 'H')) {
        showHint();
      }
    });
    window.addEventListener('beforeunload', function () { saveNow(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseTimer();
      else if (st.screen === 'game' && !st.won && st.els.svg) startTimer();
    });
  }

  function saveOptsSoon() {
    writeJSON(LS.opts, st.opts);
  }

  /* ---------------- decorative solved-board art ---------------- */
  function renderHeroArt() {
    var host = $('heroArt');
    if (!host) return;
    var pz = PRESETS.stages && PRESETS.stages.s2;
    if (!pz) return;
    var g = S.geom(pz.R, pz.C);
    var R = pz.R, C = pz.C;
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '-0.6 -0.6 ' + (C + 1.2) + ' ' + (R + 1.2));
    var defs = document.createElementNS(NS, 'defs');
    defs.innerHTML = '<linearGradient id="heroGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + C + '" y2="' + R + '">' +
      '<stop offset="0%" stop-color="#ff6a49"/><stop offset="45%" stop-color="#d21f40"/><stop offset="100%" stop-color="#ffb268"/></linearGradient>';
    svg.appendChild(defs);
    var i, r, c;
    for (r = 0; r < R; r++) {
      for (c = 0; c < C; c++) {
        var k = pz.clues[r][c];
        if (k == null || k < 0) continue;
        var t = document.createElementNS(NS, 'text');
        t.setAttribute('x', c + 0.5); t.setAttribute('y', r + 0.52);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('font-size', '0.42');
        t.setAttribute('font-family', 'inherit');
        t.setAttribute('font-weight', '700');
        t.setAttribute('fill', 'rgba(236,230,220,.20)');
        t.textContent = k;
        svg.appendChild(t);
      }
    }
    pz.solution.forEach(function (e) {
      var ln = document.createElementNS(NS, 'line');
      var x1, y1, x2, y2;
      if (g.eH[e]) { x1 = g.eCol[e]; y1 = g.eRow[e]; x2 = x1 + 1; y2 = y1; }
      else { x1 = g.eCol[e]; y1 = g.eRow[e]; x2 = x1; y2 = y1 + 1; }
      ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
      ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
      ln.setAttribute('stroke', 'url(#heroGrad)');
      ln.setAttribute('stroke-width', '0.12');
      ln.setAttribute('stroke-linecap', 'round');
      svg.appendChild(ln);
    });
    host.appendChild(svg);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    st.records = readJSON(LS.records, {});
    st.unlocked = readJSON(LS.unlocked, 1) || 1;
    st.freeBest = readJSON('df.v1.freeBest', {});
    var o = readJSON(LS.opts, null);
    if (o) { st.opts.warn = o.warn !== false; st.opts.sound = o.sound !== false; }
    bind();
    renderChips();
    renderHome();
    layoutBoard();
    showScreen('home');
    if (!window.__DFTest) {
      // first visit hint
    }
  }

  // expose for automated tests
  window.DFApp = {
    st: st,
    startStage: function (id) {
      var s = STAGES.filter(function (x) { return x.id === id; })[0];
      var pz = PRESETS.stages[id];
      if (!s || !pz) return false;
      startPuzzle(pz, { mode: 'stage', stageId: s.id, name: s.name, sub: s.sub });
      return true;
    },
    startFree: startFreePlay,
    setFree: function (size, diff) { st.freeSel.size = size; st.freeSel.diff = diff; renderChips(); },
    showHint: showHint,
    applyHint: applyHint,
    hint: function () { return S.hint(st.board, st.els.g, st.clues, st.puzzle && st.puzzle.solution); },
    setEdge: function (id, v) { beginEdit(); if (setEdge(id, v)) { st.edited = true; } commitEdit(); render(); },
    board: function () { return st.board; },
    puzzle: function () { return st.puzzle; },
    win: function () { return st.won; },
    mode: function (m) { st.mode = m; },
    mark: markCheckpoint,
    restore: restoreCheckpoint,
    undo: function () { $('btnUndo').click(); },
    redo: function () { $('btnRedo').click(); },
    elapsed: function () { return st.elapsed; },
    home: function () { showScreen('home'); },
    paint: function (onEdges, xEdges) {
      beginEdit();
      for (var i = 0; i < st.board.length; i++) st.board[i] = 0;
      (onEdges || []).forEach(function (e) { st.board[e] = 1; });
      (xEdges || []).forEach(function (e) { st.board[e] = 2; });
      st.edited = true;
      commitEdit();
      render();
      return true;
    },
    solveForTest: function () {
      var p = st.puzzle;
      if (!p) return false;
      beginEdit();
      for (var i = 0; i < st.board.length; i++) st.board[i] = 0;
      for (var q = 0; q < p.solution.length; q++) st.board[p.solution[q]] = 1;
      st.edited = true;
      commitEdit();
      render();
      return true;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
