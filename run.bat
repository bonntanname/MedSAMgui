@echo off
rem ----------------------------------------------------------------------------
rem Launch MedSAM backend (FastAPI/uvicorn) and frontend (Vite) together.
rem On first run, downloads the MedSAM checkpoint if it is missing.
rem Opens each server in its own window so logs stay separate.
rem ----------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
if "%BACKEND_PORT%"=="" set "BACKEND_PORT=8000"
set "CKPT=%ROOT%work_dir\MedSAM\medsam_vit_b.pth"
set "GDRIVE_ID=1UAmWL88roYR7wKlnApw5Bcuzf2iQgk6_"

rem --- checkpoint: download only if missing ---
if exist "%CKPT%" (
    echo [ckpt] Found %CKPT%, skipping download.
) else (
    echo [ckpt] Not found. Downloading MedSAM checkpoint ^(~360MB^) via gdown...
    if not exist "%ROOT%work_dir\MedSAM" mkdir "%ROOT%work_dir\MedSAM"
    uvx gdown %GDRIVE_ID% -O "%CKPT%"
    if not exist "%CKPT%" (
        echo [ckpt] ERROR: download failed. Aborting.
        pause
        exit /b 1
    )
    echo [ckpt] Download complete.
)

echo Starting MedSAM backend  -^> http://127.0.0.1:%BACKEND_PORT%
echo Starting MedSAM frontend -^> http://localhost:5173
echo.

start "MedSAM backend"  cmd /k cd /d "%ROOT%medsam-uv" ^&^& uv run uvicorn server:app --port %BACKEND_PORT%
start "MedSAM frontend" cmd /k cd /d "%ROOT%webapp" ^&^& npm run dev

echo Two windows launched. Open http://localhost:5173 in your browser.
endlocal
