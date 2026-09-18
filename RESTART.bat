@echo off
title Restart DeepSeek Web API [Port 8080]
echo Stopping old DeepSeek Web API on port 8080...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo Terminating PID %%a
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo Starting updated DeepSeek Web API...
cd /d "Z:\Hub\projects\deepseek-web-api"
set PORT=8080
set DS_API_KEY=sk-deepseek
set DS_TOOL_REASONING=clean
node dist/index.js start
