const { execFile } = require('node:child_process')
const si = require('systeminformation')
const { isWindows } = require('./platform.cjs')

function runPs(script, timeout = 20000) {
  if (!isWindows) return Promise.resolve('')
  return new Promise((resolve) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve('')
        resolve(String(stdout || '').trim())
      },
    )
  })
}

function fmtBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.max(0, Number(n) || 0)
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(i > 1 ? 1 : 0)} ${u[i]}`
}

async function getDiskInfo() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$volumes = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ForEach-Object {
  [ordered]@{
    mount = $_.DeviceID
    label = $_.VolumeName
    fs = $_.FileSystem
    total = [int64]$_.Size
    free = [int64]$_.FreeSpace
    used = [int64]($_.Size - $_.FreeSpace)
    percent = if ($_.Size -gt 0) { [math]::Round((($_.Size - $_.FreeSpace) / $_.Size) * 100, 1) } else { 0 }
  }
}
$disks = @()
Get-PhysicalDisk | ForEach-Object {
  $pd = $_
  $life = $null
  $temp = $null
  $powerOn = $null
  try {
    $c = Get-StorageReliabilityCounter -PhysicalDisk $pd -EA SilentlyContinue
    if ($c) {
      if ($null -ne $c.Wear) { $life = [int](100 - [math]::Min(100, [int]$c.Wear)) }
      if ($null -ne $c.Temperature) { $temp = [int]$c.Temperature }
      if ($null -ne $c.PowerOnHours) { $powerOn = [int64]$c.PowerOnHours }
      if ($null -eq $temp -and $null -ne $c.TemperatureMax) { $temp = [int]$c.TemperatureMax }
    }
  } catch {}
  # Fallback NVMe / SMART vía MSFT_PhysicalDisk + Reliability
  if ($null -eq $temp -or $null -eq $powerOn -or $null -eq $life) {
    try {
      $msft = Get-CimInstance -Namespace root/Microsoft/Windows/Storage -ClassName MSFT_PhysicalDisk -EA SilentlyContinue |
        Where-Object { $_.DeviceId -eq $pd.DeviceId } | Select-Object -First 1
      if ($msft) {
        $c2 = Get-CimAssociatedInstance -InputObject $msft -ResultClassName MSFT_StorageReliabilityCounter -EA SilentlyContinue |
          Select-Object -First 1
        if ($c2) {
          if ($null -eq $life -and $null -ne $c2.Wear) { $life = [int](100 - [math]::Min(100, [int]$c2.Wear)) }
          if ($null -eq $temp -and $null -ne $c2.Temperature) { $temp = [int]$c2.Temperature }
          if ($null -eq $powerOn -and $null -ne $c2.PowerOnHours) { $powerOn = [int64]$c2.PowerOnHours }
        }
      }
    } catch {}
  }
  # smartctl si está en PATH
  if (($null -eq $temp -or $null -eq $powerOn) -and (Get-Command smartctl -EA SilentlyContinue)) {
    try {
      $smart = smartctl -a -j ($pd.FriendlyName) 2>$null | ConvertFrom-Json
      if ($smart) {
        if ($null -eq $temp -and $smart.temperature.current) { $temp = [int]$smart.temperature.current }
        if ($null -eq $powerOn -and $smart.power_on_time.hours) { $powerOn = [int64]$smart.power_on_time.hours }
        if ($null -eq $life -and $smart.nvme_smart_health_information_log.percentage_used -ne $null) {
          $life = [int](100 - [math]::Min(100, [int]$smart.nvme_smart_health_information_log.percentage_used))
        }
      }
    } catch {}
  }
  $health = [string]$pd.HealthStatus
  $status = 'ok'
  if ($health -match 'Warning') { $status = 'warning' }
  elseif ($health -match 'Unhealthy|Fail') { $status = 'critical' }
  elseif ($null -ne $life -and $life -lt 20) { $status = 'critical' }
  elseif ($null -ne $life -and $life -lt 40) { $status = 'warning' }
  $disks += [ordered]@{
    name = $pd.FriendlyName
    media = [string]$pd.MediaType
    bus = [string]$pd.BusType
    size = [int64]$pd.Size
    health = $health
    operational = [string]$pd.OperationalStatus
    lifePercent = $life
    temperature = $temp
    powerOnHours = $powerOn
    status = $status
    serial = [string]$pd.SerialNumber
  }
}
@{ volumes = @($volumes); disks = @($disks) } | ConvertTo-Json -Compress -Depth 5
`
  const raw = await runPs(script, 25000)
  let volumes = []
  let disks = []
  if (raw) {
    try {
      const data = JSON.parse(raw)
      volumes = Array.isArray(data.volumes) ? data.volumes : data.volumes ? [data.volumes] : []
      disks = Array.isArray(data.disks) ? data.disks : data.disks ? [data.disks] : []
    } catch {
      /* fallback abajo */
    }
  }

  if (!volumes.length) {
    try {
      const fs = await si.fsSize()
      volumes = (fs || []).map((v) => ({
        mount: v.mount,
        label: v.fs || '',
        fs: v.type || '',
        total: v.size,
        free: v.available,
        used: v.used,
        percent: Math.round((v.use || 0) * 10) / 10,
      }))
    } catch {
      volumes = []
    }
  }

  if (!disks.length) {
    try {
      const layout = await si.diskLayout()
      disks = (layout || []).map((d) => {
        const life =
          d.lifeLeft != null
            ? Number(d.lifeLeft)
            : d.smartStatus && /ok/i.test(String(d.smartStatus))
              ? null
              : null
        let status = 'ok'
        const smart = String(d.smartStatus || d.health || 'unknown')
        if (/fail|bad|critical/i.test(smart)) status = 'critical'
        else if (/warn|predict/i.test(smart)) status = 'warning'
        return {
          name: d.name || d.device || 'Disco',
          media: d.type || d.interfaceType || 'Unknown',
          bus: d.interfaceType || '',
          size: d.size || 0,
          health: smart,
          operational: 'OK',
          lifePercent: Number.isFinite(life) ? life : null,
          temperature: d.temperature ?? null,
          powerOnHours: null,
          status,
          serial: d.serialNum || '',
        }
      })
    } catch {
      disks = []
    }
  }

  const primary = volumes.find((v) => /^C:/i.test(v.mount)) || volumes[0] || null

  function healthPercent(d) {
    if (d.lifePercent != null && Number.isFinite(d.lifePercent)) return Math.max(0, Math.min(100, d.lifePercent))
    const h = String(d.health || '').toLowerCase()
    if (/healthy|ok|good|normal/.test(h)) return 92
    if (/warning|warn|caution/.test(h)) return 58
    if (/unhealthy|fail|bad|critical|error/.test(h)) return 22
    if (d.status === 'critical') return 18
    if (d.status === 'warning') return 55
    if (d.status === 'ok') return 88
    return null
  }

  return {
    volumes: volumes.map((v) => ({
      ...v,
      totalLabel: fmtBytes(v.total),
      usedLabel: fmtBytes(v.used),
      freeLabel: fmtBytes(v.free),
    })),
    disks: disks.map((d) => {
      const hp = healthPercent(d)
      return {
        ...d,
        sizeLabel: fmtBytes(d.size),
        healthPercent: hp,
        healthPercentLabel: hp == null ? 'N/D' : `${hp}%`,
        lifeLabel:
          d.lifePercent == null
            ? 'Vida util N/D'
            : `${d.lifePercent}% vida restante`,
        statusLabel:
          d.status === 'critical'
            ? 'Critico'
            : d.status === 'warning'
              ? 'Atencion'
              : 'Saludable',
      }
    }),
    primary,
  }
}

async function getAdvancedSpecs() {
  const script = `
$ErrorActionPreference='SilentlyContinue'
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$bios = Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$base = Get-CimInstance Win32_BaseBoard
$gpu = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -and $_.Name -notmatch 'Basic|Microsoft' })
$ram = @(Get-CimInstance Win32_PhysicalMemory)
$net = @(Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.NetEnabled -eq $true -and $_.PhysicalAdapter -eq $true })
$bat = @(Get-CimInstance Win32_Battery)
[ordered]@{
  manufacturer = $cs.Manufacturer
  model = $cs.Model
  family = $cs.SystemFamily
  hostname = $env:COMPUTERNAME
  username = $env:USERNAME
  bios = $bios.SMBIOSBIOSVersion
  biosDate = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { '' }
  serial = $bios.SerialNumber
  board = ($base.Manufacturer + ' ' + $base.Product).Trim()
  os = $os.Caption
  osVersion = $os.Version
  osBuild = $os.BuildNumber
  osArch = $os.OSArchitecture
  installDate = if ($os.InstallDate) { $os.InstallDate.ToString('yyyy-MM-dd') } else { '' }
  lastBoot = if ($os.LastBootUpTime) { $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') } else { '' }
  cpuName = $cpu.Name
  cpuCores = [int]$cpu.NumberOfCores
  cpuThreads = [int]$cpu.NumberOfLogicalProcessors
  cpuMaxMhz = [int]$cpu.MaxClockSpeed
  cpuL2 = [int64]$cpu.L2CacheSize
  cpuL3 = [int64]$cpu.L3CacheSize
  totalRam = [int64]$cs.TotalPhysicalMemory
  ramModules = @($ram | ForEach-Object {
    [ordered]@{
      bank = $_.BankLabel
      capacity = [int64]$_.Capacity
      speed = [int]$_.Speed
      manufacturer = $_.Manufacturer
      part = $_.PartNumber
    }
  })
  gpus = @($gpu | ForEach-Object {
    [ordered]@{
      name = $_.Name
      driver = $_.DriverVersion
      vram = [int64]$_.AdapterRAM
      res = $_.CurrentHorizontalResolution.ToString() + 'x' + $_.CurrentVerticalResolution.ToString()
    }
  })
  adapters = @($net | Select-Object -First 8 | ForEach-Object {
    [ordered]@{ name = $_.Name; mac = $_.MACAddress; speed = $_.Speed }
  })
  battery = if ($bat.Count -gt 0) {
    $b = $bat[0]
    [ordered]@{
      name = $b.Name
      charge = [int]$b.EstimatedChargeRemaining
      status = [string]$b.BatteryStatus
    }
  } else { $null }
} | ConvertTo-Json -Compress -Depth 6
`
  const raw = await runPs(script, 25000)
  let data = {}
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      data = {}
    }
  }

  let cpuSi = {}
  let memSi = {}
  let osSi = {}
  try {
    ;[cpuSi, memSi, osSi] = await Promise.all([si.cpu(), si.mem(), si.osInfo()])
  } catch {
    /* ignore */
  }

  const ramModules = Array.isArray(data.ramModules)
    ? data.ramModules
    : data.ramModules
      ? [data.ramModules]
      : []
  const gpus = Array.isArray(data.gpus) ? data.gpus : data.gpus ? [data.gpus] : []
  const adapters = Array.isArray(data.adapters)
    ? data.adapters
    : data.adapters
      ? [data.adapters]
      : []

  return {
    device: {
      manufacturer: data.manufacturer || 'Desconocido',
      model: data.model || 'Desconocido',
      family: data.family || '',
      hostname: data.hostname || osSi.hostname || '',
      username: data.username || '',
      board: data.board || '',
      bios: data.bios || '',
      biosDate: data.biosDate || '',
      serial: data.serial || '',
    },
    os: {
      name: (data.os || osSi.distro || 'Windows').replace(/^Microsoft\s+/i, ''),
      version: data.osVersion || osSi.release || '',
      build: data.osBuild || osSi.build || '',
      arch: data.osArch || osSi.arch || '',
      installDate: data.installDate || '',
      lastBoot: data.lastBoot || '',
    },
    cpu: {
      name: data.cpuName || [cpuSi.manufacturer, cpuSi.brand].filter(Boolean).join(' ') || 'CPU',
      cores: data.cpuCores || cpuSi.physicalCores || 0,
      threads: data.cpuThreads || cpuSi.cores || 0,
      maxMhz: data.cpuMaxMhz || cpuSi.speedMax || 0,
      l2: data.cpuL2 || 0,
      l3: data.cpuL3 || 0,
      manufacturer: cpuSi.manufacturer || '',
      socket: cpuSi.socket || '',
    },
    ram: {
      total: data.totalRam || memSi.total || 0,
      totalLabel: fmtBytes(data.totalRam || memSi.total || 0),
      used: memSi.active || memSi.used || 0,
      usedLabel: fmtBytes(memSi.active || memSi.used || 0),
      available: memSi.available || 0,
      availableLabel: fmtBytes(memSi.available || 0),
      percent:
        memSi.total > 0
          ? Math.round(((memSi.active || memSi.used || 0) / memSi.total) * 1000) / 10
          : 0,
      modules: ramModules.map((m) => ({
        ...m,
        capacityLabel: fmtBytes(m.capacity),
      })),
    },
    gpus: gpus.map((g) => ({
      ...g,
      vramLabel: g.vram > 0 && g.vram < 0xffffffff ? fmtBytes(g.vram) : 'N/D',
    })),
    adapters,
    battery: data.battery || null,
  }
}

module.exports = { getDiskInfo, getAdvancedSpecs, fmtBytes }
