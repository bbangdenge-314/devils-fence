#!/usr/bin/env python3
"""울타리 치기(Slitherlink) 퍼즐 검증기 — 독립 구현(파이썬).

1) presets.js 에 들어 있는 스테이지/뱅크 퍼즐이
   - 저장된 해답이 실제로 규칙을 만족하는지
   - 그 해답이 유일한지 (다른 해가 없는지)
2) 브라우저의 생성기(JS)가 만든 새 퍼즐도 같은 기준으로 검증

사용:
    python3 verify/verify.py                 # 프리셋 + 생성기 검증
    python3 verify/verify.py --presets       # 프리셋만
    python3 verify/verify.py --gen-only      # 생성기만
"""
import argparse
import itertools
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- model
class Puzzle:
    def __init__(self, R, C, clues, solution=None):
        self.R = R
        self.C = C
        self.clues = clues          # 2D list, -1 = blank
        self.solution = solution    # list of edge ids (JS scheme) or None
        self.HC = (R + 1) * C
        self.N = self.HC + R * (C + 1)
        self.cells = []      # [(edges, clue)]
        for r in range(R):
            for c in range(C):
                self.cells.append((tuple(self.cell_edges(r, c)), self.clues[r][c]))
        self.verts = []
        for r in range(R + 1):
            for c in range(C + 1):
                self.verts.append(tuple(self.vertex_edges(r, c)))
        self.ends = [self.edge_ends(e) for e in range(self.N)]

    # edges
    def h(self, r, c):
        return r * self.C + c

    def v(self, r, c):
        return self.HC + r * (self.C + 1) + c

    def cell_edges(self, r, c):
        return [self.h(r, c), self.v(r, c + 1), self.h(r + 1, c), self.v(r, c)]

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

    def edge_ends(self, e):
        if e < self.HC:
            r, c = divmod(e, self.C)
            return (r, c), (r, c + 1)
        t = e - self.HC
        r, c = divmod(t, self.C + 1)
        return (r, c), (r + 1, c)


UNKNOWN, ON, OFF = 0, 1, 2


def propagate(state, pz):
    """제약 전파. 모순이면 False."""
    ON_, UNKNOWN_ = ON, UNKNOWN
    cells = pz.cells
    verts = pz.verts
    changed = True
    while changed:
        changed = False
        for es, k in cells:
            if k < 0:
                continue
            on = 0
            unk = None
            unk_n = 0
            for e in es:
                v = state[e]
                if v == ON_:
                    on += 1
                elif v == UNKNOWN_:
                    unk_n += 1
                    if unk is None:
                        unk = [e]
                    else:
                        unk.append(e)
            if on > k or on + unk_n < k:
                return False
            if not unk_n:
                continue
            if on == k:
                for e in unk:
                    state[e] = OFF
                changed = True
            elif on + unk_n == k:
                for e in unk:
                    state[e] = ON_
                changed = True
        for es in verts:
            deg = 0
            unk = []
            for e in es:
                v = state[e]
                if v == ON_:
                    deg += 1
                elif v == UNKNOWN_:
                    unk.append(e)
            if deg > 2:
                return False
            if deg == 2:
                if unk:
                    for e in unk:
                        state[e] = OFF
                    changed = True
            elif deg == 1:
                if not unk:
                    return False
                if len(unk) == 1:
                    state[unk[0]] = ON_
                    changed = True
            else:
                if len(es) == 1 and len(unk) == 1:
                    state[unk[0]] = OFF
                    changed = True
    return True


def degrees(state, pz):
    deg = [[0] * (pz.C + 1) for _ in range(pz.R + 1)]
    for e, s in enumerate(state):
        if s != ON:
            continue
        (r1, c1), (r2, c2) = pz.edge_ends(e)
        deg[r1][c1] += 1
        deg[r2][c2] += 1
    return deg


def is_single_loop(state, pz):
    deg = degrees(state, pz)
    nodes = set()
    for r in range(pz.R + 1):
        for c in range(pz.C + 1):
            if deg[r][c] not in (0, 2):
                return False
            if deg[r][c] == 2:
                nodes.add((r, c))
    if not nodes:
        return False
    # connected components
    adj = {}
    for e, s in enumerate(state):
        if s != ON:
            continue
        a, b = pz.edge_ends(e)
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = next(iter(nodes))
    seen = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return len(seen) == len(nodes)


def clues_ok(state, pz):
    for r in range(pz.R):
        for c in range(pz.C):
            k = pz.clues[r][c]
            if k < 0:
                continue
            on = sum(1 for e in pz.cell_edges(r, c) if state[e] == ON)
            if on != k:
                return False
    return True


def is_valid(state, pz):
    return clues_ok(state, pz) and is_single_loop(state, pz)


def _blank_regions_off(state, pz):
    """선도 단서도 없는 빈 영역은 비어 있어야 한다 (탐색 폭발 방지)."""
    parent = list(range(len(pz.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e, s in enumerate(state):
        if s == OFF:
            continue
        (r1, c1), (r2, c2) = pz.ends[e]
        a = find(r1 * (pz.C + 1) + c1)
        b = find(r2 * (pz.C + 1) + c2)
        if a != b:
            parent[b] = a

    has_on = set()
    for e, s in enumerate(state):
        if s == ON:
            (r1, c1), _ = pz.ends[e]
            has_on.add(find(r1 * (pz.C + 1) + c1))
    has_need = set()
    for idx, (es, k) in enumerate(pz.cells):
        if k is None or k <= 0:
            continue
        r, c = divmod(idx, pz.C)
        has_need.add(find(r * (pz.C + 1) + c))

    changed = False
    for e, s in enumerate(state):
        if s != UNKNOWN:
            continue
        (r1, c1), _ = pz.ends[e]
        root = find(r1 * (pz.C + 1) + c1)
        if root not in has_on and root not in has_need:
            state[e] = OFF
            changed = True
    return changed


def _closed_but_clue_left(state, pz):
    """이미 닫힌 고리가 있는데 아직 채워야 할 단서가 남아 있으면 모순."""
    deg = {}
    any_on = False
    for e, s in enumerate(state):
        if s != ON:
            continue
        any_on = True
        for v in pz.ends[e]:
            deg[v] = deg.get(v, 0) + 1
    if not any_on:
        return False
    if any(d == 1 for d in deg.values()):
        return False
    for es, k in pz.cells:
        if k is None or k < 0:
            continue
        on = sum(1 for e in es if state[e] == ON)
        if on != k:
            return True
    return False


def count_solutions(pz, limit=2, max_nodes=400000):
    """해의 개수를 센다 (limit 까지만). 반환: (count, nodes, exceeded)"""
    state = [UNKNOWN] * pz.N
    out = {"count": 0, "nodes": 0, "exceeded": False}
    cells = pz.cells
    clue_cells = [(es, k) for es, k in cells if k is not None and k >= 0]

    def search(st):
        if out["count"] >= limit:
            return
        out["nodes"] += 1
        if out["nodes"] > max_nodes:
            out["exceeded"] = True
            return
        if not propagate(st, pz):
            return
        if _blank_regions_off(st, pz):
            if not propagate(st, pz):
                return

        # 분기: 조합 수가 가장 적은 단서 칸
        best = None
        best_n = 99
        for es, k in clue_cells:
            on = 0
            unk = []
            for e in es:
                v = st[e]
                if v == ON:
                    on += 1
                elif v == UNKNOWN:
                    unk.append(e)
            if len(unk) < 2:
                continue
            need = k - on
            if need < 0 or need > len(unk):
                return
            combos = _ncr(len(unk), need)
            if combos < best_n:
                best_n = combos
                best = (unk, need)
                if combos == 2:
                    break

        if best is None:
            target = None
            for e in range(pz.N):
                if st[e] == UNKNOWN:
                    target = e
                    break
            if target is None:
                if is_valid(st, pz):
                    out["count"] += 1
                return
            a = st[:]
            a[target] = OFF
            search(a)
            if out["count"] >= limit or out["exceeded"]:
                return
            b = st[:]
            b[target] = ON
            search(b)
            return

        if _closed_but_clue_left(st, pz):
            return

        unk, need = best
        for chosen in itertools.combinations(unk, need):
            ns = st[:]
            cset = set(chosen)
            for e in unk:
                ns[e] = ON if e in cset else OFF
            search(ns)
            if out["count"] >= limit or out["exceeded"]:
                return

    search(state)
    return out["count"], out["nodes"], out["exceeded"]


def _ncr(n, r):
    if r < 0 or r > n:
        return 0
    return math.comb(n, r)


# ---------------------------------------------------------------- checks
def check_puzzle(pz, name, max_nodes=400000):
    """저장된 해답 검증 + 유일해 검증."""
    problems = []
    if pz.solution is not None:
        st = [OFF] * pz.N
        for e in pz.solution:
            st[e] = ON
        on_edges = sum(1 for x in st if x == ON)
        if on_edges != len(set(pz.solution)):
            problems.append("해답에 중복 엣지")
        if not clues_ok(st, pz):
            problems.append("해답이 단서를 만족하지 않음")
        if not is_single_loop(st, pz):
            problems.append("해답이 단일 고리가 아님")
    else:
        problems.append("해답 없음")

    cnt, nodes, exceeded = count_solutions(pz, limit=2, max_nodes=max_nodes)
    if exceeded:
        problems.append("탐색 한도 초과(미검증) nodes=%d" % nodes)
    elif cnt != 1:
        problems.append("유일해 아님 (해 %d개)" % cnt)
    return problems, cnt, nodes


def load_presets():
    src = open(os.path.join(ROOT, "js", "presets.js"), encoding="utf-8").read()
    m = re.search(r"window\.DF_PRESETS\s*=\s*(\{.*\});", src, re.S)
    if not m:
        raise SystemExit("presets.js 파싱 실패")
    return json.loads(m.group(1))


def from_json(p):
    return Puzzle(p["R"], p["C"], p["clues"], p.get("solution"))


def verify_presets(max_nodes=400000, bank_range=None, skip_stages=False):
    data = load_presets()
    rows = []
    ok = True
    for sid, p in ([] if skip_stages else sorted(data.get("stages", {}).items())):
        pz = from_json(p)
        probs, cnt, nodes = check_puzzle(pz, sid, max_nodes)
        print("  stage %s %dx%d solved=%d nodes=%d %s" % (sid, pz.R, pz.C, cnt, nodes, probs), flush=True)
        rows.append(("stage:" + sid, pz.R, p.get("meta", {}).get("difficulty", "?"),
                     p.get("meta", {}).get("clueCount", "?"), cnt, nodes, probs))
        ok = ok and not probs
    lo, hi = (0, 10 ** 9) if not bank_range else bank_range
    for i, p in enumerate(data.get("bank", [])):
        if not (lo <= i < hi):
            continue
        pz = from_json(p)
        probs, cnt, nodes = check_puzzle(pz, "bank%d" % i, max_nodes)
        print("  bank %d %dx%d solved=%d nodes=%d %s" % (i, pz.R, pz.C, cnt, nodes, probs), flush=True)
        rows.append(("bank:%02d" % i, pz.R, p.get("meta", {}).get("difficulty", "?"),
                     p.get("meta", {}).get("clueCount", "?"), cnt, nodes, probs))
        ok = ok and not probs
    return rows, ok


def verify_generator(sizes, diffs, budget_ms=12000, per=1):
    """브라우저에서 새로 생성한 퍼즐을 파이썬 솔버(독립 구현)로 검증."""
    from playwright.sync_api import sync_playwright
    sys.path.insert(0, os.path.join(ROOT, "verify"))
    from _serve import serve  # noqa

    port = 8781
    serve(ROOT, port)
    js = """
    ([R,C,diff,seed,budget]) => {
      DFGen.setTimeBudget(budget);
      var t0 = performance.now();
      var p = DFGen.generateSync(R,C,diff,seed);
      return p ? {ok:true, puzzle:p, ms: Math.round(performance.now()-t0)} : {ok:false};
    }
    """
    rows = []
    ok = True
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        pg = b.new_page()
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://127.0.0.1:%d/verify/harness.html" % port, wait_until="load")
        for size in sizes:
            for diff in diffs:
                for i in range(per):
                    seed = 1000 + size * 7 + i * 13
                    r = pg.evaluate(js, [size, size, diff, seed, budget_ms])
                    if not r.get("ok"):
                        rows.append(("gen:%dx%d/%s" % (size, size, diff), size, diff, "-", 0, 0, ["생성 실패"]))
                        ok = False
                        continue
                    pz = from_json(r["puzzle"])
                    probs, cnt, nodes = check_puzzle(pz, "gen", max_nodes=600000)
                    rows.append(("gen:%dx%d/%s" % (size, size, diff), size, diff,
                                 r["puzzle"]["meta"]["clueCount"], cnt, nodes,
                                 probs + ([] if r["ms"] < 40000 else ["생성 시간 초과"])))
                    if probs:
                        ok = False
        if errors:
            print("페이지 오류:", errors[:3])
        b.close()
    return rows, ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--presets", action="store_true")
    ap.add_argument("--gen-only", action="store_true")
    ap.add_argument("--budget", type=int, default=12000)
    ap.add_argument("--per", type=int, default=1)
    ap.add_argument("--bank-range", type=str, default="")
    ap.add_argument("--skip-stages", action="store_true")
    ap.add_argument("--sizes", type=str, default="5,7,10,12,15")
    args = ap.parse_args()

    all_ok = True
    if not args.gen_only:
        br = None
        if args.bank_range:
            a, b = args.bank_range.split(":")
            br = (int(a), int(b))
        rows, ok = verify_presets(bank_range=br, skip_stages=args.skip_stages)
        print("\n=== presets.js 검증 ===")
        print("%-14s %6s %8s %5s %5s %8s  %s" % ("puzzle", "size", "diff", "clue", "sol", "nodes", "problem"))
        for name, size, diff, clue, cnt, nodes, probs in rows:
            print("%-14s %6s %8s %5s %5s %8s  %s" % (name, "%dx%d" % (size, size), diff, clue, cnt, nodes,
                                                     ", ".join(probs) if probs else "OK"))
        print("프리셋:", "PASS" if ok else "FAIL")
        all_ok = all_ok and ok

    if not args.presets:
        sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
        rows, ok = verify_generator(sizes, ["easy", "normal", "hard"],
                                    budget_ms=args.budget, per=args.per)
        print("\n=== 생성기 검증 (JS 생성 → 파이썬 독립 솔버 검증) ===")
        print("%-20s %5s %8s %6s %8s  %s" % ("case", "size", "diff", "sol", "nodes", "problem"))
        for name, size, diff, clue, cnt, nodes, probs in rows:
            print("%-20s %5s %8s %6s %8s  %s" % (name, size, diff, cnt, nodes,
                                                 ", ".join(probs) if probs else "OK"))
        print("생성기:", "PASS" if ok else "FAIL")
        all_ok = all_ok and ok

    print("\nRESULT:", "PASS" if all_ok else "FAIL")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
