#!/usr/bin/env python3
"""Punto de entrada de EyedOptimizer."""

from __future__ import annotations

import ctypes
import sys
import tkinter.messagebox as messagebox


MUTEX_NAME = "Local\\EyedOptimizerSingleInstance"


def _ensure_single_instance() -> ctypes.c_void_p | None:
    """Permite una sola instancia del proceso en el PC."""
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        try:
            messagebox.showinfo(
                "EyedOptimizer",
                "EyedOptimizer ya esta en ejecucion.\nSolo se permite una instancia.",
            )
        except Exception:
            pass
        return None
    return handle


def main() -> int:
    mutex = _ensure_single_instance()
    if mutex is None:
        return 1
    from eyedoptimizer.app import run

    run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
