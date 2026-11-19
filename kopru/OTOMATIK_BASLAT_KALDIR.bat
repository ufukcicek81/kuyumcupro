@echo off
title Asil Kuyumcu Kopru - Otomatik Baslatmayi Kaldir
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\AsilKopru.vbs" >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ARKAPLAN.bat*' -or $_.CommandLine -like '*asil-kopru.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo.
echo  Otomatik baslatma kaldirildi ve arka plandaki kopru durduruldu.
echo  Elle calistirmak icin BASLAT.bat kullanabilirsiniz.
echo.
pause
