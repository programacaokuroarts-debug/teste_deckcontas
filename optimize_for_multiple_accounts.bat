@echo off
REM ============================================
REM Script de Otimizacao para Multiplas Contas
REM ============================================

setlocal enabledelayedexpansion

echo ========================================
echo Otimizacao para Multiplas Contas
echo ========================================
echo.

REM Fazer backup do lib.rs atual
echo Criando backup do arquivo atual...
copy "src-tauri\src\lib.rs" "src-tauri\src\lib_backup_original.rs" >nul

if exist "src-tauri\src\lib_light.rs" (
    echo Encontrado arquivo de otimizacao light...
    
    REM Perguntar qual versao usar
    echo.
    echo Escolha uma opcao:
    echo 1. Versao Padrao (já implementada - logs limitados a 100)
    echo 2. Versao Ultra-Light (logs limitados a 20, intervalo 600ms)
    echo 3. Manter original (restaurar backup)
    echo.
    set /p CHOICE="Selecione (1/2/3): "
    
    if "!CHOICE!"=="1" (
        echo.
        echo Mantendo configuracao padrao ja aplicada...
        echo - Logs limitados a 100
        echo - Intervalo de verificacao: 500ms
        echo - Limpeza automatica a cada 1 minuto
    )
    else if "!CHOICE!"=="2" (
        echo.
        echo Aplicando versao ultra-light...
        echo (Configure manualmente editando lib.rs para os valores abaixo)
        echo.
        echo VALORES PARA ALTERAR EM src-tauri\src\lib.rs:
        echo.
        echo 1. Linha ~500 (BALL_DIAGNOSTICS_SCRIPT):
        echo    window.__deckContasLogs.length > 20
        echo.
        echo 2. Linha ~900 (BALL_AUTOMATION_SCRIPT):
        echo    setInterval(..., 600)
        echo.
        echo 3. Linha ~920 (LIMPAR TENTATIVAS):
        echo    if (agora - horario > 15000)
        echo.
    )
    else if "!CHOICE!"=="3" (
        echo.
        echo Restaurando configuracao original...
        if exist "src-tauri\src\lib_backup_original.rs" (
            move /y "src-tauri\src\lib_backup_original.rs" "src-tauri\src\lib.rs" >nul
            echo Configuracao original restaurada!
        ) else (
            echo Backup original nao encontrado!
        )
    )
    else (
        echo Opcao invalida. Mantendo configuracao atual.
    )
) else (
    echo.
    echo NOTA: A configuracao de otimizacao ja foi aplicada!
    echo.
    echo Valores atuais:
    echo - Limite de logs: 100
    echo - Limite pendentes: 50
    echo - Limite pendentes WS: 30
    echo - Intervalo: 400ms
    echo - Limpeza tentativas: 20 segundos
    echo - Limpeza automatica: 1 minuto
)

echo.
echo ========================================
echo RESUMO PARA MULTIPLAS CONTAS
echo ========================================
echo.
echo 1. Use build_release.bat ou build_release.sh
echo 2. Execute o atalho iniciar.bat na pasta build
echo 3. Para muitas contas, edite lib.rs manualmente:
echo    - Increase interval to 600ms
echo    - Decrease log limits to 20
echo    - Set cleanup to 15 seconds
echo.
echo Referencia: ULTIMATE_OPTIMIZATION.md
echo.
pause