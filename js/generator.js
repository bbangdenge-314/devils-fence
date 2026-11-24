/* ============================================================
 * 울타리 치기 — Puzzle generator
 * 1) 무작위 단일 폐곡선 성장  2) 단서 도출  3) 유일해를 유지하며 단서 제거
 * ============================================================ */
(function (global) {
  'use strict';

  var S = global.DFSolver;
  var ON = 1;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function now() { return (global.performance && performance.now) ? performance.now() : Date.now(); }

  /* ---------- random simple closed loop ---------- */
  function growLoop(R, C, rand, frac, initial) {
    var g = S.geom(R, C);
    var st = new Uint8Array(g.N);
    var deg = new Int8Array(g.NV);
    var list = [];

    function addE(e) {
      st[e] = 1; list.push(e);
      var r = g.eRow[e], c = g.eCol[e];
      if (g.eH[e]) { deg[r * (C + 1) + c]++; deg[r * (C + 1) + c + 1]++; }
      else { deg[r * (C + 1) + c]++; deg[(r + 1) * (C + 1) + c]++; }
    }
    function remE(e) {
      st[e] = 0;
      for (var i = 0; i < list.length; i++) if (list[i] === e) { list[i] = list[list.length - 1]; list.pop(); break; }
      var r = g.eRow[e], c = g.eCol[e];
      if (g.eH[e]) { deg[r * (C + 1) + c]--; deg[r * (C + 1) + c + 1]--; }
      else { deg[r * (C + 1) + c]--; deg[(r + 1) * (C + 1) + c]--; }
    }

    // start rectangle
    var w = initial ? initial.w : 2 + Math.floor(rand() * Math.min(3, C - 1));
    var h = initial ? initial.h : 2 + Math.floor(rand() * Math.min(3, R - 1));
    w = Math.max(1, Math.min(C, w)); h = Math.max(1, Math.min(R, h));
    var r0 = initial ? initial.r : Math.floor(rand() * (R - h + 1));
    var c0 = initial ? initial.c : Math.floor(rand() * (C - w + 1));
    r0 = Math.max(0, Math.min(R - h, r0)); c0 = Math.max(0, Math.min(C - w, c0));

    var cc, rr;
    for (cc = c0; cc < c0 + w; cc++) { addE(g.H(r0, cc)); addE(g.H(r0 + h, cc)); }
    for (rr = r0; rr < r0 + h; rr++) { addE(g.V(rr, c0)); addE(g.V(rr, c0 + w)); }

    var targetArea = Math.max(w * h + 2, Math.round(R * C * frac));
    var targetBumps = Math.max(0, targetArea - w * h);

    function tryBump() {
      var e = list[Math.floor(rand() * list.length)];
      var r = g.eRow[e], c = g.eCol[e];
      var d = rand() < 0.5 ? -1 : 1;
      var add = [];
      if (g.eH[e]) {
        var nr = r + d;
        if (nr < 0 || nr > R) return false;
        var v1 = nr * (C + 1) + c, v2 = nr * (C + 1) + c + 1;
        if (deg[v1] || deg[v2]) return false;
        var eA = (d > 0) ? g.V(r, c) : g.V(nr, c);
        var eB = g.H(nr, c);
        var eC = (d > 0) ? g.V(r, c + 1) : g.V(nr, c + 1);
        if (st[eA] || st[eB] || st[eC]) return false;
        add = [eA, eB, eC];
      } else {
        var nc = c + d;
        if (nc < 0 || nc > C) return false;
        var w1 = r * (C + 1) + nc, w2 = (r + 1) * (C + 1) + nc;
        if (deg[w1] || deg[w2]) return false;
        var fA = (d > 0) ? g.H(r, c) : g.H(r, nc);
        var fB = g.V(r, nc);
        var fC = (d > 0) ? g.H(r + 1, c) : g.H(r + 1, nc);
        if (st[fA] || st[fB] || st[fC]) return false;
        add = [fA, fB, fC];
      }
      remE(e);
      for (var i2 = 0; i2 < 3; i2++) addE(add[i2]);
      if (countComponents() !== 1) {
        for (var i3 = 0; i3 < 3; i3++) remE(add[i3]);
        addE(e);
        return false;
      }
      return true;
    }

    function countComponents() {
      var total = 0, start = -1;
      for (var v = 0; v < g.NV; v++) {
        if (deg[v] > 0) { total++; if (start < 0) start = v; }
      }
      if (start < 0) return 0;
      var seen = new Uint8Array(g.NV);
      var stack = [start];
      seen[start] = 1;
      var visited = 1;
      while (stack.length) {
        var cur = stack.pop();
        var b = cur * 4;
        for (var q = 0; q < 4; q++) {
          var e2 = g.vertEdges[b + q];
          if (e2 < 0 || !st[e2]) continue;
          var r2 = g.eRow[e2], c2 = g.eCol[e2], nv;
          if (g.eH[e2]) {
            var vr = Math.floor(cur / (C + 1)), vc = cur % (C + 1);
            nv = vr * (C + 1) + (c2 === vc ? c2 + 1 : c2);
          } else {
            var vr2 = Math.floor(cur / (C + 1));
            nv = (r2 === vr2 ? r2 + 1 : r2) * (C + 1) + c2;
          }
          if (!seen[nv]) { seen[nv] = 1; visited++; stack.push(nv); }
        }
      }
      return visited === total ? 1 : 2;
    }

    var made = 0, tries = 0, maxTries = targetBumps * 40 + 200;
    var rej = 0;
    while (made < targetBumps && tries < maxTries) {
      tries++;
      if (tryBump()) made++; else rej++;
    }
    return { st: st, edges: list.slice(), geom: g, area: w * h + made, tries: tries, rej: rej, finalComps: countComponents() };
  }

  function deriveClues(R, C, st, g) {
    var clues = new Int8Array(R * C);
    for (var i = 0, n = R * C; i < n; i++) {
      var base = i * 4, count = 0;
      for (var j = 0; j < 4; j++) if (st[g.cellEdges[base + j]] === ON) count++;
      clues[i] = count;
    }
    return clues;
  }

  var TIME_BUDGET = 9000;
  var CONF = {
    easy: { frac: 0.62, density: 0.60, requireProp: true, requireNonProp: false, budget: 90000 },
    normal: { frac: 0.66, density: 0.47, requireProp: false, requireNonProp: false, budget: 120000 },
    hard: { frac: 0.70, density: 0.34, requireProp: false, requireNonProp: true, budget: 160000 }
  };

  /* ---------- generator as a resumable step machine ---------- */
  function* build(R, C, diff, seed) {
    var cfg = CONF[diff] || CONF.normal;
    var g = S.geom(R, C);
    var t0 = now();
    var fallback = null;

    for (var attempt = 0; attempt < 8; attempt++) {
      if (fallback && now() - t0 > TIME_BUDGET * 0.7) break;
      var rand = mulberry32(((seed | 0) + attempt * 7919 + R * 131 + C * 17) >>> 0);
      var grown = growLoop(R, C, rand, cfg.frac);
      var inside = S.insideCells(grown.st, g).length;
      if (inside < R * C * 0.26 || inside > R * C * 0.94) { yield 0.05; continue; }

      var clues = deriveClues(R, C, grown.st, g);
      var clueList = [];
      for (var i = 0; i < R * C; i++) clueList.push(i);
      // shuffle
      for (var k = clueList.length - 1; k > 0; k--) {
        var jj = Math.floor(rand() * (k + 1));
        var tmp = clueList[k]; clueList[k] = clueList[jj]; clueList[jj] = tmp;
      }

      var minClues = Math.max(4, Math.round(R * C * cfg.density));
      var remaining = R * C;
      var steps = 0;
      for (var q = 0; q < clueList.length; q++) {
        if (remaining <= minClues) break;
        var cell = clueList[q];
        var saved = clues[cell];
        clues[cell] = -1;
        var res = S.solveCount(R, C, clues, 2, cfg.budget);
        var ok = (!res.exceeded) && res.count === 1;
        if (ok && cfg.requireProp) {
          ok = S.propagateOnly(R, C, clues).solved;
        }
        if (!ok) clues[cell] = saved;
        else remaining--;
        steps++;
        if ((steps & 7) === 0) yield Math.min(0.95, 0.1 + 0.85 * (q / clueList.length));
        if (now() - t0 > TIME_BUDGET) break;
      }

      if (remaining >= R * C) { yield 0.05; continue; }  // nothing was removed -> degenerate
      var propTest = S.propagateOnly(R, C, clues);
      var propSolved = propTest.solved;

      var candidate = {
        R: R, C: C, difficulty: diff, seed: seed,
        clues: clues, solution: grown.edges.slice(), clueCount: remaining,
        propSolved: propSolved, ms: Math.round(now() - t0)
      };

      if (!fallback) fallback = candidate;

      var good = true;
      if (cfg.requireProp && !propSolved) good = false;
      if (cfg.requireNonProp && propSolved) good = false;
      if (remaining > R * C * 0.86) good = false;
      if (good) { yield 1; return candidate; }
      yield 0.5;
    }

    yield 1;
    return fallback;
  }

  function finish(cand) {
    if (!cand) return null;
    var R = cand.R, C = cand.C;
    var rows = [];
    for (var r = 0; r < R; r++) {
      var row = [];
      for (var c = 0; c < C; c++) row.push(cand.clues[r * C + c]);
      rows.push(row);
    }
    return {
      R: R, C: C, clues: rows,
      solution: cand.solution.slice(),
      meta: {
        difficulty: cand.difficulty, seed: cand.seed, clueCount: cand.clueCount,
        propSolved: cand.propSolved, ms: cand.ms
      }
    };
  }

  function generateSync(R, C, diff, seed) {
    var it = build(R, C, diff, seed);
    var step = it.next();
    while (!step.done) step = it.next();
    return finish(step.value);
  }

  function generateAsync(R, C, diff, seed, onProgress) {
    return new Promise(function (resolve) {
      var it = build(R, C, diff, seed);
      var last = now();
      function pump() {
        var step;
        try { step = it.next(); } catch (err) { resolve(null); return; }
        if (step.done) { resolve(finish(step.value)); return; }
        if (onProgress) onProgress(step.value);
        if (now() - last > 24) {
          last = now();
          setTimeout(pump, 0);
        } else {
          pump();
        }
      }
      setTimeout(pump, 0);
    });
  }

  /* clues helper: 2D rows -> flat */
  function flatClues(p) {
    var out = new Int8Array(p.R * p.C);
    for (var r = 0; r < p.R; r++) for (var c = 0; c < p.C; c++) {
      var v = p.clues[r][c];
      out[r * p.C + c] = (v === null || v === undefined) ? -1 : v;
    }
    return out;
  }

  global.DFGen = {
    growLoop: growLoop,
    deriveClues: deriveClues,
    generateSync: generateSync,
    setTimeBudget: function (ms) { TIME_BUDGET = ms; },
    generateAsync: generateAsync,
    flatClues: flatClues,
    mulberry32: mulberry32,
    CONF: CONF
  };
})(typeof window !== 'undefined' ? window : this);
