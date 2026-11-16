// Script de diagnóstico de logs - para execucao no console do navegador do jogo

(function() {
    console.log("=== Diagnóstico de Logs Deck Contas ===");
    
    const logs = window.__deckContasLogs || [];
    const pendingWs = window.__deckContasPendingWsLogs || [];
    const pendingGame = window.__deckContasPendingGameMessages || [];
    const caidos = window.__deckContasFallenPokemon || new Map();
    const tentativas = window.__deckContasBallAttempts || new Map();
    
    console.log("Logs ativos:", logs.length);
    console.log("Logs pendente WebSocket:", pendingWs.length);
    console.log("Logs pendente jogo:", pendingGame.length);
    console.log("Pokemons mortos:", caidos.size);
    console.log("Tentativas de captura:", tentativas.size);
    
    // Calcular tamanho aproximado dos logs em bytes
    const logsSize = JSON.stringify(logs).length;
    const pendingWsSize = JSON.stringify(pendingWs).length;
    const pendingGameSize = JSON.stringify(pendingGame).length;
    const totalKb = (logsSize + pendingWsSize + pendingGameSize) / 1024;
    
    console.log("Tamanho aproximado dos dados:", Math.round(totalKb), "KB");
    
    // Aviso se estiver grande
    if (totalKb > 100) {
        console.warn("⚠️ ATENÇÃO: Os dados estão muito grandes! Execute window.__deckContasClearLogs()");
    }
    
    // Função de limpeza manual
    window.__diagnoseCleanup = function() {
        const antes = totalKb;
        window.__deckContasClearLogs();
        window.__deckContasCleanupLogs();
        console.log("✅ Logs limpos");
        
        const logs2 = window.__deckContasLogs || [];
        const pendingWs2 = window.__deckContasPendingWsLogs || [];
        const pendingGame2 = window.__deckContasPendingGameMessages || [];
        const logsSize2 = JSON.stringify(logs2).length;
        const pendingWsSize2 = JSON.stringify(pendingWs2).length;
        const pendingGameSize2 = JSON.stringify(pendingGame2).length;
        const depoisKb = (logsSize2 + pendingWsSize2 + pendingGameSize2) / 1024;
        
        console.log("Antes:", Math.round(antes), "KB");
        console.log("Depois:", Math.round(depoisKb), "KB");
        console.log("Economizado:", Math.round(antes - depoisKb), "KB");
    };
    
    console.log("\nPara limpar logs, execute: window.__diagnoseCleanup()");
    
})();