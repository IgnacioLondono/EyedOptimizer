"""Lectura en vivo de CPU, RAM, disco, red y sistema."""

from __future__ import annotations

import platform
import socket
import time
from dataclasses import dataclass, field
from typing import Any

import psutil


@dataclass
class SystemSnapshot:
    cpu_percent: float = 0.0
    cpu_per_core: list[float] = field(default_factory=list)
    cpu_freq_mhz: float = 0.0
    cpu_count_logical: int = 0
    cpu_count_physical: int = 0
    ram_total: int = 0
    ram_used: int = 0
    ram_available: int = 0
    ram_percent: float = 0.0
    swap_total: int = 0
    swap_used: int = 0
    swap_percent: float = 0.0
    disk_total: int = 0
    disk_used: int = 0
    disk_free: int = 0
    disk_percent: float = 0.0
    disk_read_bps: float = 0.0
    disk_write_bps: float = 0.0
    net_sent_bps: float = 0.0
    net_recv_bps: float = 0.0
    boot_time: float = 0.0
    hostname: str = ""
    os_name: str = ""
    os_version: str = ""
    architecture: str = ""
    python_version: str = ""
    battery_percent: float | None = None
    battery_plugged: bool | None = None
    timestamp: float = 0.0


class SystemMonitor:
    def __init__(self) -> None:
        self._last_disk = psutil.disk_io_counters()
        self._last_net = psutil.net_io_counters()
        self._last_ts = time.time()
        # Primera llamada en caliente para CPU
        psutil.cpu_percent(interval=None, percpu=True)

    def snapshot(self) -> SystemSnapshot:
        now = time.time()
        dt = max(now - self._last_ts, 0.001)

        cpu_per_core = list(psutil.cpu_percent(interval=None, percpu=True))
        cpu_percent = sum(cpu_per_core) / len(cpu_per_core) if cpu_per_core else 0.0

        freq = psutil.cpu_freq()
        mem = psutil.virtual_memory()
        swap = psutil.swap_memory()

        try:
            disk_usage = psutil.disk_usage("C:\\")
        except Exception:
            disk_usage = psutil.disk_usage("/")

        disk_io = psutil.disk_io_counters()
        net_io = psutil.net_io_counters()

        disk_read = disk_write = 0.0
        if disk_io and self._last_disk:
            disk_read = max(0.0, (disk_io.read_bytes - self._last_disk.read_bytes) / dt)
            disk_write = max(0.0, (disk_io.write_bytes - self._last_disk.write_bytes) / dt)

        net_sent = net_recv = 0.0
        if net_io and self._last_net:
            net_sent = max(0.0, (net_io.bytes_sent - self._last_net.bytes_sent) / dt)
            net_recv = max(0.0, (net_io.bytes_recv - self._last_net.bytes_recv) / dt)

        self._last_disk = disk_io
        self._last_net = net_io
        self._last_ts = now

        battery_percent = None
        battery_plugged = None
        try:
            bat = psutil.sensors_battery()
            if bat is not None:
                battery_percent = bat.percent
                battery_plugged = bat.power_plugged
        except Exception:
            pass

        uname = platform.uname()
        return SystemSnapshot(
            cpu_percent=round(cpu_percent, 1),
            cpu_per_core=[round(c, 1) for c in cpu_per_core],
            cpu_freq_mhz=round(freq.current, 0) if freq else 0.0,
            cpu_count_logical=psutil.cpu_count(logical=True) or 0,
            cpu_count_physical=psutil.cpu_count(logical=False) or 0,
            ram_total=mem.total,
            ram_used=mem.used,
            ram_available=mem.available,
            ram_percent=mem.percent,
            swap_total=swap.total,
            swap_used=swap.used,
            swap_percent=swap.percent,
            disk_total=disk_usage.total,
            disk_used=disk_usage.used,
            disk_free=disk_usage.free,
            disk_percent=disk_usage.percent,
            disk_read_bps=disk_read,
            disk_write_bps=disk_write,
            net_sent_bps=net_sent,
            net_recv_bps=net_recv,
            boot_time=psutil.boot_time(),
            hostname=socket.gethostname(),
            os_name=f"{uname.system} {uname.release}",
            os_version=uname.version,
            architecture=uname.machine,
            python_version=platform.python_version(),
            battery_percent=battery_percent,
            battery_plugged=battery_plugged,
            timestamp=now,
        )

    @staticmethod
    def format_bytes(num: float) -> str:
        units = ["B", "KB", "MB", "GB", "TB"]
        n = float(num)
        for unit in units:
            if abs(n) < 1024.0:
                return f"{n:.1f} {unit}"
            n /= 1024.0
        return f"{n:.1f} PB"

    @staticmethod
    def format_rate(bps: float) -> str:
        return f"{SystemMonitor.format_bytes(bps)}/s"

    @staticmethod
    def uptime_text(boot_time: float) -> str:
        seconds = int(time.time() - boot_time)
        days, rem = divmod(seconds, 86400)
        hours, rem = divmod(rem, 3600)
        minutes, secs = divmod(rem, 60)
        parts = []
        if days:
            parts.append(f"{days}d")
        parts.append(f"{hours:02d}h")
        parts.append(f"{minutes:02d}m")
        parts.append(f"{secs:02d}s")
        return " ".join(parts)

    def static_info(self) -> dict[str, Any]:
        snap = self.snapshot()
        return {
            "hostname": snap.hostname,
            "os": snap.os_name,
            "version": snap.os_version,
            "arch": snap.architecture,
            "cpu_logical": snap.cpu_count_logical,
            "cpu_physical": snap.cpu_count_physical,
            "ram_total": self.format_bytes(snap.ram_total),
            "disk_total": self.format_bytes(snap.disk_total),
        }
