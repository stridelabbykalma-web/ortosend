@echo off
REM Puente de escaneo Ortosend. Lo lanza el servicio (tarea programada) al
REM arrancar Windows; tambien se puede abrir a mano para ver que hace.
cd /d "%~dp0"
set NODE=node
where node >nul 2>nul || set "NODE=%ProgramFiles%\nodejs\node.exe"
:bucle
"%NODE%" puente.js
REM Si se cierra (actualizacion o fallo) se vuelve a lanzar a los 10 s.
ping -n 11 127.0.0.1 >nul
goto bucle
