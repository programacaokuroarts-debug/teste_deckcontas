# Otimização Ultimate para Múltiplas Contas

## Configurações para Performance Máxima

### 1. Limites de Logs (conforme implementado):

**Para uso normal (até 4 contas):**
- Logs ativos: 100
- Logs pendentes: 50
- Intervalo: 400ms
- Limpeza: 20 segundos

**Para uso intensivo (mais de 4 contas):**

Edite o arquivo `src-tauri/src/lib.rs` e ajuste:

```javascript
// Linha ~500 (BALL_DIAGNOSTICS_SCRIPT)
window.__deckContasLogs.length > 20  // Reduzir de 100

// Linha ~900 (BALL_AUTOMATION_SCRIPT)
setInterval(() => {...}, 300)  // Aumentar de 400ms

// Limpar tentativas mais rápido
if (agora - horario > 15000)  // Reduzir de 20000
```

### 2. WebViews por Conta

Cada conta usa uma WebView separada. Para evitar travamentos:

- **Máximo recomendado:** 6-8 contas simultâneas
- **Recomendado:** 4-6 contas com hardware médio
- **Sobremédio:** 8+ contas requer hardware potente

### 3. Configurações de Sistema

#### Windows:
```cmd
# Aumentar memoria do navegador
setx PUPPETEER_SKIP_CHROMIUM_DOWNLOAD 1

# Ou usar Chrome instalado
setx CHROME_EXECUTABLE_PATH "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

#### Configurações avançadas para múltiplas contas:

No arquivo `vite.config.ts`, adicione:
```javascript
export default defineConfig({
  build: {
    // Reduzir tamanho do build
    rollupOptions: {
      output: {
        manualChunks: {
          // Separar chunks para carregamento paralelo
        }
      }
    }
  },
  server: {
    // Desativar HMR em producao
    hmr: false
  }
})
```

### 4. Script de Diagnóstico de Performance

Execute no console do jogo:
```javascript
// Diagnóstico completo
window.__deckContasDiagnosticSnapshot()
```

### 5. Limpeza Manual de Recursos

Quando travar:
```javascript
// Limpar tudo
window.__deckContasClearLogs()
window.__deckContasClearAttempts()
window.__deckContasCleanupLogs()

// Fechar contas não usadas
// No app: clique no botão de pausar/conta
```

## Estratégia Recomendada

### Para 1-3 contas:
- Usar configuração padrão
- Intervalo 400ms
- Logs limitados a 50

### Para 4-6 contas:
- Intervalo 500ms
- Logs limitados a 30
- Monitorar uso de memória

### Para 7+ contas:
- Intervalo 600ms
- Logs limitados a 20
- Desativar diagnósticos
- Considerar máquina dedicada

## Script de Limpeza Automática

Para limpar automaticamente recursos:

```javascript
// Script de limpeza agressiva
setInterval(() => {
    // Limpar logs antigos
    window.__deckContasLogs = window.__deckContasLogs.slice(-10);
    
    // Limpar tentativas antigas
    const agora = Date.now();
    for (const [slot, ts] of window.__deckContasBallAttempts?.entries() || []) {
        if (agora - ts > 15000) {
            window.__deckContasBallAttempts.delete(slot);
        }
    }
    
    // Limpar Pokémons mortos expirados
    for (const [slot, p] of window.__deckContasFallenPokemon?.entries() || []) {
        if (p.expiraEm <= agora) {
            window.__deckContasFallenPokemon.delete(slot);
        }
    }
}, 30000);
```

## Monitoramento de Recursos

Use o Gerenciador de Tarefas:
- **Memória:** Cada WebView usa ~100-200MB
- **CPU:** Ajuste intervalo conforme necessidade
- **Disco:** Verifique crescimento de arquivos de perfil

## Solução de Problemas

### Travamento frequente:
1. Reduza número de contas
2. Aumente intervalo de verificação
3. Limpe logs manualmente
4. Reiniciе o navegador

### Memória alta:
```javascript
// Limpar tudo
window.__deckContasLogs = [];
window.__deckContasPendingWsLogs = [];
window.__deckContasPendingGameMessages = [];
```

### Pokémons não capturados:
1. Verifique conexão WebSocket
2. Reduza intervalo temporariamente
3. Forçar captura: `window.__deckContasForceCatch()`