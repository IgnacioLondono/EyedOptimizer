"""Modo juegos: telemetria densa estilo Afterburner."""

from __future__ import annotations

import time

import customtkinter as ctk

from eyedoptimizer.services.gpu_monitor import GpuMonitor
from eyedoptimizer.services.system_monitor import SystemMonitor, SystemSnapshot
from eyedoptimizer.ui.widgets import RingGauge, SectionHeader, StatTile


class GamesPage(ctk.CTkFrame):
    def __init__(
        self,
        master,
        theme: dict,
        monitor: SystemMonitor,
        gpu_monitor: GpuMonitor,
        **kwargs,
    ) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self.theme = theme
        self.monitor = monitor
        self.gpu = gpu_monitor
        self._history: list[tuple[float, float, float, float]] = []  # t, cpu, ram, gpu
        self._peak_gpu = 0.0
        self._peak_cpu = 0.0
        self._peak_ram = 0.0
        self._top_proc = ("—", 0.0)
        self._top_proc_ts = 0.0

        self.header = SectionHeader(
            self,
            "Modo juegos",
            "Monitor en tiempo real de CPU, GPU, VRAM, temperatura y red (estilo Afterburner)",
            theme,
        )
        self.header.pack(fill="x", padx=4, pady=(0, 12))

        rings = ctk.CTkFrame(self, fg_color="transparent")
        rings.pack(fill="x", padx=2)
        for i in range(4):
            rings.grid_columnconfigure(i, weight=1, uniform="r")

        self.ring_frames = []
        specs = (
            ("CPU", theme["cpu"]),
            ("RAM", theme["ram"]),
            ("GPU", theme["net"]),
            ("VRAM", theme["disk"]),
        )
        self.rings: list[RingGauge] = []
        for i, (label, color) in enumerate(specs):
            card = ctk.CTkFrame(
                rings,
                fg_color=theme["surface"],
                corner_radius=14,
                border_width=1,
                border_color=theme["border"],
            )
            card.grid(row=0, column=i, sticky="nsew", padx=5, pady=2)
            gauge = RingGauge(card, theme, color, size=120, thickness=10, label=label)
            gauge.pack(padx=8, pady=14)
            self.rings.append(gauge)
            self.ring_frames.append(card)

        grid = ctk.CTkFrame(self, fg_color="transparent")
        grid.pack(fill="both", expand=True, padx=2, pady=(12, 0))
        for c in range(4):
            grid.grid_columnconfigure(c, weight=1, uniform="t")
        for r in range(3):
            grid.grid_rowconfigure(r, weight=1)

        tile_defs = [
            ("GPU TEMP", theme["danger"]),
            ("GPU CLOCK", theme["net"]),
            ("MEM CLOCK", theme["disk"]),
            ("POTENCIA", theme["warning"]),
            ("CPU FREQ", theme["cpu"]),
            ("RAM USADA", theme["ram"]),
            ("VRAM USADA", theme["disk"]),
            ("RED TOTAL", theme["net"]),
            ("DISCO R/W", theme["warning"]),
            ("PICOS SESION", theme["accent"]),
            ("PROCESOS TOP", theme["cpu"]),
            ("ESTADO", theme["success"]),
        ]
        self.tiles: dict[str, StatTile] = {}
        for idx, (title, color) in enumerate(tile_defs):
            r, c = divmod(idx, 4)
            tile = StatTile(grid, title, color, theme)
            tile.grid(row=r, column=c, sticky="nsew", padx=5, pady=5)
            self.tiles[title] = tile

        self.note = ctk.CTkLabel(
            self,
            text="Actualizacion continua cada 500 ms en esta vista. Ideal mientras juegas.",
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
            anchor="w",
        )
        self.note.pack(fill="x", padx=8, pady=(8, 0))

    def update_live(self, snap: SystemSnapshot) -> None:
        gpu = self.gpu.snapshot(min_interval=0.25)
        fmt = self.monitor.format_bytes

        self.rings[0].set_value(snap.cpu_percent)
        self.rings[1].set_value(snap.ram_percent)
        if gpu.available:
            self.rings[2].set_value(gpu.gpu_percent)
            vram_pct = (gpu.mem_used_mb / gpu.mem_total_mb * 100.0) if gpu.mem_total_mb else gpu.mem_percent
            self.rings[3].set_value(vram_pct)
        else:
            self.rings[2].set_value(0, center_text="N/D")
            self.rings[3].set_value(0, center_text="N/D")

        self._peak_cpu = max(self._peak_cpu, snap.cpu_percent)
        self._peak_ram = max(self._peak_ram, snap.ram_percent)
        if gpu.available:
            self._peak_gpu = max(self._peak_gpu, gpu.gpu_percent)

        if gpu.available:
            self.tiles["GPU TEMP"].set(
                f"{gpu.temperature_c:.0f} C" if gpu.temperature_c is not None else "N/D",
                gpu.name[:40],
            )
            self.tiles["GPU CLOCK"].set(
                f"{gpu.core_clock_mhz:.0f} MHz" if gpu.core_clock_mhz else "N/D",
                "Nucleo grafico",
            )
            self.tiles["MEM CLOCK"].set(
                f"{gpu.mem_clock_mhz:.0f} MHz" if gpu.mem_clock_mhz else "N/D",
                "Memoria GPU",
            )
            self.tiles["POTENCIA"].set(
                f"{gpu.power_w:.0f} W" if gpu.power_w is not None else "N/D",
                "Consumo GPU",
            )
            self.tiles["VRAM USADA"].set(
                f"{gpu.mem_used_mb:.0f} MB",
                f"de {gpu.mem_total_mb:.0f} MB",
            )
            self.tiles["ESTADO"].set("GPU NVIDIA", "Telemetria activa")
        else:
            self.tiles["GPU TEMP"].set("N/D", "Sin NVIDIA / nvidia-smi")
            self.tiles["GPU CLOCK"].set("N/D", "")
            self.tiles["MEM CLOCK"].set("N/D", "")
            self.tiles["POTENCIA"].set("N/D", "")
            self.tiles["VRAM USADA"].set("N/D", "")
            self.tiles["ESTADO"].set("Limitado", gpu.name or "GPU basica")

        self.tiles["CPU FREQ"].set(f"{snap.cpu_freq_mhz:.0f} MHz", f"{snap.cpu_count_logical} hilos")
        self.tiles["RAM USADA"].set(fmt(snap.ram_used), f"de {fmt(snap.ram_total)}")
        net = snap.net_recv_bps + snap.net_sent_bps
        self.tiles["RED TOTAL"].set(
            self.monitor.format_rate(net),
            f"↓ {self.monitor.format_rate(snap.net_recv_bps)}  ↑ {self.monitor.format_rate(snap.net_sent_bps)}",
        )
        self.tiles["DISCO R/W"].set(
            f"{self.monitor.format_rate(snap.disk_read_bps)}",
            f"W {self.monitor.format_rate(snap.disk_write_bps)}",
        )
        self.tiles["PICOS SESION"].set(
            f"CPU {self._peak_cpu:.0f}%",
            f"GPU {self._peak_gpu:.0f}% · RAM {self._peak_ram:.0f}%",
        )

        # Top proceso por CPU (cada 2 s para no saturar)
        now = time.time()
        if now - self._top_proc_ts > 2.0:
            self._top_proc_ts = now
            try:
                import psutil

                top = ("—", 0.0)
                for p in psutil.process_iter(["name", "cpu_percent"]):
                    try:
                        info = p.info
                        pct = float(info.get("cpu_percent") or 0)
                        if pct > top[1]:
                            top = (info.get("name") or "?", pct)
                    except Exception:
                        continue
                self._top_proc = top
            except Exception:
                pass
        self.tiles["PROCESOS TOP"].set(f"{self._top_proc[1]:.0f}%", str(self._top_proc[0])[:36])

        self._history.append((now, snap.cpu_percent, snap.ram_percent, gpu.gpu_percent if gpu.available else 0))
        if len(self._history) > 120:
            self._history = self._history[-120:]

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.header.apply_theme(theme)
        colors = (theme["cpu"], theme["ram"], theme["net"], theme["disk"])
        for card, ring, color in zip(self.ring_frames, self.rings, colors):
            card.configure(fg_color=theme["surface"], border_color=theme["border"])
            ring.apply_theme(theme, color)
        self.note.configure(text_color=theme["text_muted"])
