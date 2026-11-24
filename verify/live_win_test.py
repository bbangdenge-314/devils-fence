#!/usr/bin/env python3
"""라이브 사이트 클리어 판정 검증 — 끊긴 울타리는 클리어되지 않아야 한다.

① Stage 2 정답에서 변 하나만 지운 판(숫자는 그대로 만족, 선은 끊김) → 클리어 아님
② 정답에서 서로 먼 변 두 개를 지운 판(고리 둘로 분리) → 클리어 아님
③ 진짜 정답 → 클리어
"""
import sys

from playwright.sync_api import sync_playwright

URL = "https://bbangdenge-314.github.io/devils-fence/?v=4"
fails = []


def check(name, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + name + ((" · " + str(extra)) if extra else ""), flush=True)
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(800)
    pg.wait_for_function("window.DFApp && window.DF_PRESETS")

    check("v4 · 단계별 25문제 배포됨",
          pg.evaluate("() => Object.keys(DF_PRESETS.stages).every(function (k) { return DF_PRESETS.stages[k].length === 25; })"))
    check("새 판정 코드 배포됨(deadEnds 노출)",
          pg.evaluate("() => { const pz=DF_PRESETS.stages.s2[0], g=DFSolver.geom(7,7);"
                      "const st=new Uint8Array(g.N); pz.solution.forEach(e=>st[e]=1);"
                      "return 'deadEnds' in DFSolver.analyze(st,g,DFGen.flatClues(pz)); }"))

    # 2단계는 1단계 5문제를 풀어야 열린다 → 라이브 저장소에 기록을 심는다
    pg.evaluate("""() => {
      var r = {};
      for (var i = 0; i < 5; i++) r[i] = { best: 60000 + i * 1000, clears: 1 };
      DFApp.st.records = { s1: r };
      localStorage.setItem('df.v2.records', JSON.stringify(DFApp.st.records));
    }""")
    sol = pg.evaluate("() => DF_PRESETS.stages.s2[0].solution.slice()")

    def play(on_edges, label, expect):
        pg.evaluate("() => { const m=document.getElementById('modalRoot'); m.classList.remove('open'); m.innerHTML=''; }")
        pg.evaluate("() => DFApp.startProblem('s2', 0)")
        pg.wait_for_timeout(150)
        pg.evaluate("(on) => DFApp.paint(on, [])", on_edges)
        pg.wait_for_timeout(1300)
        win = pg.evaluate("() => DFApp.win()")
        cleared = pg.evaluate("() => document.getElementById('board').classList.contains('cleared')")
        modal = pg.evaluate("() => document.getElementById('modalRoot').classList.contains('open')")
        check(label, win == expect and cleared == expect and modal == expect,
              "win=%s cleared=%s modal=%s" % (win, cleared, modal))

    play([e for e in sol if e != 15], "정답에서 변 하나 제거(끊긴 끝) → 클리어 아님", False)
    play([e for e in sol if e not in (15, 90)], "정답에서 변 두 개 제거(고리 분리) → 클리어 아님", False)
    play(list(sol), "진짜 정답 → 클리어", True)
    pg.screenshot(path="/workspace/downloads/devils_fence_live_clear.png")
    check("콘솔 오류 0건", not errs, errs[:3])
    b.close()

print("\n" + ("RESULT: PASS" if not fails else "RESULT: FAIL -> " + ", ".join(fails)), flush=True)
sys.exit(0 if not fails else 1)
