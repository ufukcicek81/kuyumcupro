@echo off
title Asil Kuyumcu Kopru (IsNet e-Fatura)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
:basla
node asil-kopru.js
if errorlevel 3 if not errorlevel 4 (
  echo Kopru zaten arka planda calisiyor, bu pencereye gerek yok.
  pause
  exit /b 0
)
echo Kopru durdu, 5 saniye sonra yeniden baslatiliyor...
timeout /t 5 >nul
goto basla
