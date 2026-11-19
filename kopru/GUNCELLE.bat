@echo off
title Asil Kuyumcu Kopru - Guncelle
cd /d "%~dp0"
echo Kopru programinin son surumu indiriliyor...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $b='https://raw.githubusercontent.com/ufukcicek81/kuyumcupro/main/kopru/'; foreach($f in 'asil-kopru.js','BASLAT.bat','ARKAPLAN.bat','OTOMATIK_BASLAT_KUR.bat','OTOMATIK_BASLAT_KALDIR.bat'){ Invoke-WebRequest -UseBasicParsing ($b+$f) -OutFile ($f+'.tmp') }; foreach($f in 'asil-kopru.js','BASLAT.bat','ARKAPLAN.bat','OTOMATIK_BASLAT_KUR.bat','OTOMATIK_BASLAT_KALDIR.bat'){ Move-Item ($f+'.tmp') $f -Force }"
if errorlevel 1 (
  echo.
  echo  INDIRME BASARISIZ. Internet baglantisini kontrol edin.
  pause
  exit /b 1
)
echo Eski kopru durduruluyor...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*asil-kopru.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
set "S=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AsilKopru.vbs"
if exist "%S%" (
  ping -n 8 127.0.0.1 >nul
  powershell -NoProfile -Command "if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*asil-kopru.js*' })) { exit 1 }"
  if errorlevel 1 start "" wscript.exe "%S%"
  echo Kopru yeni surumle arka planda yeniden basladi.
) else (
  echo Kopruyu BASLAT.bat ile yeniden acin.
)
echo.
echo  Tamam. asil-kopru.json (ayarlariniz) degistirilmedi.
echo  Programda "Baglantiyi Test Et" ile surumu kontrol edin (Surum: 1.1 veya ustu).
echo.
pause
