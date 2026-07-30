"""Administrador de procesos detallado (listado ligero + detalles bajo demanda)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import psutil


@dataclass
class ProcessInfo:
    pid: int
    name: str
    status: str
    username: str
    cpu_percent: float
    memory_rss: int
    memory_percent: float
    memory_vms: int
    threads: int
    handles: int
    priority: str
    nice: int
    create_time: float
    exe: str
    cmdline: str
    parent_pid: int
    io_read_bytes: int
    io_write_bytes: int
    num_ctx_switches: int
    cwd: str


class ProcessManager:
    PRIORITY_MAP = {
        getattr(psutil, "IDLE_PRIORITY_CLASS", 64): "Idle",
        getattr(psutil, "BELOW_NORMAL_PRIORITY_CLASS", 16384): "Below Normal",
        getattr(psutil, "NORMAL_PRIORITY_CLASS", 32): "Normal",
        getattr(psutil, "ABOVE_NORMAL_PRIORITY_CLASS", 32768): "Above Normal",
        getattr(psutil, "HIGH_PRIORITY_CLASS", 128): "High",
        getattr(psutil, "REALTIME_PRIORITY_CLASS", 256): "Realtime",
    }

    # Solo attrs rapidos en Windows (ppid/status/threads son muy caros)
    _LIST_ATTRS = ("pid", "name", "cpu_percent", "memory_info")

    def __init__(self) -> None:
        # Warmup ligero de CPU % (no bloquea en cada refresh)
        for proc in psutil.process_iter(["pid"]):
            try:
                proc.cpu_percent(interval=None)
            except (psutil.Error, ProcessLookupError):
                pass
        self._mem_total = psutil.virtual_memory().total or 1

    def list_processes(self) -> list[ProcessInfo]:
        items: list[ProcessInfo] = []
        mem_total = self._mem_total
        for proc in psutil.process_iter(self._LIST_ATTRS):
            try:
                info = proc.info
                mem = info.get("memory_info")
                rss = getattr(mem, "rss", 0) if mem else 0
                vms = getattr(mem, "vms", 0) if mem else 0
                mem_pct = (rss / mem_total) * 100.0 if mem_total else 0.0
                items.append(
                    ProcessInfo(
                        pid=info.get("pid") or 0,
                        name=info.get("name") or "?",
                        status="running",
                        username="",
                        cpu_percent=round(float(info.get("cpu_percent") or 0.0), 1),
                        memory_rss=rss,
                        memory_percent=round(mem_pct, 2),
                        memory_vms=vms,
                        threads=0,
                        handles=0,
                        priority="—",
                        nice=0,
                        create_time=0.0,
                        exe="",
                        cmdline="",
                        parent_pid=0,
                        io_read_bytes=0,
                        io_write_bytes=0,
                        num_ctx_switches=0,
                        cwd="",
                    )
                )
            except (psutil.Error, ProcessLookupError, PermissionError, OSError):
                continue
        return items

    def _priority_label(self, value: Any) -> str:
        if value in self.PRIORITY_MAP:
            return self.PRIORITY_MAP[value]
        if value is None:
            return "N/D"
        return str(value)

    def kill_process(self, pid: int, force: bool = False) -> tuple[bool, str]:
        try:
            proc = psutil.Process(pid)
            name = proc.name()
            if force:
                proc.kill()
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except psutil.TimeoutExpired:
                    proc.kill()
            return True, f"Proceso {name} (PID {pid}) finalizado."
        except psutil.NoSuchProcess:
            return False, "El proceso ya no existe."
        except psutil.AccessDenied:
            return False, "Acceso denegado. Ejecuta EyedOptimizer como administrador."
        except Exception as exc:
            return False, f"Error: {exc}"

    def process_details(self, pid: int) -> dict[str, Any] | None:
        try:
            proc = psutil.Process(pid)
            with proc.oneshot():
                mem = proc.memory_info()
                try:
                    mem_full = proc.memory_full_info()
                    uss = getattr(mem_full, "uss", 0)
                except (psutil.Error, AttributeError):
                    uss = 0
                try:
                    io = proc.io_counters()
                    io_data = {
                        "read_bytes": io.read_bytes,
                        "write_bytes": io.write_bytes,
                        "read_count": io.read_count,
                        "write_count": io.write_count,
                    }
                except (psutil.Error, AttributeError):
                    io_data = {}
                try:
                    open_files = [f.path for f in proc.open_files()]
                except (psutil.Error, AttributeError):
                    open_files = []
                try:
                    conns = proc.net_connections(kind="inet")
                    connections = [
                        f"{c.laddr.ip}:{c.laddr.port} -> "
                        f"{c.raddr.ip if c.raddr else '*'}:{c.raddr.port if c.raddr else '*'} "
                        f"[{c.status}]"
                        for c in conns[:40]
                    ]
                except (psutil.Error, AttributeError):
                    connections = []
                try:
                    thread_count = proc.num_threads()
                except (psutil.Error, AttributeError):
                    thread_count = 0

                return {
                    "pid": proc.pid,
                    "name": proc.name(),
                    "exe": self._call(proc.exe, ""),
                    "cwd": self._call(proc.cwd, ""),
                    "cmdline": " ".join(self._call(proc.cmdline, []) or []),
                    "status": proc.status(),
                    "username": self._call(proc.username, "N/D"),
                    "create_time": proc.create_time(),
                    "cpu_percent": proc.cpu_percent(interval=None),
                    "cpu_times": self._call(lambda: proc.cpu_times()._asdict(), {}),
                    "memory_rss": mem.rss,
                    "memory_vms": mem.vms,
                    "memory_uss": uss,
                    "memory_percent": proc.memory_percent(),
                    "threads": thread_count,
                    "nice": self._call(proc.nice, 0),
                    "ppid": proc.ppid(),
                    "io": io_data,
                    "open_files": open_files[:50],
                    "connections": connections,
                }
        except (psutil.Error, ProcessLookupError):
            return None

    @staticmethod
    def _call(fn, default):
        try:
            return fn()
        except Exception:
            return default

    @staticmethod
    def format_bytes(num: float) -> str:
        n = float(num)
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if abs(n) < 1024:
                return f"{n:.1f} {unit}"
            n /= 1024
        return f"{n:.1f} PB"
