@echo off
chcp 65001 >nul
title Setup High Accuracy Local OCR
where ollama >nul 2>&1
if errorlevel 1 (
  echo Ollama is not installed.
  echo Download it from: https://ollama.com/download
  echo Install it, then run this file again.
  start https://ollama.com/download
  pause
  exit /b 1
)
echo Downloading the local vision model qwen2.5vl:3b...
echo This is a one-time download and may take several GB.
ollama pull qwen2.5vl:3b
if errorlevel 1 goto :error
echo.
echo High accuracy OCR is ready.
echo Restart the WhatsApp bot using start-bot.cmd.
pause
exit /b 0
:error
echo Model download failed. Check your internet connection and free disk space.
pause
exit /b 1
