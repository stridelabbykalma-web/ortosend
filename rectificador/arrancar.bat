@echo off
rem Rectificador de moldes - Ortosend
rem Doble clic para abrir el programa. La primera vez prepara Python y descarga
rem lo necesario (unos minutos, hace falta internet). Las siguientes veces abre directo.
setlocal
cd /d "%~dp0"
title Rectificador de moldes - Ortosend

rem Ya instalado: abrir directamente.
if exist ".venv\instalado.ok" goto lanzar

rem Buscar Python: primero el lanzador "py" (lo instala siempre python.org), luego "python".
set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
    where python >nul 2>nul
    if not errorlevel 1 set "PY=python"
)
if not defined PY goto sinpython

rem Hace falta Python 3.11 o mas nuevo.
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>nul
if errorlevel 1 goto sinpython

echo.
echo Preparando el programa por primera vez. Tarda unos minutos, no cierres esta ventana...
echo (el detalle se guarda en instalacion.log)
if exist .venv rmdir /s /q .venv
%PY% -m venv .venv > instalacion.log 2>&1
if errorlevel 1 goto error
".venv\Scripts\python.exe" -m pip install --upgrade pip >> instalacion.log 2>&1
".venv\Scripts\python.exe" -m pip install -r requirements.txt >> instalacion.log 2>&1
if errorlevel 1 goto error
echo ok > ".venv\instalado.ok"
echo Listo.

:lanzar
echo Abriendo el rectificador... (no cierres esta ventana mientras lo uses)
".venv\Scripts\python.exe" -m interfaz.principal %*
if errorlevel 1 (
    echo.
    echo El programa se ha cerrado con un error.
    echo Haz una captura de esta ventana y mandala.
    pause
)
goto :eof

:sinpython
echo.
echo No encuentro Python 3.11 o mas nuevo en este ordenador.
echo  1. Descargalo de https://www.python.org/downloads/
echo  2. Al instalar, marca la casilla "Add Python to PATH".
echo  3. Vuelve a hacer doble clic en arrancar.bat
pause
goto :eof

:error
echo.
echo No se ha podido instalar. Comprueba la conexion a internet y vuelve a intentarlo.
echo Si sigue fallando, manda el archivo instalacion.log de esta carpeta.
pause
