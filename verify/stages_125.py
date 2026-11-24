#!/usr/bin/env python3
"""125문제 전수 검증 — 단계별 25문제 고정 퍼즐.

  python3 verify/stages_125.py

각 문제에 대해
  ① 저장된 해답이 단일 닫힌 고리이며 모든 단서를 만족
  ② DFSolver.solveCount(..., 2) === 1  (유일해, 노드 예산 초과 없음)
  ③ 해답이 저장된 solution 과 일치
  ④ 단계 안에서 같은 단서 배열이 두 번 나오지 않음(중복 없음)
를 검사하고 단계별 요약을 출력한다.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8777
NODES = 600000

JS = r"""
(args) => {
  var out = [];
  var seen = {};
  var stages = DF_PRESETS.stages;
  Object.keys(stages).forEach(function (sid) {
    stages[sid].forEach(function (pz, i) {
      var g = DFSolver.geom(pz.R, pz.C);
      var clues = DFGen.flatClues(pz);
      var st = new Uint8Array(g.N);
      pz.solution.forEach(function (e) { st[e] = 1; });
      var res = DFSolver.solveCount(pz.R, pz.C, clues, 2, args.nodes);
      var found = [];
      if (res.solution) for (var e2 = 0; e2 < g.N; e2++) if (res.solution[e2] === 1) found.push(e2);
      var want = pz.solution.slice().sort(function (a, b) { return a - b; });
      var sig = clues.join(',');
      var dup = !!seen[sig];
      seen[sig] = 1;
      out.push({
        id: sid + '-' + (i + 1), R: pz.R, C: pz.C,
        clueCount: pz.meta && pz.meta.clueCount != null ? pz.meta.clueCount : clues.filter(function (v) { return v >= 0; }).length,
        unique: res.count === 1 && !res.exceeded,
        count: res.count, exceeded: !!res.exceeded,
        solutionValid: DFSolver.isValid(st, g, clues),
        matches: found.join(',') === want.join(','),
        dup: dup, ms: Math.round(res.ms)
      });
    });
  });
  return { rows: out, stages: Object.keys(stages).map(function (k) { return [k, stages[k].length]; }) };
}
"""


def main():
    httpd = serve(ROOT, PORT)
    fails = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto('http://127.0.0.1:%d/verify/harness.html' % PORT, wait_until='load')
            pg.add_script_tag(url='../js/presets.js')
            data = pg.evaluate(JS, {'nodes': NODES})
            rows, stages = data['rows'], data['stages']
            for sid, n in stages:
                rs = [r for r in rows if r['id'].startswith(sid + '-')]
                ok = [r for r in rs if r['unique'] and r['solutionValid'] and r['matches'] and not r['dup']]
                print('%s: %d문제 · 유일해 %d · 해답유효 %d · 해답일치 %d · 중복 %d · 최대 %.0fms' % (
                    sid, n,
                    sum(1 for r in rs if r['unique']),
                    sum(1 for r in rs if r['solutionValid']),
                    sum(1 for r in rs if r['matches']),
                    sum(1 for r in rs if r['dup']),
                    max([r['ms'] for r in rs] or [0])), flush=True)
                if n != 25:
                    fails.append('%s 문제 수 %d' % (sid, n))
                if len(ok) != n:
                    fails.append('%s 불량 %s' % (sid, [r['id'] for r in rs if r not in ok]))
            total = len(rows)
            print('총 %d문제' % total, flush=True)
            if total != 125:
                fails.append('총 문제 수 %d' % total)
            if errs:
                fails.append('페이지 오류 %s' % errs[:2])
            b.close()
    finally:
        httpd.shutdown()

    print('RESULT: ' + ('PASS' if not fails else 'FAIL -> ' + ' / '.join(str(f) for f in fails)), flush=True)
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
