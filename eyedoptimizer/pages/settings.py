"""Ajustes: tema, intervalo y opciones de la aplicación."""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

import customtkinter as ctk

from eyedoptimizer import __version__
from eyedoptimizer.ui.widgets import SectionHeader


def settings_path() -> Path:
    base = Path(os.environ.get("APPDATA", Path.home())) / "EyedOptimizer"
    base.mkdir(parents=True, exist_ok=True)
    return base / "settings.json"


def load_settings() -> dict:
    defaults = {"theme": "dark", "refresh_ms": 800, "start_page": "dashboard"}
    path = settings_path()
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            defaults.update(data)
        except Exception:
            pass
    return defaults


def save_settings(data: dict) -> None:
    settings_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


class SettingsPage(ctk.CTkFrame):
    def __init__(self, master, theme: dict, settings: dict, on_theme_change, on_refresh_change, **kwargs) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self.theme = theme
        self.settings = settings
        self.on_theme_change = on_theme_change
        self.on_refresh_change = on_refresh_change

        self.header = SectionHeader(
            self,
            "Configuracion",
            "Personaliza el aspecto y la frecuencia de actualizacion",
            theme,
        )
        self.header.pack(fill="x", padx=4, pady=(0, 16))

        card = ctk.CTkFrame(
            self,
            fg_color=theme["surface"],
            corner_radius=14,
            border_width=1,
            border_color=theme["border"],
        )
        card.pack(fill="x", padx=4, pady=4)

        row1 = ctk.CTkFrame(card, fg_color="transparent")
        row1.pack(fill="x", padx=20, pady=(18, 10))
        ctk.CTkLabel(
            row1,
            text="Tema de la interfaz",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=theme["text"],
        ).pack(anchor="w")
        ctk.CTkLabel(
            row1,
            text="Elige entre modo claro u oscuro",
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
        ).pack(anchor="w", pady=(2, 8))

        self.theme_var = ctk.StringVar(value=settings.get("theme", "dark"))
        theme_switch = ctk.CTkSegmentedButton(
            row1,
            values=["Oscuro", "Claro"],
            command=self._theme_selected,
            font=ctk.CTkFont(size=13, weight="bold"),
            selected_color=theme["accent"],
            selected_hover_color=theme["accent_hover"],
        )
        theme_switch.pack(anchor="w")
        theme_switch.set("Oscuro" if self.theme_var.get() == "dark" else "Claro")
        self.theme_switch = theme_switch

        row2 = ctk.CTkFrame(card, fg_color="transparent")
        row2.pack(fill="x", padx=20, pady=10)
        ctk.CTkLabel(
            row2,
            text="Intervalo de actualizacion (panel)",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=theme["text"],
        ).pack(anchor="w")
        self.refresh_lbl = ctk.CTkLabel(
            row2,
            text=f"{settings.get('refresh_ms', 800)} ms  ·  Modo juegos siempre a 500 ms",
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
        )
        self.refresh_lbl.pack(anchor="w", pady=(2, 8))
        self.refresh_slider = ctk.CTkSlider(
            row2,
            from_=400,
            to=3000,
            number_of_steps=26,
            command=self._refresh_changed,
            progress_color=theme["accent"],
            button_color=theme["accent"],
            button_hover_color=theme["accent_hover"],
            width=320,
        )
        self.refresh_slider.set(settings.get("refresh_ms", 800))
        self.refresh_slider.pack(anchor="w", pady=(0, 18))

        about = ctk.CTkFrame(
            self,
            fg_color=theme["surface"],
            corner_radius=14,
            border_width=1,
            border_color=theme["border"],
        )
        about.pack(fill="x", padx=4, pady=12)
        ctk.CTkLabel(
            about,
            text="Acerca de EyedOptimizer",
            font=ctk.CTkFont(size=14, weight="bold"),
            text_color=theme["text"],
        ).pack(anchor="w", padx=20, pady=(16, 4))
        self.about_lbl = ctk.CTkLabel(
            about,
            text=(
                f"Version {__version__}\n"
                "Monitorizacion, optimizacion y modo juegos con telemetria GPU.\n"
                "Detecta marca/modelo del equipo y el sistema operativo."
            ),
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
            justify="left",
            anchor="w",
        )
        self.about_lbl.pack(anchor="w", padx=20, pady=(0, 8))
        self.hw_lbl = ctk.CTkLabel(
            about,
            text="Detectando hardware…",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=theme["text"],
            justify="left",
            anchor="w",
        )
        self.hw_lbl.pack(anchor="w", padx=20, pady=(0, 16))

        self._card = card
        self._about = about
        self.after(150, self._load_hw)

    def _load_hw(self) -> None:
        def worker() -> None:
            from eyedoptimizer.services.hardware_info import get_hardware_info
            from eyedoptimizer.services.gpu_monitor import GpuMonitor

            hw = get_hardware_info()
            gpu = GpuMonitor().snapshot(min_interval=0)
            text = f"{hw.brand_model} · {hw.device_type}\n{hw.os_full}"
            if gpu.name:
                text += f"\n{gpu.name}"
            try:
                self.after(0, lambda: self.hw_lbl.configure(text=text))
            except Exception:
                pass

        threading.Thread(target=worker, daemon=True).start()

    def _theme_selected(self, value: str) -> None:
        mode = "dark" if value == "Oscuro" else "light"
        self.settings["theme"] = mode
        save_settings(self.settings)
        self.on_theme_change(mode)

    def _refresh_changed(self, value: float) -> None:
        ms = int(round(value / 100.0) * 100)
        ms = max(400, min(3000, ms))
        self.refresh_lbl.configure(text=f"{ms} ms  ·  Modo juegos siempre a 500 ms")
        self.settings["refresh_ms"] = ms
        save_settings(self.settings)
        self.on_refresh_change(ms)

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.header.apply_theme(theme)
        self._card.configure(fg_color=theme["surface"], border_color=theme["border"])
        self._about.configure(fg_color=theme["surface"], border_color=theme["border"])
        self.theme_switch.configure(
            selected_color=theme["accent"],
            selected_hover_color=theme["accent_hover"],
        )
        self.refresh_slider.configure(
            progress_color=theme["accent"],
            button_color=theme["accent"],
            button_hover_color=theme["accent_hover"],
        )
        self.about_lbl.configure(text_color=theme["text_muted"])
        self.hw_lbl.configure(text_color=theme["text"])
