@echo off
REM Mi Foco - arranque en Windows. La primera vez crea el entorno virtual e instala dependencias.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Creando entorno virtual...
    python -m venv .venv || goto :error
    ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :error
)
".venv\Scripts\python.exe" app.py %*
goto :eof

:error
echo.
echo No se pudo preparar el entorno. Verifica que Python 3.9+ este instalado y en el PATH.
pause
