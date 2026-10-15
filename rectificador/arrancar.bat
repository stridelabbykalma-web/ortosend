@echo off
rem Rectificador de moldes - Ortosend
rem La primera vez crea un entorno de Python e instala lo necesario.
cd /d "%~dp0"
if not exist .venv (
    echo Preparando el programa por primera vez, espera unos minutos...
    python -m venv .venv || goto error
    .venv\Scripts\python -m pip install --upgrade pip
    .venv\Scripts\python -m pip install -r requirements.txt || goto error
)
if exist interfaz\principal.py (
    .venv\Scripts\python -m interfaz.principal %*
) else (
    echo La ventana todavia no esta disponible. Uso por consola:
    echo   .venv\Scripts\python herramientas\rectificar.py ENTRADA.stl CARPETA_SALIDA NOMBRE
    pause
)
goto :eof
:error
echo.
echo No se ha podido instalar. Comprueba que Python esta instalado y en el PATH.
pause
