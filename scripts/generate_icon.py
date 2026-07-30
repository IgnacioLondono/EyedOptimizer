"""Genera assets/icon.ico para EyedOptimizer."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


def create_icon(dest: Path) -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images: list[Image.Image] = []

    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Fondo circular azul profesional
        margin = max(1, size // 16)
        draw.ellipse(
            [margin, margin, size - margin - 1, size - margin - 1],
            fill=(21, 112, 239, 255),
        )

        # Anillo interior (ojo)
        ring = size * 0.22
        draw.ellipse(
            [ring, ring, size - ring - 1, size - ring - 1],
            outline=(255, 255, 255, 230),
            width=max(1, size // 18),
        )

        # Pupila
        pupil = size * 0.36
        draw.ellipse(
            [pupil, pupil, size - pupil - 1, size - pupil - 1],
            fill=(11, 18, 32, 255),
        )

        # Brillo
        hi = size * 0.42
        hr = max(1, size // 12)
        draw.ellipse([hi, hi, hi + hr, hi + hr], fill=(255, 255, 255, 220))

        images.append(img)

    dest.parent.mkdir(parents=True, exist_ok=True)
    images[0].save(
        dest,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"Icono creado: {dest}")


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    create_icon(root / "assets" / "icon.ico")
