#!/usr/bin/env python3
"""프리셋 유일해 검증(JS 솔버 solveCount)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8815

JS = r"""
(args) => {
  var out = [];
  Object.keys(DF_PRESETS.stages).forEach(function (sid) {
    DF_PRESETS.stages[sid].forEach(function (pz, pi) {
    var clues = DFGen.flatClues(pz);
    var r = DFSolver.solveCount(pz.R, pz.C, clues, 3, args.nodes);
    // 저장된 해답이 그 해답인지
    var g = DFSolver.geom(pz.R, pz.C);
    var st = new Uint8Array(g.N);
    pz.solution.forEach(function (e) { st[e] = 1; });
    out.push({ id: sid + '-' + (pi + 1), R: pz.R, C: pz.C, count: r.count, exceeded: r.exceeded,
               nodes: r.nodes, ms: Math.round(r.ms),
               solutionValid: DFSolver.isValid(st, g, clues),
               matches: (function () {
                 if (!r.solution) return false;
                 var found = []; for (var i = 0; i < g.N; i++) if (r.solution[i] === 1) found.push(i);
                 var want = pz.solution.slice().sort(function (a, b) { return a - b; });
                 return found.join(',') === want.join(',');
               })() });
    });
  });
  return out;
}
"""


def main():
    nodes = int(sys.argv[1]) if len(sys.argv) > 1 else 600000
    with sync_playwright() as pw:
        serve(ROOT, PORT)
        b = pw.chromium.launch()
        pg = b.new_page()
        pg.goto("http://127.0.0.1:%d/index.html" % PORT)
        pg.wait_for_function("window.DFSolver && window.DF_PRESETS")
        for r in pg.evaluate(JS, {"nodes": nodes}):
            print(json.dumps(r, ensure_ascii=False))
        b.close()


if __name__ == "__main__":
    main()
