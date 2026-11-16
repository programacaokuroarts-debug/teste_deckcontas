# Scripts de Backup Automático - Deck Contas

Este repositório contém scripts otimizados para backup automático de alterações no projeto Deck Contas.

## Scripts Disponíveis

### 1. `backup_and_commit.bat`
Backup rápido das alterações sem compilação.

**Uso:**
```cmd
backup_and_commit.bat "mensagem descritiva do commit"
```

**Exemplo:**
```cmd
backup_and_commit.bat "Corrigido bug de lancamento de pokebolas"
```

Se não passar uma mensagem, ele usa uma mensagem automática com timestamp.

### 2. `build_and_backup.bat`
Compila o projeto e envia para backup automático.

**Uso:**
```cmd
build_and_backup.bat "mensagem descritiva do commit"
```

**Exemplo:**
```cmd
build_and_backup.bat "Nova funcionalidade: correcao automacao pokebolas"
```

## O que os scripts fazem?

1. **Adiciona** todos os arquivos modificados (`git add .`)
2. **Verifica** se há alterações para commitar
3. **Cria commit** com a mensagem fornecida ou automática
4. **Envia** para o GitHub (`git push`)
5. **Cria tag** de backup com timestamp
6. **Envia tag** para o GitHub

## Tags de Backup

As tags seguem o padrão:
- `auto-backup-YYYYMMDD-HHMMSS` - para backup sem build
- `build-backup-YYYYMMDD-HHMMSS` - para backup com build

## Como usar no dia a dia

1. **Para alterações menores:**
   ```cmd
   backup_and_commit.bat "Arrumado layout da tela principal"
   ```

2. **Para funcionalidades importantes:**
   ```cmd
   build_and_backup.bat "Implementada correcao automacao pokebolas"
   ```

3. **Para listar tags de backup:**
   ```cmd
   git tag
   ```

4. **Para voltar a um backup específico:**
   ```cmd
   git checkout auto-backup-20261116-001
   ```

## Diagnóstico de Pokebolas

Acesse o console do jogo (F12) e use:

```javascript
// Ver estado atual da automação
window.__deckContasDiagnosticSnapshot()

// Forçar lançar em slot específico
window.__deckContasForceCatch(1)

// Forçar lançar no mais urgente
window.__deckContasForceCatch()

// Limpar tentativas para teste
window.__deckContasClearAttempts()
```

### Funções de limpeza de logs (para evitar travamentos)

```javascript
// Limpar logs antigos manualmente
window.__deckContasClearLogs()

// Limpar logs de mais de 1 hora atrás
window.__deckContasPurgeOldLogs()

// Forçar limpeza de logs pendentes
window.__deckContasCleanupLogs()

// Exportar apenas os últimos 50 logs (evita arquivos gigantes)
window.__deckContasExportLogs()
```

## Otimizações de Desempenho

### Redução de logs para prevenir travamentos

Para evitar que o arquivo de dados cresça demais e cause travamentos:

1. **Logs limitados a 100 registros** (em vez de 300)
2. **Logs pendentes limitados a 50** (em vez de 100)
3. **Limpeza automática a cada 1 minuto**
4. **Exportação limitada a 50 logs**

### Diagnóstico de arquivos grandes

Se o computador travar:

1. Abra o console do jogo (F12)
2. Execute:
   ```javascript
   window.__deckContasGetLogs().length  // Verifica quantos logs existem
   window.__deckContasClearLogs()        // Limpa imediatamente
   ```

## Fluxo Recomendado

1. Faça suas alterações no código
2. Teste no jogo (pressione F12 no navegador)
3. Quando tudo funcionar:
   ```cmd
   build_and_backup.bat "Corrigido: pokemons com timeout antes de receber bola"
   ```
4. Verifique se a tag foi criada no GitHub