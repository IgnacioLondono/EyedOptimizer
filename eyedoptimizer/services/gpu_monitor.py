"""Monitor de GPU (NVIDIA / fallback WMI) para modo juegos."""

from __future__ import annotations

import shutil
import subprocess
import time
from dataclasses import dataclass


@dataclass
class GpuSnapshot:
    available: bool = False
    name: str = ""
    vendor: str = ""
    gpu_percent: float = 0.0
    mem_percent: float = 0.0
    mem_used_mb: float = 0.0
    mem_total_mb: float = 0.0
    temperature_c: float | None = None
    core_clock_mhz: float | None = None
    mem_clock_mhz: float | None = None
    power_w: float | None = None


class GpuMonitor:
    def __init__(self) -> None:
        self._nvidia = shutil.which("nvidia-smi") is not None
        self._last: GpuSnapshot = GpuSnapshot()
        self._last_ts = 0.0
        self._name_cache = ""
        if not self._nvidia:
            self._name_cache = self._wmi_gpu_name()

    @property
    def has_nvidia(self) -> bool:
        return self._nvidia

    def snapshot(self, min_interval: float = 0.35) -> GpuSnapshot:
        now = time.time()
        if now - self._last_ts < min_interval and self._last.available:
            return self._last
        self._last_ts = now
        if self._nvidia:
            self._last = self._read_nvidia()
        else:
            self._last = GpuSnapshot(
                available=bool(self._name_cache),
                name=self._name_cache,
                vendor="Other",
            )
        return self._last

    def _read_nvidia(self) -> GpuSnapshot:
        query = (
            "name,utilization.gpu,utilization.memory,memory.used,memory.total,"
            "temperature.gpu,clocks.gr,clocks.mem,power.draw"
        )
        try:
            completed = subprocess.run(
                [
                    "nvidia-smi",
                    f"--query-gpu={query}",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=2.5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if completed.returncode != 0 or not completed.stdout.strip():
                return GpuSnapshot(available=False)
            line = completed.stdout.strip().splitlines()[0]
            parts = [p.strip() for p in line.split(",")]
            while len(parts) < 9:
                parts.append("N/A")

            def num(v: str) -> float | None:
                try:
                    if v.upper() == "N/A" or v == "":
                        return None
                    return float(v)
                except ValueError:
                    return None

            name = parts[0]
            gpu_pct = num(parts[1]) or 0.0
            mem_pct = num(parts[2]) or 0.0
            mem_used = num(parts[3]) or 0.0
            mem_total = num(parts[4]) or 0.0
            temp = num(parts[5])
            core = num(parts[6])
            memclk = num(parts[7])
            power = num(parts[8])
            self._name_cache = name
            return GpuSnapshot(
                available=True,
                name=name,
                vendor="NVIDIA",
                gpu_percent=gpu_pct,
                mem_percent=mem_pct,
                mem_used_mb=mem_used,
                mem_total_mb=mem_total,
                temperature_c=temp,
                core_clock_mhz=core,
                mem_clock_mhz=memclk,
                power_w=power,
            )
        except Exception:
            return GpuSnapshot(available=False, name=self._name_cache, vendor="NVIDIA")

    def _wmi_gpu_name(self) -> str:
        try:
            completed = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name)",
                ],
                capture_output=True,
                text=True,
                timeout=8,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return (completed.stdout or "").strip()
        except Exception:
            return ""
