@echo off
rem Rectificador de moldes - Ortosend
rem Doble clic para abrir el programa. La primera vez prepara Python y descarga
rem lo necesario (unos minutos, hace falta internet). Las siguientes veces abre directo.
rem
rem Lo instalado va a una carpeta corta del usuario (fuera de OneDrive y del Escritorio):
rem   %LOCALAPPDATA%\RectificadorOrtosend
rem porque algunas piezas tienen rutas muy largas y Windows falla si pasan de 260 letras.
setlocal
cd /d "%~dp0"
title Rectificador de moldes - Ortosend

set "ENTORNO=%LOCALAPPDATA%\RectificadorOrtosend\entorno"
set "LOG=%LOCALAPPDATA%\RectificadorOrtosend\instalacion.log"
set "PYV=%ENTORNO%\Scripts\python.exe"

rem Ya instalado: abrir directamente.
if exist "%ENTORNO%\instalado.ok" goto lanzar

rem Buscar Python. Primero versiones probadas (3.13, 3.12, 3.11) con el lanzador "py";
rem si no, cualquier Python 3 que haya.
set "PY="
for %%V in (3.13 3.12 3.11) do (
    if not defined PY (
        py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
    )
)
if not defined PY (
    py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=py -3"
)
if not defined PY (
    python -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY goto sinpython

if not exist "%LOCALAPPDATA%\RectificadorOrtosend" mkdir "%LOCALAPPDATA%\RectificadorOrtosend"
echo.
echo Preparando el programa por primera vez. Tarda unos minutos, no cierres esta ventana...
for /f "delims=" %%i in ('%PY% --version 2^>^&1') do echo Usando %%i
echo Usando %PY% > "%LOG%"
%PY% --version >> "%LOG%" 2>&1
if exist "%ENTORNO%" rmdir /s /q "%ENTORNO%"
echo [1/2] Creando el entorno...
%PY% -m venv "%ENTORNO%" >> "%LOG%" 2>&1
if errorlevel 1 goto error
echo [2/2] Descargando e instalando lo necesario (lo mas largo)...
"%PYV%" -m pip install --upgrade pip >> "%LOG%" 2>&1
"%PYV%" -m pip install -r requirements.txt >> "%LOG%" 2>&1
if errorlevel 1 goto error
echo ok > "%ENTORNO%\instalado.ok"
echo Listo.

:lanzar
echo Abriendo el rectificador... (no cierres esta ventana mientras lo uses)
"%PYV%" -m interfaz.principal %*
if errorlevel 1 (
    echo.
    echo El programa se ha cerrado con un error.
    echo Haz una captura de esta ventana y mandala.
    pause
)
goto :eof

:sinpython
echo.
echo No encuentro Python 3.11, 3.12 o 3.13 en este ordenador.
echo  1. Descarga Python 3.13 de https://www.python.org/downloads/
echo  2. Al instalar, marca la casilla "Add Python to PATH".
echo  3. Vuelve a hacer doble clic en arrancar.bat
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
echo Si arriba pone Python 3.14 o mas nuevo, instala Python 3.13 desde python.org
echo y vuelve a hacer doble clic en arrancar.bat
pause
