/* ============================================================
 * 25-problem stage generator (runs inside verify/gen_stages.html)
 * - 무작위 단일 폐곡선 → 단서 도출 → 묶음 단서 제거(유일해 유지)
 * - 마지막에 solveCount(...,2)로 전수 재검증
 * ============================================================ */
(function () {
  'use strict';

  function now() { return performance.now(); }

  function flatOf(R, C, grown) {
    return Array.from(DFGen.deriveClues(R, C, grown.st, DFSolver.geom(R, C)));
  }

  function sigOf(flat) { return flat.join(','); }

  /* 한 판 생성. 성공하면 {R,C,clues,solution,meta}, 실패하면 {ok:false, why} */
  window.genPuzzle = function (size, seed, opts) {
    opts = opts || {};
    var R = size, C = size;
    var S = DFSolver, GEN = DFGen;
    var g = S.geom(R, C);
    var rand = GEN.mulberry32((seed >>> 0) || 1);
    var frac = opts.frac != null ? opts.frac : (0.62 + 0.08 * rand());
    var t0 = now();

    var grown = GEN.growLoop(R, C, rand, frac);
    if (grown.finalComps !== 1) return { ok: false, why: 'loop-broken' };
    var clues = flatOf(R, C, grown);

    // 해답 자체가 단일 닫힌 고리인지
    var solState = new Uint8Array(g.N);
    grown.edges.forEach(function (e) { solState[e] = 1; });
    if (!S.isValid(solState, g, new Int8Array(clues))) return { ok: false, why: 'bad-solution' };

    // 단서를 모두 남긴 상태에서 이미 유일해여야 제거가 의미 있다
    var full = S.solveCount(R, C, new Int8Array(clues), 2, opts.nodes || 400000);
    if (full.count !== 1 || full.exceeded) return { ok: false, why: 'full-not-unique' };

    var target = opts.target != null ? opts.target : Math.round(R * C * 0.5);
    var nodes = opts.nodes || 400000;
    var deadline = t0 + (opts.timeMs || 45000);
    var cells = [];
    for (var i = 0; i < R * C; i++) cells.push(i);
    for (var k = cells.length - 1; k > 0; k--) {
      var j = Math.floor(rand() * (k + 1));
      var t = cells[k]; cells[k] = cells[j]; cells[j] = t;
    }

    var kept = R * C, idx = 0, calls = 0;
    var batch = Math.max(2, Math.round(R * C * 0.06));
    var maxCalls = opts.maxCalls || 400;
    while (kept > target && idx < cells.length && calls < maxCalls && now() < deadline) {
      var group = [];
      for (var q = idx; q < cells.length && group.length < batch; q++) group.push(cells[q]);
      if (!group.length) break;
      var saved = group.map(function (c) { return clues[c]; });
      group.forEach(function (c) { clues[c] = -1; });
      var res = S.solveCount(R, C, new Int8Array(clues), 2, nodes);
      calls++;
      if (res.count === 1 && !res.exceeded) {
        kept -= group.length;
        idx += group.length;
      } else {
        group.forEach(function (c, n) { clues[c] = saved[n]; });
        if (batch > 1) batch = Math.max(1, Math.floor(batch / 2));
        else idx += 1;
      }
    }

    if (kept >= R * C) return { ok: false, why: 'nothing-removed' };

    // 최종 전수 검증
    var finalFlat = new Int8Array(clues);
    var check = S.solveCount(R, C, finalFlat, 2, 600000);
    if (check.count !== 1 || check.exceeded) return { ok: false, why: 'final-not-unique' };
    if (!check.solution) return { ok: false, why: 'no-solution' };
    var checkState = check.solution;
    if (!S.isValid(checkState, g, finalFlat)) return { ok: false, why: 'solver-solution-invalid' };

    var rows = [];
    for (var r = 0; r < R; r++) {
      var row = [];
      for (var c2 = 0; c2 < C; c2++) row.push(clues[r * C + c2]);
      rows.push(row);
    }
    var solEdges = [];
    for (var e = 0; e < g.N; e++) if (checkState[e] === 1) solEdges.push(e);

    return {
      ok: true,
      puzzle: {
        R: R, C: C, clues: rows, solution: solEdges,
        meta: {
          seed: seed, clueCount: kept, cells: R * C,
          propSolved: S.propagateOnly(R, C, finalFlat).solved,
          genMs: Math.round(now() - t0), calls: calls
        }
      },
      cells: R * C, clueCount: kept, propSolved: S.propagateOnly(R, C, finalFlat).solved,
      calls: calls, ms: Math.round(now() - t0), sig: sigOf(clues)
    };
  };
})();
