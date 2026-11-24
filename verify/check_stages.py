#!/usr/bin/env python3
"""스테이지 프리셋의 해답 자체가 '단일 닫힌 고리'인지, 단서를 만족하는지, 유일해인지 검사."""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_presets():
    txt = open(os.path.join(ROOT, 'js', 'presets.js'), encoding='utf-8').read()
    m = re.search(r'window\.DF_PRESETS\s*=\s*(\{.*\});\s*$', txt, re.S | re.M)
    if not m:
        m = re.search(r'window\.DF_PRESETS\s*=\s*(\{.*\});', txt, re.S)
    return json.loads(m.group(1))


class P:
    def __init__(self, R, C, clues, solution):
        self.R, self.C, self.clues, self.solution = R, C, clues, solution
        self.HC = (R + 1) * C
        self.N = self.HC + R * (C + 1)
        self.NV = (R + 1) * (C + 1)

    def h(self, r, c):
        return r * self.C + c

    def v(self, r, c):
        return self.HC + r * (self.C + 1) + c

    def cell_edges(self, r, c):
        return [self.h(r, c), self.v(r, c + 1), self.h(r + 1, c), self.v(r, c)]

    def ends(self, e):
        if e < self.HC:
            r, c = divmod(e, self.C)
            return (r, c), (r, c + 1)
        t = e - self.HC
        r, c = divmod(t, self.C + 1)
        return (r, c), (r + 1, c)

    def vertex_edges(self, r, c):
        out = []
        if c > 0:
            out.append(self.h(r, c - 1))
        if c < self.C:
            out.append(self.h(r, c))
        if r > 0:
            out.append(self.v(r - 1, c))
        if r < self.R:
            out.append(self.v(r, c))
        return out


def check(p):
    R, C = p.R, p.C
    on = set(p.solution)
    # 중복/범위 검사
    problems = []
    if len(on) != len(p.solution):
        problems.append('중복된 변이 있음')
    if any(not (0 <= e < p.N) for e in on):
        problems.append('범위를 벗어난 변 번호')
    deg = [0] * p.NV
    for e in on:
        a, b = p.ends(e)
        deg[a[0] * (C + 1) + a[1]] += 1
        deg[b[0] * (C + 1) + b[1]] += 1
    bad = [(i // (C + 1), i % (C + 1), d) for i, d in enumerate(deg) if d not in (0, 2)]
    # 단서 만족
    clue_bad = []
    for r in range(R):
        for c in range(C):
            k = p.clues[r][c]
            if k is None or k < 0:
                continue
            cnt = sum(1 for e in p.cell_edges(r, c) if e in on)
            if cnt != k:
                clue_bad.append((r, c, k, cnt))
    # 연결 요소
    seen = [False] * p.NV
    comps = 0
    for v0 in range(p.NV):
        if seen[v0] or deg[v0] == 0:
            continue
        comps += 1
        stack = [v0]
        seen[v0] = True
        while stack:
            cv = stack.pop()
            r, c = divmod(cv, C + 1)
            for e in p.vertex_edges(r, c):
                if e not in on:
                    continue
                a, b = p.ends(e)
                nv = (b[0] * (C + 1) + b[1]) if (a[0] * (C + 1) + a[1]) == cv else (a[0] * (C + 1) + a[1])
                if not seen[nv]:
                    seen[nv] = True
                    stack.append(nv)
    return {'edges': len(on), 'bad_vertices': bad, 'clue_bad': clue_bad, 'components': comps,
            'ok': not bad and not clue_bad and comps == 1}


def main():
    pres = load_presets()
    for sid, pz in pres['stages'].items():
        p = P(pz['R'], pz['C'], pz['clues'], pz['solution'])
        res = check(p)
        print(f"{sid} {pz['R']}x{pz['C']} edges={res['edges']} comps={res['components']} "
              f"badV={len(res['bad_vertices'])} clueBad={len(res['clue_bad'])} ok={res['ok']}")
        if res['bad_vertices']:
            print('   bad vertices (r,c,deg):', res['bad_vertices'][:20])
        if res['clue_bad']:
            print('   clue mismatches (r,c,clue,count):', res['clue_bad'][:20])


if __name__ == '__main__':
    main()
