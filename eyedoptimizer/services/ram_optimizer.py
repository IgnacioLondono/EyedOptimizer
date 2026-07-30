"""Optimización de memoria RAM y limpieza de recursos en Windows."""

from __future__ import annotations

import ctypes
import gc
import os
import shutil
import tempfile
from ctypes import wintypes
from dataclasses import dataclass, field

import psutil

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
psapi = ctypes.WinDLL("psapi", use_last_error=True)

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_SET_QUOTA = 0x0100
PROCESS_TERMINATE = 0x0001
PROCESS_VM_READ = 0x0010

OpenProcess = kernel32.OpenProcess
OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
OpenProcess.restype = wintypes.HANDLE

CloseHandle = kernel32.CloseHandle
CloseHandle.argtypes = [wintypes.HANDLE]
CloseHandle.restype = wintypes.BOOL

EmptyWorkingSet = psapi.EmptyWorkingSet
EmptyWorkingSet.argtypes = [wintypes.HANDLE]
EmptyWorkingSet.restype = wintypes.BOOL


@dataclass
class OptimizeResult:
    success: bool
    message: str
    ram_before: int = 0
    ram_after: int = 0
    freed_bytes: int = 0
    processes_trimmed: int = 0
    temp_files_removed: int = 0
    temp_bytes_freed: int = 0
    details: list[str] = field(default_factory=list)


class RamOptimizer:
    """Libera working sets, limpia temporales y fuerza recolección."""

    SYSTEM_SKIP = {
        "System",
        "Idle",
        "Registry",
        "smss.exe",
        "csrss.exe",
        "wininit.exe",
        "services.exe",
        "lsass.exe",
        "svchost.exe",
        "fontdrvhost.exe",
        "dwm.exe",
        "Memory Compression",
        "Secure System",
    }

    def optimize(self, clean_temp: bool = True, trim_processes: bool = True) -> OptimizeResult:
        before = psutil.virtual_memory()
        details: list[str] = []
        trimmed = 0
        temp_removed = 0
        temp_freed = 0

        gc.collect()
        details.append("Recolección de basura de Python ejecutada.")

        if trim_processes:
            trimmed, trim_notes = self._trim_working_sets()
            details.extend(trim_notes)

        if clean_temp:
            temp_removed, temp_freed, temp_notes = self._clean_temp_files()
            details.extend(temp_notes)

        # Pequeña pausa para que el SO actualice contadores
        import time

        time.sleep(0.4)
        after = psutil.virtual_memory()
        freed = max(0, before.used - after.used)

        msg = (
            f"Optimización completada. Liberados aprox. "
            f"{self._fmt(freed)} de RAM."
            if freed > 0
            else "Optimización completada. El sistema ya estaba en buen estado."
        )
        return OptimizeResult(
            success=True,
            message=msg,
            ram_before=before.used,
            ram_after=after.used,
            freed_bytes=freed,
            processes_trimmed=trimmed,
            temp_files_removed=temp_removed,
            temp_bytes_freed=temp_freed,
            details=details,
        )

    def _trim_working_sets(self) -> tuple[int, list[str]]:
        trimmed = 0
        notes: list[str] = []
        current_pid = os.getpid()

        for proc in psutil.process_iter(["pid", "name"]):
            try:
                info = proc.info
                name = info.get("name") or ""
                pid = info.get("pid")
                if not pid or pid == current_pid:
                    continue
                if name in self.SYSTEM_SKIP or name.lower() in {s.lower() for s in self.SYSTEM_SKIP}:
                    continue
                if self._empty_working_set(pid):
                    trimmed += 1
            except (psutil.Error, PermissionError, OSError):
                continue

        notes.append(f"Working sets reducidos en {trimmed} procesos.")
        return trimmed, notes

    def _empty_working_set(self, pid: int) -> bool:
        access = PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA
        handle = OpenProcess(access, False, pid)
        if not handle:
            return False
        try:
            return bool(EmptyWorkingSet(handle))
        finally:
            CloseHandle(handle)

    def _clean_temp_files(self) -> tuple[int, int, list[str]]:
        removed = 0
        freed = 0
        notes: list[str] = []
        targets = [
            tempfile.gettempdir(),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Temp"),
            os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Temp"),
        ]
        seen: set[str] = set()

        for folder in targets:
            if not folder or not os.path.isdir(folder):
                continue
            norm = os.path.normcase(os.path.abspath(folder))
            if norm in seen:
                continue
            seen.add(norm)
            r, f = self._purge_folder(folder)
            removed += r
            freed += f

        notes.append(f"Temporales: {removed} elementos, {self._fmt(freed)} liberados.")
        return removed, freed, notes

    def _purge_folder(self, folder: str) -> tuple[int, int]:
        removed = 0
        freed = 0
        try:
            entries = list(os.scandir(folder))
        except OSError:
            return 0, 0

        for entry in entries:
            try:
                if entry.is_file(follow_symlinks=False):
                    size = entry.stat(follow_symlinks=False).st_size
                    os.remove(entry.path)
                    removed += 1
                    freed += size
                elif entry.is_dir(follow_symlinks=False):
                    size = self._dir_size(entry.path)
                    shutil.rmtree(entry.path, ignore_errors=True)
                    if not os.path.exists(entry.path):
                        removed += 1
                        freed += size
            except OSError:
                continue
        return removed, freed

    def _dir_size(self, path: str) -> int:
        total = 0
        for root, _dirs, files in os.walk(path):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
        return total

    @staticmethod
    def _fmt(num: int | float) -> str:
        n = float(num)
        for unit in ("B", "KB", "MB", "GB", "TB"):
            if abs(n) < 1024:
                return f"{n:.1f} {unit}"
            n /= 1024
        return f"{n:.1f} PB"
