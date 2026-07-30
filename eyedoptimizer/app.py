"""Ventana principal de EyedOptimizer."""

from __future__ import annotations

import sys
import threading
from pathlib import Path

import customtkinter as ctk

from eyedoptimizer import __app_name__, __version__
from eyedoptimizer.pages.dashboard import DashboardPage
from eyedoptimizer.pages.games import GamesPage
from eyedoptimizer.pages.optimizer import OptimizerPage
from eyedoptimizer.pages.settings import SettingsPage, load_settings
from eyedoptimizer.pages.task_manager import TaskManagerPage
from eyedoptimizer.services.gpu_monitor import GpuMonitor
from eyedoptimizer.services.hardware_info import get_hardware_info
from eyedoptimizer.services.process_manager import ProcessManager
from eyedoptimizer.services.ram_optimizer import RamOptimizer
from eyedoptimizer.services.system_monitor import SystemMonitor
from eyedoptimizer.themes import get_theme
from eyedoptimizer.ui.widgets import SidebarButton


class EyedOptimizerApp(ctk.CTk):
    def __init__(self) -> None:
        super().__init__()

        self.settings = load_settings()
        self.theme_mode = self.settings.get("theme", "dark")
        self.theme = get_theme(self.theme_mode)
        # Actualizaciones constantes por defecto
        self.refresh_ms = int(self.settings.get("refresh_ms", 800))
        self._task_refresh_every = 2
        self._tick_count = 0

        ctk.set_appearance_mode("dark" if self.theme_mode == "dark" else "light")
        ctk.set_default_color_theme("blue")

        self.title(f"{__app_name__} {__version__}")
        self.geometry("1280x780")
        self.minsize(1080, 660)
        self.configure(fg_color=self.theme["bg"])

        icon = self._resolve_icon()
        if icon:
            try:
                self.iconbitmap(icon)
            except Exception:
                pass

        self.monitor = SystemMonitor()
        self.gpu = GpuMonitor()
        self.optimizer = RamOptimizer()
        self.process_manager = ProcessManager()

        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(0, weight=1)

        self._build_sidebar()
        self._build_content()

        self.current_page = "dashboard"
        self.show_page("dashboard")
        self.after(120, self._update_device_chip)
        self._tick()

    def _resolve_icon(self) -> str | None:
        meipass = getattr(sys, "_MEIPASS", None)
        candidates = []
        if meipass:
            candidates.append(Path(meipass) / "assets" / "icon.ico")
        candidates.append(Path(__file__).resolve().parent.parent / "assets" / "icon.ico")
        for path in candidates:
            if path.is_file():
                return str(path)
        return None

    def _build_sidebar(self) -> None:
        self.sidebar = ctk.CTkFrame(
            self,
            width=210,
            corner_radius=0,
            fg_color=self.theme["sidebar"],
        )
        self.sidebar.grid(row=0, column=0, sticky="nsw")
        self.sidebar.grid_propagate(False)

        brand = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        brand.pack(fill="x", padx=16, pady=(22, 8))

        self.logo_badge = ctk.CTkFrame(
            brand,
            width=40,
            height=40,
            corner_radius=10,
            fg_color=self.theme["accent"],
        )
        self.logo_badge.pack(anchor="w")
        self.logo_badge.pack_propagate(False)
        ctk.CTkLabel(
            self.logo_badge,
            text="EO",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=14, weight="bold"),
            text_color="#ffffff",
        ).place(relx=0.5, rely=0.5, anchor="center")

        self.brand_title = ctk.CTkLabel(
            brand,
            text="EyedOptimizer",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=16, weight="bold"),
            text_color="#ffffff",
            anchor="w",
        )
        self.brand_title.pack(fill="x", pady=(10, 0))
        ctk.CTkLabel(
            brand,
            text="Rendimiento inteligente",
            font=ctk.CTkFont(size=11),
            text_color="#8b9bb8",
            anchor="w",
        ).pack(fill="x")

        self.device_chip = ctk.CTkLabel(
            self.sidebar,
            text="Detectando equipo…",
            font=ctk.CTkFont(size=11),
            text_color="#a8b8d4",
            fg_color="#152238",
            corner_radius=10,
            padx=10,
            pady=8,
            wraplength=170,
            justify="left",
            anchor="w",
        )
        self.device_chip.pack(fill="x", padx=14, pady=(16, 4))

        nav = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        nav.pack(fill="x", padx=12, pady=(18, 8))

        self.nav_buttons: dict[str, SidebarButton] = {}
        items = [
            ("dashboard", "Inicio"),
            ("optimizer", "Optimizar"),
            ("games", "Modo juegos"),
            ("tasks", "Procesos"),
            ("settings", "Ajustes"),
        ]
        for key, label in items:
            btn = SidebarButton(
                nav,
                text=f"  {label}",
                command=lambda k=key: self.show_page(k),
                theme=self.theme,
                active=key == "dashboard",
            )
            btn.pack(fill="x", pady=3)
            self.nav_buttons[key] = btn

        foot = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        foot.pack(side="bottom", fill="x", padx=14, pady=14)
        self.side_status = ctk.CTkLabel(
            foot,
            text="Monitor activo",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=self.theme["success"],
            anchor="w",
        )
        self.side_status.pack(fill="x")
        ctk.CTkLabel(
            foot,
            text=f"v{__version__}",
            font=ctk.CTkFont(size=10),
            text_color="#6b7c99",
            anchor="w",
        ).pack(fill="x", pady=(2, 0))

    def _update_device_chip(self) -> None:
        def worker() -> None:
            hw = get_hardware_info()
            text = f"{hw.manufacturer}\n{hw.model}\n{hw.device_type}"
            try:
                self.after(0, lambda: self.device_chip.configure(text=text))
            except Exception:
                pass

        threading.Thread(target=worker, daemon=True).start()

    def _build_content(self) -> None:
        self.content = ctk.CTkFrame(self, fg_color=self.theme["bg"], corner_radius=0)
        self.content.grid(row=0, column=1, sticky="nsew")
        self.content.grid_columnconfigure(0, weight=1)
        self.content.grid_rowconfigure(0, weight=1)

        self.pages: dict[str, ctk.CTkFrame] = {}
        self.pages["dashboard"] = DashboardPage(
            self.content,
            self.theme,
            self.monitor,
            self.gpu,
            on_refresh=self.force_refresh,
        )
        self.pages["optimizer"] = OptimizerPage(
            self.content, self.theme, self.optimizer, self.monitor
        )
        self.pages["games"] = GamesPage(self.content, self.theme, self.monitor, self.gpu)
        self.pages["tasks"] = TaskManagerPage(self.content, self.theme, self.process_manager)
        self.pages["settings"] = SettingsPage(
            self.content,
            self.theme,
            self.settings,
            on_theme_change=self.set_theme,
            on_refresh_change=self.set_refresh,
        )

        for page in self.pages.values():
            page.grid(row=0, column=0, sticky="nsew", padx=20, pady=16)

    def show_page(self, key: str) -> None:
        if key == self.current_page:
            return
        prev = self.current_page
        self.current_page = key
        # tkraise es casi instantaneo (sin recalcular layout)
        self.pages[key].tkraise()
        self.nav_buttons[prev].set_active(False, self.theme)
        self.nav_buttons[key].set_active(True, self.theme)
        if key == "tasks":
            self.after_idle(self.pages["tasks"].refresh)

    def set_theme(self, mode: str) -> None:
        self.theme_mode = mode
        self.theme = get_theme(mode)
        ctk.set_appearance_mode("dark" if mode == "dark" else "light")
        self.configure(fg_color=self.theme["bg"])
        self.content.configure(fg_color=self.theme["bg"])
        self.sidebar.configure(fg_color=self.theme["sidebar"])
        self.logo_badge.configure(fg_color=self.theme["accent"])
        self.side_status.configure(text_color=self.theme["success"])
        # Solo tema de la pagina visible (mucho mas rapido)
        page = self.pages.get(self.current_page)
        if page and hasattr(page, "apply_theme"):
            page.apply_theme(self.theme)
        for name, btn in self.nav_buttons.items():
            btn.set_active(name == self.current_page, self.theme)
        # Resto de paginas en segundo plano
        self.after(50, self._apply_theme_hidden)

    def _apply_theme_hidden(self) -> None:
        for name, page in self.pages.items():
            if name == self.current_page:
                continue
            if hasattr(page, "apply_theme"):
                try:
                    page.apply_theme(self.theme)
                except Exception:
                    pass

    def set_refresh(self, ms: int) -> None:
        self.refresh_ms = max(400, min(5000, int(ms)))

    def force_refresh(self) -> None:
        self._tick_once()

    def _tick_interval(self) -> int:
        page = self.current_page
        if page == "games":
            return 500
        if page == "tasks":
            return 1200
        if page == "settings":
            return 2000
        return self.refresh_ms

    def _tick_once(self) -> None:
        page = self.current_page
        # En ajustes casi no hace falta muestrear todo
        if page == "settings":
            snap = self.monitor.snapshot()
            self.side_status.configure(
                text=f"CPU {snap.cpu_percent:.0f}%  ·  RAM {snap.ram_percent:.0f}%"
            )
            return

        snap = self.monitor.snapshot()
        self.side_status.configure(
            text=f"CPU {snap.cpu_percent:.0f}%  ·  RAM {snap.ram_percent:.0f}%"
        )
        self._tick_count += 1

        if page == "dashboard":
            self.pages["dashboard"].update_snapshot(snap)
        elif page == "optimizer":
            self.pages["optimizer"].update_ram(snap.ram_used, snap.ram_total, snap.ram_percent)
        elif page == "games":
            self.pages["games"].update_live(snap)
        elif page == "tasks":
            # Refresco de procesos cada ~3.6 s y solo si no hay uno en curso
            if self._tick_count % 3 == 0:
                self.pages["tasks"].refresh()

    def _tick(self) -> None:
        try:
            self._tick_once()
        except Exception:
            pass
        self.after(self._tick_interval(), self._tick)


def run() -> None:
    app = EyedOptimizerApp()
    app.mainloop()
