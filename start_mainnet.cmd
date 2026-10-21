@echo off
rem Bitmap Battle on your own mainnet node: http://localhost:8787
rem The server only reads the node. Players sign and broadcast their own transactions.
rem If the server stops with an error it starts again after 5 seconds (see data\restarts.log). Ctrl+C stops it.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist apps\web\dist\index.html call npm run build
rem Tips: put your Bitcoin address in tip-address.txt (one line) to show the tip cube and tip buttons.
if exist tip-address.txt set /p BB_TIP_ADDRESS=<tip-address.txt
set ARGS=--network mainnet
for %%d in (C D E F G H I J K L M N O P Q R S T U V W X Y Z) do if exist "%%d:\Bitmap Index\bitmaps.sqlite" set ARGS=--network mainnet "--bitmap-db=%%d:\Bitmap Index\bitmaps.sqlite"
if not exist data mkdir data

:run
node --disable-warning=ExperimentalWarning --import tsx apps\server\src\main.ts %ARGS% %*
if not errorlevel 1 goto done
echo %date% %time:~0,8%  the server stopped with exit code %errorlevel%, restarting in 5 seconds>> data\restarts.log
echo.
echo The server stopped with an error, see above. It starts again in 5 seconds; close this window to cancel.
timeout /t 5 /nobreak >nul
goto run

:done
pause
