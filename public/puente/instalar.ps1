# ============================================================
# Instalador del puente de escaneo Ortosend - PC del escáner (Windows)
# ============================================================
# Lo descarga el administrador de la clínica desde Panel -> Puente de escaneo
# (ya con el servidor y el token puestos) y lo ejecuta con doble clic en el
# PC donde está Revo Scan. Hace todo lo que haría una persona:
#   1. Instala Node (si no está).
#   2. Copia el puente a C:\Ortosend\puente-escaneo.
#   3. Detecta la carpeta de escaneos de Revo Scan y escribe la configuración.
#   4. Lo deja arrancando solo al iniciar sesión en Windows y lo arranca ahora.
param(
  [Parameter(Mandatory = $true)] [string] $Servidor,
  [Parameter(Mandatory = $true)] [string] $Token
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Hace falta ser administrador para dejar el puente como servicio (tarea del
# sistema): si no lo somos, se relanza pidiendo permiso (aviso de Windows).
$esAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $esAdmin) {
  Write-Host "Windows va a pedir permiso de administrador para instalar el puente como servicio..." -ForegroundColor Yellow
  $args = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Servidor `"$Servidor`" -Token `"$Token`""
  Start-Process powershell.exe -Verb RunAs -ArgumentList $args -Wait
  exit
}

function Paso($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    $t" -ForegroundColor Green }

$Destino = "C:\Ortosend\puente-escaneo"
$Escaneos = "C:\Ortosend\Escaneos"

Write-Host "Puente de escaneo Ortosend - instalación" -ForegroundColor Yellow
Write-Host "Servidor: $Servidor"

# --- 1. Node ---------------------------------------------------------------
Paso "Comprobando Node"
function NodeExe {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}
$node = NodeExe
if ($node) {
  Ok "Node ya instalado: $(& $node -v)"
} else {
  Write-Host "    Node no está instalado. Instalando (puede tardar un par de minutos)..."
  $instalado = $false
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    try {
      winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null
      $instalado = $true
    } catch { $instalado = $false }
  }
  if (-not $instalado) {
    # Sin winget: MSI oficial. El nombre lleva la versión exacta, se lee del índice.
    $msi = Join-Path $env:TEMP "node-lts.msi"
    $idx = Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/"
    $nombre = ([regex]::Match($idx.Content, 'node-v22\.[0-9.]+-x64\.msi')).Value
    if (-not $nombre) { throw "No se pudo localizar el instalador de Node. Instálalo a mano desde https://nodejs.org (LTS) y vuelve a ejecutar este instalador." }
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v22.x/$nombre" -OutFile $msi
    Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /qn /norestart" -Wait
  }
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $node = NodeExe
  if (-not $node) { throw "No se pudo instalar Node. Instálalo a mano desde https://nodejs.org (versión LTS) y vuelve a ejecutar este instalador." }
  Ok "Node instalado: $(& $node -v)"
}

# --- 2. Archivos del puente ---------------------------------------------
Paso "Copiando el puente a $Destino"
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
New-Item -ItemType Directory -Force -Path $Escaneos | Out-Null
foreach ($f in @("puente.js", "zip.js", "iniciar-puente.bat")) {
  Invoke-WebRequest -UseBasicParsing "$Servidor/puente/$f" -OutFile (Join-Path $Destino $f)
}
Ok "puente.js, zip.js e iniciar-puente.bat descargados"

# --- 3. Carpeta de Revo Scan y configuración ----------------------------------
Paso "Buscando la carpeta de escaneos de Revo Scan"
$carpetaRevo = ""
$candidatos = @(
  (Join-Path $env:APPDATA "RevoScan5\Projects"),
  (Join-Path $env:APPDATA "RevoScan6\Projects"),
  (Join-Path $env:APPDATA "RevoScan\Projects"),
  (Join-Path ([Environment]::GetFolderPath("MyDocuments")) "Revo Scan")
)
# Con permiso de administrador, $env:APPDATA puede ser el de otro usuario:
# se miran las carpetas de Revo Scan de todos los usuarios del PC.
Get-ChildItem "C:\Users" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
  Get-ChildItem (Join-Path $_.FullName "AppData\Roaming") -Directory -Filter "RevoScan*" -ErrorAction SilentlyContinue | ForEach-Object {
    $candidatos += (Join-Path $_.FullName "Projects")
    $candidatos += $_.FullName
  }
}
foreach ($c in $candidatos) { if ($c -and (Test-Path $c)) { $carpetaRevo = $c; break } }
if (-not $carpetaRevo) {
  $otras = Get-ChildItem -Path $env:APPDATA -Directory -Filter "RevoScan*" -ErrorAction SilentlyContinue
  if ($otras) { $carpetaRevo = $otras[0].FullName }
}
if ($carpetaRevo) {
  Ok "Revo Scan guarda los escaneos en: $carpetaRevo"
} else {
  Write-Host "    No he encontrado la carpeta de Revo Scan (¿está instalado en este PC?)." -ForegroundColor Yellow
  Write-Host "    En Revo Scan: Preferencias -> ruta de proyectos. Pégala aquí, o deja vacío para configurarla después:"
  $carpetaRevo = Read-Host "    Carpeta de Revo Scan"
}
$config = [ordered]@{
  servidor        = $Servidor
  token           = $Token
  carpetaRevoScan = $carpetaRevo
  carpeta         = $Escaneos
}
$config | ConvertTo-Json | Set-Content -Path (Join-Path $Destino "puente.config.json") -Encoding UTF8
Ok "Configuración guardada en $Destino\puente.config.json"

# --- 4. Servicio: tarea del sistema oculta, arranca con Windows, se reinicia sola ---------
Paso "Dejando el puente como servicio de Windows"
# Se para cualquier puente que estuviera abierto a mano, para no tener dos.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*puente.js*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# Acceso directo de la carpeta Inicio de versiones anteriores: ya no hace falta.
$viejo = Join-Path ([Environment]::GetFolderPath("Startup")) "Ortosend puente de escaneo.lnk"
if (Test-Path $viejo) { Remove-Item $viejo -Force }

$tarea = "Ortosend puente de escaneo"
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$Destino\iniciar-puente.bat`"" -WorkingDirectory $Destino
$disparo = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$ajustes = New-ScheduledTaskSettingsSet -Hidden -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Unregister-ScheduledTask -TaskName $tarea -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger $disparo -Principal $principal -Settings $ajustes -Description "Sube los escaneos de Revo Scan a Ortosend" | Out-Null
Start-ScheduledTask -TaskName $tarea
Ok "Servicio instalado y en marcha (arranca solo con Windows, sin ventana)"

Start-Sleep -Seconds 8
$log = Join-Path $Destino "puente.log"
if (Test-Path $log) {
  Write-Host ""
  Write-Host "Ultimas lineas del puente:" -ForegroundColor Cyan
  Get-Content $log -Tail 8 | ForEach-Object { Write-Host "    $_" }
}
Write-Host ""
Write-Host "Listo. El puente funciona en segundo plano. Su estado y su actividad se ven en" -ForegroundColor Yellow
Write-Host "Ortosend -> Panel de clinica -> Puente de escaneo (Ultima senal)." -ForegroundColor Yellow
Write-Host "Desde ahora: en Revo Scan, crea el proyecto con el nombre del paciente (o el numero" -ForegroundColor Yellow
Write-Host "de caso), escanea y pulsa Parar. El escaneo llega solo al paciente." -ForegroundColor Yellow
