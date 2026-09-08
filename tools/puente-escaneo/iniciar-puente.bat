@echo off
REM Puente de escaneo Ortosend — arranca el vigilante de la carpeta de RevoScan.
REM Deja esta ventana abierta mientras se usa el escáner.
cd /d "%~dp0"
node puente.js
pause
