"""Panel de inicio estilo fabricante: cards, anillos y datos del equipo."""

from __future__ import annotations

import threading

import customtkinter as ctk

from eyedoptimizer.services.gpu_monitor import GpuMonitor
from eyedoptimizer.services.hardware_info import HardwareInfo, get_hardware_info
from eyedoptimizer.services.system_monitor import SystemMonitor, SystemSnapshot
from eyedoptimizer.ui.widgets import DeviceBanner, MetricCard, RingGauge, SectionHeader


class DashboardPage(ctk.CTkFrame):
    def __init__(
        self,
        master,
        theme: dict,
        monitor: SystemMonitor,
        gpu_monitor: GpuMonitor,
        on_refresh=None,
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self.theme = theme
        self.monitor = monitor
        self.gpu = gpu_monitor
        self._hw: HardwareInfo | None = None
        self._on_refresh = on_refresh

        self.header = SectionHeader(
            self,
            "Inicio",
            "Estado del equipo, sistema operativo y recursos en tiempo real",
            theme,
            action_text="Actualizar ahora",
            action_command=self._manual_refresh,
        )
        self.header.pack(fill="x", padx=4, pady=(0, 12))

        top = ctk.CTkFrame(self, fg_color="transparent")
        top.pack(fill="x", padx=2)
        top.grid_columnconfigure(0, weight=3)
        top.grid_columnconfigure(1, weight=1)
        top.grid_columnconfigure(2, weight=1)

        self.device_banner = DeviceBanner(top, theme)
        self.device_banner.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        self.ring_card = ctk.CTkFrame(
            top,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
        )
        self.ring_card.grid(row=0, column=1, sticky="nsew", padx=4)
        ctk.CTkLabel(
            self.ring_card,
            text="Bateria",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=theme["text_muted"],
        ).pack(pady=(14, 0))
        self.battery_ring = RingGauge(
            self.ring_card, theme, theme["accent"], size=130, thickness=11, label="Carga"
        )
        self.battery_ring.pack(expand=True, pady=8)
        self.battery_status = ctk.CTkLabel(
            self.ring_card,
            text="Sin bateria detectada",
            font=ctk.CTkFont(size=11),
            text_color=theme["text_muted"],
            wraplength=150,
        )
        self.battery_status.pack(pady=(0, 14))

        self.gpu_ring_card = ctk.CTkFrame(
            top,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
        )
        self.gpu_ring_card.grid(row=0, column=2, sticky="nsew", padx=(4, 0))
        ctk.CTkLabel(
            self.gpu_ring_card,
            text="GPU",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=theme["text_muted"],
        ).pack(pady=(14, 0))
        self.gpu_ring = RingGauge(
            self.gpu_ring_card, theme, theme["net"], size=130, thickness=11, label="Uso"
        )
        self.gpu_ring.pack(expand=True, pady=8)
        self.gpu_status = ctk.CTkLabel(
            self.gpu_ring_card,
            text="Detectando GPU…",
            font=ctk.CTkFont(size=11),
            text_color=theme["text_muted"],
            wraplength=150,
        )
        self.gpu_status.pack(pady=(0, 14))

        self.cards_row = ctk.CTkFrame(self, fg_color="transparent")
        self.cards_row.pack(fill="x", padx=2, pady=(12, 0))
        for i in range(4):
            self.cards_row.grid_columnconfigure(i, weight=1, uniform="m")

        self.cpu_card = MetricCard(self.cards_row, "CPU", theme["cpu"], theme)
        self.ram_card = MetricCard(self.cards_row, "Memoria RAM", theme["ram"], theme)
        self.disk_card = MetricCard(self.cards_row, "Disco", theme["disk"], theme)
        self.net_card = MetricCard(self.cards_row, "Red", theme["net"], theme)
        self.cpu_card.grid(row=0, column=0, sticky="nsew", padx=(0, 6), pady=4)
        self.ram_card.grid(row=0, column=1, sticky="nsew", padx=6, pady=4)
        self.disk_card.grid(row=0, column=2, sticky="nsew", padx=6, pady=4)
        self.net_card.grid(row=0, column=3, sticky="nsew", padx=(6, 0), pady=4)

        self.lower = ctk.CTkFrame(self, fg_color="transparent")
        self.lower.pack(fill="both", expand=True, padx=2, pady=(12, 0))
        self.lower.grid_columnconfigure(0, weight=3)
        self.lower.grid_columnconfigure(1, weight=2)
        self.lower.grid_rowconfigure(0, weight=1)

        self.cores_frame = ctk.CTkFrame(
            self.lower,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
        )
        self.cores_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        self.cores_title = ctk.CTkLabel(
            self.cores_frame,
            text="Uso por nucleo",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=15, weight="bold"),
            text_color=theme["text"],
            anchor="w",
        )
        self.cores_title.pack(fill="x", padx=16, pady=(14, 8))
        self.cores_container = ctk.CTkScrollableFrame(
            self.cores_frame, fg_color="transparent", height=240
        )
        self.cores_container.pack(fill="both", expand=True, padx=10, pady=(0, 12))
        self.core_bars: list[tuple[ctk.CTkLabel, ctk.CTkProgressBar, ctk.CTkLabel]] = []

        self.info_frame = ctk.CTkFrame(
            self.lower,
            fg_color=theme["surface"],
            corner_radius=16,
            border_width=1,
            border_color=theme["border"],
        )
        self.info_frame.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        self.info_title = ctk.CTkLabel(
            self.info_frame,
            text="Detalles del sistema",
            font=ctk.CTkFont(family="Segoe UI Semibold", size=15, weight="bold"),
            text_color=theme["text"],
            anchor="w",
        )
        self.info_title.pack(fill="x", padx=16, pady=(14, 8))

        self.info_labels: dict[str, ctk.CTkLabel] = {}
        for key in (
            "Marca",
            "Modelo",
            "Tipo",
            "Sistema",
            "Build / Arch",
            "Nucleos",
            "RAM total",
            "Disco total",
            "Tiempo activo",
            "Bateria",
            "Swap",
        ):
            row = ctk.CTkFrame(self.info_frame, fg_color="transparent")
            row.pack(fill="x", padx=16, pady=3)
            ctk.CTkLabel(
                row,
                text=key,
                font=ctk.CTkFont(size=12),
                text_color=theme["text_muted"],
                width=100,
                anchor="w",
            ).pack(side="left")
            lbl = ctk.CTkLabel(
                row,
                text="—",
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=theme["text"],
                anchor="w",
            )
            lbl.pack(side="left", fill="x", expand=True)
            self.info_labels[key] = lbl

        self._init_core_bars(8)
        self.after(80, self._load_hardware_async)

    def _manual_refresh(self) -> None:
        if self._on_refresh:
            self._on_refresh()

    def _load_hardware_async(self) -> None:
        def worker() -> None:
            hw = get_hardware_info()
            gpu = self.gpu.snapshot(min_interval=0)
            self.after(0, lambda: self._apply_hardware(hw, gpu.name))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_hardware(self, hw: HardwareInfo, gpu_name: str) -> None:
        self._hw = hw
        self.device_banner.update_info(hw, gpu_name)
        self.info_labels["Marca"].configure(text=hw.manufacturer)
        self.info_labels["Modelo"].configure(text=hw.model)
        self.info_labels["Tipo"].configure(text=hw.device_type)
        self.info_labels["Sistema"].configure(text=hw.os_caption)
        arch = " · ".join(x for x in (hw.os_build and f"Build {hw.os_build}", hw.os_arch) if x)
        self.info_labels["Build / Arch"].configure(text=arch or "—")

    def _init_core_bars(self, count: int = 8) -> None:
        for child in self.cores_container.winfo_children():
            child.destroy()
        self.core_bars.clear()
        for i in range(count):
            row = ctk.CTkFrame(self.cores_container, fg_color="transparent")
            row.pack(fill="x", pady=2)
            name = ctk.CTkLabel(
                row,
                text=f"CPU {i}",
                width=52,
                anchor="w",
                font=ctk.CTkFont(size=11),
                text_color=self.theme["text_muted"],
            )
            name.pack(side="left")
            bar = ctk.CTkProgressBar(
                row,
                height=9,
                progress_color=self.theme["cpu"],
                fg_color=self.theme["surface_alt"],
            )
            bar.pack(side="left", fill="x", expand=True, padx=8)
            bar.set(0)
            val = ctk.CTkLabel(
                row,
                text="0%",
                width=40,
                anchor="e",
                font=ctk.CTkFont(size=11, weight="bold"),
                text_color=self.theme["text"],
            )
            val.pack(side="right")
            self.core_bars.append((name, bar, val))

    def update_snapshot(self, snap: SystemSnapshot) -> None:
        fmt = self.monitor.format_bytes
        self.cpu_card.update_metric(
            f"{snap.cpu_percent:.0f}%",
            f"{snap.cpu_freq_mhz:.0f} MHz · {snap.cpu_count_logical} hilos",
            snap.cpu_percent / 100.0,
        )
        self.ram_card.update_metric(
            f"{snap.ram_percent:.0f}%",
            f"{fmt(snap.ram_used)} / {fmt(snap.ram_total)}",
            snap.ram_percent / 100.0,
        )
        self.disk_card.update_metric(
            f"{snap.disk_percent:.0f}%",
            f"{fmt(snap.disk_used)} / {fmt(snap.disk_total)} · libre {fmt(snap.disk_free)}",
            snap.disk_percent / 100.0,
        )
        net_total = snap.net_recv_bps + snap.net_sent_bps
        self.net_card.update_metric(
            self.monitor.format_rate(net_total),
            f"↓ {self.monitor.format_rate(snap.net_recv_bps)}  ↑ {self.monitor.format_rate(snap.net_sent_bps)}",
            min(1.0, net_total / (50 * 1024 * 1024)),
        )

        if len(snap.cpu_per_core) != len(self.core_bars):
            self._init_core_bars(len(snap.cpu_per_core) or 1)
        for i, pct in enumerate(snap.cpu_per_core):
            if i >= len(self.core_bars):
                break
            _n, bar, val = self.core_bars[i]
            bar.set(pct / 100.0)
            val.configure(text=f"{pct:.0f}%")

        if snap.battery_percent is not None:
            self.battery_ring.set_value(snap.battery_percent)
            plug = "Conectado a la corriente" if snap.battery_plugged else "En bateria"
            self.battery_status.configure(text=plug)
            bat_txt = f"{snap.battery_percent:.0f}% · {plug}"
        else:
            self.battery_ring.set_value(0, center_text="N/D")
            self.battery_status.configure(text="Sobremesa / sin bateria")
            bat_txt = "N/D"

        gpu = self.gpu.snapshot()
        if gpu.available and gpu.vendor == "NVIDIA":
            self.gpu_ring.set_value(gpu.gpu_percent)
            temp = f"{gpu.temperature_c:.0f} C" if gpu.temperature_c is not None else ""
            self.gpu_status.configure(text=temp or gpu.name[:28])
            if self._hw:
                self.device_banner.gpu_lbl.configure(text=gpu.name)
        elif gpu.name:
            self.gpu_ring.set_value(0, center_text="N/D")
            self.gpu_status.configure(text=gpu.name[:32])
        else:
            self.gpu_ring.set_value(0, center_text="N/D")
            self.gpu_status.configure(text="GPU no disponible")

        if self._hw:
            self.info_labels["Marca"].configure(text=self._hw.manufacturer)
            self.info_labels["Modelo"].configure(text=self._hw.model)
            self.info_labels["Tipo"].configure(text=self._hw.device_type)
            self.info_labels["Sistema"].configure(text=self._hw.os_caption)

        self.info_labels["Nucleos"].configure(
            text=f"{snap.cpu_count_physical} fisicos / {snap.cpu_count_logical} logicos"
        )
        self.info_labels["RAM total"].configure(text=fmt(snap.ram_total))
        self.info_labels["Disco total"].configure(text=fmt(snap.disk_total))
        self.info_labels["Tiempo activo"].configure(text=self.monitor.uptime_text(snap.boot_time))
        self.info_labels["Bateria"].configure(text=bat_txt)
        self.info_labels["Swap"].configure(
            text=f"{snap.swap_percent:.0f}% · {fmt(snap.swap_used)} / {fmt(snap.swap_total)}"
        )

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.header.apply_theme(theme)
        self.device_banner.apply_theme(theme)
        for card, accent in (
            (self.ring_card, None),
            (self.gpu_ring_card, None),
            (self.cores_frame, None),
            (self.info_frame, None),
        ):
            card.configure(fg_color=theme["surface"], border_color=theme["border"])
        self.battery_ring.apply_theme(theme, theme["accent"])
        self.gpu_ring.apply_theme(theme, theme["net"])
        self.cpu_card.apply_theme(theme, theme["cpu"])
        self.ram_card.apply_theme(theme, theme["ram"])
        self.disk_card.apply_theme(theme, theme["disk"])
        self.net_card.apply_theme(theme, theme["net"])
        self.cores_title.configure(text_color=theme["text"])
        self.info_title.configure(text_color=theme["text"])
        self.battery_status.configure(text_color=theme["text_muted"])
        self.gpu_status.configure(text_color=theme["text_muted"])
        for name, bar, val in self.core_bars:
            name.configure(text_color=theme["text_muted"])
            bar.configure(progress_color=theme["cpu"], fg_color=theme["surface_alt"])
            val.configure(text_color=theme["text"])
        for lbl in self.info_labels.values():
            lbl.configure(text_color=theme["text"])
