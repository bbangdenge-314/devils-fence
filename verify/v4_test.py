#!/usr/bin/env python3
"""v4 UI 검증 — 단계별 25문제 · 문제 자유 선택 · 5문제 해금 흐름.

  python3 verify/v4_test.py

 1. ?v=4 자산·배지, 홈 5단계 카드(0/25, 잠금 조건 문구)
 2. 단계 카드 → 25문제 선택 화면(전부 열림, 잠금 없음)
 3. 7번 문제 선택 → HUD '7번 문제', 클리어 모달(다음 문제·문제 목록·다시 도전)
 4. 5문제 클리어 → 다음 단계 해금(홈 카드·선택 화면 표시)
 5. 문제 목록에서 기록·최고 시간 표시, 새로고침 후 유지
 6. 25번 문제는 '다음 문제' 대신 '문제 목록'
 7. 자유 플레이·이어하기 회귀, 콘솔 오류 0건
"""
import sys

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = __file__.rsplit('/verify/', 1)[0]
PORT = 8774
URL = 'http://127.0.0.1:%d/index.html?v=4' % PORT

fails = []


def check(name, cond, extra=''):
    print(('  PASS ' if cond else '  FAIL ') + name + ((' · ' + str(extra)) if extra else ''), flush=True)
    if not cond:
        fails.append(name)


def main():
    httpd = serve(ROOT, PORT)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={'width': 1440, 'height': 900})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            pg.goto(URL, wait_until='load')
            pg.evaluate('() => { try { localStorage.clear(); } catch (e) {} }')
            pg.reload(wait_until='load')
            pg.wait_for_function('window.DFApp && window.DF_PRESETS')
            pg.wait_for_timeout(300)

            def modal_text():
                return pg.evaluate("() => { const m=document.getElementById('modalRoot');"
                                   " return m.classList.contains('open') ? m.querySelector('.modal').innerText.replace(/\\n/g,' | ') : ''; }")

            def modal_buttons():
                return pg.eval_on_selector_all('.modal-foot .btn', 'els => els.map(e => e.textContent.trim())')

            def close_modal():
                pg.evaluate("() => { const m=document.getElementById('modalRoot'); m.classList.remove('open'); m.innerHTML=''; }")

            def solve(stage, idx):
                close_modal()
                ok = pg.evaluate('([s,i]) => DFApp.startProblem(s,i)', [stage, idx])
                pg.wait_for_timeout(140)
                pg.evaluate('() => DFApp.solveForTest()')
                pg.wait_for_timeout(1250)
                return ok

            # ---------- 1) 버전 · 홈 ----------
            print('[1] 버전 · 홈', flush=True)
            assets = pg.evaluate("() => Array.from(document.querySelectorAll('link[rel=stylesheet],script[src]'))"
                                 ".map(n => n.getAttribute('href') || n.getAttribute('src'))")
            check('모든 css/js 가 ?v=4', all(a.endswith('?v=4') for a in assets), assets)
            check('홈 v4 배지', pg.inner_text('#appVer').strip() == 'v4')
            check('단계 카드 5개', pg.eval_on_selector_all('.stage', 'n => n.length') == 5)
            check('처음엔 1단계만 열림 · 4개 잠금',
                  pg.eval_on_selector_all('.stage.locked', 'n => n.length') == 4
                  and pg.evaluate("() => !document.querySelectorAll('.stage')[0].classList.contains('locked')"))
            tiles = pg.eval_on_selector_all('.stage', "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
            check('카드마다 "0 / 25" 클리어 수', all('0 / 25' in t for t in tiles), tiles[0])
            check('잠금 카드에 해금 조건 문구',
                  '이전 단계 5문제 클리어 시 해금' in tiles[1] and '현재 0 / 5' in tiles[1], tiles[1])
            check('홈 총 클리어 0 / 125', '0 / 125' in pg.inner_text('#homeProgress'))

            # ---------- 2) 문제 선택 화면 ----------
            print('[2] 25문제 선택 화면', flush=True)
            pg.click('.stage:nth-child(1)')
            pg.wait_for_timeout(250)
            check('선택 화면 열림', pg.is_visible('#screen-select') and not pg.is_visible('#screen-game'))
            check('25개 문제 타일', pg.eval_on_selector_all('.prob', 'n => n.length') == 25)
            check('모든 타일 활성(순차 해금 아님)',
                  pg.eval_on_selector_all('.prob', 'els => els.every(e => !e.disabled)'))
            check('타일 번호 1..25',
                  pg.eval_on_selector_all('.prob', "els => els.map(e => +e.getAttribute('data-no')).join(',')")
                  == ','.join(str(i) for i in range(1, 26)))
            check('단계 제목 · 0 / 25', pg.inner_text('#selectName') == '수련의 방'
                  and pg.inner_text('#selectCleared').replace(' ', '') == '0/25')

            # ---------- 3) 7번 문제 ----------
            print('[3] 7번 문제 선택 · 클리어', flush=True)
            pg.click('.prob[data-no="7"]')
            pg.wait_for_timeout(300)
            check('게임 진입 · HUD 7번 문제',
                  pg.is_visible('#screen-game') and '7번 문제' in pg.inner_text('#hudSub'))
            check('HUD 단계 이름', pg.inner_text('#hudMode') == '수련의 방')
            sol = pg.evaluate('() => DFApp.puzzle().solution.slice()')
            pg.evaluate('(on) => DFApp.paint(on, [])', sol)
            pg.wait_for_timeout(1350)
            check('7번 문제 클리어', pg.evaluate('() => DFApp.win()') is True)
            btns = modal_buttons()
            check('클리어 모달 버튼: 다음 문제 · 문제 목록 · 다시 도전',
                  btns[:2] == ['다음 문제 →', '문제 목록'] and btns[-1] == '다시 도전', btns)
            check('모달에 단계 진행 1 / 25', '1 / 25' in modal_text(), modal_text())
            pg.screenshot(path='/workspace/downloads/devils_fence_v4_clear_modal.png')
            pg.click('.modal-foot .btn.primary')      # 다음 문제 →
            pg.wait_for_timeout(320)
            check('다음 문제 → 8번', '8번 문제' in pg.inner_text('#hudSub'))

            # 뒤로 → 문제 목록
            pg.click('#btnBack')
            pg.wait_for_timeout(200)
            if pg.is_visible('.modal-foot'):
                pg.eval_on_selector_all('.modal-foot .btn', "els => els.find(e => e.textContent.includes('나가기')).click()")
            pg.wait_for_timeout(320)
            check('뒤로가기 → 문제 목록 화면', pg.is_visible('#screen-select'))
            check('7번 타일에 클리어 표시 · 기록', pg.eval_on_selector(
                '.prob[data-no="7"]', "e => e.classList.contains('cleared') && /\\d\\d:\\d\\d/.test(e.innerText)"))

            # ---------- 4) 5문제 클리어 → 다음 단계 해금 ----------
            print('[4] 5문제 클리어 해금', flush=True)
            for idx in [1, 2, 3, 4]:
                solve('s1', idx)
                if idx == 4:
                    txt = modal_text()
                    btns = modal_buttons()
            check('4문제 더 클리어 (총 5/25)',
                  pg.evaluate("() => DFApp.stageState('s1').cleared") == 5)
            check('해금 안내 표시', '다음 단계 해금' in txt and '유배지 예선' in txt, txt[-80:])
            close_modal()
            check('2단계 해금 상태', pg.evaluate("() => DFApp.stageState('s2').unlocked") is True)
            pg.evaluate('() => DFApp.home()')
            pg.wait_for_timeout(300)
            rows = pg.eval_on_selector_all('.stage', "els => els.map(e => e.innerText.replace(/\\n/g,' '))")
            check('홈: 1단계 5 / 25', '5 / 25' in rows[0], rows[0])
            check('홈: 2단계 잠금 해제', '이전 단계' not in rows[1] and '0 / 25' in rows[1], rows[1])
            check('홈 진행 배지 5 / 125', '5 / 125' in pg.inner_text('#homeProgress'))
            check('홈 단계 개방 2 / 5', '2 / 5' in pg.inner_text('#homeTotal'))
            pg.screenshot(path='/workspace/downloads/devils_fence_v4_home_desktop.png')

            # ---------- 5) 2단계 진입 · 새로고침 유지 ----------
            print('[5] 2단계 · 저장 유지', flush=True)
            pg.click('.stage:nth-child(2)')
            pg.wait_for_timeout(250)
            check('2단계 선택 화면', pg.inner_text('#selectName') == '유배지 예선'
                  and pg.eval_on_selector_all('.prob', 'n => n.length') == 25)
            pg.click('.prob[data-no="1"]')
            pg.wait_for_timeout(300)
            check('2단계 1번 문제 HUD', '1번 문제' in pg.inner_text('#hudSub')
                  and '7 × 7' in pg.inner_text('#hudSub'))
            # 진행 저장 → 새로고침 → 이어하기
            on = pg.evaluate('() => DFApp.puzzle().solution.slice(0, 3)')
            pg.evaluate('(on) => { on.forEach(e => DFApp.setEdge(e, 1)); }', on)
            pg.wait_for_timeout(700)
            pg.reload(wait_until='load')
            pg.wait_for_function('window.DFApp')
            pg.wait_for_timeout(300)
            check('새로고침 후 2단계 유지', pg.evaluate("() => DFApp.stageState('s1').cleared") == 5
                  and pg.evaluate("() => DFApp.stageState('s2').unlocked") is True)
            check('홈에 이어하기 버튼', pg.is_visible('#btnResume'))
            pg.click('#btnResume')
            pg.wait_for_timeout(400)
            check('이어하기: 2단계 1번 문제 · 그은 선 복원',
                  '1번 문제' in pg.inner_text('#hudSub')
                  and pg.evaluate('(on) => on.every(e => DFApp.board()[e] === 1)', on))

            # ---------- 6) 25번 문제 = 마지막 ----------
            print('[6] 마지막 문제', flush=True)
            pg.evaluate("() => { const m=document.getElementById('modalRoot'); m.classList.remove('open'); m.innerHTML=''; }")
            solve('s1', 24)
            btns = modal_buttons()
            check('25번 문제: 다음 문제 없음 · 문제 목록이 주 버튼',
                  '다음 문제 →' not in btns and btns[0] == '문제 목록' and '다시 도전' in btns, btns)
            close_modal()

            # ---------- 7) 자유 플레이 회귀 ----------
            print('[7] 자유 플레이 회귀', flush=True)
            pg.evaluate('() => DFApp.home()')
            pg.wait_for_timeout(250)
            pg.evaluate("() => { DFApp.setFree(7,'easy'); DFApp.startFree(); }")
            pg.wait_for_function("() => DFApp.puzzle() && DFApp.puzzle().R === 7", timeout=25000)
            pg.wait_for_timeout(200)
            pg.evaluate('() => DFApp.solveForTest()')
            pg.wait_for_timeout(1250)
            check('자유 플레이 클리어', pg.evaluate('() => DFApp.win()') is True)
            check('자유 플레이 모달: 새 퍼즐·홈으로', modal_buttons()[:1] == ['새 퍼즐'])
            close_modal()
            check('자유 플레이에서는 문제 목록 개념 없음',
                  pg.evaluate('() => DFApp.problemIndex()') is None)

            # ---------- 8) 모바일 화면 ----------
            print('[8] 모바일', flush=True)
            m = b.new_page(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            merrs = []
            m.on('pageerror', lambda e: merrs.append(str(e)))
            m.on('console', lambda x: merrs.append(x.text) if x.type == 'error' else None)
            m.goto(URL, wait_until='load')
            m.wait_for_timeout(500)
            check('모바일: 새 프로필은 1단계만 열림', m.eval_on_selector_all('.stage.locked', 'n => n.length') == 4)
            m.screenshot(path='/workspace/downloads/devils_fence_v4_home_mobile.png')
            m.click('.stage:nth-child(1)')
            m.wait_for_timeout(350)
            m.screenshot(path='/workspace/downloads/devils_fence_v4_select_mobile.png')
            check('모바일 25타일 선택 화면', m.eval_on_selector_all('.prob', 'n => n.length') == 25)
            box = m.eval_on_selector('.prob[data-no="13"]', 'e => { const r=e.getBoundingClientRect(); return {w:r.width,h:r.height}; }')
            check('모바일 타일 터치 크기 확보', box['w'] >= 44 and box['h'] >= 44, box)
            m.click('.prob[data-no="13"]')
            m.wait_for_timeout(400)
            check('모바일 13번 문제 진입', '13번 문제' in m.inner_text('#hudSub'))
            m.screenshot(path='/workspace/downloads/devils_fence_v4_game_mobile.png')
            check('모바일 콘솔 오류 0건', not merrs, merrs[:3])

            # ---------- 9) localStorage 구조 ----------
            keys = pg.evaluate('() => Object.keys(localStorage)')
            check('새 키 df.v2.records 사용', 'df.v2.records' in keys, keys)
            check('옛 df.v1.unlocked 의존 없음', 'df.v1.unlocked' not in keys, keys)

            check('콘솔 오류 0건(데스크톱)', not errs, errs[:3])
            pg.screenshot(path='/workspace/downloads/devils_fence_v4_home_final.png')
            b.close()
    finally:
        httpd.shutdown()

    print('')
    print('RESULT: ' + ('PASS' if not fails else 'FAIL -> ' + ', '.join(fails)), flush=True)
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
