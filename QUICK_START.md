# 🚀 Guia Rápido - Deck Contas

## Para uso normal (1-4 contas)

1. **Build rápido:**
   ```cmd
   build_release.bat
   ```
   ou
   ```bash
   ./build_release.sh
   ```

2. **Iniciar:**
   - Duplo clique em `iniciar.bat` na pasta `build-release-*`
   - Ou execute `deckcontas.exe`

---

## Para uso com múltiplas contas (5+)

### Opção 1: Usar script de otimização
```cmd
optimize_for_multiple_accounts.bat
```

### Opção 2: Edição manual no código

Abra `src-tauri/src/lib.rs` e ajuste:

| Parâmetro | Valor Atual | Para 5+ Contas | Para 8+ Contas |
|-----------|-------------|----------------|----------------|
| Logs ativos | 100 | 50 | 20 |
| Pendentes WS | 50 | 30 | 20 |
| Intervalo | 400ms | 500ms | 600ms |
| Limpeza tentativas | 20s | 25s | 30s |
| Limpeza automática | 1 min | 1 min | 1 min |

---

## 📊 Diagnóstico no Console

Abra o jogo, pressione **F12** e use:

```javascript
// Estado atual
window.__deckContasDiagnosticSnapshot()

// Forçar captura (slot 1-6)
window.__deckContasForceCatch(1)

// Limpar logs (evitar travamentos)
window.__deckContasClearLogs()

// Limpar tentativas antigas
window.__deckContasClearAttempts()
```

---

## 🧹 Solução de Problemas

### Computador travando:
1. Pare o programa
2. Execute:
   ```javascript
   window.__deckContasClearLogs()
   ```
3. Reduza número de contas

### Pokémons não capturados:
1. Aumente o número de contas temporariamente
2. Verifique se há bolas disponíveis
3. Use `window.__deckContasForceCatch()` manualmente

### Memória alta:
- Feche WebViews não usadas
- Reinicie o aplicativo periodicamente

---

## 📁 Estrutura de Arquivos

```
deckcontas/
├── build_release.bat    # Build para Windows
├── build_release.sh     # Build para GitBash
├── optimize_for_multiple_accounts.bat  # Otimização
├── README_BACKUP.md     # Scripts de backup
├── ULTIMATE_OPTIMIZATION.md  # Guia avançado
├── diagnose_logs.js     # Script de diagnóstico
└── QUICK_START.md       # Este arquivo
```

---

## 🔖 Tags no GitHub

| Tag |Descrição |
|-----|----------|
| `full-optimization-fix-20261116-001` | Correção pokebolas |
| `optimization-backup-20261116-001` | Otimizações de desempenho |
| `complete-multi-account-solution-20261116` | Tudo implementado |

---

## ⚠️ Lembrete

**Para múltiplas contas:**
- Monitore o uso de memória
- Limpe logs periodicamente
- Não ultrapasse 6 contas em hardware médio