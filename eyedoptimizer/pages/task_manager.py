"""Administrador de tareas detallado."""

from __future__ import annotations

import time
import tkinter as tk
import tkinter.messagebox as messagebox
from tkinter import ttk

import customtkinter as ctk

from eyedoptimizer.services.process_manager import ProcessInfo, ProcessManager
from eyedoptimizer.ui.widgets import SectionHeader


COLUMNS = (
    ("pid", "PID", 70),
    ("name", "Nombre", 260),
    ("cpu", "CPU %", 80),
    ("mem", "Memoria", 100),
    ("mem_pct", "Mem %", 80),
)


class TaskManagerPage(ctk.CTkFrame):
    def __init__(self, master, theme: dict, process_manager: ProcessManager, **kwargs) -> None:
        super().__init__(master, fg_color="transparent", **kwargs)
        self.theme = theme
        self.pm = process_manager
        self._processes: list[ProcessInfo] = []
        self._sort_col = "cpu"
        self._sort_reverse = True
        self._selected_pid: int | None = None
        self._auto_refresh = True
        self._refreshing = False
        self._render_job = None

        self.header = SectionHeader(
            self,
            "Administrador de tareas",
            "Vista detallada de procesos, recursos, E/S y conexiones",
            theme,
        )
        self.header.pack(fill="x", padx=8, pady=(4, 10))

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.pack(fill="x", padx=8, pady=(0, 8))

        self.search_var = tk.StringVar()
        self.search_entry = ctk.CTkEntry(
            toolbar,
            placeholder_text="Buscar por nombre, PID o usuario…",
            textvariable=self.search_var,
            width=280,
            height=36,
            corner_radius=8,
        )
        self.search_entry.pack(side="left", padx=(0, 8))
        self.search_var.trace_add("write", lambda *_: self._schedule_filter())

        self.refresh_btn = ctk.CTkButton(
            toolbar,
            text="Actualizar",
            width=120,
            height=36,
            command=self.refresh,
            fg_color=theme["accent"],
            hover_color=theme["accent_hover"],
        )
        self.refresh_btn.pack(side="left", padx=4)

        self.end_btn = ctk.CTkButton(
            toolbar,
            text="Finalizar",
            width=120,
            height=36,
            fg_color=theme["danger"],
            hover_color="#e04555",
            command=self._end_selected,
        )
        self.end_btn.pack(side="left", padx=4)

        self.details_btn = ctk.CTkButton(
            toolbar,
            text="Detalles",
            width=120,
            height=36,
            fg_color=theme["surface"],
            hover_color=theme["surface_alt"],
            border_width=1,
            border_color=theme["border"],
            text_color=theme["text"],
            command=self._show_details,
        )
        self.details_btn.pack(side="left", padx=4)

        self.count_lbl = ctk.CTkLabel(
            toolbar,
            text="0 procesos",
            font=ctk.CTkFont(size=12),
            text_color=theme["text_muted"],
        )
        self.count_lbl.pack(side="right", padx=4)

        table_wrap = ctk.CTkFrame(
            self,
            fg_color=theme["surface"],
            corner_radius=12,
            border_width=1,
            border_color=theme["border"],
        )
        table_wrap.pack(fill="both", expand=True, padx=8, pady=(0, 8))

        self._setup_style(theme)

        cols = [c[0] for c in COLUMNS]
        self.tree = ttk.Treeview(
            table_wrap,
            columns=cols,
            show="headings",
            selectmode="browse",
        )
        for key, title, width in COLUMNS:
            self.tree.heading(key, text=title, command=lambda k=key: self._sort_by(k))
            anchor = "e" if key in {"cpu", "mem", "mem_pct", "pid"} else "w"
            self.tree.column(key, width=width, minwidth=50, anchor=anchor)

        vsb = ttk.Scrollbar(table_wrap, orient="vertical", command=self.tree.yview)
        hsb = ttk.Scrollbar(table_wrap, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)

        self.tree.grid(row=0, column=0, sticky="nsew", padx=(8, 0), pady=(8, 0))
        vsb.grid(row=0, column=1, sticky="ns", pady=(8, 0), padx=(0, 8))
        hsb.grid(row=1, column=0, sticky="ew", padx=(8, 0), pady=(0, 8))
        table_wrap.grid_rowconfigure(0, weight=1)
        table_wrap.grid_columnconfigure(0, weight=1)

        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        self.tree.bind("<Double-1>", lambda _e: self._show_details())

        self.detail_panel = ctk.CTkTextbox(
            self,
            height=120,
            fg_color=theme["surface"],
            border_width=1,
            border_color=theme["border"],
            text_color=theme["text"],
            font=ctk.CTkFont(family="Consolas", size=11),
            corner_radius=10,
        )
        self.detail_panel.pack(fill="x", padx=8, pady=(0, 4))
        self.detail_panel.insert("1.0", "Selecciona un proceso para ver resumen rápido.")
        self.detail_panel.configure(state="disabled")

    def _setup_style(self, theme: dict) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(
            "Treeview",
            background=theme["surface"],
            foreground=theme["text"],
            fieldbackground=theme["surface"],
            borderwidth=0,
            rowheight=28,
            font=("Segoe UI", 10),
        )
        style.configure(
            "Treeview.Heading",
            background=theme["surface_alt"],
            foreground=theme["text"],
            relief="flat",
            font=("Segoe UI Semibold", 10),
        )
        style.map(
            "Treeview",
            background=[("selected", theme["selection"])],
            foreground=[("selected", theme["text"])],
        )
        style.map("Treeview.Heading", background=[("active", theme["border"])])

    def refresh(self) -> None:
        """Actualizacion asincrona para no congelar la UI al cambiar de pestana."""
        if self._refreshing:
            return
        self._refreshing = True
        self.count_lbl.configure(text="Cargando…")

        import threading

        def worker() -> None:
            try:
                data = self.pm.list_processes()
            except Exception:
                data = []
            try:
                self.after(0, lambda: self._apply_processes(data))
            except Exception:
                self._refreshing = False

        threading.Thread(target=worker, daemon=True).start()

    def _schedule_filter(self) -> None:
        if self._render_job is not None:
            try:
                self.after_cancel(self._render_job)
            except Exception:
                pass
        self._render_job = self.after(120, self._render_table)

    def _apply_processes(self, data: list[ProcessInfo]) -> None:
        self._processes = data
        self._refreshing = False
        self._render_table()

    def _filtered(self) -> list[ProcessInfo]:
        q = self.search_var.get().strip().lower()
        items = self._processes
        if q:
            items = [
                p
                for p in items
                if q in p.name.lower() or q in str(p.pid) or q in (p.status or "").lower()
            ]
        key_map = {
            "pid": lambda p: p.pid,
            "name": lambda p: p.name.lower(),
            "cpu": lambda p: p.cpu_percent,
            "mem": lambda p: p.memory_rss,
            "mem_pct": lambda p: p.memory_percent,
        }
        key_fn = key_map.get(self._sort_col, key_map["cpu"])
        return sorted(items, key=key_fn, reverse=self._sort_reverse)

    def _render_table(self) -> None:
        self._render_job = None
        selected = self._selected_pid
        children = self.tree.get_children()
        if children:
            self.tree.delete(*children)
        fmt = self.pm.format_bytes
        rows = self._filtered()
        insert = self.tree.insert
        # Limitar filas visibles al top 200 tras ordenar para UI fluida
        for p in rows[:200]:
            insert(
                "",
                "end",
                iid=str(p.pid),
                values=(
                    p.pid,
                    p.name,
                    f"{p.cpu_percent:.1f}",
                    fmt(p.memory_rss),
                    f"{p.memory_percent:.1f}",
                ),
            )
        shown = min(200, len(rows))
        self.count_lbl.configure(text=f"{shown} de {len(rows)} procesos")
        if selected is not None and self.tree.exists(str(selected)):
            self.tree.selection_set(str(selected))
            self.tree.see(str(selected))

    def _sort_by(self, col: str) -> None:
        if self._sort_col == col:
            self._sort_reverse = not self._sort_reverse
        else:
            self._sort_col = col
            self._sort_reverse = col in {"cpu", "mem", "mem_pct"}
        self._render_table()

    def _on_select(self, _event=None) -> None:
        sel = self.tree.selection()
        if not sel:
            return
        pid = int(sel[0])
        self._selected_pid = pid
        proc = next((p for p in self._processes if p.pid == pid), None)
        if not proc:
            return
        text = (
            f"PID {proc.pid} · {proc.name}\n"
            f"CPU {proc.cpu_percent:.1f}% · Memoria {self.pm.format_bytes(proc.memory_rss)} "
            f"({proc.memory_percent:.1f}%)\n"
            f"Pulsa Detalles para ver ejecutable, usuario, hilos y conexiones."
        )
        self.detail_panel.configure(state="normal")
        self.detail_panel.delete("1.0", "end")
        self.detail_panel.insert("1.0", text)
        self.detail_panel.configure(state="disabled")

    def _end_selected(self) -> None:
        if self._selected_pid is None:
            messagebox.showinfo("EyedOptimizer", "Selecciona un proceso primero.")
            return
        pid = self._selected_pid
        if not messagebox.askyesno("Finalizar proceso", f"¿Finalizar el proceso PID {pid}?"):
            return
        ok, msg = self.pm.kill_process(pid)
        messagebox.showinfo("EyedOptimizer", msg)
        if ok:
            self.refresh()

    def _show_details(self) -> None:
        if self._selected_pid is None:
            messagebox.showinfo("EyedOptimizer", "Selecciona un proceso primero.")
            return
        details = self.pm.process_details(self._selected_pid)
        if not details:
            messagebox.showwarning("EyedOptimizer", "No se pudieron obtener detalles.")
            return

        win = ctk.CTkToplevel(self)
        win.title(f"Detalles — {details['name']} ({details['pid']})")
        win.geometry("720x560")
        win.grab_set()

        box = ctk.CTkTextbox(win, font=ctk.CTkFont(family="Consolas", size=12))
        box.pack(fill="both", expand=True, padx=12, pady=12)

        fmt = self.pm.format_bytes
        lines = [
            f"Nombre:        {details['name']}",
            f"PID:           {details['pid']}",
            f"Padre (PPID):  {details['ppid']}",
            f"Estado:        {details['status']}",
            f"Usuario:       {details['username']}",
            f"Prioridad:     {details['nice']}",
            f"CPU:           {details['cpu_percent']:.1f}%",
            f"Memoria RSS:   {fmt(details['memory_rss'])}",
            f"Memoria VMS:   {fmt(details['memory_vms'])}",
            f"Memoria USS:   {fmt(details['memory_uss'])}",
            f"Memoria %:     {details['memory_percent']:.2f}%",
            f"Hilos:         {details['threads']}",
            f"Ejecutable:    {details['exe']}",
            f"Directorio:    {details['cwd']}",
            f"Línea cmd:     {details['cmdline']}",
            "",
            "=== E/S ===",
        ]
        for k, v in (details.get("io") or {}).items():
            lines.append(f"  {k}: {v if not str(k).endswith('bytes') else fmt(v)}")
        lines.append("")
        lines.append("=== Archivos abiertos ===")
        files = details.get("open_files") or []
        lines.extend([f"  {f}" for f in files] if files else ["  (ninguno / sin permiso)"])
        lines.append("")
        lines.append("=== Conexiones de red ===")
        conns = details.get("connections") or []
        lines.extend([f"  {c}" for c in conns] if conns else ["  (ninguna / sin permiso)"])

        box.insert("1.0", "\n".join(lines))
        box.configure(state="disabled")

        ctk.CTkButton(win, text="Cerrar", command=win.destroy, width=120).pack(pady=(0, 12))

    def apply_theme(self, theme: dict) -> None:
        self.theme = theme
        self.header.apply_theme(theme)
        self._setup_style(theme)
        self.refresh_btn.configure(fg_color=theme["accent"], hover_color=theme["accent_hover"])
        self.end_btn.configure(fg_color=theme["danger"])
        self.details_btn.configure(
            fg_color=theme["surface"],
            hover_color=theme["surface_alt"],
            border_color=theme["border"],
            text_color=theme["text"],
        )
        self.count_lbl.configure(text_color=theme["text_muted"])
        self.detail_panel.configure(
            fg_color=theme["surface"],
            border_color=theme["border"],
            text_color=theme["text"],
        )
