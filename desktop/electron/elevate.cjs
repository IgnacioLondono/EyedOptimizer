const { execFile } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { isWindows, unsupported } = require('./platform.cjs')

let adminCache = null
let adminCacheAt = 0

function cleanPsError(msg) {
  const raw = String(msg || '')
  if (/access denied|permissiondenied|40001|requiere.*admin|elevat/i.test(raw)) {
    return 'Se necesitan permisos de administrador. Acepta el aviso UAC.'
  }
  // Quitar stack ruidoso de PowerShell
  const first = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !/^At |^\+|CategoryInfo|FullyQualifiedErrorId|Activity ID/i.test(l))
  return (first || raw).slice(0, 220)
}

/** ¿La cuenta puede elevarse (grupo Administrators)? Cache 60s. */
async function canElevate() {
  if (!isWindows) return false
  const now = Date.now()
  if (adminCache != null && now - adminCacheAt < 60000) return adminCache
  const ok = await new Promise((resolve) => {
    execFile(
      'powershell',
      [
        '-NoProfile',
        '-NoLogo',
        '-Command',
        "(whoami /groups 2>$null) -match 'S-1-5-32-544'",
      ],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(true)
        const t = String(stdout || '').trim().toLowerCase()
        resolve(t === 'true')
      },
    )
  })
  adminCache = !!ok
  adminCacheAt = now
  return adminCache
}

/**
 * Elevación clásica con diálogo UAC (Start-Process -Verb RunAs).
 */
async function runElevatedPsUac(scriptBody, timeoutMs = 180000) {
  if (!isWindows) {
    return unsupported('uacElevation', 'La elevación UAC solo está disponible en Windows.')
  }
  const eligible = await canElevate()
  if (!eligible) {
    return {
      ok: false,
      output: '',
      reason: 'no-admin-account',
      message:
        'Tu cuenta de Windows no es administrador. Inicia sesión con una cuenta admin o pide elevación a IT.',
    }
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ps1 = path.join(os.tmpdir(), `eyed-elev-${id}.ps1`)
  const outFile = path.join(os.tmpdir(), `eyed-elev-out-${id}.txt`)
  const statusFile = path.join(os.tmpdir(), `eyed-elev-status-${id}.txt`)
  const launcher = path.join(os.tmpdir(), `eyed-elev-launch-${id}.ps1`)

  const body = String(scriptBody || '')
  fs.writeFileSync(
    ps1,
    `
$ErrorActionPreference = 'Continue'
$out = '${outFile.replace(/'/g, "''")}'
$st = '${statusFile.replace(/'/g, "''")}'
try {
  $result = & {
${body}
  } 2>&1 | Out-String
  Set-Content -LiteralPath $out -Value $result -Encoding UTF8
  Set-Content -LiteralPath $st -Value 'OK' -Encoding UTF8
} catch {
  Set-Content -LiteralPath $out -Value ($_ | Out-String) -Encoding UTF8
  Set-Content -LiteralPath $st -Value 'FAIL' -Encoding UTF8
}
`,
    'utf8',
  )

  fs.writeFileSync(
    launcher,
    `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1.replace(/'/g, "''")}')`,
    'utf8',
  )

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'powershell',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher],
        { windowsHide: true, timeout: timeoutMs },
        (err) => {
          if (err && !fs.existsSync(statusFile)) {
            reject(new Error('UAC cancelado o elevación fallida'))
            return
          }
          resolve()
        },
      )
    })

    const status = fs.existsSync(statusFile) ? fs.readFileSync(statusFile, 'utf8').trim() : 'FAIL'
    const output = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').trim() : ''
    if (status !== 'OK') {
      return { ok: false, output, message: cleanPsError(output) || 'Comando elevado falló' }
    }
    return { ok: true, output, message: output.slice(0, 300) || 'OK' }
  } catch (e) {
    return { ok: false, output: '', message: cleanPsError(e.message) || 'UAC cancelado' }
  } finally {
    for (const f of [ps1, outFile, statusFile, launcher]) {
      try {
        fs.unlinkSync(f)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Ejecuta PowerShell elevado.
 * Preferencia: agente privilegiado (sin UAC). Si no está, un UAC clásico.
 * @param {string} scriptBody
 * @param {number} [timeoutMs]
 * @param {{ forceUac?: boolean }} [opts] forceUac=true solo para instalar el agente
 */
async function runElevatedPs(scriptBody, timeoutMs = 180000, opts = {}) {
  if (!isWindows) {
    return unsupported('uacElevation', 'La elevación UAC solo está disponible en Windows.')
  }
  if (!opts.forceUac) {
    try {
      const agent = require('./priv-agent.cjs')
      const via = await agent.runJob(scriptBody, timeoutMs)
      if (via) return via
    } catch {
      /* fallback UAC */
    }
  }
  return runElevatedPsUac(scriptBody, timeoutMs)
}

module.exports = { runElevatedPs, runElevatedPsUac, cleanPsError, canElevate }
