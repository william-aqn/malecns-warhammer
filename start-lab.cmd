@echo off
cd /d "%~dp0"
echo Starting the MaleCNS laboratory...
node server.mjs --open-lab
if errorlevel 1 pause
