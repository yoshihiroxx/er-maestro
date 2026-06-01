"""Generate the er-maestro brand icon as a 1024x1024 PNG.

Run from anywhere; writes ``logo-source.png`` next to this file. The result is
fed into ``cargo tauri icon`` to materialize every platform-specific size.
"""

from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 1024
OUT = Path(__file__).resolve().parent / "logo-source.png"

BG_TOP = (29, 78, 216)      # #1D4EAD8 (deep blue)
BG_BOT = (15, 41, 122)      # darker blue for a subtle vertical fade
CARD = (248, 250, 252)      # near-white (#F8FAFC)
CARD_HEADER = (96, 165, 250)  # accent blue (#60A5FA)
ROW = (148, 163, 184)       # slate-400 for column lines
LINK = (250, 204, 21)       # amber-400 — relation line / diamond


def vertical_gradient(w: int, h: int, top: tuple, bot: tuple) -> Image.Image:
    base = Image.new("RGB", (w, h), top)
    px = base.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px[0, y] = (
            int(top[0] * (1 - t) + bot[0] * t),
            int(top[1] * (1 - t) + bot[1] * t),
            int(top[2] * (1 - t) + bot[2] * t),
        )
    # broadcast the single column across every row
    col = base.crop((0, 0, 1, h)).resize((w, h))
    return col


def rounded_mask(w: int, h: int, radius: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    return mask


def draw_table_card(canvas: Image.Image, x: int, y: int, w: int, h: int) -> None:
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    radius = int(w * 0.12)
    # body
    d.rounded_rectangle((0, 0, w, h), radius=radius, fill=CARD + (255,))
    # header band — only top corners rounded; bottom edge straight.
    header_h = int(h * 0.22)
    band = Image.new("RGBA", (w, header_h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    bd.rounded_rectangle((0, 0, w, header_h), radius=radius, fill=CARD_HEADER + (255,))
    # cover the rounded bottom so it tucks under the body cleanly
    bd.rectangle((0, header_h // 2, w, header_h), fill=CARD_HEADER + (255,))
    card.alpha_composite(band, (0, 0))
    # column rows
    rows = 4
    row_h = int(h * 0.10)
    row_gap = int(h * 0.04)
    row_x = int(w * 0.14)
    row_w = int(w * 0.72)
    start_y = header_h + int(h * 0.08)
    for i in range(rows):
        ry = start_y + i * (row_h + row_gap)
        d.rounded_rectangle(
            (row_x, ry, row_x + row_w, ry + row_h),
            radius=row_h // 2,
            fill=ROW + (255,),
        )
    canvas.alpha_composite(card, (x, y))


def draw_relation(canvas: Image.Image, left_anchor, right_anchor) -> None:
    d = ImageDraw.Draw(canvas)
    x1, y1 = left_anchor
    x2, y2 = right_anchor
    line_w = 18
    d.line((x1, y1, x2, y2), fill=LINK + (255,), width=line_w)
    # crow's-foot-ish diamond endpoints
    diamond = 38
    for cx, cy in (left_anchor, right_anchor):
        d.polygon(
            [
                (cx, cy - diamond),
                (cx + diamond, cy),
                (cx, cy + diamond),
                (cx - diamond, cy),
            ],
            fill=LINK + (255,),
        )


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)

    # full-bleed gradient backdrop
    bg = vertical_gradient(SIZE, SIZE, BG_TOP, BG_BOT).convert("RGBA")

    # mask the whole icon with a rounded square so OS-side squircle masks
    # don't bite into important content. ~18% radius matches iOS-ish curves.
    mask = rounded_mask(SIZE, SIZE, radius=int(SIZE * 0.18))
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(bg, (0, 0), mask)

    # two table cards
    card_w, card_h = 360, 460
    gap = 140
    total_w = card_w * 2 + gap
    x_left = (SIZE - total_w) // 2
    y_top = (SIZE - card_h) // 2 + 20
    draw_table_card(canvas, x_left, y_top, card_w, card_h)
    draw_table_card(canvas, x_left + card_w + gap, y_top, card_w, card_h)

    # relation line between the right edge of left card and left edge of right card
    left_anchor = (x_left + card_w, y_top + card_h // 2)
    right_anchor = (x_left + card_w + gap, y_top + card_h // 2)
    draw_relation(canvas, left_anchor, right_anchor)

    canvas.save(OUT, format="PNG")
    print(f"wrote {OUT} ({SIZE}x{SIZE} RGBA)")


if __name__ == "__main__":
    main()
