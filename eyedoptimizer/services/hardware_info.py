"""Detección de marca, modelo, tipo de equipo y sistema operativo."""

from __future__ import annotations

import json
import platform
import re
import subprocess
from dataclasses import asdict, dataclass
from functools import lru_cache


# ChassisTypes SMBIOS: portátiles / convertibles
_LAPTOP_CHASSIS = {8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32}


@dataclass(frozen=True)
class HardwareInfo:
    manufacturer: str = "Desconocido"
    model: str = "Desconocido"
    system_family: str = ""
    device_type: str = "Equipo"  # Portátil / Sobremesa / All-in-One / Servidor / Equipo
    is_laptop: bool = False
    chassis_types: tuple[int, ...] = ()
    serial_number: str = ""
    bios_version: str = ""
    cpu_name: str = ""
    os_caption: str = ""
    os_version: str = ""
    os_build: str = ""
    os_arch: str = ""
    os_install_date: str = ""
    total_ram_gb: float = 0.0
    hostname: str = ""

    @property
    def brand_model(self) -> str:
        brand = self.manufacturer.strip() or "Desconocido"
        model = self.model.strip() or "Desconocido"
        if model.lower().startswith(brand.lower()):
            return model
        return f"{brand} {model}".strip()

    @property
    def os_full(self) -> str:
        parts = [self.os_caption or platform.system()]
        if self.os_build:
            parts.append(f"Build {self.os_build}")
        if self.os_arch:
            parts.append(self.os_arch)
        return " · ".join(parts)

    def to_dict(self) -> dict:
        return asdict(self)


def _run_ps(script: str) -> str:
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            capture_output=True,
            text=True,
            timeout=12,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if completed.returncode != 0:
            return ""
        return (completed.stdout or "").strip()
    except Exception:
        return ""


def _clean(value: str | None, fallback: str = "Desconocido") -> str:
    if not value:
        return fallback
    text = str(value).strip()
    if not text or text.lower() in {"n/a", "none", "null", "to be filled by o.e.m.", "default string"}:
        return fallback
    return text


def _parse_chassis(raw: str) -> tuple[int, ...]:
    nums = [int(x) for x in re.findall(r"\d+", raw or "")]
    return tuple(nums)


def _device_type(chassis: tuple[int, ...], pc_system_type: int, has_battery: bool) -> tuple[str, bool]:
    if any(c in _LAPTOP_CHASSIS for c in chassis) or pc_system_type == 2 or has_battery:
        return "Portátil", True
    if 13 in chassis or 35 in chassis or 36 in chassis:
        return "All-in-One", False
    if 3 in chassis or 4 in chassis or 5 in chassis or 6 in chassis or 7 in chassis or pc_system_type == 1:
        return "Sobremesa", False
    if 17 in chassis or 23 in chassis:
        return "Servidor", False
    if has_battery:
        return "Portátil", True
    return "Equipo", False


@lru_cache(maxsize=1)
def get_hardware_info() -> HardwareInfo:
    """Consulta WMI una sola vez y cachea el resultado."""
    script = r"""
$ErrorActionPreference = 'SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$enc = Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$bat = @(Get-CimInstance Win32_Battery)
$obj = [ordered]@{
  Manufacturer = $cs.Manufacturer
  Model = $cs.Model
  SystemFamily = $cs.SystemFamily
  PCSystemType = [int]$cs.PCSystemType
  ChassisTypes = @($enc.ChassisTypes)
  SerialNumber = $bios.SerialNumber
  BiosVersion = $bios.SMBIOSBIOSVersion
  CpuName = $cpu.Name
  OsCaption = $os.Caption
  OsVersion = $os.Version
  OsBuild = $os.BuildNumber
  OsArch = $os.OSArchitecture
  OsInstallDate = if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { '' }
  TotalRamGb = [math]::Round(($cs.TotalPhysicalMemory / 1GB), 1)
  Hostname = $env:COMPUTERNAME
  HasBattery = ($bat.Count -gt 0)
}
$obj | ConvertTo-Json -Compress
"""
    raw = _run_ps(script)
    data: dict = {}
    if raw:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {}

    chassis_raw = data.get("ChassisTypes", [])
    if isinstance(chassis_raw, list):
        chassis = tuple(int(x) for x in chassis_raw if str(x).isdigit() or isinstance(x, int))
    else:
        chassis = _parse_chassis(str(chassis_raw))

    pc_type = int(data.get("PCSystemType") or 0)
    has_battery = bool(data.get("HasBattery"))
    # Refuerzo con psutil battery
    try:
        import psutil

        if psutil.sensors_battery() is not None:
            has_battery = True
    except Exception:
        pass

    device_type, is_laptop = _device_type(chassis, pc_type, has_battery)

    uname = platform.uname()
    os_caption = _clean(data.get("OsCaption"), f"{uname.system} {uname.release}")
    # Quitar marca registrada rara
    os_caption = os_caption.replace("Microsoft ", "")

    return HardwareInfo(
        manufacturer=_clean(data.get("Manufacturer")),
        model=_clean(data.get("Model")),
        system_family=_clean(data.get("SystemFamily"), ""),
        device_type=device_type,
        is_laptop=is_laptop,
        chassis_types=chassis,
        serial_number=_clean(data.get("SerialNumber"), ""),
        bios_version=_clean(data.get("BiosVersion"), ""),
        cpu_name=_clean(data.get("CpuName"), platform.processor() or "CPU"),
        os_caption=os_caption,
        os_version=_clean(data.get("OsVersion"), uname.version),
        os_build=_clean(data.get("OsBuild"), ""),
        os_arch=_clean(data.get("OsArch"), platform.machine()),
        os_install_date=_clean(data.get("OsInstallDate"), ""),
        total_ram_gb=float(data.get("TotalRamGb") or 0.0),
        hostname=_clean(data.get("Hostname"), platform.node()),
    )
