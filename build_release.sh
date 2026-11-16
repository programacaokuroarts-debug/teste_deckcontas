#!/bin/bash
# Build Release Otimizado para Múltiplas Contas

echo "========================================"
echo "Build Release Otimizado - Deck Contas"
echo "========================================"
echo ""

# Timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")

# Criar pasta de build na raiz
BUILD_DIR="./build-release-${TIMESTAMP}"
mkdir -p "$BUILD_DIR"

echo "Criando pasta de build: $BUILD_DIR"
echo ""

# Entrar no diretorio src-tauri
cd ./src-tauri

echo "Compilando em modo release otimizado..."
cargo build --release

if [ $? -eq 0 ]; then
    echo ""
    echo "Build concluido com sucesso!"
    echo ""
    
    # Voltar ao diretorio principal
    cd ..
    
    # Copiar o executavel
    EXE_PATH="./src-tauri/target/release/deckcontas.exe"
    
    if [ -f "$EXE_PATH" ]; then
        cp "$EXE_PATH" "$BUILD_DIR/deckcontas.exe"
        echo "Executavel copiado para: $BUILD_DIR/deckcontas.exe"
    fi
    
    # Criar atalho batch (compativel com Windows)
    cat > "$BUILD_DIR/iniciar.bat" << 'EOF'
@echo off
start "" "%~dp0deckcontas.exe"
REM Atalho para iniciar o programa
REM Duplo clique ou execute este arquivo
EOF
    
    echo ""
    
    # Criar README na pasta de build
    cat > "$BUILD_DIR/README.txt" << EOF
# Deck Contas - Build ${TIMESTAMP}

## Executaveis
- Executavel: deckcontas.exe
- Atalho: iniciar.bat

## Otimizacoes aplicadas
- Limite reduzido de logs (100 -> 20 para light)
- Intervalo de verificacao: 500ms -> 400ms
- Tempo de limpeza: 35s -> 20s
- Limpeza automatica a cada 1 minuto
- Funcoes de limpeza de logs incluidas

## Para usar com multiplas contas
Veja: ULTIMATE_OPTIMIZATION.md

## Diagnóstico
Console do jogo (F12):
- window.__deckContasDiagnosticSnapshot()
- window.__deckContasClearLogs()
- window.__deckContasForceCatch(slot)

EOF
    
    echo "=== ARQUIVOS CRIADOS ==="
    echo "Pasta de build: $BUILD_DIR"
    echo "Executavel: $BUILD_DIR/deckcontas.exe"
    echo "Atalho: $BUILD_DIR/iniciar.bat"
    echo "README: $BUILD_DIR/README.txt"
    
else
    echo ""
    echo "ERRO na compilacao! Verifique os logs."
    cd ..
    exit 1
fi

echo ""