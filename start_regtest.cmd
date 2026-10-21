@echo off
rem Bitmap Battle with play money: a private regtest node, a test wallet and a rival bot.
rem Open http://localhost:8788 and use the purple test panel to mine blocks.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist apps\web\dist\index.html call npm run build
node scripts\regtest.mjs %*
pause
