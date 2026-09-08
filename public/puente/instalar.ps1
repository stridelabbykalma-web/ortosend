# ============================================================
# Instalador del puente de escaneo Ortosend - PC del escáner (Windows)
# ============================================================
# Lo descarga el administrador de la clínica desde Panel → Puente de escaneo
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
foreach ($c in $candidatos) { if (Test-Path $c) { $carpetaRevo = $c; break } }
if (-not $carpetaRevo) {
  $otras = Get-ChildItem -Path $env:APPDATA -Directory -Filter "RevoScan*" -ErrorAction SilentlyContinue
  if ($otras) { $carpetaRevo = $otras[0].FullName }
}
if ($carpetaRevo) {
  Ok "Revo Scan guarda los escaneos en: $carpetaRevo"
} else {
  Write-Host "    No he encontrado la carpeta de Revo Scan (¿está instalado en este PC?)." -ForegroundColor Yellow
  Write-Host "    En Revo Scan: Preferencias → ruta de proyectos. Pégala aquí, o deja vacío para configurarla después:"
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

# --- 4. Arranque automático + arrancar ahora -----------------------------------
Paso "Dejándolo arrancando solo al iniciar sesión en Windows"
$startup = [Environment]::GetFolderPath("Startup")
$acceso = Join-Path $startup "Ortosend puente de escaneo.lnk"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($acceso)
$lnk.TargetPath = Join-Path $Destino "iniciar-puente.bat"
$lnk.WorkingDirectory = $Destino
$lnk.WindowStyle = 7  # minimizado
$lnk.Description = "Sube los escaneos de Revo Scan a Ortosend"
$lnk.Save()
Ok "Acceso directo creado en la carpeta Inicio"

Paso "Arrancando el puente"
Start-Process -FilePath (Join-Path $Destino "iniciar-puente.bat") -WorkingDirectory $Destino
Write-Host ""
Write-Host "Listo. Se ha abierto la ventana del puente: su cuarta línea debe decir" -ForegroundColor Yellow
Write-Host "  'modo directo al almacén (sin límite de tamaño)'." -ForegroundColor Yellow
Write-Host "Déjala abierta (o minimizada). A partir de ahora: abre el caso en el paso 'Escaneo'," -ForegroundColor Yellow
Write-Host "escanea con Revo Scan y pulsa Parar. El escaneo llega solo al paciente." -ForegroundColor Yellow
