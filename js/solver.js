/* ============================================================
 * 울타리 치기 — Solver core
 * 슬리더링크(Slitherlink) 기하 구조, 제약 전파, 유일해 카운팅, 논리 힌트
 * ============================================================ */
(function (global) {
  'use strict';

  var UNKNOWN = 0, ON = 1, OFF = 2;

  /* ---------- geometry ---------- */
  var geomCache = Object.create(null);

  function geom(R, C) {
    var key = R + 'x' + C;
    if (geomCache[key]) return geomCache[key];

    var HC = (R + 1) * C;              // horizontal edges: H(r,c), r:0..R, c:0..C-1
    var N = HC + R * (C + 1);          // vertical edges:  V(r,c), r:0..R-1, c:0..C

    var cellEdges = new Int32Array(R * C * 4); // [top, right, bottom, left]
    for (var r = 0; r < R; r++) {
      for (var c = 0; c < C; c++) {
        var i = (r * C + c) * 4;
        cellEdges[i] = r * C + c;                          // H(r,c)   top
        cellEdges[i + 1] = HC + r * (C + 1) + (c + 1);     // V(r,c+1) right
        cellEdges[i + 2] = (r + 1) * C + c;                // H(r+1,c) bottom
        cellEdges[i + 3] = HC + r * (C + 1) + c;           // V(r,c)   left
      }
    }

    var vertEdges = new Int32Array((R + 1) * (C + 1) * 4).fill(-1);
    for (var vr = 0; vr <= R; vr++) {
      for (var vc = 0; vc <= C; vc++) {
        var vi = (vr * (C + 1) + vc) * 4, k = 0;
        if (vc > 0) vertEdges[vi + k++] = vr * C + (vc - 1);
        if (vc < C) vertEdges[vi + k++] = vr * C + vc;
        if (vr > 0) vertEdges[vi + k++] = HC + (vr - 1) * (C + 1) + vc;
        if (vr < R) vertEdges[vi + k++] = HC + vr * (C + 1) + vc;
      }
    }

    var eRow = new Int16Array(N), eCol = new Int16Array(N), eH = new Uint8Array(N);
    for (var e = 0; e < N; e++) {
      if (e < HC) { eRow[e] = Math.floor(e / C); eCol[e] = e % C; eH[e] = 1; }
      else {
        var t = e - HC;
        eRow[e] = Math.floor(t / (C + 1)); eCol[e] = t % (C + 1); eH[e] = 0;
      }
    }

    var g = {
      R: R, C: C, HC: HC, N: N, NV: (R + 1) * (C + 1),
      cellEdges: cellEdges, vertEdges: vertEdges,
      eRow: eRow, eCol: eCol, eH: eH,
      H: function (r, c) { return r * C + c; },
      V: function (r, c) { return HC + r * (C + 1) + c; }
    };
    geomCache[key] = g;
    return g;
  }

  /* ---------- constraint propagation ---------- */
  function propagate(st, g, clues) {
    var R = g.R, C = g.C, ce = g.cellEdges, ve = g.vertEdges;
    var changed = true;
    var guard = 0;
    while (changed) {
      changed = false;
      if (++guard > 400) break;

      for (var i = 0, n = R * C; i < n; i++) {
        var k = clues[i];
        if (k < 0) continue;
        var base = i * 4, on = 0, unk = 0, j, ed;
        for (j = 0; j < 4; j++) {
          var s = st[ce[base + j]];
          if (s === ON) on++; else if (s === UNKNOWN) unk++;
        }
        if (on > k || on + unk < k) return false;
        if (unk) {
          if (on === k) {
            for (j = 0; j < 4; j++) { ed = ce[base + j]; if (st[ed] === UNKNOWN) { st[ed] = OFF; changed = true; } }
          } else if (on + unk === k) {
            for (j = 0; j < 4; j++) { ed = ce[base + j]; if (st[ed] === UNKNOWN) { st[ed] = ON; changed = true; } }
          }
        }
      }

      for (var v = 0, nv = g.NV; v < nv; v++) {
        var deg = 0, unk2 = 0, last = -1, cnt = 0, b = v * 4, ed2;
        for (var q = 0; q < 4; q++) {
          ed2 = ve[b + q];
          if (ed2 < 0) continue;
          cnt++;
          var sv = st[ed2];
          if (sv === ON) deg++; else if (sv === UNKNOWN) { unk2++; last = ed2; }
        }
        if (deg > 2) return false;
        if (deg === 2) {
          if (unk2) {
            for (var q2 = 0; q2 < 4; q2++) { ed2 = ve[b + q2]; if (ed2 >= 0 && st[ed2] === UNKNOWN) { st[ed2] = OFF; changed = true; } }
          }
        } else if (deg === 1) {
          if (unk2 === 0) return false;
          if (unk2 === 1) { st[last] = ON; changed = true; }
        } else {
          // degree 0: a lone undecided edge cannot become a line (it would be a dead end)
          if (unk2 === 1 && cnt === 1) { st[last] = OFF; changed = true; }
        }
      }
    }
    return true;
  }

  /* ---------- solution validity ---------- */
  function vertexDegrees(st, g, degOut) {
    var deg = degOut || new Int8Array(g.NV);
    deg.fill(0);
    for (var e = 0; e < g.N; e++) {
      if (st[e] !== ON) continue;
      var r = g.eRow[e], c = g.eCol[e];
      if (g.eH[e]) {
        deg[r * (g.C + 1) + c]++;
        deg[r * (g.C + 1) + c + 1]++;
      } else {
        deg[r * (g.C + 1) + c]++;
        deg[(r + 1) * (g.C + 1) + c]++;
      }
    }
    return deg;
  }

  function countLoops(st, g, deg) {
    // number of connected edge components among ON edges (all degrees must be 2 for a clean loop)
    var seen = new Uint8Array(g.NV);
    var comps = 0;
    var stack = [];
    for (var v = 0; v < g.NV; v++) {
      if (seen[v] || deg[v] === 0) continue;
      comps++;
      stack.length = 0;
      stack.push(v);
      seen[v] = 1;
      while (stack.length) {
        var cur = stack.pop();
        var vr = Math.floor(cur / (g.C + 1)), vc = cur % (g.C + 1);
        var b = cur * 4;
        for (var q = 0; q < 4; q++) {
          var e = g.vertEdges[b + q];
          if (e < 0 || st[e] !== ON) continue;
          var nr, nc;
          if (g.eH[e]) {
            nr = g.eRow[e]; nc = (g.eCol[e] === vc) ? g.eCol[e] + 1 : g.eCol[e];
          } else {
            nr = (g.eRow[e] === vr) ? g.eRow[e] + 1 : g.eRow[e]; nc = g.eCol[e];
          }
          var nv = nr * (g.C + 1) + nc;
          if (!seen[nv]) { seen[nv] = 1; stack.push(nv); }
        }
      }
    }
    return comps;
  }

  function cluesSatisfied(st, g, clues) {
    var bad = [];
    for (var i = 0, n = g.R * g.C; i < n; i++) {
      var k = clues[i];
      if (k < 0) continue;
      var base = i * 4, on = 0;
      for (var j = 0; j < 4; j++) if (st[g.cellEdges[base + j]] === ON) on++;
      if (on !== k) bad.push(i);
    }
    return bad;
  }

  function isValid(st, g, clues) {
    var bad = cluesSatisfied(st, g, clues);
    if (bad.length) return false;
    var deg = vertexDegrees(st, g);
    var any = false;
    for (var v = 0; v < g.NV; v++) {
      if (deg[v] !== 0 && deg[v] !== 2) return false;
      if (deg[v] === 2) any = true;
    }
    if (!any) return false;
    return countLoops(st, g, deg) === 1;
  }

  /* ---------- uniqueness / solution counting ---------- */
  function solveCount(R, C, clues, limit, budgetMax) {
    var g = geom(R, C);
    var st = new Uint8Array(g.N);
    var out = { count: 0, nodes: 0, exceeded: false, solution: null, ms: 0 };
    var t0 = (global.performance && performance.now) ? performance.now() : Date.now();
    var max = budgetMax || 120000;

    function search(s) {
      if (out.count >= limit) return;
      out.nodes++;
      if (out.nodes > max) { out.exceeded = true; return; }
      if (!propagate(s, g, clues)) return;
      if (blankComponentOff(s, g, clues)) {
        if (!propagate(s, g, clues)) return;
      }

      // branch on the clue cell with the fewest possible completions
      var bestCell = -1, bestCombos = 1e9, bestUnkEdges = null, bestNeed = 0;
      for (var i = 0, n = R * C; i < n; i++) {
        var k = clues[i];
        if (k < 0) continue;
        var base = i * 4, on = 0, unks = [];
        for (var j = 0; j < 4; j++) {
          var e2 = g.cellEdges[base + j], sv = s[e2];
          if (sv === ON) on++; else if (sv === UNKNOWN) unks.push(e2);
        }
        var u = unks.length;
        if (u < 2) continue;
        var need = k - on;
        if (need < 0 || need > u) return;
        var combos = nCr(u, need);
        if (combos < bestCombos) { bestCombos = combos; bestCell = i; bestUnkEdges = unks; bestNeed = need; 
          if (combos === 2) break; }
      }

      if (bestCell < 0) {
        // every clue is resolved: remaining undecided edges live in clue-free areas
        var anyE = -1;
        for (var e0 = 0; e0 < g.N; e0++) if (s[e0] === UNKNOWN) { anyE = e0; break; }
        if (anyE < 0) {
          if (isValid(s, g, clues)) {
            out.count++;
            if (!out.solution) out.solution = s.slice();
          }
          return;
        }
        var sOff = s.slice(); sOff[anyE] = OFF; search(sOff);
        if (out.count >= limit || out.exceeded) return;
        var sOn = s.slice(); sOn[anyE] = ON; search(sOn);
        return;
      }

      // prune: a closed cycle can no longer grow, so every other undecided edge must be off
      if (closedCycleBlocked(s, g, clues)) return;

      var ue = bestUnkEdges, need2 = bestNeed;
      var combosList = [];
      (function pick(start, chosen) {
        if (chosen.length === need2) { combosList.push(chosen.slice()); return; }
        if (ue.length - start < need2 - chosen.length) return;
        for (var q = start; q < ue.length; q++) { chosen.push(ue[q]); pick(q + 1, chosen); chosen.pop(); }
      })(0, []);

      for (var ci = 0; ci < combosList.length; ci++) {
        var pick2 = combosList[ci];
        var ns = s.slice();
        for (var a2 = 0; a2 < ue.length; a2++) ns[ue[a2]] = OFF;
        for (var b2 = 0; b2 < pick2.length; b2++) ns[pick2[b2]] = ON;
        search(ns);
        if (out.count >= limit || out.exceeded) return;
      }
    }

    search(st);
    out.ms = ((global.performance && performance.now) ? performance.now() : Date.now()) - t0;
    return out;
  }

  /* A blank region that holds no drawn line and no clue needing a line can only be empty. */
  function blankComponentOff(s, g, clues) {
    var NV = g.NV;
    var parent = new Int32Array(NV);
    for (var i = 0; i < NV; i++) parent[i] = i;
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }

    var vc = g.C + 1;
    for (var e = 0; e < g.N; e++) {
      if (s[e] === OFF) continue;
      var r = g.eRow[e], c = g.eCol[e];
      if (g.eH[e]) union(r * vc + c, r * vc + c + 1);
      else union(r * vc + c, (r + 1) * vc + c);
    }

    var hasOn = new Uint8Array(NV);
    var hasNeed = new Uint8Array(NV);
    for (var e2 = 0; e2 < g.N; e2++) {
      if (s[e2] !== ON) continue;
      var r2 = g.eRow[e2], c2 = g.eCol[e2];
      hasOn[find(r2 * vc + c2)] = 1;
    }
    for (var i2 = 0, n2 = g.R * g.C; i2 < n2; i2++) {
      if (clues[i2] <= 0) continue;
      var cr = Math.floor(i2 / g.C), cc = i2 % g.C;
      hasNeed[find(cr * vc + cc)] = 1;
    }

    var changed = false;
    for (var e3 = 0; e3 < g.N; e3++) {
      if (s[e3] !== UNKNOWN) continue;
      var r3 = g.eRow[e3], c3 = g.eCol[e3];
      var root = find(r3 * vc + c3);
      if (!hasOn[root] && !hasNeed[root]) { s[e3] = OFF; changed = true; }
    }
    return changed;
  }

  function nCr(n, r) {
    if (r < 0 || r > n) return 0;
    if (r === 0 || r === n) return 1;
    if (r > n - r) r = n - r;
    var res = 1;
    for (var i = 0; i < r; i++) res = res * (n - i) / (i + 1);
    return Math.round(res);
  }

  function closedCycleBlocked(s, g, clues) {
    // true when the drawn lines already form closed loop(s) but some clue still needs a line
    var deg = new Int8Array(g.NV);
    var anyOn = false;
    for (var e = 0; e < g.N; e++) {
      if (s[e] !== ON) continue;
      anyOn = true;
      var r = g.eRow[e], c = g.eCol[e];
      if (g.eH[e]) { deg[r * (g.C + 1) + c]++; deg[r * (g.C + 1) + c + 1]++; }
      else { deg[r * (g.C + 1) + c]++; deg[(r + 1) * (g.C + 1) + c]++; }
    }
    if (!anyOn) return false;
    for (var v = 0; v < g.NV; v++) if (deg[v] === 1) return false;
    // closed: check whether every remaining clue can still be met with the rest off
    for (var i = 0, n = g.R * g.C; i < n; i++) {
      var k = clues[i];
      if (k < 0) continue;
      var base = i * 4, on = 0;
      for (var j = 0; j < 4; j++) if (s[g.cellEdges[base + j]] === ON) on++;
      if (on !== k) return true;
    }
    return false;
  }

  function propagateOnly(R, C, clues) {
    var g = geom(R, C);
    var st = new Uint8Array(g.N);
    var ok = propagate(st, g, clues);
    var unk = 0;
    for (var e = 0; e < g.N; e++) if (st[e] === UNKNOWN) unk++;
    return { ok: ok, solved: ok && unk === 0, unknown: unk, state: st };
  }

  /* ---------- live analysis (UI feedback) ---------- */
  function analyze(st, g, clues) {
    var res = {
      clueOn: new Int8Array(g.R * g.C),
      clueOk: new Uint8Array(g.R * g.C),
      clueOver: new Uint8Array(g.R * g.C),
      cellViolations: [],     // clues impossible to satisfy
      vertexBad: [],          // degree>2 or dead end
      deg: new Int8Array(g.NV),
      closed: false,
      loops: 0,
      unsolvedClues: 0,
      lineCount: 0,
      xCount: 0,
      inside: null,
      win: false
    };
    var i, j, base, on, n;
    for (i = 0, n = g.R * g.C; i < n; i++) {
      base = i * 4; on = 0;
      for (j = 0; j < 4; j++) if (st[g.cellEdges[base + j]] === ON) on++;
      res.clueOn[i] = on;
      var k = clues[i];
      if (k < 0) continue;
      if (on === k) res.clueOk[i] = 1;
      else {
        res.unsolvedClues++;
        if (on > k) res.clueOver[i] = 1;
        // needs more lines than there is room for
        var unk = 0;
        for (j = 0; j < 4; j++) if (st[g.cellEdges[base + j]] === UNKNOWN) unk++;
        if (on + unk < k) { res.clueOver[i] = 2; res.cellViolations.push(i); }
      }
    }
    for (var e = 0; e < g.N; e++) {
      if (st[e] === ON) res.lineCount++;
      else if (st[e] === OFF) res.xCount++;
    }
    vertexDegrees(st, g, res.deg);
    for (var v = 0; v < g.NV; v++) {
      var d = res.deg[v];
      if (d > 2) { res.vertexBad.push(v); continue; }
      if (d === 1) {
        var b = v * 4, unk2 = 0;
        for (var q = 0; q < 4; q++) { var ed = g.vertEdges[b + q]; if (ed >= 0 && st[ed] === UNKNOWN) unk2++; }
        if (unk2 === 0) res.vertexBad.push(v);
      }
    }
    if (res.lineCount && res.vertexBad.length === 0 && res.unsolvedClues === 0 && res.cellViolations.length === 0) {
      var comps = countLoops(st, g, res.deg);
      res.loops = comps;
      res.closed = true;
      if (comps === 1 && cluesSatisfied(st, g, clues).length === 0) res.win = true;
    }
    return res;
  }

  /* inside-region flood fill (for the clear animation) */
  function insideCells(st, g) {
    var R = g.R, C = g.C;
    var W = C + 2;
    var seen = new Uint8Array(W * (R + 2));
    var idx = function (i, j) { return (i + 1) * W + (j + 1); };
    var stack = [idx(-1, -1)];
    seen[idx(-1, -1)] = 1;
    while (stack.length) {
      var cur = stack.pop();
      var fi = Math.floor(cur / W) - 1, fj = cur % W - 1;
      var ni, nj, e, ii;
      // right: boundary is vertical edge V(fi, fj+1)
      nj = fj + 1;
      if (nj <= C) {
        var blockR = (fi >= 0 && fi < R && nj >= 0 && nj <= C) && st[g.V(fi, nj)] === ON;
        if (!blockR) { ii = idx(fi, nj); if (!seen[ii]) { seen[ii] = 1; stack.push(ii); } }
      }
      // left: boundary is vertical edge V(fi, fj)
      nj = fj - 1;
      if (nj >= -1) {
        var blockL = (fi >= 0 && fi < R && fj >= 0 && fj <= C) && st[g.V(fi, fj)] === ON;
        if (!blockL) { ii = idx(fi, nj); if (!seen[ii]) { seen[ii] = 1; stack.push(ii); } }
      }
      // down: boundary is horizontal edge H(fi+1, fj)
      ni = fi + 1;
      if (ni <= R) {
        var blockD = (ni >= 0 && ni <= R && fj >= 0 && fj < C) && st[g.H(ni, fj)] === ON;
        if (!blockD) { ii = idx(ni, fj); if (!seen[ii]) { seen[ii] = 1; stack.push(ii); } }
      }
      // up: boundary is horizontal edge H(fi, fj)
      ni = fi - 1;
      if (ni >= -1) {
        var blockU = (fi >= 0 && fi <= R && fj >= 0 && fj < C) && st[g.H(fi, fj)] === ON;
        if (!blockU) { ii = idx(ni, fj); if (!seen[ii]) { seen[ii] = 1; stack.push(ii); } }
      }
    }
    var inside = [];
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      if (!seen[idx(r, c)]) inside.push(r * C + c);
    }
    return inside;
  }

  /* ---------- logic hints ----------
   * returns null when nothing logical is left, otherwise:
   * { kind:'cell'|'vertex'|'model', at:{...}, changes:[{edge, value}], title, detail }
   */
  function hint(st, g, clues, solutionEdges) {
    var R = g.R, C = g.C;
    var sol = null;
    if (solutionEdges) {
      sol = new Uint8Array(g.N);
      for (var s = 0; s < solutionEdges.length; s++) sol[solutionEdges[s]] = 1;
    }

    // 0) conflicting player state
    var an = analyze(st, g, clues);
    if (an.cellViolations.length || an.vertexBad.length) {
      return {
        kind: 'error',
        cells: an.cellViolations,
        verts: an.vertexBad,
        title: '지금 배치에 모순이 있어요',
        detail: '빨간색으로 표시된 숫자/교차점을 확인하세요. 모순을 지우면 다시 논리로 풀 수 있습니다.'
      };
    }

    // 1) wrong edges compared with the one true solution (only surfaced through hints)
    if (sol) {
      var wrong = [];
      for (var e = 0; e < g.N; e++) {
        if (st[e] === ON && !sol[e]) wrong.push(e);
        if (st[e] === OFF && sol[e]) wrong.push(e);
      }
      if (wrong.length) {
        return {
          kind: 'wrong',
          edges: wrong,
          title: '선 하나가 잘못 그어져 있어요',
          detail: '붉게 표시된 곳의 선을 지우고, 다시 논리로 확인해 보세요. (X 표시도 정답과 다르면 함께 표시됩니다)'
        };
      }
    }

    function consistent(changes) {
      if (!sol) return true;
      for (var q = 0; q < changes.length; q++) {
        var ch = changes[q];
        var should = sol[ch.edge] ? ON : OFF;
        if (ch.value !== should) return false;
      }
      return true;
    }

    function mkCell(i, changes, title, detail) {
      return { kind: 'cell', cell: i, changes: changes, title: title, detail: detail };
    }

    // 2) cell rules
    for (var i = 0, n = R * C; i < n; i++) {
      var k = clues[i];
      if (k < 0) continue;
      var base = i * 4, on = 0, unk = 0, unkEdges = [];
      for (var j = 0; j < 4; j++) {
        var ed = g.cellEdges[base + j], sv = st[ed];
        if (sv === ON) on++; else if (sv === UNKNOWN) { unk++; unkEdges.push(ed); }
      }
      var row = Math.floor(i / C) + 1, col = (i % C) + 1;
      if (!unk || on + unk < k) continue;

      if (k === 0 && unk) {
        var ch0 = unkEdges.map(function (x) { return { edge: x, value: OFF }; });
        if (consistent(ch0)) return mkCell(i, ch0,
          '0 주변은 전부 X',
          row + '행 ' + col + '열의 0 — 이 칸을 지나는 울타리는 하나도 없으므로 주변 네 변은 모두 X입니다.');
      }
      if (on === k) {
        var ch1 = unkEdges.map(function (x) { return { edge: x, value: OFF }; });
        if (consistent(ch1)) return mkCell(i, ch1,
          '숫자가 이미 채워짐',
          row + '행 ' + col + '열의 ' + k + ' — 필요한 선 ' + k + '개가 모두 그어졌습니다. 남은 변은 X입니다.');
      }
      if (on + unk === k) {
        var ch2 = unkEdges.map(function (x) { return { edge: x, value: ON }; });
        if (consistent(ch2)) return mkCell(i, ch2,
          '남은 변이 전부 선',
          row + '행 ' + col + '열의 ' + k + ' — 남은 변이 ' + unk + '개뿐이라 모두 선이 되어야 합니다.');
      }
    }

    // 3) vertex rules
    for (var v = 0; v < g.NV; v++) {
      var b = v * 4, deg = 0, unk3 = [], onE = [];
      for (var q = 0; q < 4; q++) {
        var e3 = g.vertEdges[b + q];
        if (e3 < 0) continue;
        if (st[e3] === ON) { deg++; onE.push(e3); }
        else if (st[e3] === UNKNOWN) unk3.push(e3);
      }
      if (!unk3.length) continue;
      var vr = Math.floor(v / (C + 1)) + 1, vc = (v % (C + 1)) + 1;

      if (deg === 2) {
        var chv = unk3.map(function (x) { return { edge: x, value: OFF }; });
        if (consistent(chv)) return {
          kind: 'vertex', vert: v, changes: chv,
          title: '이미 닫힌 교차점',
          detail: '표시한 점에 선이 이미 두 개 들어왔습니다. 울타리는 한 점에서 두 갈래로만 이어지므로 나머지는 X입니다.'
        };
      }
      if (deg === 1 && unk3.length === 1) {
        var chv2 = [{ edge: unk3[0], value: ON }];
        if (consistent(chv2)) return {
          kind: 'vertex', vert: v, changes: chv2,
          title: '출구가 하나뿐',
          detail: '선 하나가 들어온 교차점에 남은 출구가 하나뿐입니다. 그 변은 반드시 선이 됩니다.'
        };
      }
      if (deg === 0 && unk3.length === 1) {
        var total = 0;
        for (var q4 = 0; q4 < 4; q4++) if (g.vertEdges[b + q4] >= 0) total++;
        if (total === 1) {
          var chv3 = [{ edge: unk3[0], value: OFF }];
          if (consistent(chv3)) return {
            kind: 'vertex', vert: v, changes: chv3,
            title: '막다른 점',
            detail: '이 점에 들어온 선이 없고 남은 변이 하나뿐입니다. 그 변을 선으로 하면 끝이 막힌 막대가 되므로 X입니다.'
          };
        }
      }
    }

    // 4) assumption (가정법): an edge that cannot be a line / must be a line
    var cand = [];
    for (var c2 = 0; c2 < R * C; c2++) {
      if (clues[c2] < 0) continue;
      var bb = c2 * 4;
      for (var j2 = 0; j2 < 4; j2++) {
        var ee = g.cellEdges[bb + j2];
        if (st[ee] === UNKNOWN) cand.push(ee);
      }
    }
    var tried = Object.create(null);
    var tStart = (global.performance && performance.now) ? performance.now() : Date.now();
    for (var t = 0; t < cand.length; t++) {
      var e5 = cand[t];
      if (tried[e5]) continue;
      tried[e5] = 1;
      var now = (global.performance && performance.now) ? performance.now() : Date.now();
      if (now - tStart > 320) break;

      var assumeOn = st.slice();
      assumeOn[e5] = ON;
      if (!propagate(assumeOn, g, clues)) {
        var chA = [{ edge: e5, value: OFF }];
        if (consistent(chA)) return {
          kind: 'model', changes: chA,
          title: '가정하면 모순',
          detail: '이 변을 선으로 가정하면 주변 숫자 규칙이 곧바로 깨집니다. 따라서 이 변은 선이 될 수 없습니다 — X를 놓으세요.'
        };
        continue;
      }

      var assumeOff = st.slice();
      assumeOff[e5] = OFF;
      if (!propagate(assumeOff, g, clues)) {
        var chB = [{ edge: e5, value: ON }];
        if (consistent(chB)) return {
          kind: 'model', changes: chB,
          title: '가정하면 모순',
          detail: '이 변을 X로 가정하면 반드시 모순이 생깁니다. 가정을 지우고 이 변은 선으로 그으세요.'
        };
      }
    }

    // 5) picture-based fallback: reveal one edge of the true solution with a reasoned note
    if (sol) {
      for (var e6 = 0; e6 < g.N; e6++) {
        if (st[e6] !== UNKNOWN) continue;
        if (!sol[e6]) continue;
        return {
          kind: 'model',
          changes: [{ edge: e6, value: ON }],
          title: '고급 테크닉이 필요한 자리',
          detail: '여기까지는 단순 규칙으로 좁혀지지 않습니다. 분기 저장(📌)으로 한쪽을 가정해 보거나, 이 변을 힌트로 확정하세요.'
        };
      }
    }
    return null;
  }

  var api = {
    UNKNOWN: UNKNOWN, ON: ON, OFF: OFF,
    geom: geom,
    propagate: propagate,
    solveCount: solveCount,
    propagateOnly: propagateOnly,
    analyze: analyze,
    insideCells: insideCells,
    isValid: isValid,
    vertexDegrees: vertexDegrees,
    countLoops: countLoops,
    cluesSatisfied: cluesSatisfied,
    hint: hint
  };
  global.DFSolver = api;
})(typeof window !== 'undefined' ? window : this);
