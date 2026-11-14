@echo off
chcp 65001 >nul
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
    py -3 servidor.py
    goto :fim
)
where python >nul 2>&1
if %errorlevel%==0 (
    python servidor.py
    goto :fim
)
echo.
echo Para iniciar o painel QNT CUP, instale Python 3 em https://www.python.org/downloads/
echo Durante a instalacao marque a opcao "Add Python to PATH".
echo Depois execute INICIAR_QNT_CUP.bat novamente.
:fim
pause
