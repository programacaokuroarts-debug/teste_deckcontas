@echo off
REM Script de build e backup automatico para alteracoes no Deck Contas
REM Uso: build_and_backup.bat "mensagem do commit"

setlocal

REM Obter data e hora formatadas
for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value') do set "dt=%%a"

set YYYY=%dt:~0,4%
set MM=%dt:~4,2%
set DD=%dt:~6,2%
set HH=%dt:~8,2%
set Min=%dt:~10,2%
set Sec=%dt:~12,2%

set timestamp=%YYYY%%MM%%DD%-%HH%%Min%%Sec%

REM Verificar se mensagem foi passada como argumento
if "%~1"=="" (
    set commit_msg=Auto build & backup: %timestamp%
) else (
    set commit_msg=%~1
)

echo ========================================
echo Build e Backup automatico do Deck Contas
echo ========================================
echo.

REM Entrar no diretorio src-tauri
cd /d "%~dp0src-tauri"

echo Compilando o projeto...
cargo build --release

if %errorlevel%==0 (
    echo.
    echo Build concluido com sucesso!
    echo.
    
    REM Voltar ao diretorio principal
    cd /d "%~dp0"
    
    REM Adicionar todos os arquivos modificados
    git add .
    
    REM Verificar se ha alteracoes para commitar
    git diff-index --quiet HEAD --
    if %errorlevel%==1 (
        echo Encontradas alteracoes...
        echo.
        
        REM Fazer commit com a mensagem
        git commit -m "%commit_msg%"
        
        REM Enviar para o GitHub
        git push
        
        REM Criar tag de backup
        git tag -a "build-backup-%timestamp%" -m "%commit_msg%"
        git push origin "build-backup-%timestamp%"
        
        echo.
        echo Backup concluido com sucesso!
        echo Commit: %commit_msg%
        echo Tag: build-backup-%timestamp%
    ) else (
        echo Nao ha alteracoes para backup.
    )
) else (
    echo.
    echo Erro na compilacao! Verifique os logs.
    cd /d "%~dp0"
)

echo.
pause