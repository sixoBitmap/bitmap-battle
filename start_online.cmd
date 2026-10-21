@echo off
rem Puts Bitmap Battle online through a free Cloudflare quick tunnel and shows the address and a QR code.
rem Keep this window open: closing it takes the app offline.
cd /d "%~dp0"
if not exist node_modules call npm install
node scripts\online.mjs %*
pause
