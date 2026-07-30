"""Página de optimización de memoria y recursos."""

from __future__ import annotations

import threading
import tkinter.messagebox as messagebox

import customtkinter as ctk

from eyedoptimizer.services.ram_optimizer import OptimizeResult, RamOptimizer
from eyedoptimizer.services.system_monitor import SystemMonitor
from eyedoptimizer.ui.widgets import SectionHeader


class OptimizerPage(ctk.CTkFrame):
    def __init__(
        self,
        master,
        theme: dict,
        optimizer: RamOptimizer,
        monitor: SystemMonitor,
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self.theme = theme
        self.optimizer = optimizer
        self.monitor = monitor
        self._busy = False

        self.header = SectionHeader(
            self,
            "Optimizador",
            "Libera memoria RAM, reduce working sets y limpia temporales",
            theme,
        )
        self.header.pack(fill="x", padx=8, pady=(4, 16))

        self.hero = ctk.CTkFrame(
            self,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
        )
        self.hero.pack(fill="x", padx=8, pady=(0, 12))

        left = ctk.CTkFrame(self.hero, fg_color="transparent")
        left.pack(side="left", fill="both", expand=True, padx=20, pady=20)

        self.ram_big = ctk.CTkLabel(
            left,
            text="—",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=42, weight="bold"),
            text_color=theme["ram"],
            anchor="w",
        )
        self.ram_big.pack(fill="x")
        self.ram_sub = ctk.CTkLabel(
            left,
            text="Uso actual de memoria",
            font=ctk.CTkFont(family="Segoe UI", size=13),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.ram_sub.pack(fill="x", pady=(0, 12))
        self.ram_bar = ctk.CTkProgressBar(
            left, height=12, progress_color=theme["ram"], fg_color=theme["surface_alt"]
        )
        self.ram_bar.pack(fill="x")
        self.ram_bar.set(0)

        right = ctk.CTkFrame(self.hero, fg_color="transparent")
        right.pack(side="right", padx=20, pady=20)

        self.trim_var = ctk.BooleanVar(value=True)
        self.temp_var = ctk.BooleanVar(value=True)

        ctk.CTkCheckBox(
            right,
            text="Reducir working sets de procesos",
            variable=self.trim_var,
            font=ctk.CTkFont(size=13),
            text_color=theme["text"],
            fg_color=theme["accent"],
            hover_color=theme["accent_hover"],
        ).pack(anchor="w", pady=4)

        ctk.CTkCheckBox(
            right,
            text="Limpiar archivos temporales",
            variable=self.temp_var,
            font=ctk.CTkFont(size=13),
            text_color=theme["text"],
            fg_color=theme["accent"],
            hover_color=theme["accent_hover"],
        ).pack(anchor="w", pady=4)

        self.optimize_btn = ctk.CTkButton(
            right,
            text="Optimizar ahora",
            height=46,
            width=230,
            corner_radius=12,
            font=ctk.CTkFont(family="Segoe UI Semibold", size=15, weight="bold"),
            fg_color=theme["accent"],
            hover_color=theme["accent_hover"],
            command=self._on_optimize,
        )
        self.optimize_btn.pack(anchor="w", pady=(14, 0))

        self.status_lbl = ctk.CTkLabel(
            self,
            text="Listo para optimizar.",
            font=ctk.CTkFont(size=13),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.status_lbl.pack(fill="x", padx=12, pady=(0, 8))

        self.log_box = ctk.CTkTextbox(
            self,
            fg_color=theme["surface"],
            border_width=1,
            border_color=theme["border"],
            text_color=theme["text"],
            font=ctk.CTkFont(family="Consolas", size=12),
            corner_radius=12,
        )
        self.log_box.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.log_box.insert(
            "1.0",
            "EyedOptimizer — registro de optimización\n"
            "----------------------------------------\n"
            "Selecciona las opciones y pulsa «Optimizar ahora».\n",
        )
        self.log_box.configure(state="disabled")

        tips = ctk.CTkFrame(
            self,
            fg_color=theme["surface_alt"],
            corner_radius=12,
            border_width=1,
            border_color=theme["border"],
        )
        tips.pack(fill="x", padx=8, pady=(0, 4))
        ctk.CTkLabel(
            tips,
            text="Consejo: para liberar más memoria en procesos del sistema, ejecuta EyedOptimizer como administrador.",
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
            wraplength=900,
            justify="left",
        ).pack(padx=14, pady=10, anchor="w")

    def update_ram(self, used: int, total: int, percent: float) -> None:
        fmt = self.monitor.format_bytes
        self.ram_big.configure(text=f"{percent:.0f}%")
        self.ram_sub.configure(text=f"{fmt(used)} en uso de {fmt(total)} disponibles")
        self.ram_bar.set(percent / 100.0)

    def _on_optimize(self) -> None:
        if self._busy:
            return
        if not self.trim_var.get() and not self.temp_var.get():
            messagebox.showinfo("EyedOptimizer", "Selecciona al menos una opción.")
            return
        self._busy = True
        self.optimize_btn.configure(state="disabled", text="Optimizando…")
        self.status_lbl.configure(text="Optimización en curso…")

        def worker() -> None:
            result = self.optimizer.optimize(
                clean_temp=self.temp_var.get(),
                trim_processes=self.trim_var.get(),
            )
            self.after(0, lambda: self._finish(result))

        threading.Thread(target=worker, daemon=True).start()

    def _finish(self, result: OptimizeResult) -> None:
        self._busy = False
        self.optimize_btn.configure(state="normal", text="Optimizar ahora")
        self.status_lbl.configure(text=result.message)
        self._append_log(result)
        messagebox.showinfo("EyedOptimizer", result.message)

    def _append_log(self, result: OptimizeResult) -> None:
        fmt = self.monitor.format_bytes
        lines = [
            "",
            f"[{__import__('datetime').datetime.now().strftime('%H:%M:%S')}] {result.message}",
            f"  RAM antes: {fmt(result.ram_before)}  →  después: {fmt(result.ram_after)}",
            f"  Liberado: {fmt(result.freed_bytes)}",
            f"  Procesos ajustados: {result.processes_trimmed}",
            f"  Temporales eliminados: {result.temp_files_removed} ({fmt(result.temp_bytes_freed)})",
        ]
        for d in result.details:
            lines.append(f"  • {d}")
        self.log_box.configure(state="normal")
        self.log_box.insert("end", "\n".join(lines) + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.header.apply_theme(theme)
        self.hero.configure(fg_color=theme["surface"], border_color=theme["border"])
        self.ram_big.configure(text_color=theme["ram"])
        self.ram_sub.configure(text_color=theme["text_muted"])
        self.ram_bar.configure(progress_color=theme["ram"], fg_color=theme["surface_alt"])
        self.optimize_btn.configure(fg_color=theme["accent"], hover_color=theme["accent_hover"])
        self.status_lbl.configure(text_color=theme["text_muted"])
        self.log_box.configure(
            fg_color=theme["surface"],
            border_color=theme["border"],
            text_color=theme["text"],
        )
