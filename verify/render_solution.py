#!/usr/bin/env python3
"""스테이지 해답을 그림으로 렌더 (사진과 비교용)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_stages import load_presets, P, ROOT
from PIL import Image, ImageDraw

S = 100
PAD = 60


def render(sid, out):
    pres = load_presets()
    pz = pres['stages'][sid]
    p = P(pz['R'], pz['C'], pz['clues'], pz['solution'])
    W = p.C * S + PAD * 2
    H = p.R * S + PAD * 2
    im = Image.new('RGB', (W, H), (14, 15, 22))
    d = ImageDraw.Draw(im)
    for r in range(p.R + 1):
        for c in range(p.C + 1):
            x, y = PAD + c * S, PAD + r * S
            d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(90, 95, 110))
    for r in range(p.R):
        for c in range(p.C):
            k = p.clues[r][c]
            if k is None or k < 0:
                continue
            x, y = PAD + c * S + S // 2, PAD + r * S + S // 2
            d.text((x - 6, y - 8), str(k), fill=(233, 201, 135))
    for e in p.solution:
        a, b = p.ends(e)
        d.line([PAD + a[1] * S, PAD + a[0] * S, PAD + b[1] * S, PAD + b[0] * S],
               fill=(255, 190, 110), width=7)
    im.save(out)
    print('saved', out, im.size)


if __name__ == '__main__':
    render(sys.argv[1] if len(sys.argv) > 1 else 's2', sys.argv[2] if len(sys.argv) > 2 else '/tmp/s2.png')
