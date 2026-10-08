@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo Node.js no esta instalado. Instala Node.js 20 o superior.
  pause
  exit /b 1
)
if not exist "node_modules\pg\package.json" (
  echo Instalando dependencias...
  call npm install
  if %errorlevel% neq 0 (
    echo No se pudieron instalar las dependencias.
    pause
    exit /b 1
  )
)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
call npm start
pause
