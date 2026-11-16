@echo off
REM ============================================
REM Build de 64 bits para Deck Contas
REM ============================================

setlocal enabledelayedexpansion

echo ========================================
echo Build de 64 bits - Deck Contas
echo ========================================
echo.

REM Verificar se rustup esta instalado
where rustup >nul 2>&1
if %errorlevel% neq 0 (
    echo ERRO: Rustup nao encontrado!
    echo.
    echo Instale o Rust de 64 bits:
    echo 1. Baixe de: https://www.rust-lang.org/tools/install
    echo 2. Ou execute: winget install Rustlang.Rustup
    echo.
    pause
    exit /b 1
)

echo Verificando arquitetura do Rust...
for /f "delims=" %%a in ('rustc --version --verbose 2^>nul') do (
    set rust_arch=%%a
    goto :check_arch
)

:check_arch
echo Arquitetura atual: %rust_arch%
echo.

REM Verificar se ja e 64 bits
if "%rust_arch%"=="x86_64-pc-windows-msvc" (
    echo Rust ja esta configurado para 64 bits!
    goto :build
)

if "%rust_arch%"=="x86_64-pc-windows-gnu" (
    echo Rust ja esta configurado para 64 bits!
    goto :build
)

REM Se nao for 64 bits, adicionar target
echo Adicionando target de 64 bits...
rustup target add x86_64-pc-windows-msvc
if %errorlevel% neq 0 (
    echo ERRO: Nao foi possivel adicionar target de 64 bits
    echo.
    echo Tente reinstalar o Rust para 64 bits
    echo.
    pause
    exit /b 1
)

:build
echo.
echo Iniciando build de 64 bits...
echo.

REM Criar pasta de build
set BUILD_DIR=build-release-64bit-%date:~-4,4%%date:~-10,2%%date:~-7,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set BUILD_DIR=%BUILD_DIR: =0%
mkdir "%BUILD_DIR%" 2>nul

REM Entrar no diretorio src-tauri
cd /d "%~dp0src-tauri"

echo Compilando para 64 bits...
cargo build --release --target x86_64-pc-windows-msvc

if %errorlevel%==0 (
    echo.
    echo Build concluido com sucesso!
    echo.
    
    REM Voltar ao diretorio principal
    cd /d "%~dp0"
    
    REM Copiar o executavel
    set EXE_PATH=src-tauri\target\x86_64-pc-windows-msvc\release\deckcontas.exe
    
    if exist "%EXE_PATH%" (
        copy "%EXE_PATH%" "%BUILD_DIR%\deckcontas.exe"
        echo Executavel copiado para: %BUILD_DIR%\deckcontas.exe
    ) else (
        echo ERRO: Executavel nao encontrado em %EXE_PATH%
        echo.
        echo Verifique se o build foi concluido com sucesso
        cd /d "%~dp0"
        pause
        exit /b 1
    )
    
    REM Criar atalho
    echo @echo off > "%BUILD_DIR%\iniciar.bat"
    echo start "" "%~dp0deckcontas.exe" >> "%BUILD_DIR%\iniciar.bat"
    echo. >> "%BUILD_DIR%\iniciar.bat"
    echo REM Atalho para iniciar o programa >> "%BUILD_DIR%\iniciar.bat"
    
    REM Criar README
    echo # Deck Contas - Build 64 bits > "%BUILD_DIR%\README.txt"
    echo. >> "%BUILD_DIR%\README.txt"
    echo Data: %date% %time% >> "%BUILD_DIR%\README.txt"
    echo. >> "%BUILD_DIR%\README.txt"
    echo Para iniciar: clique duplo em iniciar.bat >> "%BUILD_DIR%\README.txt"
    echo. >> "%BUILD_DIR%\README.txt"
    echo Arquitetura: 64 bits >> "%BUILD_DIR%\README.txt"
    
    echo.
    echo ========================================
    echo ARQUIVOS CRIADOS
    echo ========================================
    echo Pasta: %BUILD_DIR%
    echo Executavel: %BUILD_DIR%\deckcontas.exe
    echo Atalho: %BUILD_DIR%\iniciar.bat
    echo README: %BUILD_DIR%\README.txt
    echo.
    
    REM Verificar se o executavel e de 64 bits
    echo Verificando arquitetura do executavel...
    dumpbin /headers "%BUILD_DIR%\deckcontas.exe" | findstr machine >nul
    if %errorlevel%==0 (
        for /f "tokens=*" %%a in ('dumpbin /headers "%BUILD_DIR%\deckcontas.exe" ^| findstr machine') do (
            echo Arquitetura: %%a
        )
    )
    
) else (
    echo.
    echo ERRO no build! Verifique os logs.
    cd /d "%~dp0"
    pause
    exit /b 1
)

echo.
echo Build concluido!
echo.
pause