@echo off
title Asil Kuyumcu Kopru - WhatsApp Kurulumu
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
echo WhatsApp modulu kuruluyor (internet gerekir, 1-2 dakika surebilir)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  KURULUM BASARISIZ. Internet baglantisini kontrol edip tekrar deneyin.
  pause
  exit /b 1
)
echo Kopru yeniden baslatiliyor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*asil-kopru.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
set "S=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AsilKopru.vbs"
if exist "%S%" (
  ping -n 8 127.0.0.1 >nul
  powershell -NoProfile -Command "if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*asil-kopru.js*' })) { exit 1 }"
  if errorlevel 1 start "" wscript.exe "%S%"
)
echo.
echo  Tamam. Programda Tamir - WhatsApp Ayarlari - "Otomatik (dukkan koprusu)"
echo  secin ve ekranda cikan QR kodu bildirim hattinin telefonundan okutun:
echo  WhatsApp - Ayarlar - Bagli cihazlar - Cihaz bagla.
echo.
pause
