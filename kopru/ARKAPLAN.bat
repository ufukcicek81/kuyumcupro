@echo off
rem Asil Kuyumcu Kopru - pencere acmadan arka planda calisir (OTOMATIK_BASLAT_KUR.bat kullanir).
rem Kayitlar bu klasordeki kopru.log dosyasina yazilir.
cd /d "%~dp0"
:basla
node asil-kopru.js >> kopru.log 2>&1
if errorlevel 3 if not errorlevel 4 exit /b 0
ping -n 6 127.0.0.1 >nul
goto basla
