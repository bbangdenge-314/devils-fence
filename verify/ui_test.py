#!/usr/bin/env python3
"""울타리 치기 — Playwright 실플레이 검증 (PC 1440×900 / 모바일 390×844 hasTouch).

확인 항목
  · 콘솔·페이지 오류 0건
  · PC: 클릭 순환(빈→선→X→빈), 우클릭 X, 드래그 연속 긋기, 되돌리기/다시 실행
  · 힌트 표시/적용, 분기 저장·복원
  · 10×10 / 15×15 에서 HUD·보드·툴바 비겹침
  · 정답 배치 시 자동 클리어 + 클리어 모달
  · 모바일 터치 탭·드래그로 선/X 입력
대표 스크린샷
  downloads/devils_fence_01_pc.png
  downloads/devils_fence_02_solve.png
  downloads/devils_fence_03_guide.png
  downloads/devils_fence_04_mobile.png
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "/workspace/downloads"
PORT = 8790

serve(ROOT, PORT)
BASE = "http://127.0.0.1:%d/" % PORT
fails = []


def check(name, cond, extra=""):
    print(("  PASS " if cond else "  FAIL ") + name + ((" · " + str(extra)) if extra else ""), flush=True)
    if not cond:
        fails.append(name)


def edge_pt(box, R, C, r, c, horiz):
    vb = {"x": -0.42, "y": -0.42, "w": C + 0.84, "h": R + 0.84}
    x = (c + 0.5) if horiz else c
    y = r if horiz else (r + 0.5)
    return (box["x"] + (x - vb["x"]) / vb["w"] * box["w"],
            box["y"] + (y - vb["y"]) / vb["h"] * box["h"])


def board_box(pg):
    return pg.eval_on_selector("#board", "e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()

        # ---------------- PC ----------------
        print("[PC 1440x900]", flush=True)
        pg = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console: %s" % m.text) if m.type == "error" else None)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(400)
        check("홈 화면 스테이지 5개", pg.eval_on_selector_all(".stage", "n=>n.length") == 5)
        pg.screenshot(path=os.path.join(OUT, "devils_fence_01_pc.png"))

        # open a 10x10 stage
        pg.evaluate("()=>window.DFApp.startStage('s3')")
        pg.wait_for_timeout(300)
        check("스테이지 진입", pg.eval_on_selector("#screen-game", "e=>!e.classList.contains('hidden')"))
        R = C = 10
        box = board_box(pg)

        # click cycle
        x, y = edge_pt(box, R, C, 4, 4, True)
        pg.mouse.click(x, y); pg.wait_for_timeout(50)
        s1 = pg.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(10,10).H(4,4)]")
        pg.mouse.click(x, y); pg.wait_for_timeout(50)
        s2 = pg.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(10,10).H(4,4)]")
        pg.mouse.click(x, y); pg.wait_for_timeout(50)
        s3 = pg.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(10,10).H(4,4)]")
        check("클릭 순환 빈→선→X→빈", (s1, s2, s3) == (1, 2, 0), (s1, s2, s3))

        # right click
        x, y = edge_pt(box, R, C, 3, 3, False)
        pg.mouse.click(x, y, button="right"); pg.wait_for_timeout(50)
        r1 = pg.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(10,10).V(3,3)]")
        check("우클릭 X 토글", r1 == 2, r1)

        # drag a full row
        pg.evaluate("()=>window.DFApp.mode('line')")
        x0, y0 = edge_pt(box, R, C, 6, 0, True)
        x1, _ = edge_pt(box, R, C, 6, 9, True)
        pg.mouse.move(x0, y0); pg.mouse.down()
        for i in range(1, 25):
            pg.mouse.move(x0 + (x1 - x0) * i / 24, y0)
            pg.wait_for_timeout(6)
        pg.mouse.up(); pg.wait_for_timeout(100)
        row = pg.evaluate("()=>{const g=window.DFSolver.geom(10,10);const b=window.DFApp.board();const a=[];for(let c=0;c<10;c++)a.push(b[g.H(6,c)]);return a;}")
        check("드래그 연속 긋기(가로 10칸)", row == [1] * 10, row)

        # undo / redo
        pg.evaluate("()=>window.DFApp.undo()"); pg.wait_for_timeout(60)
        undone = pg.evaluate("()=>{const g=window.DFSolver.geom(10,10);const b=window.DFApp.board();let n=0;for(let c=0;c<10;c++) if(b[g.H(6,c)]) n++; return n;}")
        pg.evaluate("()=>window.DFApp.redo()"); pg.wait_for_timeout(60)
        redone = pg.evaluate("()=>{const g=window.DFSolver.geom(10,10);const b=window.DFApp.board();let n=0;for(let c=0;c<10;c++) if(b[g.H(6,c)]) n++; return n;}")
        check("되돌리기/다시 실행", undone == 0 and redone == 10, (undone, redone))

        # reset via UI
        pg.evaluate("()=>window.DFApp.mode('cycle')")
        pg.evaluate("()=>document.getElementById('btnReset').click()")
        pg.wait_for_timeout(150)
        pg.evaluate("()=>document.querySelectorAll('.modal-foot .btn')[1].click()")
        pg.wait_for_timeout(150)
        left = pg.evaluate("()=>{const b=window.DFApp.board();let n=0;for(let i=0;i<b.length;i++) if(b[i]) n++; return n;}")
        check("초기화", left == 0, left)

        # hint
        pg.evaluate("()=>window.DFApp.showHint()")
        pg.wait_for_timeout(200)
        hint = pg.evaluate("()=>({open:!document.getElementById('hintPanel').classList.contains('hidden'), title:document.getElementById('hintTitle').textContent})")
        check("힌트 표시", hint["open"] and len(hint["title"]) > 0, hint)
        pg.evaluate("()=>window.DFApp.applyHint()")
        pg.wait_for_timeout(120)
        applied = pg.evaluate("()=>{const b=window.DFApp.board();let n=0;for(let i=0;i<b.length;i++) if(b[i]) n++; return n;}")
        check("힌트 적용", applied > 0, applied)

        # checkpoint
        pg.evaluate("()=>window.DFApp.mark()")
        pg.evaluate("()=>{const a=window.DFApp.board(); for(let i=0;i<a.length;i++) a[i]=0;}")
        pg.evaluate("()=>window.DFApp.restore()")
        pg.wait_for_timeout(120)
        restored = pg.evaluate("()=>{const b=window.DFApp.board();let n=0;for(let i=0;i<b.length;i++) if(b[i]) n++; return n;}")
        check("분기 저장/복원", restored == applied, (restored, applied))

        # ---- screenshot pass on a clean page (no toasts / leftover state) ----
        shot = browser.new_page(viewport={"width": 1440, "height": 900})
        shot.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        shot.goto(BASE, wait_until="load")
        shot.evaluate("()=>window.DFApp.startStage('s3')")
        shot.wait_for_timeout(250)
        shot.evaluate("""()=>{
          const p = window.DFApp.puzzle();
          const g = window.DFSolver.geom(p.R,p.C);
          const half = Math.floor(p.solution.length*0.74);
          const on = p.solution.slice(0, half);
          const solSet = new Set(p.solution);
          const xs = [];
          for (let e=0;e<g.N && xs.length<24;e++){ if(!solSet.has(e) && (e%6===2)) xs.push(e); }
          window.DFApp.paint(on, xs);
        }""")
        shot.wait_for_timeout(200)
        shot.evaluate("()=>window.DFApp.showHint()")
        shot.wait_for_timeout(450)
        shot.screenshot(path=os.path.join(OUT, "devils_fence_02_solve.png"))

        # guide modal
        shot.evaluate("()=>document.getElementById('btnGuide').click()")
        shot.wait_for_timeout(400)
        check("규칙·공략 모달", shot.eval_on_selector_all(".rule", "n=>n.length") >= 10)
        shot.screenshot(path=os.path.join(OUT, "devils_fence_03_guide.png"))
        shot.close()

        # auto clear
        # auto clear
        pg.evaluate("()=>window.DFApp.solveForTest()")
        pg.wait_for_timeout(1300)
        won = pg.evaluate("()=>window.DFApp.win()")
        modal = pg.eval_on_selector("#modalRoot", "e=>e.classList.contains('open')")
        check("자동 클리어 + 클리어 모달", won and modal, (won, modal))

        # 15x15 layout without overlap (desktop)
        pg.evaluate("()=>{document.querySelectorAll('.modal-foot .btn').forEach(b=>{});}")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(150)
        pg.evaluate("()=>window.DFApp.startStage('s5')")
        pg.wait_for_timeout(400)
        geo = pg.evaluate("""()=>{
          const hud=document.getElementById('hud').getBoundingClientRect();
          const board=document.getElementById('board').getBoundingClientRect();
          const bar=document.getElementById('toolbar').getBoundingClientRect();
          return {t:board.top, b:board.bottom, hudB:hud.bottom, barT:bar.top, vw:innerWidth, vh:innerHeight};
        }""")
        check("PC 15×15 비겹침", geo["t"] >= geo["hudB"] - 1 and geo["b"] <= geo["barT"] + 1, geo)

        # ---- 진행 저장 / 이어하기 ----
        pg.evaluate("()=>window.DFApp.startStage('s2')")
        pg.wait_for_timeout(200)
        pg.evaluate("()=>window.DFApp.paint([0,1,2,3,4], [])")
        pg.wait_for_timeout(700)
        pg.reload(wait_until="load")
        pg.wait_for_timeout(400)
        has_resume = pg.eval_on_selector_all("#btnResume", "n=>n.length") == 1
        pg.evaluate("()=>document.getElementById('btnResume').click()")
        pg.wait_for_timeout(400)
        resumed = pg.evaluate("()=>{const b=window.DFApp.board();let n=0;for(let i=0;i<b.length;i++) if(b[i]===1) n++; return n;}")
        check("자동 저장 · 이어하기", has_resume and resumed == 5, (has_resume, resumed))

        # ---- 스테이지 클리어 → 다음 스테이지 해금 ----
        pg.evaluate("()=>{localStorage.clear(); location.reload();}")
        pg.wait_for_timeout(500)
        locked_before = pg.eval_on_selector_all(".stage.locked", "n=>n.length")
        pg.evaluate("()=>window.DFApp.startStage('s1')")
        pg.wait_for_timeout(200)
        pg.evaluate("()=>window.DFApp.solveForTest()")
        pg.wait_for_timeout(1400)
        pg.evaluate("()=>{const b=document.querySelector('.modal-foot .btn.ghost'); }")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(200)
        pg.evaluate("()=>window.DFApp.home()")
        pg.wait_for_timeout(300)
        locked_after = pg.eval_on_selector_all(".stage.locked", "n=>n.length")
        check("클리어 시 다음 스테이지 해금", locked_before == 4 and locked_after == 3, (locked_before, locked_after))

        # ---- 옵션: 실시간 경고 끄기 ----
        pg.evaluate("()=>window.DFApp.startStage('s1')")
        pg.wait_for_timeout(200)
        pg.evaluate("""()=>{
          const p = window.DFApp.puzzle();
          const g = window.DFSolver.geom(p.R,p.C);
          // 0 단서 칸에 선을 하나 그어 일부러 초과 상태 만들기
          let target = null;
          for (let r=0;r<p.R && target===null;r++) for (let c=0;c<p.C;c++) if (p.clues[r][c]===0){ target=[r,c]; break; }
          if (target) window.DFApp.paint([g.H(target[0], target[1])], []);
        }""")
        pg.wait_for_timeout(200)
        warns_on = pg.eval_on_selector_all(".cell.over", "n=>n.length")
        pg.evaluate("()=>document.getElementById('btnOptions').click()")
        pg.wait_for_timeout(250)
        pg.evaluate("()=>document.querySelector('.switch').click()")
        pg.wait_for_timeout(150)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        warns_off = pg.eval_on_selector_all(".cell.over", "n=>n.length")
        check("옵션: 실시간 오류 경고 on/off", warns_on > 0 and warns_off == 0, (warns_on, warns_off))
        pg.evaluate("()=>{window.DFApp.st.opts.warn=true; document.querySelectorAll('.switch').forEach(s=>{}); }")

        check("PC 콘솔 오류 0건", len(errors) == 0, errors[:3])

        # ---------------- mobile ----------------
        print("[Mobile 390x844 hasTouch]", flush=True)
        m = browser.new_page(viewport={"width": 390, "height": 844}, has_touch=True,
                             is_mobile=True, device_scale_factor=2)
        merr = []
        m.on("pageerror", lambda e: merr.append("pageerror: %s" % e))
        m.on("console", lambda x: merr.append("console: %s" % x.text) if x.type == "error" else None)
        m.goto(BASE, wait_until="load")
        m.wait_for_timeout(400)
        m.evaluate("()=>window.DFApp.startStage('s5')")
        m.wait_for_timeout(500)

        mgeo = m.evaluate("""()=>{
          const hud=document.getElementById('hud').getBoundingClientRect();
          const board=document.getElementById('board').getBoundingClientRect();
          const bar=document.getElementById('toolbar').getBoundingClientRect();
          return {boardT:board.top, boardB:board.bottom, boardW:board.width, hudB:hud.bottom, barT:bar.top, vw:innerWidth};
        }""")
        check("모바일 15×15 HUD/보드/툴바 비겹침",
              mgeo["boardT"] >= mgeo["hudB"] - 1 and mgeo["boardB"] <= mgeo["barT"] + 1, mgeo)
        check("모바일 보드 폭 사용", mgeo["boardW"] >= 350, mgeo["boardW"])

        mbox = board_box(m)
        # touch tap
        tx, ty = edge_pt(mbox, 15, 15, 5, 5, True)
        m.touchscreen.tap(tx, ty)
        m.wait_for_timeout(120)
        tv = m.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(15,15).H(5,5)]")
        check("모바일 탭으로 선 긋기", tv == 1, tv)

        # touch drag
        m.evaluate("()=>window.DFApp.mode('line')")
        x0, y0 = edge_pt(mbox, 15, 15, 8, 1, True)
        x1, _ = edge_pt(mbox, 15, 15, 8, 13, True)
        m.evaluate("""([x0,y0,x1,y1])=>{
          const svg=document.getElementById('board');
          const r=svg.getBoundingClientRect();
          function fire(type, x, y){
            const ev=new PointerEvent(type,{pointerId:11,pointerType:'touch',isPrimary:true,bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1});
            svg.dispatchEvent(ev);
          }
          fire('pointerdown', x0, y0);
          for (let i=1;i<=16;i++) fire('pointermove', x0+(x1-x0)*i/16, y0);
          fire('pointerup', x1, y0);
        }""", [x0, y0, x1, _])
        m.wait_for_timeout(150)
        row = m.evaluate("()=>{const g=window.DFSolver.geom(15,15);const b=window.DFApp.board();const a=[];for(let c=1;c<14;c++)a.push(b[g.H(8,c)]);return a;}")
        check("모바일 드래그 연속 긋기", all(v == 1 for v in row), row)

        # touch X mode
        m.evaluate("()=>window.DFApp.mode('cross')")
        tx, ty = edge_pt(mbox, 15, 15, 10, 3, False)
        m.touchscreen.tap(tx, ty)
        m.wait_for_timeout(120)
        xv = m.evaluate("()=>window.DFApp.board()[window.DFSolver.geom(15,15).V(10,3)]")
        check("모바일 X 모드 입력", xv == 2, xv)

        # partial solve for a representative mobile shot
        m.evaluate("""()=>{
          const p = window.DFApp.puzzle();
          const g = window.DFSolver.geom(p.R,p.C);
          const half = Math.floor(p.solution.length*0.66);
          const on = p.solution.slice(0, half);
          const solSet = new Set(p.solution);
          const xs = [];
          for (let e=0;e<g.N && xs.length<18;e++){ if(!solSet.has(e) && (e%7===3)) xs.push(e); }
          window.DFApp.paint(on, xs);
        }""")
        m.wait_for_timeout(300)
        m.screenshot(path=os.path.join(OUT, "devils_fence_04_mobile.png"))
        check("모바일 콘솔 오류 0건", len(merr) == 0, merr[:3])

        browser.close()

    print("\n" + ("RESULT: PASS" if not fails else "RESULT: FAIL -> " + ", ".join(fails)), flush=True)
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
