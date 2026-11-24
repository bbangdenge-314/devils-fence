#!/usr/bin/env python3
"""v4 회귀 검증 — 캐시 갱신 표기 + 자유 플레이/이어하기에서 클리어 판정과 툴바 잠금이 어긋나지 않는지.

로컬 서버(_serve.py, no-store)로 띄워서 검사한다.
 1. index.html 이 css/js ?v=4 를 물고 오고 v4 배지가 보인다
 2. 자유 플레이 7×7 쉬움 → 몇 변 긋고 홈 → 이어하기 → 정답 → 클리어(툴바 잠금)
 3. 분기 저장(📌) → 복원 → 정답 → 클리어
 4. 숫자만 맞고 울타리가 끊긴 판(옛 오판정 시나리오)은 클리어 아님
"""
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _serve import serve

ROOT = __file__.rsplit('/verify/', 1)[0]
PORT = 8771
URL = 'http://127.0.0.1:%d/index.html?v=4' % PORT

fails = []


def check(name, cond, extra=''):
    print(('  PASS ' if cond else '  FAIL ') + name + ((' · ' + str(extra)) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


httpd = serve(ROOT, PORT)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL, wait_until='load')
    pg.wait_for_timeout(700)

    # 1) 버전 표기
    check('홈 v4 배지 보임', pg.is_visible('#appVer') and pg.inner_text('#appVer').strip() == 'v4')
    assets = pg.evaluate("() => Array.from(document.querySelectorAll('link[rel=stylesheet],script[src]')).map(n => n.getAttribute('href') || n.getAttribute('src'))")
    check('css/js 전부 ?v=4', all(a.endswith('?v=4') for a in assets), assets)

    def clear_modal():
        pg.evaluate("() => { const m=document.getElementById('modalRoot'); m.classList.remove('open'); m.innerHTML=''; }")

    def toolbar():
        return pg.evaluate("() => ({undo:document.getElementById('btnUndo').disabled,"
                           "redo:document.getElementById('btnRedo').disabled,"
                           "restore:document.getElementById('btnRestore').disabled,"
                           "reset:document.getElementById('btnReset').disabled,"
                           "label:document.getElementById('btnRestore').textContent.trim(),"
                           "cleared:document.getElementById('board').classList.contains('cleared')})")

    # 2) 자유 플레이 7×7 쉬움 → 이어하기
    pg.evaluate("() => { DFApp.setFree(7,'easy'); DFApp.startFree(); }")
    pg.wait_for_function("() => window.DFApp && DFApp.puzzle() && DFApp.puzzle().R === 7", timeout=20000)
    pg.wait_for_timeout(200)
    sol = pg.evaluate("() => DFApp.puzzle().solution.slice()")
    check('자유 플레이 7×7 생성(meta.difficulty=easy)',
          pg.evaluate("() => DFApp.puzzle().meta && DFApp.puzzle().meta.difficulty") == 'easy')

    # 몇 변 긋고 → 홈 → 이어하기
    pg.evaluate("(on) => DFApp.setEdge(on[0], 1)", sol)
    pg.evaluate("(on) => DFApp.setEdge(on[1], 2)", sol)
    pg.evaluate("() => DFApp.home()")
    pg.wait_for_timeout(700)  # scheduleSave(500ms) 대기
    check('홈에 이어하기 버튼', pg.is_visible('#btnResume'))
    pg.click('#btnResume')
    pg.wait_for_timeout(400)
    check('이어하기 후 같은 판 복원', pg.evaluate("() => DFApp.board()[%d]" % sol[0]) == 1)
    check('이어하기 후 클리어 아님', pg.evaluate("() => DFApp.win()") is False)

    # 이어한 판에서 분기 저장 → 복원 → 정답
    pg.evaluate("() => DFApp.mark()")
    pg.wait_for_timeout(120)
    t = toolbar()
    check('분기 저장 후 복원 버튼 활성 · 복원 1', (t['restore'] is False) and t['label'].endswith('복원 1'), t)
    pg.evaluate("() => DFApp.restore()")
    pg.wait_for_timeout(200)
    t = toolbar()
    check('복원 후 복원 버튼 비활성(분기 0)', t['restore'] is True and t['label'].endswith('복원'), t)

    pg.evaluate("() => DFApp.solveForTest()")
    pg.wait_for_timeout(1400)
    t = toolbar()
    check('이어하기→정답 클리어', pg.evaluate("() => DFApp.win()") is True)
    check('클리어 후 cleared + 툴바 전부 잠김',
          t['cleared'] is True and t['undo'] and t['redo'] and t['restore'] and t['reset'], t)
    check('클리어 모달 표시', pg.evaluate("() => document.getElementById('modalRoot').classList.contains('open')") is True)
    pg.screenshot(path='/workspace/downloads/devils_fence_v4_free_resume_win.png')
    clear_modal()
    pg.evaluate("() => DFApp.home()")
    pg.wait_for_timeout(300)
    check('클리어 후 저장 지워져 이어하기 없음', pg.is_visible('#btnResume') is False)

    # 3) 숫자만 맞고 끊긴 판은 클리어 아님 (옛 오판정 회귀)
    #    v4: 2단계는 앞 단계 5문제를 풀어야 열린다 → 기록을 심어 해금한다
    pg.evaluate("""() => {
      var r = {};
      for (var i = 0; i < 5; i++) r[i] = { best: 60000 + i * 1000, clears: 1 };
      DFApp.st.records = { s1: r };
      localStorage.setItem('df.v2.records', JSON.stringify(DFApp.st.records));
    }""")
    pg.evaluate("() => DFApp.startStage('s2')")
    pg.wait_for_timeout(250)
    s2 = pg.evaluate("() => DF_PRESETS.stages.s2[0].solution.slice()")
    # 숫자는 그대로 두고 울타리만 끊는 변: 양옆 칸에 단서가 없는 해답 변
    cut = pg.evaluate("""() => {
      var pz = DF_PRESETS.stages.s2[0], g = DFSolver.geom(pz.R, pz.C);
      for (var q = 0; q < pz.solution.length; q++) {
        var e = pz.solution[q], r = g.eRow[e], c = g.eCol[e], cells = [];
        if (g.eH[e]) { if (r > 0) cells.push([r - 1, c]); if (r < pz.R) cells.push([r, c]); }
        else { if (c > 0) cells.push([r, c - 1]); if (c < pz.C) cells.push([r, c]); }
        if (cells.every(function (rc) { return pz.clues[rc[0]][rc[1]] < 0; })) return e;
      }
      return -1;
    }""")
    pg.evaluate("(on) => DFApp.paint(on, [])", [e for e in s2 if e != cut])
    pg.wait_for_timeout(1300)
    t = toolbar()
    check('숫자만 맞고 끊긴 판 → 클리어 아님 · 초기화는 살아 있음',
          pg.evaluate("() => DFApp.win()") is False and t['cleared'] is False
          and t['reset'] is False, t)
    gold = pg.evaluate("() => document.querySelectorAll('#board .vertOpen').length")
    check('끊긴 교차점 금색 표시 있음', cut >= 0 and gold > 0, 'cut=%s gold=%s' % (cut, gold))

    # 4) 스테이지 진짜 정답 → 클리어 + 툴바 잠금
    pg.evaluate("(on) => DFApp.paint(on, [])", list(s2))
    pg.wait_for_timeout(1400)
    t = toolbar()
    check('스테이지 정답 클리어 + 툴바 잠김',
          pg.evaluate("() => DFApp.win()") is True and t['cleared'] is True
          and t['undo'] and t['redo'] and t['restore'] and t['reset'], t)

    # HUD 버전 표기
    check('게임 HUD에 v4 표기', pg.is_visible('#hudVer') and pg.inner_text('#hudVer').strip() == 'v4')
    pg.screenshot(path='/workspace/downloads/devils_fence_v4_mobile_win.png')
    check('콘솔 오류 0건', not errs, errs[:3])
    b.close()
httpd.shutdown()

print('\n' + ('RESULT: PASS' if not fails else 'RESULT: FAIL -> ' + ', '.join(fails)), flush=True)
sys.exit(0 if not fails else 1)
