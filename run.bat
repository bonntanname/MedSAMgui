@echo off
rem ----------------------------------------------------------------------------
rem Launch MedSAM backend (FastAPI/uvicorn) and frontend (Vite) together.
rem Opens each in its own window so logs stay separate. Close a window to stop it.
rem ----------------------------------------------------------------------------
setlocal
set "ROOT=%~dp0"
if "%BACKEND_PORT%"=="" set "BACKEND_PORT=8000"

echo Starting MedSAM backend  -^> http://127.0.0.1:%BACKEND_PORT%
echo Starting MedSAM frontend -^> http://localhost:5173
echo.

start "MedSAM backend"  cmd /k cd /d "%ROOT%medsam-uv" ^&^& uv run uvicorn server:app --port %BACKEND_PORT%
start "MedSAM frontend" cmd /k cd /d "%ROOT%webapp" ^&^& npm run dev

echo Two windows launched. Open http://localhost:5173 in your browser.
endlocal
