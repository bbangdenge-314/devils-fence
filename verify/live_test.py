#!/usr/bin/env python3
"""라이브 사이트(GitHub Pages) 최종 검증 — 홈 → 스테이지 진입 → 플레이 → 클리어."""
import sys
from playwright.sync_api import sync_playwright

URL = "https://bbangdenge-314.github.io/devils-fence/"
fails = []


def check(name, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + name + ((" · " + str(extra)) if extra else ""), flush=True)
    if not cond:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errs = []
    pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
    pg.on("console", lambda m: errs.append("console: %s" % m.text) if m.type == "error" else None)
    resp = pg.goto(URL, wait_until="load")
    check("라이브 HTTP 200", resp is not None and resp.status == 200, resp.status if resp else None)
    pg.wait_for_timeout(700)
    check("홈 스테이지 5개", pg.eval_on_selector_all(".stage", "n=>n.length") == 5)
    check("잠금 상태 초기 4개", pg.eval_on_selector_all(".stage.locked", "n=>n.length") == 4)

    # 실제 클릭으로 스테이지 1 진입
    pg.click(".stage")
    pg.wait_for_timeout(500)
    check("스테이지 진입", pg.eval_on_selector("#screen-game", "e=>!e.classList.contains('hidden')"))
    check("보드 렌더", pg.eval_on_selector_all(".edge", "n=>n.length") > 0)

    box = pg.eval_on_selector("#board", "e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")

    def edge_pt(R, C, r, c, horiz):
        vb = {"x": -0.42, "y": -0.42, "w": C + 0.84, "h": R + 0.84}
        x = (c + 0.5) if horiz else c
        y = r if horiz else (r + 0.5)
        return (box["x"] + (x - vb["x"]) / vb["w"] * box["w"],
                box["y"] + (y - vb["y"]) / vb["h"] * box["h"])

    # 드래그로 한 줄 긋기 (실제 포인터 입력)
    pg.click(".mode[data-mode='line']")
    x0, y0 = edge_pt(5, 5, 2, 0, True)
    x1, _ = edge_pt(5, 5, 2, 4, True)
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    for i in range(1, 18):
        pg.mouse.move(x0 + (x1 - x0) * i / 17, y0)
        pg.wait_for_timeout(6)
    pg.mouse.up()
    pg.wait_for_timeout(150)
    row = pg.evaluate("()=>{const g=window.DFSolver.geom(5,5);const b=window.DFApp.board();const a=[];for(let c=0;c<5;c++)a.push(b[g.H(2,c)]);return a;}")
    check("드래그로 5칸 긋기(라이브)", row == [1] * 5, row)

    # 초기화 후 힌트 → 적용
    pg.click("#btnReset")
    pg.wait_for_timeout(300)
    pg.click(".modal-foot .btn.primary")
    pg.wait_for_timeout(300)
    pg.click("#btnHint")
    pg.wait_for_timeout(400)
    hint = pg.evaluate("()=>({open:!document.getElementById('hintPanel').classList.contains('hidden'), title:document.getElementById('hintTitle').textContent})")
    check("힌트 패널(라이브)", hint["open"], hint)
    pg.click("#hintApply")
    pg.wait_for_timeout(300)
    after = pg.evaluate("()=>{const b=window.DFApp.board();let n=0;for(let i=0;i<b.length;i++) if(b[i]) n++; return n;}")
    check("힌트 적용(라이브)", after > 0, after)

    # 정답 배치 → 자동 클리어 + 모달
    pg.evaluate("()=>window.DFApp.solveForTest()")
    pg.wait_for_timeout(1500)
    won = pg.evaluate("()=>window.DFApp.win()")
    modal = pg.eval_on_selector("#modalRoot", "e=>e.classList.contains('open')")
    title = pg.eval_on_selector(".clear-title", "e=>e.textContent") if modal else ""
    check("자동 클리어 + 클리어 모달(라이브)", won and modal, (won, modal, title))

    # 다음 스테이지 해금 확인
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    pg.evaluate("()=>window.DFApp.home()")
    pg.wait_for_timeout(400)
    locked = pg.eval_on_selector_all(".stage.locked", "n=>n.length")
    check("클리어 후 다음 스테이지 해금(라이브)", locked == 3, locked)

    check("PC 콘솔 오류 0건(라이브)", len(errs) == 0, errs[:3])

    # 모바일 라이브
    m = b.new_page(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    merr = []
    m.on("pageerror", lambda e: merr.append(str(e)))
    m.on("console", lambda x: merr.append(x.text) if x.type == "error" else None)
    m.goto(URL, wait_until="load")
    m.wait_for_timeout(600)
    m.click(".stage")
    m.wait_for_timeout(600)
    m.screenshot(path="/workspace/downloads/devils_fence_live_mobile.png")
    geo = m.evaluate("""()=>{
      const hud=document.getElementById('hud').getBoundingClientRect();
      const board=document.getElementById('board').getBoundingClientRect();
      const bar=document.getElementById('toolbar').getBoundingClientRect();
      return {ok: board.top>=hud.bottom-1 && board.bottom<=bar.top+1, w: board.width};
    }""")
    check("모바일 라이브 레이아웃", geo["ok"], geo)
    check("모바일 콘솔 오류 0건(라이브)", len(merr) == 0, merr[:3])
    b.close()

print("\n" + ("RESULT: PASS" if not fails else "RESULT: FAIL -> " + ", ".join(fails)), flush=True)
sys.exit(0 if not fails else 1)
