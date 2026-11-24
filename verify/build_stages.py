#!/usr/bin/env python3
"""단계별 25문제(총 125문제) 고정 퍼즐 생성 + 전수 검증 + js/presets.js 작성.

  python3 verify/build_stages.py [--only s3] [--verify-only]

- verify/gen_stages.html 의 genPuzzle()로 생성 (유일해 유지 단서 제거)
- 생성 결과는 /workspace/tmp/df_stages_v2.json 에 캐시(재시작 가능)
- 전수 검증: 단일 닫힌 고리 해답 · solveCount(...,2)===1 · 단계 내 중복 없음
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _serve import serve  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = '/workspace/tmp/df_stages_v2.json'
PORT = 8892

STAGES = [
    # id, 이름, 크기, 단서 수(1번=쉬움 → 25번=어려움)
    ('s1', '수련의 방', 5, 19, 14),
    ('s2', '유배지 예선', 7, 30, 20),
    ('s3', '유배지 본선', 10, 68, 50),
    ('s4', '심연의 문', 12, 96, 76),
    ('s5', '신의 시험', 15, 148, 125),
]
TOTAL = 25

GEN = "(args) => genPuzzle(args[0], args[1], args[2])"


def load_cache():
    if os.path.exists(CACHE):
        return json.load(open(CACHE))
    return {}


def save_cache(data):
    json.dump(data, open(CACHE, 'w'))


def target_for(lo, hi, idx, n=25):
    if n == 1:
        return hi
    return round(lo + (hi - lo) * idx / (n - 1))


def generate(pg, cache, only=None):
    for sid, name, size, lo, hi in STAGES:
        if only and sid != only:
            continue
        have = sum(1 for i in range(TOTAL) if '%s-%d' % (sid, i) in cache)
        print('[%s] %s %dx%d target %d..%d · 보유 %d' % (sid, name, size, size, lo, hi, have), flush=True)
        for i in range(TOTAL):
            key = '%s-%d' % (sid, i)
            if key in cache:
                continue
            tgt = target_for(lo, hi, i)
            seed0 = 100000 + size * 1000 + i * 37
            got = None
            for attempt in range(14):
                seed = seed0 + attempt * 7919
                relax = tgt + (attempt // 4) * 4          # 계속 실패하면 단서를 조금 더 남긴다
                try:
                    r = pg.evaluate(GEN, [size, seed, {'target': relax, 'timeMs': 25000,
                                                       'nodes': 120000, 'maxCalls': 500}])
                except Exception as e:  # noqa: BLE001
                    print('  eval error', key, e, flush=True)
                    continue
                if r and r.get('ok'):
                    pz = r['puzzle']
                    pz['meta']['stars'] = 0  # 정렬 후 채움
                    got = pz
                    break
                why = (r or {}).get('why')
                print('  retry', key, attempt, why, flush=True)
            if not got:
                raise SystemExit('생성 실패: %s' % key)
            cache[key] = got
            save_cache(cache)
            print('  %s done · 단서 %d · %dms · %s' % (key, got['meta']['clueCount'],
                                                     got['meta']['genMs'],
                                                     '전파만으로 풀이' if got['meta']['propSolved'] else '가정 필요'),
                  flush=True)


VERIFY = r"""
(args) => {
  var out = [];
  var seen = {};
  Object.keys(DF_PRESETS.stages).forEach(function (sid) {
    var arr = DF_PRESETS.stages[sid];
    var local = 0;
    arr.forEach(function (pz, i) {
      var g = DFSolver.geom(pz.R, pz.C);
      var clues = DFGen.flatClues(pz);
      var st = new Uint8Array(g.N);
      pz.solution.forEach(function (e) { st[e] = 1; });
      var res = DFSolver.solveCount(pz.R, pz.C, clues, 2, 600000);
      var sig = clues.join(',');
      if (seen[sig]) local++;
      seen[sig] = 1;
      out.push({
        id: sid, i: i, R: pz.R, C: pz.C, clues: pz.meta.clueCount,
        unique: res.count === 1 && !res.exceeded, count: res.count, exceeded: !!res.exceeded,
        nodes: res.nodes, ms: Math.round(res.ms),
        solutionValid: DFSolver.isValid(st, g, clues),
        matchesStored: (function () {
          if (!res.solution) return false;
          var found = []; for (var e = 0; e < g.N; e++) if (res.solution[e] === 1) found.push(e);
          var want = pz.solution.slice().sort(function (a, b) { return a - b; });
          return found.join(',') === want.join(',');
        })(),
        dup: local > 0
      });
    });
  });
  return out;
}
"""


def verify(pg):
    rows = pg.evaluate(VERIFY, [])
    bad = [r for r in rows if not (r['unique'] and r['solutionValid'] and not r['dup'])]
    return rows, bad


def write_presets(cache):
    src_path = os.path.join(ROOT, 'js', 'presets.js')
    txt = open(src_path, encoding='utf-8').read()
    m = re.search(r'window\.DF_PRESETS\s*=\s*(\{.*\});', txt, re.S)
    old = json.loads(m.group(1))
    bank = old.get('bank', [])

    stages = {}
    for sid, name, size, lo, hi in STAGES:
        items = [cache['%s-%d' % (sid, i)] for i in range(TOTAL)]
        items.sort(key=lambda p: -p['meta']['clueCount'])
        for idx, pz in enumerate(items):
            pz['meta']['stage'] = sid
            pz['meta']['no'] = idx + 1
            # 단계 안에서도 앞번호는 단서가 많고 뒤로 갈수록 적다 → 별 1~3개로 표시
            pz['meta']['stars'] = 1 if idx < 8 else (2 if idx < 17 else 3)
        stages[sid] = items

    out = {'version': 2, 'stages': stages, 'bank': bank}
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    header = ('/* 자동 생성 퍼즐 데이터 — 모든 퍼즐은 solveCount(...,2)===1 로 유일해를 재검증했습니다.\n'
              ' * stages: 단계별 25문제 배열(s1..s5) / bank: 자유 플레이 12×12·15×15 퍼즐 풀\n'
              ' * verify/build_stages.py 로 생성·검증 (verify/gen_stages.html + js/solver.js)\n'
              ' */\n')
    open(src_path, 'w', encoding='utf-8').write(header + 'window.DF_PRESETS = ' + body + ';\n')
    print('presets.js written · %d stages · %d puzzles · bank %d' %
          (len(stages), sum(len(v) for v in stages.values()), len(bank)))
    print('size', os.path.getsize(src_path) // 1024, 'KB')


def main():
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1]
    verify_only = '--verify-only' in sys.argv

    cache = load_cache()
    httpd = serve(ROOT, PORT)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page()
            pg.on('pageerror', lambda e: print('PAGE ERROR', e, flush=True))
            pg.goto('http://127.0.0.1:%d/verify/gen_stages.html' % PORT, wait_until='load')
            if not verify_only:
                generate(pg, cache, only)
                write_presets(cache)
                pg.goto('http://127.0.0.1:%d/verify/gen_stages.html' % PORT, wait_until='load')
                pg.add_script_tag(url='../js/presets.js')
            else:
                pg.add_script_tag(url='../js/presets.js')
            rows, bad = verify(pg)
            for sid in [s[0] for s in STAGES]:
                rs = [r for r in rows if r['id'] == sid]
                print('[%s] %d문제 · 유일해 %d · 해답유효 %d · 중복 %d · 최대 %dms' %
                      (sid, len(rs), sum(1 for r in rs if r['unique']),
                       sum(1 for r in rs if r['solutionValid']),
                       sum(1 for r in rs if r['dup']),
                       max(r['ms'] for r in rs) if rs else 0), flush=True)
            if bad:
                print('FAIL', json.dumps(bad[:5], ensure_ascii=False), flush=True)
                raise SystemExit(1)
            print('VERIFY OK · %d문제 전수 유일해 · 중복 없음' % len(rows))
            b.close()
    finally:
        httpd.shutdown()


if __name__ == '__main__':
    main()
