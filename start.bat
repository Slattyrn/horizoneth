@echo off
echo.
echo ============================================
echo   Horizon Alpha Terminal (MGC) - Starting...
echo ============================================
echo.

echo [1/2] Starting backend on port 8001...
start "HAT-MGC Backend" cmd /k "cd /d "%~dp0backend" && python -m uvicorn main:app --host 0.0.0.0 --port 8001"

timeout /t 3 /nobreak >nul

echo [2/2] Starting frontend on port 5174...
start "HAT-MGC Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo.
echo   Backend:  http://localhost:8001
echo   Frontend: http://localhost:5174
echo.
echo   Close the two terminal windows to stop.
echo.
pause
