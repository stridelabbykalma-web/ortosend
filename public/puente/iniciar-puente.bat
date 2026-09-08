@echo off
REM Puente de escaneo Ortosend — arranca el vigilante de la carpeta de Revo Scan.
REM Deja esta ventana abierta (o minimizada) mientras se usa el escáner.
cd /d "%~dp0"
set NODE=node
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
:bucle
"%NODE%" puente.js
echo.
echo El puente se ha cerrado; se vuelve a arrancar en 10 segundos (Ctrl+C para salir).
timeout /t 10 >nul
goto bucle
