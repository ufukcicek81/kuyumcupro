@echo off
title Asil Kuyumcu Kopru - Otomatik Baslatma
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
set "S=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AsilKopru.vbs"
> "%S%" echo Set s = CreateObject("WScript.Shell")
>> "%S%" echo s.Run """%~dp0ARKAPLAN.bat""", 0, False
start "" wscript.exe "%S%"
echo.
echo  Tamam. Kopru artik bilgisayar her acildiginda pencere acmadan
echo  arka planda kendiliginden baslayacak. Su anda da baslatildi.
echo.
echo  Kontrol: programda Fatura - Entegrasyon Ayarlari - "Baglantiyi Test Et"
echo  veya tarayicida http://127.0.0.1:8787 adresini acin.
echo  Kaldirmak icin: OTOMATIK_BASLAT_KALDIR.bat
echo.
pause
