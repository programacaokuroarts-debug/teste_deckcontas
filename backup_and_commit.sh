#!/bin/bash
# Script de backup automatico para alteracoes no Deck Contas
# Uso: ./backup_and_commit.sh "mensagem do commit"

# Cores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")

# Mensagem do commit
if [ -z "$1" ]; then
    COMMIT_MSG="Auto backup: $TIMESTAMP"
else
    COMMIT_MSG="$1"
fi

echo "========================================"
echo "Backup automatico do Deck Contas"
echo "========================================"
echo ""

# Verificar se ha alteracoes
if git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}Nao ha alteracoes para backup.${NC}"
    exit 0
fi

echo "Encontradas alteracoes..."
echo ""

# Adicionar arquivos
git add .

# Fazer commit
git commit -m "$COMMIT_MSG"

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}Commit criado com sucesso!${NC}"
    echo "Mensagem: $COMMIT_MSG"
    
    # Enviar para GitHub
    git push
    
    # Criar tag
    TAG_NAME="auto-backup-$TIMESTAMP"
    git tag -a "$TAG_NAME" -m "$COMMIT_MSG"
    git push origin "$TAG_NAME"
    
    echo -e "${GREEN}Tag criada: $TAG_NAME${NC}"
    echo -e "${GREEN}Backup concluido com sucesso!${NC}"
else
    echo -e "${YELLOW}Commit vazio ou ja existe.${NC}"
fi

echo ""