/** Descripciones en español de procesos comunes de Windows y apps frecuentes. */

const DESCRIPTIONS = {
  // Sistema
  system: 'Nucleo del sistema operativo Windows. Gestiona memoria, dispositivos y servicios basicos.',
  idle: 'Proceso inactivo: representa el tiempo de CPU que no esta en uso.',
  registry: 'Proceso del registro de Windows (clave del sistema).',
  smss: 'Gestor de sesiones de Windows. Arranca el resto del sistema al iniciar.',
  csrss: 'Subsistema de tiempo de ejecucion de cliente/servidor. Parte critica de Windows.',
  wininit: 'Inicializacion de Windows. Arranca servicios esenciales tras el arranque.',
  services: 'Administrador de servicios del sistema (Service Control Manager).',
  lsass: 'Autoridad de seguridad local. Autenticacion de usuarios y politicas de seguridad.',
  svchost: 'Contenedor de servicios de Windows. Aloja uno o varios servicios del sistema.',
  winlogon: 'Gestiona el inicio de sesion interactivo (Ctrl+Alt+Supr, pantalla de bloqueo).',
  dwm: 'Administrador de ventanas de escritorio. Composicion, transparencia y efectos visuales.',
  explorer: 'Explorador de Windows: barra de tareas, escritorio y navegacion de archivos.',
  taskhostw: 'Anfitrion de tareas programadas de Windows.',
  taskmgr: 'Administrador de tareas de Windows.',
  sihost: 'Anfitrion de infraestructura de shell. Soporta elementos de la interfaz.',
  runtimebroker: 'Intermediario de permisos para aplicaciones UWP/Store.',
  searchhost: 'Interfaz de busqueda de Windows (menu Inicio / buscar).',
  searchindexer: 'Indexa archivos para que la busqueda de Windows sea rapida.',
  startmenuexperiencehost: 'Interfaz del menu Inicio de Windows.',
  shellexperiencehost: 'Notificaciones, reloj, bandeja y elementos de la interfaz.',
  textinputhost: 'Entrada de texto, teclado tactil y emojis.',
  applicationframehost: 'Marco de ventanas para aplicaciones de Microsoft Store.',
  systemsettings: 'Aplicacion de Configuracion de Windows.',
  fontdrvhost: 'Anfitrion del controlador de fuentes.',
  conhost: 'Anfitrion de consola (ventanas de terminal / CMD).',
  dllhost: 'Anfitrion de objetos COM (DLL). Ejecuta componentes bajo demanda.',
  wmiadap: 'Adaptador de rendimiento WMI.',
  wmiprvse: 'Proveedor WMI: consulta de informacion del sistema por otras apps.',
  spoolsv: 'Cola de impresion de Windows.',
  audiodg: 'Motor de audio de Windows (aislamiento de audio).',
  ctfmon: 'Servicio de texto y idiomas de entrada.',
  securityhealthservice: 'Servicio de seguridad de Windows (Windows Security).',
  msmpeng: 'Motor antivirus de Microsoft Defender.',
  nissrv: 'Servicio de inspeccion de red de Defender.',
  smartscreen: 'Windows SmartScreen: proteccion frente a apps y sitios sospechosos.',
  'memory compression': 'Compresion de memoria de Windows para liberar RAM fisica.',
  'secure system': 'Proceso protegido del kernel (VBS / seguridad basada en virtualizacion).',
  'system interrupts': 'Tiempo de CPU dedicado a interrupciones de hardware.',
  // Apps frecuentes
  chrome: 'Google Chrome: navegador web.',
  msedge: 'Microsoft Edge: navegador web.',
  firefox: 'Mozilla Firefox: navegador web.',
  opera: 'Opera: navegador web.',
  brave: 'Brave: navegador web centrado en privacidad.',
  discord: 'Discord: chat de voz y texto para comunidades y juegos.',
  spotify: 'Spotify: reproduccion de musica en streaming.',
  code: 'Visual Studio Code: editor de codigo.',
  cursor: 'Cursor: editor de codigo con IA.',
  steam: 'Cliente Steam: biblioteca y lanzador de juegos.',
  steamwebhelper: 'Proceso auxiliar web del cliente Steam.',
  epicgameslauncher: 'Epic Games Launcher: tienda y juegos de Epic.',
  nvidia: 'Procesos de controladores / utilidades NVIDIA.',
  nvcontainer: 'Contenedor de servicios NVIDIA (telemetria, overlay, etc.).',
  'nvidia share': 'GeForce Experience / captura y comparticion NVIDIA.',
  amdow: 'AMD: captura y retransmision (Radeon Software).',
  radeonsoftware: 'AMD Radeon Software: panel de control de GPU AMD.',
  teams: 'Microsoft Teams: comunicacion y videollamadas.',
  outlook: 'Microsoft Outlook: correo y calendario.',
  winword: 'Microsoft Word: procesador de textos.',
  excel: 'Microsoft Excel: hojas de calculo.',
  powerpnt: 'Microsoft PowerPoint: presentaciones.',
  onedrive: 'Microsoft OneDrive: sincronizacion de archivos en la nube.',
  dropbox: 'Dropbox: sincronizacion de archivos en la nube.',
  skype: 'Skype: llamadas y mensajeria.',
  zoom: 'Zoom: videoconferencias.',
  slack: 'Slack: mensajeria para equipos de trabajo.',
  notepad: 'Bloc de notas de Windows.',
  'notepad++': 'Notepad++: editor de texto avanzado.',
  powershell: 'Windows PowerShell: consola y automatizacion.',
  pwsh: 'PowerShell 7+: consola moderna multiplataforma.',
  cmd: 'Interprete de comandos (CMD) de Windows.',
  windowsterminal: 'Terminal de Windows.',
  eyedoptimizer: 'EyedOptimizer: monitor y optimizador de recursos.',
  electron: 'Runtime Electron (aplicaciones de escritorio basadas en web).',
  presentmon: 'PresentMon: captura de FPS y tiempos de frame en juegos.',
  robloxplayerbeta: 'Cliente de Roblox (jugador).',
  roblox: 'Roblox: plataforma de juegos.',
  javaw: 'Java (sin consola). Suele ejecutar Minecraft u otras apps Java.',
  minecraft: 'Minecraft: juego de construccion y supervivencia.',
  valorant: 'VALORANT: shooter competitivo de Riot Games.',
  'valorant-win64-shipping': 'VALORANT (ejecutable principal del juego).',
  'fortniteclient-win64-shipping': 'Fortnite: ejecutable principal del juego.',
  cs2: 'Counter-Strike 2.',
  gta5: 'Grand Theft Auto V.',
  obs64: 'OBS Studio: grabacion y retransmision en vivo.',
  obs: 'OBS Studio: grabacion y retransmision.',
  vlc: 'VLC: reproductor multimedia.',
  snippingtool: 'Herramienta Recortes de Windows.',
  widgetservice: 'Servicio de widgets de Windows.',
  phoneexperiencehost: 'Enlace con el telefono (Phone Link).',
  yourphone: 'Phone Link / Tu Telefono.',
  gamebar: 'Xbox Game Bar: captura y overlay de Xbox.',
  gamebarftserver: 'Servicio auxiliar de Xbox Game Bar.',
}

function normalizeName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/\.exe$/i, '')
    .trim()
}

function describeProcess(name = '', pathHint = '') {
  const key = normalizeName(name)
  if (!key) return 'Proceso del sistema o de una aplicacion instalada.'

  if (DESCRIPTIONS[key]) return DESCRIPTIONS[key]

  // Coincidencias parciales
  const partial = Object.keys(DESCRIPTIONS).find((k) => key.includes(k) || k.includes(key))
  if (partial) return DESCRIPTIONS[partial]

  const hint = String(pathHint || '').toLowerCase()
  if (hint.includes('\\windows\\system32') || hint.includes('\\windows\\syswow64')) {
    return 'Componente o utilidad del sistema Windows (System32).'
  }
  if (hint.includes('\\windowsapps\\')) {
    return 'Aplicacion de Microsoft Store (UWP/AppX).'
  }
  if (hint.includes('program files')) {
    return `Aplicacion instalada: ${name}. Ejecutable de usuario o de terceros.`
  }
  if (/service|svc/i.test(key)) {
    return `Servicio o proceso auxiliar asociado a ${name}.`
  }
  if (/update|updater|installer/i.test(key)) {
    return `Actualizador o instalador relacionado con ${name}.`
  }
  if (/helper|host|broker/i.test(key)) {
    return `Proceso auxiliar (helper/host) de ${name}.`
  }

  return `Proceso en ejecucion: ${name}. Forma parte de una aplicacion o servicio instalado en el equipo.`
}

function enrichProcess(proc) {
  return {
    ...proc,
    description: describeProcess(proc.name, proc.path || proc.exe || ''),
  }
}

module.exports = { describeProcess, enrichProcess, DESCRIPTIONS }
