@echo off
chcp 65001 >nul
title Garden Cafe - Sistema de pedidos
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta instalar Node.js. Se abre la pagina de descarga:
  echo  instala la version LTS y despues volve a abrir este archivo.
  start https://nodejs.org/es
  pause
  exit /b
)
echo.
echo  Iniciando Garden Cafe... NO cierres esta ventana mientras lo uses.
echo.
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000/panel & start http://localhost:3000/?mesa=1"
node server.js
pause
