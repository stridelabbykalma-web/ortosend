@echo off
rem Rectificador de moldes - Ortosend: DESINSTALAR.
rem Quita los accesos directos, la asociacion de los archivos .molde y la carpeta
rem %LOCALAPPDATA%\RectificadorOrtosend (programa y Python del programa).
rem NO borra tus trabajos guardados (.molde), escaneos ni archivos .nc.
setlocal
title Desinstalar el Rectificador de moldes - Ortosend
set "BASE=%LOCALAPPDATA%\RectificadorOrtosend"
echo.
echo   Se va a quitar el Rectificador de moldes de este ordenador.
echo   Tus trabajos guardados (.molde), escaneos y archivos .nc NO se borran.
echo.
choice /c SN /m "Quitarlo"
if errorlevel 2 goto :eof

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {" ^
  "  $l = Join-Path $d 'Rectificador Ortosend.lnk'; if (Test-Path $l) { Remove-Item $l } }"
reg delete "HKCU\Software\Classes\.molde" /f >nul 2>&1
reg delete "HKCU\Software\Classes\RectificadorOrtosend.Trabajo" /f >nul 2>&1

echo Quitado. La carpeta del programa se borra en unos segundos.
rem Se borra desde otra ventana (este archivo puede estar dentro de esa carpeta).
start "" /min cmd /c "timeout /t 3 >nul & rmdir /s /q "%BASE%""
timeout /t 4 >nul
