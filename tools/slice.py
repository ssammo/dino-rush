"""Cut the dino reference images into frames and build one spritesheet per dino.

The original pixels are kept as they are: the white background is removed, the
edge pixels get a proper soft alpha (with the white taken back out of them),
and the frames are enlarged with plain bicubic resampling so the edges are
smooth instead of blocky. No sharpening, repainting or outline is applied.

usage: python slice.py <source_dir> <out_dir> [--contact]
  --contact  also write a labelled contact sheet of every detected frame
"""
import json
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

NAMES = {'1': 'rex', '2': 'crest', '3': 'bonehead', '7': 'tank', '8': 'spino', '12': 'sail', '14': 'dragon'}
# Image 13 is a pack of single, full-size characters: each one becomes its own sheet.
# Image 14 sits on a pale blue page instead of white.
PAGE = {'dragon': (205, 255, 254)}
PACK_KEY, PACK_DINOS, PACK_FOES = '13', ['raptor', 'trike', 'stego'], ['beaks']
ENEMIES = {'9': 'bats', '10': 'ptero', '11': 'wings'}      # enemy sheets: no big portrait is kept
# Screenshot UI badges to blank out, per image: (x0, y0, x1, y1), negatives count from the far edge.
BADGES = {
    'default': [(0, 0, 60, 34), (-66, -46, None, None)],
    'tank': [(0, 0, 195, 56), (-70, -62, None, None)],
    'spino': [(0, 0, 24, 12), (-48, -10, None, None)],
    'bats': [(0, -14, 14, None)],
    'ptero': [(14, 18, 52, 58)],
    'wings': [(0, 0, 60, 34), (-58, -34, None, None)],
    'sail': [],
    'dragon': [(0, 0, None, 6), (0, 0, 6, None), (0, -8, None, None), (-8, 0, None, None), (-70, -76, None, None)],
    'pack': [(0, 0, 56, 56), (-62, -62, None, None)],
}
UP = 3            # enlargement of the small frames (bicubic)
COLS = 6          # frames per spritesheet row


def remove_background(rgb, page=None):
    """Flood-fill near-white from the image border -> boolean background mask.
    White inside the dino (belly, eyes, claws) is enclosed by its outline and
    is not reached."""
    h, w, _ = rgb.shape
    if page is None:
        light = rgb.min(axis=2) >= 236
    else:
        light = np.abs(rgb - np.array(page, np.float32)).max(axis=2) <= 26
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        q.append((0, x)); q.append((h - 1, x))
    for y in range(h):
        q.append((y, 0)); q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if y < 0 or x < 0 or y >= h or x >= w or bg[y, x] or not light[y, x]:
            continue
        bg[y, x] = True
        q.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    return bg


def dilate(mask, n):
    out = mask.copy()
    for _ in range(n):
        m = out.copy()
        m[1:, :] |= out[:-1, :]; m[:-1, :] |= out[1:, :]
        m[:, 1:] |= out[:, :-1]; m[:, :-1] |= out[:, 1:]
        out = m
    return out


def components(mask):
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    boxes = []
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0, x0] or seen[y0, x0]:
                continue
            q = deque([(y0, x0)]); seen[y0, x0] = True
            x1 = x2 = x0; y1 = y2 = y0; area = 0
            while q:
                y, x = q.popleft(); area += 1
                x1 = min(x1, x); x2 = max(x2, x); y1 = min(y1, y); y2 = max(y2, y)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True; q.append((ny, nx))
            boxes.append((x1, y1, x2 + 1, y2 + 1, area))
    return boxes


def extract(path, name='default'):
    img = Image.open(path).convert('RGB')
    img = img.crop((3, 3, img.width - 3, img.height - 3))      # drop screenshot border
    rgb = np.asarray(img).astype(np.float32)
    h, w, _ = rgb.shape
    # blank the screenshot's UI badges (top-left crown, bottom-right button)
    for x0, y0, x1, y1 in BADGES.get(name, BADGES['default']):
        rgb[y0:y1, x0:x1] = PAGE.get(name, 255)
    page = PAGE.get(name)
    bg = remove_background(rgb, page)

    # Edge pixels (touching the background) are a blend of the dark outline and
    # the white page. Work out how much is dino (alpha) and take the white back
    # out of the colour, so no pale fringe is left around the cut-out.
    alpha = np.where(bg, 0.0, 1.0).astype(np.float32)
    edge = dilate(bg, 1) & ~bg
    paper = np.array(page if page else (255, 255, 255), np.float32)
    if page:
        a = np.clip(np.abs(rgb[edge] - paper).max(axis=1) / 110.0, 0.0, 1.0)
    else:
        a = np.clip((250.0 - rgb.min(axis=2)[edge]) / 150.0, 0.0, 1.0)
    alpha[edge] = a
    safe = np.maximum(a, 0.15)[:, None]
    rgb[edge] = np.clip((rgb[edge] - (1 - a[:, None]) * paper) / safe, 0, 255)

    # Where the blend is two pixels wide, the next pixel in is still a pale grey
    # mix. Treat it the same way, but only if it is colourless and sits behind a
    # mostly-transparent edge pixel (so white body parts behind a dark outline
    # are left alone).
    faint = np.zeros((h, w), bool); faint[edge] = a < 0.5
    lum, sat = rgb.min(axis=2), rgb.max(axis=2) - rgb.min(axis=2)
    ring2 = dilate(faint, 1) & ~bg & ~edge & (lum > 150) & (sat < 45) & (page is None)
    a2 = np.clip((265.0 - lum[ring2]) / 115.0, 0.0, 1.0)
    alpha[ring2] = a2
    rgb[ring2] = np.clip((rgb[ring2] - (1 - a2[:, None]) * 255.0) / np.maximum(a2, 0.3)[:, None], 0, 255)

    rgba = np.dstack([rgb, alpha * 255]).round().astype(np.uint8)
    sheet = Image.fromarray(rgba, 'RGBA')

    solid = alpha > 0.15
    boxes = [b for b in components(dilate(solid, 2)) if b[4] > 250]
    boxes.sort(key=lambda b: -b[4])
    if name in ('bats', 'pack', 'dragon'):
        boxes.insert(0, boxes[0])                    # no portrait in this image: keep every frame
    portrait, frames = boxes[0], boxes[1:]
    # small frames close to the big portrait can get lumped in with it:
    # keep just the largest single shape inside that box
    px1, py1, px2, py2, _ = portrait
    big = max(components(solid[py1:py2, px1:px2]), key=lambda c: c[4])
    portrait = (px1 + big[0], py1 + big[1], px1 + big[2], py1 + big[3], big[4])

    # a frame that touches the row above shows up as one tall blob: split it
    # at its emptiest scanline
    split = []
    for b in frames:
        x1, y1, x2, y2, area = b
        if y2 - y1 > 85 and name not in ('pack', 'dragon'):
            third = (y2 - y1) // 3
            fill = solid[y1 + third:y2 - third, x1:x2].sum(axis=1)
            cut_y = y1 + third + int(fill.argmin())
            for ya, yb in ((y1, cut_y), (cut_y, y2)):
                # keep only the biggest blob in each half (drops neighbours' scraps)
                sub = max(components(dilate(solid[ya:yb, x1:x2], 1)), key=lambda c: c[4])
                split.append((x1 + sub[0], ya + sub[1], x1 + sub[2], ya + sub[3], sub[4]))
        else:
            split.append(b)
    frames = split

    # group frames into rows by their feet (bottom edge)
    frames.sort(key=lambda b: b[3])
    rows, cur = [], [frames[0]]
    for b in frames[1:]:
        if b[3] - cur[-1][3] > 25:
            rows.append(cur); cur = [b]
        else:
            cur.append(b)
    rows.append(cur)
    for r in rows:
        r.sort(key=lambda b: b[0])
    cut = lambda b: sheet.crop(b[:4])
    return cut(portrait), [[(cut(b), b) for b in r] for r in rows]


def enlarge(frame, k):
    """Plain bicubic enlargement. Done on premultiplied alpha so transparent
    pixels cannot bleed a fringe into the edge."""
    size = (frame.width * k, frame.height * k)
    return frame.convert('RGBa').resize(size, Image.BICUBIC).convert('RGBA')


def contact(rows, out, S=4):
    cw = max(f.width for r in rows for f, _ in r) * S + 16
    ch = max(f.height for r in rows for f, _ in r) * S + 30
    im = Image.new('RGB', (cw * max(len(r) for r in rows), ch * len(rows)), (90, 140, 200))
    d = ImageDraw.Draw(im)
    for ry, r in enumerate(rows):
        for i, (f, b) in enumerate(r):
            big = enlarge(f, S)
            im.paste(big, (i * cw + 8, ry * ch + 24), big)
            d.text((i * cw + 8, ry * ch + 4), f'r{ry} #{i}  {f.width}x{f.height}', fill='white')
    im.save(out)


def head_y(frame):
    """Row of the head: the middle of the solid pixels in the right-most columns."""
    a = np.asarray(frame.split()[3]) > 128
    ys = np.nonzero(a[:, -14:].any(axis=1))[0]
    return int(ys.mean()) if len(ys) else frame.height // 2


def build(name, portrait, rows, mapping, out_dir, k=UP, pk=2, by_head=False):
    """Pack chosen frames into a grid of fixed cells, feet on a shared baseline."""
    chosen = [(anim, enlarge(rows[r][i][0], k)) for anim, ids in mapping.items() for r, i in ids]
    cw = max(f.width for _, f in chosen) + 8
    ch = max(f.height for _, f in chosen) + 8
    # A flyer's wings change its height every frame, so its frames are lined up
    # on the head (and the nose at the right edge) instead of on the feet.
    heads = [head_y(f) for _, f in chosen] if by_head else None
    if by_head:
        top = max(heads)
        ch = top + max(f.height - h for (_, f), h in zip(chosen, heads)) + 8
    n_rows = -(-len(chosen) // COLS)
    sheet = Image.new('RGBA', (cw * COLS, ch * n_rows), (0, 0, 0, 0))
    meta = {'cell': [cw, ch], 'cols': COLS, 'pad': 4,
            'stand': chosen[0][1].height, 'anims': {}}
    for n, (anim, f) in enumerate(chosen):
        cx, cy = (n % COLS) * cw, (n // COLS) * ch
        if by_head:
            sheet.paste(f, (cx + cw - f.width - 4, cy + 4 + top - heads[n]))
        else:
            sheet.paste(f, (cx + (cw - f.width) // 2, cy + ch - f.height - 4))
        meta['anims'].setdefault(anim, []).append(n)
    if by_head:
        meta['head'] = top + 4
    sheet.save(out_dir / f'{name}.png')
    if not name.startswith('foe_'):
        enlarge(portrait, pk).save(out_dir / f'{name}_portrait.png')
    return meta


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    mapping_file = Path(__file__).with_name('frames.json')
    mappings = json.loads(mapping_file.read_text()) if mapping_file.exists() else {}
    all_meta = {}
    for key, name in NAMES.items():
        if not (src / f'{key}.png').exists():
            continue
        portrait, rows = extract(src / f'{key}.png', name)
        print(name, 'rows:', [len(r) for r in rows])
        if '--contact' in sys.argv:
            contact(rows, out / f'_contact_{name}.png', S=1 if name == 'dragon' else 4)
        if name in mappings:
            if name == 'dragon':      # already full size; its picker picture is a flying frame
                all_meta[name] = build(name, rows[3][0][0], rows, mappings[name], out, k=1, pk=1, by_head=True)
            else:
                all_meta[name] = build(name, portrait, rows, mappings[name], out)
    foes = {}
    for key, name in ENEMIES.items():
        if not (src / f'{key}.png').exists():
            continue
        portrait, rows = extract(src / f'{key}.png', name)
        print(name, 'rows:', [len(r) for r in rows])
        if '--contact' in sys.argv:
            contact(rows, out / f'_contact_{name}.png')
        if name in mappings:
            foes[name] = build('foe_' + name, portrait, rows, mappings[name], out)
    if (src / f'{PACK_KEY}.png').exists():
        _, rows = extract(src / f'{PACK_KEY}.png', 'pack')
        print('pack rows:', [len(r) for r in rows])
        if '--contact' in sys.argv:
            contact(rows, out / '_contact_pack.png', S=1)
        for name in PACK_DINOS:
            if name in mappings:
                r, i = mappings[name]['idle'][0]
                all_meta[name] = build(name, rows[r][i][0], rows, mappings[name], out, k=1, pk=1)
        for name in PACK_FOES:
            if name in mappings:
                foes[name] = build('foe_' + name, None, rows, mappings[name], out, k=1)
    if foes:
        (out / 'enemies.js').write_text('window.ENEMIES = ' + json.dumps(foes, indent=1) + ';' + chr(10))
    if all_meta:
        text = 'window.DINOS = ' + json.dumps(all_meta, indent=1) + ';'
        (out / 'dinos.js').write_text(text + chr(10))


if __name__ == '__main__':
    main()
