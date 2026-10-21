@echo off
rem Ortosend Taller (fresado y confeccion): INSTALADOR.
rem  - Copia el programa a %LOCALAPPDATA%\RectificadorOrtosend\programa (asi da igual donde
rem    estuviera el ZIP descomprimido).
rem  - Prepara Python y lo necesario (solo la primera vez o si cambia la lista de requisitos).
rem  - Crea accesos directos con icono en el Escritorio y en el menu Inicio, que abren el
rem    programa SIN ventana negra, y hace que los trabajos .molde se abran con doble clic.
rem Para ACTUALIZAR: descomprime la version nueva y vuelve a hacer doble clic en instalar.bat.
setlocal
cd /d "%~dp0"
title Instalar Ortosend Taller

set "BASE=%LOCALAPPDATA%\RectificadorOrtosend"
set "PROGRAMA=%BASE%\programa"
set "ENTORNO=%BASE%\entorno"
set "LOG=%BASE%\instalacion.log"
set "PYV=%ENTORNO%\Scripts\python.exe"
set "PYW=%ENTORNO%\Scripts\pythonw.exe"
if not exist "%BASE%" mkdir "%BASE%"

echo.
echo   Ortosend Taller
echo   Instalando... (la primera vez tarda unos minutos y hace falta internet)
echo.
echo Instalacion %DATE% %TIME% > "%LOG%"

rem ---------------------------------------------------------------- 1. copiar el programa
echo [1/4] Copiando el programa...
robocopy "%~dp0." "%PROGRAMA%" /MIR /XD __pycache__ .pytest_cache tests /XF *.pyc /NFL /NDL /NJH /NJS /NP >> "%LOG%" 2>&1
rem robocopy termina con 0-7 cuando todo va bien; 8 o mas es error.
if errorlevel 8 goto error

rem ---------------------------------------------------------------- 2. Python y requisitos
echo [2/4] Preparando Python...
set "HUELLA="
for /f "delims=" %%h in ('certutil -hashfile "%PROGRAMA%\requirements.txt" SHA256 ^| findstr /v ":"') do set "HUELLA=%%h"
if defined HUELLA set "HUELLA=%HUELLA: =%"
set "INSTALADA="
if exist "%ENTORNO%\requisitos.sha" set /p INSTALADA=<"%ENTORNO%\requisitos.sha"
if exist "%PYW%" if "%INSTALADA%"=="%HUELLA%" (
    echo       Ya estaba preparado.
    goto accesos
)

set "PY="
for %%V in (3.13 3.12 3.11) do (
    if not defined PY (
        py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
    )
)
for %%V in (3.13 3.12 3.11) do (
    if not defined PY (
        python%%V -c "import sys" >nul 2>nul && set "PY=python%%V"
    )
)
if not defined PY (
    py -3 -c "import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)" >nul 2>nul && set "PY=py -3"
)
if not defined PY (
    python -c "import sys; sys.exit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY goto sinpython
for /f "delims=" %%i in ('%PY% --version 2^>^&1') do echo       Usando %%i
echo Usando %PY% >> "%LOG%"
if exist "%ENTORNO%" rmdir /s /q "%ENTORNO%"
echo       Creando el entorno...
%PY% -m venv "%ENTORNO%" >> "%LOG%" 2>&1
if errorlevel 1 goto error
echo       Descargando e instalando lo necesario (lo mas largo)...
"%PYV%" -m pip install --upgrade pip >> "%LOG%" 2>&1
"%PYV%" -m pip install -r "%PROGRAMA%\requirements.txt" >> "%LOG%" 2>&1
if errorlevel 1 goto error
> "%ENTORNO%\requisitos.sha" echo %HUELLA%
rem Compatibilidad con arrancar.bat
echo ok > "%ENTORNO%\instalado.ok"

:accesos
rem ---------------------------------------------------------------- 3. accesos directos
echo [3/4] Creando los accesos directos (Escritorio y menu Inicio)...
set "ACCESO_PY=%PYW%"
set "ACCESO_PROG=%PROGRAMA%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s = New-Object -ComObject WScript.Shell;" ^
  "foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {" ^
  "  $viejo = Join-Path $d 'Rectificador Ortosend.lnk'; if (Test-Path $viejo) { Remove-Item $viejo };" ^
  "  $l = $s.CreateShortcut((Join-Path $d 'Ortosend Taller.lnk'));" ^
  "  $l.TargetPath = $env:ACCESO_PY;" ^
  "  $l.Arguments = '\"' + (Join-Path $env:ACCESO_PROG 'interfaz\principal.py') + '\"';" ^
  "  $l.WorkingDirectory = $env:ACCESO_PROG;" ^
  "  $l.IconLocation = (Join-Path $env:ACCESO_PROG 'interfaz\icono.ico');" ^
  "  $l.Description = 'Ortosend Taller - fresado y confeccion';" ^
  "  $l.Save() }" >> "%LOG%" 2>&1
if errorlevel 1 echo       (No se han podido crear los accesos directos: mira el registro.)

rem Los trabajos guardados (.molde) se abren con doble clic.
reg add "HKCU\Software\Classes\.molde" /ve /d "RectificadorOrtosend.Trabajo" /f >> "%LOG%" 2>&1
reg add "HKCU\Software\Classes\RectificadorOrtosend.Trabajo" /ve /d "Trabajo de Ortosend Taller" /f >> "%LOG%" 2>&1
reg add "HKCU\Software\Classes\RectificadorOrtosend.Trabajo\DefaultIcon" /ve /d "%PROGRAMA%\interfaz\icono.ico" /f >> "%LOG%" 2>&1
reg add "HKCU\Software\Classes\RectificadorOrtosend.Trabajo\shell\open\command" /ve /d "\"%PYW%\" \"%PROGRAMA%\interfaz\principal.py\" \"%%1\"" /f >> "%LOG%" 2>&1

rem ---------------------------------------------------------------- 4. abrir
echo [4/4] Abriendo el programa...
cd /d "%PROGRAMA%"
start "" "%PYW%" "%PROGRAMA%\interfaz\principal.py"
echo.
echo   Listo. A partir de ahora abrelo con el icono "Ortosend Taller" del Escritorio
echo   o del menu Inicio. Ya puedes borrar la carpeta que descomprimiste.
echo.
timeout /t 8 >nul
goto :eof

:sinpython
echo.
echo No encuentro Python 3.11, 3.12 o 3.13 en este ordenador.
echo  1. Descarga Python 3.13 de https://www.python.org/downloads/
echo  2. Al instalar, marca la casilla "Add Python to PATH".
echo  3. Vuelve a hacer doble clic en instalar.bat
pause
goto :eof

:error
echo.
echo No se ha podido instalar. Ultimas lineas del registro:
echo ------------------------------------------------------------
powershell -NoProfile -Command "Get-Content -Tail 25 -LiteralPath $env:LOG"
echo ------------------------------------------------------------
echo Haz una foto de esta ventana y mandala. El registro completo esta en:
echo   %LOG%
pause
