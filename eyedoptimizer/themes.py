"""Paletas claro / oscuro para EyedOptimizer."""

from __future__ import annotations

THEMES = {
    "dark": {
        "name": "Oscuro",
        "bg": "#0b1220",
        "surface": "#121a2b",
        "surface_alt": "#182338",
        "border": "#243049",
        "text": "#e8eef9",
        "text_muted": "#8b9bb8",
        "accent": "#2f9bff",
        "accent_hover": "#4aadff",
        "success": "#2ecc71",
        "warning": "#f0b429",
        "danger": "#ff5c6c",
        "cpu": "#2f9bff",
        "ram": "#5eead4",
        "disk": "#a78bfa",
        "net": "#fb923c",
        "sidebar": "#0a101c",
        "chart_grid": "#1e2a40",
        "row_alt": "#101827",
        "selection": "#1e3a5f",
        "ring_track": "#1e2a40",
    },
    "light": {
        "name": "Claro",
        "bg": "#e8edf4",
        "surface": "#ffffff",
        "surface_alt": "#f4f7fb",
        "border": "#d5dee9",
        "text": "#0f172a",
        "text_muted": "#64748b",
        "accent": "#1570ef",
        "accent_hover": "#0b5ed7",
        "success": "#16a34a",
        "warning": "#d97706",
        "danger": "#dc2626",
        "cpu": "#1570ef",
        "ram": "#0d9488",
        "disk": "#7c3aed",
        "net": "#ea580c",
        "sidebar": "#0f1b2d",
        "chart_grid": "#e2e8f0",
        "row_alt": "#f1f5f9",
        "selection": "#dbeafe",
        "ring_track": "#e2e8f0",
    },
}


def get_theme(mode: str) -> dict:
    return THEMES.get(mode, THEMES["dark"])
