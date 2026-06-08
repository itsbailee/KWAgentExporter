from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
iconset = root / "assets" / "AppIcon.iconset"
iconset.mkdir(parents=True, exist_ok=True)

sizes = [
    (16, "icon_16x16.png"),
    (32, "icon_16x16@2x.png"),
    (32, "icon_32x32.png"),
    (64, "icon_32x32@2x.png"),
    (128, "icon_128x128.png"),
    (256, "icon_128x128@2x.png"),
    (256, "icon_256x256.png"),
    (512, "icon_256x256@2x.png"),
    (512, "icon_512x512.png"),
    (1024, "icon_512x512@2x.png"),
]

def font(size, bold=True):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    return ImageFont.load_default()

def rounded_rect(draw, xy, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

master = None

for px, name in sizes:
    scale = px / 1024
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    rounded_rect(d, (int(74*scale), int(74*scale), int(950*scale), int(950*scale)), int(210*scale), (177, 1, 78, 255))
    rounded_rect(d, (int(118*scale), int(118*scale), int(906*scale), int(906*scale)), int(170*scale), (206, 1, 31, 255))

    # White document sheet.
    rounded_rect(d, (int(282*scale), int(190*scale), int(742*scale), int(828*scale)), int(52*scale), (255, 255, 255, 255))
    d.polygon(
        [
            (int(628*scale), int(190*scale)),
            (int(742*scale), int(304*scale)),
            (int(628*scale), int(304*scale)),
        ],
        fill=(229, 232, 239, 255),
    )

    # Contact avatar and CSV rows.
    d.ellipse((int(380*scale), int(284*scale), int(506*scale), int(410*scale)), fill=(58, 61, 80, 255))
    d.rounded_rectangle((int(342*scale), int(440*scale), int(544*scale), int(542*scale)), radius=int(52*scale), fill=(58, 61, 80, 255))

    row_color = (177, 1, 78, 255)
    for y in (584, 664, 744):
        rounded_rect(d, (int(334*scale), int(y*scale), int(690*scale), int((y+34)*scale)), int(17*scale), row_color)

    # Small CSV badge.
    rounded_rect(d, (int(560*scale), int(650*scale), int(820*scale), int(820*scale)), int(52*scale), (58, 61, 80, 255))
    text = "CSV"
    f = font(max(18, int(70*scale)))
    box = d.textbbox((0, 0), text, font=f)
    tx = int(690*scale) - (box[2] - box[0]) // 2
    ty = int(735*scale) - (box[3] - box[1]) // 2 - int(6*scale)
    d.text((tx, ty), text, font=f, fill=(255, 255, 255, 255))

    img.save(iconset / name)
    if px == 1024:
        master = img

if master:
    master.save(root / "assets" / "AppIcon.png")

print(iconset)
