@echo off
REM Script de backup automatico para alteracoes no Deck Contas
REM Uso: backup_and_commit.bat "mensagem do commit"

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
    set commit_msg=Auto backup: %timestamp%
) else (
    set commit_msg=%~1
)

echo ========================================
echo Backup automatico do Deck Contas
echo ========================================
echo.

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
    git tag -a "auto-backup-%timestamp%" -m "%commit_msg%"
    git push origin "auto-backup-%timestamp%"
    
    echo.
    echo Backup concluido com sucesso!
    echo Commit: %commit_msg%
    echo Tag: auto-backup-%timestamp%
) else (
    echo Nao ha alteracoes para backup.
)

echo.
pause