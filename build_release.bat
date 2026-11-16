@echo off
REM ============================================
REM Build Release Otimizado para Múltiplas Contas
REM ============================================

setlocal enabledelayedexpansion

echo ========================================
echo Build Release Otimizado - Deck Contas
echo ========================================
echo.

REM Obter data e hora formatadas
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set "dt=%%a"

set YYYY=%dt:~0,4%
set MM=%dt:~4,2%
set DD=%dt:~6,2%
set HH=%dt:~8,2%
set Min=%dt:~10,2%
set Sec=%dt:~12,2%

set TIMESTAMP=%YYYY%-%MM%-%DD%-%HH%-%Min%-%Sec%

REM Criar pasta de build na raiz
set BUILD_DIR=.\build-release-%TIMESTAMP%
mkdir "%BUILD_DIR%"

echo Criando pasta de build: %BUILD_DIR%
echo.

REM Entrar no diretorio src-tauri
cd /d "%~dp0src-tauri"

echo Compilando em modo release otimizado...
cargo build --release

if %errorlevel%==0 (
    echo.
    echo Build concluido com sucesso!
    echo.
    
    REM Voltar ao diretorio principal
    cd /d "%~dp0"
    
    REM Copiar oexecutavel para pasta de build
    set EXE_PATH=.\src-tauri\target\release\deckcontas.exe
    
    if exist "%EXE_PATH%" (
        copy "%EXE_PATH%" "%BUILD_DIR%\deckcontas.exe"
        echo Executavel copiado para: %BUILD_DIR%\deckcontas.exe
    )
    
    REM Copiar arquivos de instalacao
    if exist ".\release-installer.exe" (
        copy ".\release-installer.exe" "%BUILD_DIR%\deckcontas_installer.exe"
    )
    
    REM Criar atalho batch
    echo @echo off > "%BUILD_DIR%\iniciar.bat"
    echo start "" "%~dp0deckcontas.exe" >> "%BUILD_DIR%\iniciar.bat"
    echo. >> "%BUILD_DIR%\iniciar.bat"
    echo REM Atalho para iniciar o programa >> "%BUILD_DIR%\iniciar.bat"
    echo REM Duplo clique ou execute este arquivo >> "%BUILD_DIR%\iniciar.bat"
    
    echo.
    
    REM Criar README na pasta de build
    echo # Deck Contas - Build %TIMESTAMP% > "%BUILD_DIR%\README.txt"
    echo. >> "%BUILD_DIR%\README.txt"
    echo Executavel: deckcontas.exe >> "%BUILD_DIR%\README.txt"
    echo Para iniciar: clique duplo em iniciar.bat >> "%BUILD_DIR%\README.txt"
    echo. >> "%BUILD_DIR%\README.txt"
    echo Otimizacoes aplicadas: >> "%BUILD_DIR%\README.txt"
    echo - Limite reduzido de logs (100 -> 20 para light) >> "%BUILD_DIR%\README.txt"
    echo - Intervalo de verificacao: 500ms -> 400ms >> "%BUILD_DIR%\README.txt"
    echo - Tempo de limpeza: 35s -> 20s >> "%BUILD_DIR%\README.txt"
    echo - Limpeza automatica a cada 1 minuto >> "%BUILD_DIR%\README.txt"
    echo - Funcoes de limpeza de logs incluidas >> "%BUILD_DIR%\README.txt"
    
    REM Criar atalho no desktop (opcional)
    echo.
    echo === ARQUIVOS CRIADOS ===
    echo Pasta de build: %BUILD_DIR%
    echo Executavel: %BUILD_DIR%\deckcontas.exe
    echo Atalho: %BUILD_DIR%\iniciar.bat
    echo README: %BUILD_DIR%\README.txt
    
    REM Criar atalho na area de trabalho
    set DESKTOP_SHORTCUT=%USERPROFILE%\Desktop\Deck Contas.lnk"
    echo.
    echo Criar atalho na area de trabalho? (S/N)
    set /p CHOICE=
    if /i "!CHOICE!"=="S" (
        echo Criando atalho...
        powershell "$WS = New-Object -ComObject WScript.Shell; $SC = $WS.CreateShortcut('%USERPROFILE%\Desktop\Deck Contas.lnk'); $SC.TargetPath = '%CD%\%BUILD_DIR%\iniciar.bat'; $SC.Save()"
        echo Atalho criado em: %USERPROFILE%\Desktop\
    )
    
) else (
    echo.
    echo ERRO na compilacao! Verifique os logs.
    cd /d "%~dp0"
    exit /b 1
)

echo.
pause