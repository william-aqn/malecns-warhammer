@echo off
cd /d "%~dp0"
echo Full CNS laboratory: http://127.0.0.1:4177/lab.html
echo Keep this window open while using the laboratory.
node server.mjs
if errorlevel 1 pause
