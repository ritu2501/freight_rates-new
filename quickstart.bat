@echo off
REM Quick Start Script for Freight Rates Project on Windows

echo.
echo ==========================================
echo Freight Rates - Quick Start (Windows)
echo ==========================================
echo.

REM Check if we're in the right directory
if not exist package.json (
    echo ERR: Please run this from the project root directory
    pause
    exit /b 1
)

echo [OK] Found package.json in project root
echo.

REM Step 1: Install dependencies
echo [INSTALL] Step 1: Installing dependencies...
call npm run install:all
echo.

REM Step 2: Create .env if it doesn't exist
echo [CONFIG] Step 2: Configuring environment...
if not exist .env (
    copy .env.example .env
    echo [OK] Created .env file from template
    echo.
    echo [WARN] IMPORTANT: Edit .env and set:
    echo   - MAERSK_USERNAME (your Maersk portal username)
    echo   - MAERSK_PASSWORD (your Maersk portal password)
    echo   - SNAPSHOT_KEY (a secure encryption key)
    echo.
    pause
) else (
    echo [OK] .env already exists
    echo.
)

REM Step 3: Initialize database
echo [DATABASE] Step 3: Initializing database...
call npm run seed
echo.

REM Step 4: Start servers
echo [STARTUP] Step 4: Starting servers...
echo.
echo Press Ctrl+C to stop all servers
echo.

call npm run dev
