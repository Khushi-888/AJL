@echo off
echo ======================================================================
echo           Starting StockSense - Modular Inventory Management
echo ======================================================================
echo.

REM Add PostgreSQL 18 bin to PATH for this session if installed
if exist "C:\Program Files\PostgreSQL\18\bin" (
    set "PATH=C:\Program Files\PostgreSQL\18\bin;%PATH%"
)

REM 1. Check if PostgreSQL is running
pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
if %errorlevel% neq 0 (
    echo [1/3] Local PostgreSQL not currently active.
    if exist "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe" (
        echo Attempting to start PostgreSQL service...
        pg_ctl start -D "C:\Program Files\PostgreSQL\18\data" >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
    pg_isready -h 127.0.0.1 -p 5432 >nul 2>&1
    if %errorlevel% equ 0 (
        echo [1/3] PostgreSQL is active and accepting connections!
    ) else (
        echo [1/3] PostgreSQL offline - StockSense will use built-in Async SQLite automatically!
    )
) else (
    echo [1/3] PostgreSQL is active and accepting connections!
)

REM 2. Open browser
echo [2/3] Opening StockSense Dashboard in your browser...
start http://localhost:8000

REM 3. Launch FastAPI Uvicorn Server
echo [3/3] Launching StockSense Web App on http://localhost:8000
echo Press Ctrl+C to stop the server anytime.
echo.
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
