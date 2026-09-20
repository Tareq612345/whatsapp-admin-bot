@echo off
chcp 65001 >nul
title Setup Lightweight Arabic OCR
cd /d "%~dp0"
py -3.12 --version >nul 2>&1
if errorlevel 1 (
  echo Python 3.12 was not found.
  echo Install it first with: winget install -e --id Python.Python.3.12
  pause
  exit /b 1
)
echo [1/4] Creating an isolated OCR environment...
if not exist ".ocr-venv\Scripts\python.exe" py -3.12 -m venv .ocr-venv
if errorlevel 1 goto :error
echo [2/4] Updating pip...
call ".ocr-venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error
echo [3/4] Installing RapidOCR, ONNX Runtime, and Arabic support...
call ".ocr-venv\Scripts\python.exe" -m pip install rapidocr onnxruntime opencv-python-headless python-bidi
if errorlevel 1 goto :error
echo [4/4] Downloading and warming up the small Arabic PP-OCRv5 model...
call ".ocr-venv\Scripts\python.exe" "ocr\rapid_worker.py" --warmup
if errorlevel 1 goto :error
echo.
echo Lightweight Arabic OCR is ready.
echo Restart the bot with start-bot.cmd.
pause
exit /b 0
:error
echo.
echo OCR setup failed. Review the error above.
pause
exit /b 1
