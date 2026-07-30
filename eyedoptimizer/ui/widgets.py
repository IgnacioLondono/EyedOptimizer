"""Widgets limpios estilo panel profesional (sin emojis ni iconos)."""

from __future__ import annotations

import tkinter as tk

import customtkinter as ctk


class RingGauge(ctk.CTkFrame):
    """Anillo de progreso circular tipo panel de fabricante."""

    def __init__(
        self,
        master,
        theme: dict,
        accent: str,
        size: int = 140,
        thickness: int = 10,
        label: str = "",
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", width=size, height=size + 36, **kwargs)
        self.theme = theme
        self.accent = accent
        self.size = size
        self.thickness = thickness
        self._value = 0.0

        self.wrap = ctk.CTkFrame(self, fg_color=theme["surface"], width=size, height=size, corner_radius=0)
        self.wrap.pack()
        self.wrap.pack_propagate(False)

        self.canvas = tk.Canvas(
            self.wrap,
            width=size,
            height=size,
            bg=theme["surface"],
            highlightthickness=0,
            bd=0,
        )
        self.canvas.place(x=0, y=0)

        self.value_lbl = ctk.CTkLabel(
            self.wrap,
            text="0%",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=22, weight="bold"),
            text_color=theme["text"],
            fg_color="transparent",
        )
        self.value_lbl.place(relx=0.5, rely=0.5, anchor="center")

        self.caption = ctk.CTkLabel(
            self,
            text=label,
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=theme["text_muted"],
        )
        self.caption.pack(pady=(4, 0))
        self._render_ring(0)

    def _render_ring(self, ratio: float) -> None:
        self.canvas.delete("all")
        pad = self.thickness + 2
        x0, y0, x1, y1 = pad, pad, self.size - pad, self.size - pad
        track = self.theme.get("ring_track", self.theme["border"])
        self.canvas.create_oval(x0, y0, x1, y1, outline=track, width=self.thickness)
        extent = -max(0.0, min(1.0, ratio)) * 360
        if abs(extent) > 0.5:
            self.canvas.create_arc(
                x0,
                y0,
                x1,
                y1,
                start=90,
                extent=extent,
                style="arc",
                outline=self.accent,
                width=self.thickness,
            )

    def set_value(self, percent: float, center_text: str | None = None) -> None:
        ratio = max(0.0, min(100.0, percent)) / 100.0
        text = center_text if center_text is not None else f"{percent:.0f}%"
        if abs(ratio - self._value) < 0.002 and text == getattr(self, "_last_text", None):
            return
        self._value = ratio
        self._last_text = text
        self._render_ring(ratio)
        self.value_lbl.configure(text=text)

    def apply_theme(self, theme: dict, accent: str | None = None) -> None:
        self.theme = theme
        if accent:
            self.accent = accent
        self.wrap.configure(fg_color=theme["surface"])
        self.canvas.configure(bg=theme["surface"])
        self.value_lbl.configure(text_color=theme["text"])
        self.caption.configure(text_color=theme["text_muted"])
        self._render_ring(self._value)


class MetricCard(ctk.CTkFrame):
    def __init__(self, master, title: str, accent: str, theme: dict, **kwargs) -> None:
        super().__init__(master, fg_color=theme["surface"], corner_radius=14, **kwargs)
        self.theme = theme
        self.accent = accent
        self.configure(border_width=1, border_color=theme["border"])

        self.accent_bar = ctk.CTkFrame(self, height=3, corner_radius=0, fg_color=accent)
        self.accent_bar.pack(fill="x")

        self.title_lbl = ctk.CTkLabel(
            self,
            text=title.upper(),
            font=ctk.CTkFont(family="Segoe UI", size=11, weight="bold"),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.title_lbl.pack(fill="x", padx=16, pady=(14, 2))

        self.value_lbl = ctk.CTkLabel(
            self,
            text="—",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=28, weight="bold"),
            text_color=theme["text"],
            anchor="w",
        )
        self.value_lbl.pack(fill="x", padx=16, pady=(0, 2))

        self.sub_lbl = ctk.CTkLabel(
            self,
            text="",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.sub_lbl.pack(fill="x", padx=16, pady=(0, 8))

        self.bar = ctk.CTkProgressBar(
            self,
            height=7,
            corner_radius=4,
            progress_color=accent,
            fg_color=theme["surface_alt"],
        )
        self.bar.pack(fill="x", padx=16, pady=(0, 16))
        self.bar.set(0)
        self._last = ("", "", -1.0)

    def update_metric(self, value_text: str, subtitle: str, ratio: float) -> None:
        ratio = max(0.0, min(1.0, ratio))
        key = (value_text, subtitle, round(ratio, 3))
        if key == self._last:
            return
        self._last = key
        self.value_lbl.configure(text=value_text)
        self.sub_lbl.configure(text=subtitle)
        self.bar.set(ratio)

    def apply_theme(self, theme: dict, accent: str | None = None) -> None:
        self.theme = theme
        if accent:
            self.accent = accent
        self.configure(fg_color=theme["surface"], border_color=theme["border"])
        self.accent_bar.configure(fg_color=self.accent)
        self.title_lbl.configure(text_color=theme["text_muted"])
        self.value_lbl.configure(text_color=theme["text"])
        self.sub_lbl.configure(text_color=theme["text_muted"])
        self.bar.configure(progress_color=self.accent, fg_color=theme["surface_alt"])


class DeviceBanner(ctk.CTkFrame):
    """Tarjeta de equipo estilo panel de fabricante."""

    def __init__(self, master, theme: dict, **kwargs) -> None:
        super().__init__(
            master,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
            **kwargs,
        )
        self.theme = theme

        body = ctk.CTkFrame(self, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=18, pady=16)

        left = ctk.CTkFrame(body, fg_color="transparent")
        left.pack(side="left", fill="both", expand=True)

        self.brand_lbl = ctk.CTkLabel(
            left,
            text="Detectando equipo…",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=22, weight="bold"),
            text_color=theme["text"],
            anchor="w",
        )
        self.brand_lbl.pack(fill="x")

        self.type_chip = ctk.CTkFrame(left, fg_color=theme["accent"], corner_radius=8)
        self.type_chip.pack(anchor="w", pady=(8, 0))
        self.type_chip_lbl = ctk.CTkLabel(
            self.type_chip,
            text="Equipo",
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color="#ffffff",
        )
        self.type_chip_lbl.pack(padx=10, pady=3)

        self.os_lbl = ctk.CTkLabel(
            left,
            text="",
            font=ctk.CTkFont(family="Segoe UI", size=13),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.os_lbl.pack(fill="x", pady=(12, 0))

        self.cpu_lbl = ctk.CTkLabel(
            left,
            text="",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.cpu_lbl.pack(fill="x", pady=(4, 0))

        self.gpu_lbl = ctk.CTkLabel(
            left,
            text="",
            font=ctk.CTkFont(family="Segoe UI", size=12),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.gpu_lbl.pack(fill="x", pady=(2, 0))

        right = ctk.CTkFrame(body, fg_color=theme["surface_alt"], corner_radius=12)
        right.pack(side="right", padx=(14, 0))
        self.right = right

        self.stat_labels: dict[str, ctk.CTkLabel] = {}
        for key, label in (("hostname", "Nombre"), ("serial", "Serie"), ("bios", "BIOS")):
            box = ctk.CTkFrame(right, fg_color="transparent")
            box.pack(fill="x", padx=14, pady=7)
            ctk.CTkLabel(
                box,
                text=label,
                font=ctk.CTkFont(size=10, weight="bold"),
                text_color=theme["text_muted"],
                anchor="w",
            ).pack(fill="x")
            val = ctk.CTkLabel(
                box,
                text="—",
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=theme["text"],
                anchor="w",
            )
            val.pack(fill="x")
            self.stat_labels[key] = val

        self.copy_btn = ctk.CTkButton(
            right,
            text="Copiar todo",
            height=28,
            fg_color="transparent",
            hover_color=theme["border"],
            text_color=theme["accent"],
            font=ctk.CTkFont(size=12, weight="bold"),
            command=self._copy,
        )
        self.copy_btn.pack(padx=10, pady=(4, 12), anchor="w")
        self._copy_text = ""

    def update_info(self, hw, gpu_name: str = "") -> None:
        self.brand_lbl.configure(text=hw.brand_model)
        self.type_chip_lbl.configure(text=hw.device_type)
        self.type_chip.configure(fg_color=self.theme["accent"])
        self.os_lbl.configure(text=hw.os_full)
        cpu = hw.cpu_name
        if len(cpu) > 72:
            cpu = cpu[:69] + "…"
        self.cpu_lbl.configure(text=cpu)
        self.gpu_lbl.configure(text=gpu_name or "")
        self.stat_labels["hostname"].configure(text=hw.hostname or "—")
        self.stat_labels["serial"].configure(text=hw.serial_number or "N/D")
        self.stat_labels["bios"].configure(text=hw.bios_version or "N/D")
        self._copy_text = (
            f"Equipo: {hw.brand_model}\n"
            f"Tipo: {hw.device_type}\n"
            f"SO: {hw.os_full}\n"
            f"CPU: {hw.cpu_name}\n"
            f"GPU: {gpu_name}\n"
            f"Nombre: {hw.hostname}\n"
            f"Serie: {hw.serial_number}\n"
            f"BIOS: {hw.bios_version}\n"
        )

    def _copy(self) -> None:
        if not self._copy_text:
            return
        self.clipboard_clear()
        self.clipboard_append(self._copy_text)

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.configure(fg_color=theme["surface"], border_color=theme["border"])
        self.brand_lbl.configure(text_color=theme["text"])
        self.type_chip.configure(fg_color=theme["accent"])
        self.os_lbl.configure(text_color=theme["text_muted"])
        self.cpu_lbl.configure(text_color=theme["text_muted"])
        self.gpu_lbl.configure(text_color=theme["text_muted"])
        self.right.configure(fg_color=theme["surface_alt"])
        self.copy_btn.configure(hover_color=theme["border"], text_color=theme["accent"])
        for lbl in self.stat_labels.values():
            lbl.configure(text_color=theme["text"])


class SectionHeader(ctk.CTkFrame):
    def __init__(
        self,
        master,
        title: str,
        subtitle: str,
        theme: dict,
        action_text: str | None = None,
        action_command=None,
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        row = ctk.CTkFrame(self, fg_color="transparent")
        row.pack(fill="x")

        texts = ctk.CTkFrame(row, fg_color="transparent")
        texts.pack(side="left", fill="x", expand=True)

        self.title_lbl = ctk.CTkLabel(
            texts,
            text=title,
            font=ctk.CTkFont(family="Segoe UI Semibold", size=24, weight="bold"),
            text_color=theme["text"],
            anchor="w",
        )
        self.title_lbl.pack(fill="x")
        self.sub_lbl = ctk.CTkLabel(
            texts,
            text=subtitle,
            font=ctk.CTkFont(family="Segoe UI", size=13),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.sub_lbl.pack(fill="x", pady=(2, 0))

        self.action_btn = None
        if action_text and action_command:
            self.action_btn = ctk.CTkButton(
                row,
                text=action_text,
                height=36,
                corner_radius=10,
                font=ctk.CTkFont(size=13, weight="bold"),
                fg_color=theme["accent"],
                hover_color=theme["accent_hover"],
                command=action_command,
            )
            self.action_btn.pack(side="right")

    def apply_theme(self, theme: dict) -> None:
        self.title_lbl.configure(text_color=theme["text"])
        self.sub_lbl.configure(text_color=theme["text_muted"])
        if self.action_btn:
            self.action_btn.configure(fg_color=theme["accent"], hover_color=theme["accent_hover"])


class SidebarButton(ctk.CTkButton):
    def __init__(self, master, text: str, command, theme: dict, active: bool = False) -> None:
        self.theme = theme
        self.active = active
        super().__init__(
            master,
            text=text,
            command=command,
            height=42,
            corner_radius=10,
            font=ctk.CTkFont(family="Segoe UI", size=14, weight="bold"),
            anchor="w",
            fg_color=theme["accent"] if active else "transparent",
            hover_color=theme["accent_hover"] if active else "#162338",
            text_color="#ffffff" if active else "#c9d4e8",
        )

    def set_active(self, active: bool, theme: dict) -> None:
        if self.active == active and self.theme is theme:
            return
        self.active = active
        self.theme = theme
        self.configure(
            fg_color=theme["accent"] if active else "transparent",
            hover_color=theme["accent_hover"] if active else "#162338",
            text_color="#ffffff" if active else "#c9d4e8",
        )


class StatTile(ctk.CTkFrame):
    """Baldosa densa para modo juegos (estilo Afterburner)."""

    def __init__(self, master, title: str, accent: str, theme: dict, **kwargs) -> None:
        super().__init__(
            master,
            fg_color=theme["surface"],
            corner_radius=12,
            border_width=1,
            border_color=theme["border"],
            **kwargs,
        )
        self.accent = accent
        ctk.CTkFrame(self, height=3, fg_color=accent, corner_radius=0).pack(fill="x")
        self.title = ctk.CTkLabel(
            self,
            text=title,
            font=ctk.CTkFont(size=11, weight="bold"),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.title.pack(fill="x", padx=12, pady=(10, 0))
        self.value = ctk.CTkLabel(
            self,
            text="—",
            font=ctk.CTkFont(family="Consolas", size=26, weight="bold"),
            text_color=accent,
            anchor="w",
        )
        self.value.pack(fill="x", padx=12, pady=(2, 0))
        self.sub = ctk.CTkLabel(
            self,
            text="",
            font=ctk.CTkFont(family="Consolas", size=11),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.sub.pack(fill="x", padx=12, pady=(0, 12))
        self._last = ("", "")

    def set(self, value: str, sub: str = "") -> None:
        if (value, sub) == self._last:
            return
        self._last = (value, sub)
        self.value.configure(text=value)
        self.sub.configure(text=sub)
