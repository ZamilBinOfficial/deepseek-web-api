@echo off
title DeepSeek Web API Server [Port 8080]
cd /d "Z:\Hub\projects\deepseek-web-api"
set PORT=8080
set DS_API_KEY=sk-deepseek
echo ========================================================
echo  DeepSeek Web API Server (ZamilBinOfficial/deepseek-web-api)
echo  Endpoint: http://127.0.0.1:8080/v1
echo  API Key:  sk-deepseek
echo  Models:   deepseek-v4-flash, deepseek-v4-pro
echo ========================================================
echo.
node dist/index.js start
pause
