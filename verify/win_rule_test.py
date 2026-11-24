#!/usr/bin/env python3
"""울타리 치기 — 클리어 판정 회귀 테스트.

[단위] solver.analyze() 가 다음 배치를 절대 클리어로 보지 않아야 한다.
  · 끊긴 끝(차수 1)이 있는 열린 경로      ← 11-24 제보 버그
  · 두 개 이상의 분리된 고리
  · T자 갈라짐(차수 3)
  · 선이 하나도 없는 판
[정합] analyze().win 은 isValid() 와 항상 같은 답이어야 한다(무작위 판 400개).
[UI]   실제 게임 화면에서 같은 배치를 그렸을 때 클리어 모달/금빛 상태가 뜨지 않고,
       진짜 정답일 때만 클리어되며, 클리어 후에는 판이 되돌려지지 않는다.

사용: python3 verify/win_rule_test.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8816
fails = []


def check(name, cond, extra=''):
    print(('  PASS ' if cond else '  FAIL ') + name + ((' · ' + str(extra)) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


UNIT_JS = r"""
() => {
  var out = [];
  function T(name, expectWin, fn) {
    var r = fn();
    out.push({ name: name, expectWin: expectWin, win: r.win, valid: r.valid, info: r.info || null });
  }
  function s2State(removeEdges, addEdges) {
    var pz = DF_PRESETS.stages.s2;
    var g = DFSolver.geom(pz.R, pz.C);
    var clues = DFGen.flatClues(pz);
    var st = new Uint8Array(g.N);
    pz.solution.forEach(function (e) { if ((removeEdges || []).indexOf(e) < 0) st[e] = 1; });
    (addEdges || []).forEach(function (e) { st[e] = 1; });
    return { g: g, st: st, clues: clues };
  }
  function evalState(o) {
    var an = DFSolver.analyze(o.st, o.g, o.clues);
    return { win: an.win, valid: DFSolver.isValid(o.st, o.g, o.clues),
             info: { unsolved: an.unsolvedClues, deadEnds: an.deadEnds.length, loops: an.loops,
                     lines: an.lineCount } };
  }

  // --- 기준: 정답 ------------------------------------------------
  T('s2 정답', true, function () { return evalState(s2State()); });
  // --- 끊긴 끝(차수 1) -------------------------------------------
  T('s2 정답에서 변 하나 제거(끊긴 끝 2개)', false, function () { return evalState(s2State([15])); });
  T('s2 정답에서 다른 변 제거(끊긴 끝 2개)', false, function () { return evalState(s2State([90])); });
  T('s2 경계 변 제거', false, function () { return evalState(s2State([49])); });
  // --- 분리된 고리 -----------------------------------------------
  T('s2 정답에서 서로 먼 변 2개 제거(고리 2개로 분리)', false, function () { return evalState(s2State([15, 90])); });
  T('s2 정답에서 변 3개 제거', false, function () { return evalState(s2State([15, 90, 49])); });
  // --- T자 갈라짐(차수 3) ----------------------------------------
  T('s2 정답에 변 하나 추가(차수 3 갈라짐)', false, function () {
    var pz = DF_PRESETS.stages.s2;
    var o = s2State();
    var extra = -1;
    for (var e = 0; e < o.g.N; e++) {
      if (o.st[e]) continue;
      var r = o.g.eRow[e], c = o.g.eCol[e], v1, v2;
      if (o.g.eH[e]) { v1 = r * 8 + c; v2 = r * 8 + c + 1; } else { v1 = r * 8 + c; v2 = (r + 1) * 8 + c; }
      if (DFSolver.vertexDegrees(o.st, o.g)[v1] === 2) { extra = e; break; }
    }
    if (extra < 0) return { win: false, valid: false, info: 'no candidate' };
    return evalState(s2State([], [extra]));
  });

  // --- 단서가 없는 격자에서의 순수 연결 규칙 ----------------------
  function noClue(R, C, onEdges, offEdges) {
    var g = DFSolver.geom(R, C);
    var st = new Uint8Array(g.N);
    onEdges.forEach(function (e) { st[e] = 1; });
    (offEdges || []).forEach(function (e) { st[e] = 2; });
    return evalState({ g: g, st: st, clues: new Int8Array(R * C).fill(-1) });
  }
  function rect(g, r0, c0, r1, c1) {
    var out = [], r, c;
    for (c = c0; c < c1; c++) out.push(g.H(r0, c));
    for (r = r0; r < r1; r++) out.push(g.V(r, c1));
    for (c = c1; c > c0; c--) out.push(g.H(r1, c - 1));
    for (r = r1; r > r0; r--) out.push(g.V(r - 1, c0));
    return out;
  }
  var g7 = DFSolver.geom(7, 7);
  T('완전한 고리 하나', true, function () { return noClue(7, 7, rect(g7, 1, 1, 3, 3)); });
  T('열린 경로(차수 1 두 개)', false, function () {
    return noClue(7, 7, [g7.H(1, 1), g7.H(1, 2), g7.V(1, 3), g7.V(2, 3), g7.V(1, 1)]);
  });
  T('고리 + 끊긴 가닥', false, function () {
    return noClue(7, 7, rect(g7, 1, 1, 3, 3).concat([g7.H(3, 3), g7.V(3, 4)]));
  });
  T('분리된 고리 두 개', false, function () {
    return noClue(7, 7, rect(g7, 0, 0, 2, 2).concat(rect(g7, 4, 4, 6, 6)));
  });
  T('T자 갈라짐', false, function () {
    return noClue(7, 7, rect(g7, 1, 1, 3, 3).concat([g7.H(1, 3), g7.V(1, 4)]));
  });
  T('빈 판', false, function () { return noClue(7, 7, []); });
  T('선 없이 X만', false, function () {
    var all = []; for (var e = 0; e < g7.N; e++) all.push(e);
    return noClue(7, 7, [], all);
  });

  // --- 모든 스테이지 정답 ----------------------------------------
  Object.keys(DF_PRESETS.stages).forEach(function (sid) {
    var pz = DF_PRESETS.stages[sid];
    var g = DFSolver.geom(pz.R, pz.C);
    var st = new Uint8Array(g.N);
    pz.solution.forEach(function (e) { st[e] = 1; });
    var an = DFSolver.analyze(st, g, DFGen.flatClues(pz));
    out.push({ name: sid + ' 정답', expectWin: true, win: an.win, valid: DFSolver.isValid(st, g, DFGen.flatClues(pz)) });
  });

  // --- 무작위 정합성: analyze().win === isValid() ----------------
  var mismatch = [], checked = 0, wins = 0;
  var rnd = DFGen.mulberry32(20261124);
  [[5, 5], [7, 7], [7, 7]].forEach(function (rc) {
    var R = rc[0], C = rc[1], g = DFSolver.geom(R, C);
    var pz = null;
    for (var k = 0; k < 400; k++) {
      var st = new Uint8Array(g.N);
      // 정답 근처를 흔든 판 + 완전 무작위 판을 섞는다
      var src = DF_PRESETS.stages[R === 5 && C === 5 ? 's1' : 's2'];
      var sg = DFSolver.geom(src.R, src.C);
      var base = new Uint8Array(sg.N);
      src.solution.forEach(function (e) { if (rnd() > 0.06) base[e] = 1; });
      st.set(base);
      for (var e = 0; e < g.N; e++) {
        if (rnd() < 0.04) st[e] = st[e] ? 0 : 1;
      }
      var clues = DFGen.flatClues(src);
      var an = DFSolver.analyze(st, g, clues);
      var ok = DFSolver.isValid(st, g, clues);
      checked++;
      if (an.win) wins++;
      if (an.win !== ok) mismatch.push(k);
    }
  });
  return { cases: out, fuzz: { checked: checked, wins: wins, mismatch: mismatch.slice(0, 10) } };
}
"""


def board_via(pg, on_edges):
    """실제 게임 화면에서 on_edges 만 선으로 칠한다."""
    pg.evaluate("(on) => DFApp.paint(on, [])", on_edges)


def main():
    with sync_playwright() as pw:
        serve(ROOT, PORT)
        b = pw.chromium.launch()
        pg = b.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.goto("http://127.0.0.1:%d/index.html" % PORT)
        pg.wait_for_function("window.DFSolver && window.DFApp && window.DF_PRESETS")

        # ---------- 단위 ----------
        print('[단위 · solver.analyze()]', flush=True)
        res = pg.evaluate(UNIT_JS)
        for c in res['cases']:
            ok = (c['win'] == c['expectWin']) and (c['win'] == c['valid'])
            check(c['name'], ok, 'win=%s valid=%s %s' % (c['win'], c['valid'], c.get('info') or ''))
        fz = res['fuzz']
        check('무작위 %d판: analyze().win == isValid()' % fz['checked'], not fz['mismatch'],
              '클리어 판정 %d개 · 불일치 %s' % (fz['wins'], fz['mismatch']))

        # ---------- UI ----------
        print('[UI · 실제 화면]', flush=True)
        sol = pg.evaluate("() => DF_PRESETS.stages.s2.solution.slice()")

        def run(kind, on_edges, expect_win, label):
            pg.evaluate("() => { document.getElementById('modalRoot').classList.remove('open'); document.getElementById('modalRoot').innerHTML=''; }")
            pg.evaluate("() => DFApp.startStage('s2')")
            pg.wait_for_timeout(120)
            board_via(pg, on_edges)
            pg.wait_for_timeout(1300)
            win = pg.evaluate("() => DFApp.win()")
            cleared = pg.evaluate("() => document.getElementById('board').classList.contains('cleared')")
            modal = pg.evaluate("() => document.getElementById('modalRoot').classList.contains('open')")
            check(label, win == expect_win and cleared == expect_win and modal == expect_win,
                  'win=%s cleared=%s modal=%s' % (win, cleared, modal))
            return win

        run('gap', [e for e in sol if e != 15], False, '끊긴 끝이 있는 판 → 클리어되지 않음')
        run('gaps', [e for e in sol if e not in (15, 90)], False, '고리가 둘로 갈라진 판 → 클리어되지 않음')
        run('full', list(sol), True, '진짜 정답 → 클리어')

        # 클리어 후 판이 되돌려지지 않는지
        before = pg.evaluate("() => Array.from(DFApp.board())")
        pg.evaluate("() => { var b=document.getElementById('btnUndo'); if(!b.disabled) b.click(); }")
        pg.evaluate("() => { var b=document.getElementById('btnRestore'); if(!b.disabled) b.click(); }")
        pg.evaluate("() => { var b=document.getElementById('btnReset'); if(!b.disabled) b.click(); }")
        pg.keyboard.press('Control+z')
        pg.wait_for_timeout(300)
        after = pg.evaluate("() => Array.from(DFApp.board())")
        check('클리어 후 되돌리기/복원/초기화로 판이 바뀌지 않음', before == after,
              'changed=%d' % sum(1 for a, b_ in zip(before, after) if a != b_))

        # 클리어 화면이 실제로 단일 고리인지
        loops = pg.evaluate("""() => {
          var g = DFSolver.geom(7, 7), st = DFApp.board(), deg = DFSolver.vertexDegrees(st, g);
          var bad = 0; for (var v = 0; v < deg.length; v++) if (deg[v] !== 0 && deg[v] !== 2) bad++;
          return { loops: DFSolver.countLoops(st, g, deg), bad: bad };
        }""")
        check('클리어 화면: 단일 고리 · 끊긴 끝 0', loops['loops'] == 1 and loops['bad'] == 0, loops)

        check('콘솔·페이지 오류 없음', not errors, ' / '.join(errors[:3]))
        b.close()

    print('')
    if fails:
        print('실패 %d건:' % len(fails))
        for f in fails:
            print('  -', f)
        sys.exit(1)
    print('전부 통과')


if __name__ == '__main__':
    main()
