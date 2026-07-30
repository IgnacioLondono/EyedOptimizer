"""Genera imágenes del asistente de instalación (Inno Setup)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _font(size: int):
    for name in (
        "segoeuib.ttf",
        "segoeui.ttf",
        "arialbd.ttf",
        "arial.ttf",
    ):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def make_wizard_large(path: Path) -> None:
    # Modern wizard side image ~164x314 (scaled for high DPI: 328x628)
    w, h = 328, 628
    img = Image.new("RGB", (w, h), (11, 18, 32))
    draw = ImageDraw.Draw(img)

    # Gradiente vertical
    for y in range(h):
        t = y / h
        r = int(11 + (21 - 11) * t)
        g = int(18 + (112 - 18) * t * 0.35)
        b = int(32 + (239 - 32) * t * 0.55)
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # Círculo ojo
    cx, cy, rad = w // 2, int(h * 0.32), 70
    draw.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=(47, 155, 255))
    draw.ellipse([cx - 42, cy - 42, cx + 42, cy + 42], outline=(255, 255, 255), width=5)
    draw.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], fill=(11, 18, 32))
    draw.ellipse([cx - 8, cy - 18, cx + 2, cy - 8], fill=(255, 255, 255))

    title = _font(28)
    sub = _font(16)
    draw.text((w // 2, int(h * 0.58)), "EyedOptimizer", fill=(255, 255, 255), font=title, anchor="mm")
    draw.text(
        (w // 2, int(h * 0.64)),
        "Rendimiento\ninteligente",
        fill=(200, 220, 255),
        font=sub,
        anchor="mm",
        align="center",
    )

    # Barras decorativas
    for i, color in enumerate([(47, 155, 255), (94, 234, 212), (167, 139, 250)]):
        y0 = int(h * 0.78) + i * 28
        draw.rounded_rectangle([40, y0, w - 40, y0 + 10], radius=5, fill=color)

    img.save(path, format="BMP")


def make_wizard_small(path: Path) -> None:
    size = 110
    img = Image.new("RGB", (size, size), (11, 18, 32))
    draw = ImageDraw.Draw(img)
    draw.ellipse([8, 8, size - 8, size - 8], fill=(47, 155, 255))
    draw.ellipse([28, 28, size - 28, size - 28], outline=(255, 255, 255), width=4)
    draw.ellipse([42, 42, size - 42, size - 42], fill=(11, 18, 32))
    draw.ellipse([48, 40, 58, 50], fill=(255, 255, 255))
    img.save(path, format="BMP")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    assets = root / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    make_wizard_large(assets / "wizard.bmp")
    make_wizard_small(assets / "wizard-small.bmp")
    print("Wizard images OK")
