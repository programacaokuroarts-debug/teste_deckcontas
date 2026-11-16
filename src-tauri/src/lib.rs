use tauri::{
    Manager,
    WebviewUrl,
    WebviewWindowBuilder,
    LogicalPosition,
    LogicalSize,
};

use tauri::webview::WebviewBuilder;

use webview2_com::{
    Microsoft::Web::WebView2::Win32::ICoreWebView2_3,
    TrySuspendCompletedHandler,
};

use windows::core::Interface;

/* =====================================================
   OBSERVADOR WEBSOCKET ANTES DO CARREGAMENTO DO JOGO

   Otimização:
   - Não registra cada mensagem WebSocket recebida.
   - Guarda somente eventos relevantes de morte/captura.
   - Não imprime cada pacote no console.
   - Continua encaminhando campo/campo.init para a automação.
===================================================== */

const BALL_WEBSOCKET_INIT_SCRIPT: &str = r##"
(() => {

    if (window.__deckContasWsObserverInstalled) return;

    const NativeWebSocket = window.WebSocket;

    if (!NativeWebSocket) return;

    window.__deckContasWsObserverInstalled = true;
    window.__deckContasPendingWsLogs = [];
    window.__deckContasPendingGameMessages = [];
    window.__deckContasGameSocket = null;

    // Remonta o estado completo a partir dos deltas (mesma regra de
    // shared/estado-delta.mjs do jogo). O Modo Solo lê o resultado
    // em window.__deckContasEstado e a lista de hunts em
    // window.__deckContasWelcome.
    window.__deckContasMesclarEstado = (function () {
        let campos = null;
        let pokemons = new Map();

        return function mesclar(parcial) {
            if (!parcial) return;

            const {
                cheio,
                pokemons: lista,
                pkMud,
                pkFora,
                dexMud,
                dexFora,
                ...resto
            } = parcial;

            if (cheio || !campos) {
                campos = resto;
                pokemons = new Map((lista ?? []).map(k => [k.id, k]));
            } else {
                Object.assign(campos, resto);

                if (lista) pokemons = new Map(lista.map(k => [k.id, k]));
                for (const k of pkMud ?? []) pokemons.set(k.id, k);
                for (const id of pkFora ?? []) pokemons.delete(id);

                if (dexMud || dexFora) {
                    campos.pokedex = { ...(campos.pokedex ?? {}), ...(dexMud ?? {}) };
                    for (const chave of dexFora ?? []) delete campos.pokedex[chave];
                }
            }

            window.__deckContasEstado = { ...campos, pokemons: [...pokemons.values()] };

            // Relógio do servidor: o campo "servidorAgora" vem nos deltas
            // e permite ao Modo Solo saber quando a troca de hunt está livre.
            if (parcial.servidorAgora) {
                window.__deckContasClock = {
                    ts: Number(parcial.servidorAgora) || 0,
                    em: Date.now()
                };
            }
        };
    })();

    function guardarLog(registro) {
        const logs = window.__deckContasLogs;
        const destino = Array.isArray(logs)
            ? logs
            : window.__deckContasPendingWsLogs;

        destino.push(registro);

        // Limitar a 100 logs para evitar arquivos gigantes
        const limite = Array.isArray(logs) ? 100 : 50;

        while (destino.length > limite) {
            destino.shift();
        }
    }

    function registrarMensagem(socket, data) {
        try {
            if (!socket.url.includes("pokeidle.io")) return;
            if (typeof data !== "string") return;

            const mensagem = JSON.parse(data);

            // Mensagens de campo são encaminhadas, mas não ficam
            // sendo copiadas para o histórico a cada atualização.
            if (mensagem.t !== "batalha" || !Array.isArray(mensagem.ev)) {
                return;
            }

            const eventos = mensagem.ev
                .filter(e => e && (e.k === "morte" || e.k === "bola"))
                .map(e => ({
                    k: e.k,
                    quem: e.quem,
                    slot: e.slot,
                    nome: e.nome,
                    ballId: e.ballId,
                    sucesso: e.sucesso,
                    chance: e.chance,
                    shiny: e.shiny
                }));

            if (eventos.length === 0) return;

            guardarLog({
                horario: new Date().toISOString(),
                timestamp: Date.now(),
                tipo: "WEBSOCKET_RECEBIDO",
                dados: {
                    url: socket.url,
                    estado: socket.readyState,
                    mensagem: {
                        t: "batalha",
                        ev: eventos
                    }
                }
            });

        } catch {}
    }

    function encaminharMensagem(data) {
        if (typeof data !== "string") return;

        try {
            const mensagem = JSON.parse(data);

            // Estado do jogo (Modo Solo): o welcome traz o quadro
            // completo e os pacotes "estado" trazem só o que mudou.
            if (mensagem.t === "welcome") {
                window.__deckContasWelcome = mensagem;
                if (mensagem.estado) {
                    window.__deckContasMesclarEstado({ ...mensagem.estado, cheio: true });
                }
                return;
            }

            if (mensagem.t === "estado") {
                if (mensagem.estado) {
                    window.__deckContasMesclarEstado(mensagem.estado);
                }
                return;
            }

            // Cooldown de troca de hunt: o servidor manda "trocaLivreEm"
            // no evento "hunt" (dentro de mensagens de batalha). O Modo
            // Solo só envia hunt.select depois que a troca está livre.
            if (mensagem.t === "batalha" && Array.isArray(mensagem.ev)) {
                for (const ev of mensagem.ev) {
                    if (ev && ev.k === "hunt" && ev.trocaLivreEm) {
                        window.__deckContasTrocaLivreEm = Number(ev.trocaLivreEm) || 0;
                    }
                }
            }

            // Recusa do servidor logo depois de um hunt.select nosso:
            // guardada para o painel mostrar o motivo e tentar de novo.
            if (mensagem.t === "erro") {
                const enviada = Number(window.__deckContasHuntSelectEm || 0);
                if (enviada && Date.now() - enviada < 8000) {
                    window.__deckContasHuntErro = {
                        chave: mensagem.chave || null,
                        msg: mensagem.msg || null,
                        params: mensagem.params || null,
                        em: Date.now()
                    };
                }
            }

            const relevante =
                mensagem.t === "campo" ||
                mensagem.t === "campo.init" ||
                (
                    mensagem.t === "batalha" &&
                    Array.isArray(mensagem.ev) &&
                    mensagem.ev.some(e =>
                        e.k === "bola" || e.k === "morte"
                    )
                );

            if (!relevante) return;

            if (typeof window.__deckContasHandleWsMessage === "function") {
                window.__deckContasHandleWsMessage(mensagem);
            } else {
                const pendentes = window.__deckContasPendingGameMessages;
                pendentes.push(mensagem);

                // Reduzir limite para evitar arquivos gigantes
                if (pendentes.length > 50) {
                    pendentes.shift();
                }
            }
        } catch {}
    }

    // Limpar logs pendentes antigos periodicamente
    window.__deckContasCleanupLogs = function() {
        if (window.__deckContasPendingWsLogs) {
            window.__deckContasPendingWsLogs = window.__deckContasPendingWsLogs.slice(-30);
        }
        if (window.__deckContasPendingGameMessages) {
            window.__deckContasPendingGameMessages = window.__deckContasPendingGameMessages.slice(-30);
        }
    };

    window.WebSocket = new Proxy(NativeWebSocket, {
        construct(target, args) {
            const socket = Reflect.construct(target, args, target);

            if (socket.url.includes("pokeidle.io")) {
                window.__deckContasGameSocket = socket;

                // Permite que automações adicionais se conectem ao socket
                // sem criar timers permanentes nem interceptar novamente o jogo.
                if (typeof window.__deckContasOnGameSocket === "function") {
                    try {
                        window.__deckContasOnGameSocket(socket);
                    } catch {}
                }

                socket.addEventListener("message", event => {
                    registrarMensagem(socket, event.data);
                    encaminharMensagem(event.data);
                });

                socket.addEventListener("close", () => {
                    if (window.__deckContasGameSocket === socket) {
                        window.__deckContasGameSocket = null;
                    }
                });
            }

            return socket;
        }
    });

})();
"##;

/* =====================================================
   CAMINHO DOS PERFIS
===================================================== */

fn account_profile(
    app: &tauri::AppHandle,
    account_id: u64,
) -> Result<std::path::PathBuf, String> {
    let profile_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("profiles")
        .join(format!("account-{}", account_id));

    std::fs::create_dir_all(&profile_dir)
        .map_err(|e| e.to_string())?;

    Ok(profile_dir)
}

/* =====================================================
   JANELAS ANTIGAS
===================================================== */

#[tauri::command]
async fn open_game_account(
    app: tauri::AppHandle,
    account_id: u64,
    account_name: String,
    url: String,
) -> Result<(), String> {
    let label = format!("game-account-{}", account_id);

    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let parsed_url = url::Url::parse(&url)
        .map_err(|_| "Endereço do jogo inválido.".to_string())?;

    if parsed_url.scheme() != "https" && parsed_url.scheme() != "http" {
        return Err("Endereço precisa começar com http:// ou https://".into());
    }

    let profile_dir = account_profile(&app, account_id)?;

    WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(parsed_url),
    )
    .title(&account_name)
    .inner_size(1100.0, 800.0)
    .data_directory(profile_dir)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   CRIAR NAVEGADOR INTERNO
===================================================== */

#[tauri::command]
async fn create_game_webview(
    app: tauri::AppHandle,
    account_id: u64,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || x < 0.0
        || y < 0.0
    {
        return Err("Posição ou tamanho inválido.".into());
    }

    let label = format!("game-view-{}", account_id);

    // Uma WebView existente é reutilizada; não cria outro navegador.
    if let Some(view) = app.get_webview(&label) {
        view.set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;

        view.set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;

        view.show().map_err(|e| e.to_string())?;

        return Ok(());
    }

    let parsed_url = url::Url::parse(&url)
        .map_err(|_| "Endereço do jogo inválido.".to_string())?;

    if parsed_url.scheme() != "https" && parsed_url.scheme() != "http" {
        return Err("Endereço precisa começar com http:// ou https://".into());
    }

    let main_webview = app
        .get_webview("main")
        .ok_or("Janela principal não encontrada.")?;

    let parent_window = main_webview.window();
    let profile_dir = account_profile(&app, account_id)?;

    let builder = WebviewBuilder::new(
        &label,
        WebviewUrl::External(parsed_url),
    )
    .initialization_script(BALL_WEBSOCKET_INIT_SCRIPT)
    .data_directory(profile_dir);

    parent_window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   ALTERAR POSIÇÃO E TAMANHO
===================================================== */

#[tauri::command]
fn update_game_webview_bounds(
    app: tauri::AppHandle,
    account_id: u64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !x.is_finite()
        || !y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || x < 0.0
        || y < 0.0
    {
        return Err("Posição ou tamanho inválido.".into());
    }

    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    view.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    view.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   ESCONDER NAVEGADOR
===================================================== */

#[tauri::command]
fn hide_game_webview(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    if let Some(view) = app.get_webview(&label) {
        view.hide().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/* =====================================================
   PAUSAR JOGO
===================================================== */

#[tauri::command]
fn pause_game_webview(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    view.hide().map_err(|e| e.to_string())?;

    view.with_webview(|webview| {
        #[cfg(windows)]
        unsafe {
            let result = (|| -> Result<(), String> {
                let controller = webview.controller();

                let core = controller
                    .CoreWebView2()
                    .map_err(|e| e.to_string())?;

                let core3: ICoreWebView2_3 = core
                    .cast()
                    .map_err(|e| e.to_string())?;

                let handler = TrySuspendCompletedHandler::create(
                    Box::new(|result, success| {
                        if result.is_err() || !success {
                            eprintln!(
                                "O WebView2 não conseguiu suspender completamente a conta."
                            );
                        } else {
                            println!("WebView2 suspenso com sucesso.");
                        }

                        Ok(())
                    })
                );

                core3
                    .TrySuspend(&handler)
                    .map_err(|e| e.to_string())?;

                Ok(())
            })();

            if let Err(error) = result {
                eprintln!("Erro ao pausar jogo: {}", error);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   RETOMAR JOGO
===================================================== */

#[tauri::command]
fn resume_game_webview(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    view.with_webview(|webview| {
        #[cfg(windows)]
        unsafe {
            let result = (|| -> Result<(), String> {
                let controller = webview.controller();

                let core = controller
                    .CoreWebView2()
                    .map_err(|e| e.to_string())?;

                let core3: ICoreWebView2_3 = core
                    .cast()
                    .map_err(|e| e.to_string())?;

                core3
                    .Resume()
                    .map_err(|e| e.to_string())?;

                Ok(())
            })();

            if let Err(error) = result {
                eprintln!("Erro ao retomar jogo: {}", error);
            }
        }
    })
    .map_err(|e| e.to_string())?;

    view.show().map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   VERIFICAR NAVEGADOR
===================================================== */

#[tauri::command]
fn is_game_webview_open(
    app: tauri::AppHandle,
    account_id: u64,
) -> bool {
    let label = format!("game-view-{}", account_id);
    app.get_webview(&label).is_some()
}

/* =====================================================
   SISTEMA DE DIAGNÓSTICO SOB DEMANDA

   Não mantém mais timers de leitura do DOM nem do estoque.
   O snapshot pode ser consultado manualmente no Console.
===================================================== */

const BALL_DIAGNOSTICS_SCRIPT: &str = r##"
(() => {

    if (window.__deckContasDiagnosticsInstalled) return;

    window.__deckContasDiagnosticsInstalled = true;
    window.__deckContasLogs = window.__deckContasLogs || [];

    function adicionarLog(registro) {
        window.__deckContasLogs.push(registro);

        // Limitar a 100 logs para evitar arquivos gigantes
        while (window.__deckContasLogs.length > 100) {
            window.__deckContasLogs.shift();
        }
    }

    window.__deckContasLog = function(tipo, dados) {
        const registro = {
            horario: new Date().toISOString(),
            timestamp: Date.now(),
            tipo,
            dados
        };

        adicionarLog(registro);
        return registro;
    };

    window.__deckContasGetLogs = function() {
        return window.__deckContasLogs;
    };

    window.__deckContasClearLogs = function() {
        window.__deckContasLogs = [];
    };

    window.__deckContasExportLogs = function() {
        // Retornar apenas os últimos 50 logs para evitar arquivos gigantes
        const logs = window.__deckContasLogs || [];
        const ultimosLogs = logs.slice(-50);
        return JSON.stringify({
            total: logs.length,
            exibidos: ultimosLogs,
            exportadoEm: new Date().toISOString()
        }, null, 2);
    };

    // Função para limpar logs manualmente
    window.__deckContasPurgeOldLogs = function() {
        if (!window.__deckContasLogs) return;
        
        const agora = Date.now();
        const UM_HORA = 60 * 60 * 1000;
        
        window.__deckContasLogs = window.__deckContasLogs.filter(registro => {
            // Manter logs de até 1 hora atrás
            return agora - registro.timestamp < UM_HORA;
        });
    };

    // Timer de limpeza automática dos logs a cada minuto
    if (!window.__deckContasCleanupTimer) {
        window.__deckContasCleanupTimer = setInterval(() => {
            window.__deckContasCleanupLogs();
            window.__deckContasPurgeOldLogs();
        }, 60000);
    }

    const mensagensPendentes = window.__deckContasPendingWsLogs || [];

    for (const registro of mensagensPendentes) {
        adicionarLog(registro);
    }

    window.__deckContasPendingWsLogs = [];

    // Diagnóstico visual somente quando solicitado manualmente.
    window.__deckContasDiagnosticSnapshot = function() {
        const caidos = Array.from(
            document.querySelectorAll("#caidos-lista .caido[data-slot]")
        ).map(pokemon => ({
            slot: pokemon.dataset.slot,
            nome: pokemon.querySelector(".caido-nome")?.innerText.trim() || "",
            barra: pokemon.querySelector(".caido-tempo i")?.style.width || ""
        }));

        const bolasCaidos = Array.from(
            document.querySelectorAll("#caidos-bolas .caidos-bola")
        ).map(botao => ({
            titulo: botao.title,
            selecionada: botao.classList.contains("on"),
            imagem: botao.querySelector("img")?.src || ""
        }));

        const bolasEstoque = Array.from(
            document.querySelectorAll(".auto-chip")
        ).map(botao => ({
            titulo: botao.title,
            quantidade: botao.querySelector(".q")?.textContent || ""
        }));

        // Novo diagnóstico: estado interno da automação
        const automacaoInterna = {
            caidosInterno: window.__deckContasFallenPokemon ? Array.from(window.__deckContasFallenPokemon.entries()).map(([slot, p]) => ({
                slot: p.slot,
                nome: p.nome,
                expiraEm: new Date(p.expiraEm).toISOString()
            })) : [],
            tentativas: window.__deckContasBallAttempts ? Array.from(window.__deckContasBallAttempts.entries()) : [],
            config: window.__deckContasBallConfig || null,
            ballBusy: window.__deckContasBallBusy || false
        };

        return {
            endereco: location.href,
            estado: document.readyState,
            websocketDisponivel: !!window.__deckContasGameSocket,
            automacao: window.__deckContasBallConfig || null,
            caidos,
            bolasCaidos,
            bolasEstoque,
            automacaoInterna
        };
    };

    // Só loga a primeira instalação por página: o app reenvia a
    // configuração periodicamente para recuperar um F5.
    if (!window.__deckContasDiagnosticsLogged) {
        window.__deckContasDiagnosticsLogged = true;
        window.__deckContasLog(
            "DIAGNOSTICO_INICIADO",
            {
                endereco: location.href,
                titulo: document.title,
                estado: document.readyState,
                observadorWebSocket:
                    window.__deckContasWsObserverInstalled === true
            }
        );
    }

})();
"##;

/* =====================================================
   AUTOMAÇÃO DE POKÉBOLAS - WEBSOCKET

   Mantida a lógica de captura já validada.
   Removidos logs por atualização de campo e console.log
   por lançamento para reduzir trabalho desnecessário.
===================================================== */

const BALL_AUTOMATION_SCRIPT: &str = r##"
(() => {

    if (window.__deckContasBallTimer) {
        clearInterval(window.__deckContasBallTimer);
    }

    if (!window.__deckContasBallAttempts) {
        window.__deckContasBallAttempts = new Map();
    }

    if (!window.__deckContasFallenPokemon) {
        window.__deckContasFallenPokemon = new Map();
    }

    window.__deckContasBallBusy = false;

    const tentativas = window.__deckContasBallAttempts;
    const caidos = window.__deckContasFallenPokemon;

    /* ================================================
       REGISTRAR ATUALIZAÇÕES DO SERVIDOR
    ================================================ */

    function processarCampo(mensagem) {
        if (!mensagem || typeof mensagem !== "object") return;

        if (mensagem.t === "campo.init") {
            caidos.clear();
            if (window.__deckContasMobInfo) {
                window.__deckContasMobInfo.clear();
            }
        }

        if (!window.__deckContasMobInfo) {
            window.__deckContasMobInfo = new Map();
        }

        const mobsInfo = window.__deckContasMobInfo;

        for (const mob of mensagem.mobs || []) {
            if (mob.s == null) continue;

            const slot = String(mob.s);

            // Guarda nível/shiny de QUALQUER atualização do mob
            // (inclusive quando está vivo), para usar quando morrer:
            // a mensagem de morte nem sempre traz esses campos.
            if (mob.nv != null || mob.sh != null || mob.n) {
                const info = mobsInfo.get(slot) || {};
                if (Number(mob.nv) > 0) info.nivel = Number(mob.nv);
                if (mob.sh != null) info.shiny = !!mob.sh;
                if (mob.n) info.nome = mob.n;
                mobsInfo.set(slot, info);
            }

            if (Number(mob.x) === 1) {
                const restante = Number(mob.xr);
                const info = mobsInfo.get(slot) || {};

                if (restante > 0) {
                    caidos.set(slot, {
                        slot: Number(mob.s),
                        nome: mob.n || info.nome || "",
                        nivel: Number(mob.nv) || info.nivel || 0,
                        shiny: !!(mob.sh ?? info.shiny),
                        expiraEm: Date.now() + restante
                    });
                }
            } else if (Number(mob.x) === 0) {
                caidos.delete(slot);
                tentativas.delete(slot);
            }
        }

        for (const slotBruto of mensagem.fora || []) {
            const slot = String(slotBruto);
            caidos.delete(slot);
            tentativas.delete(slot);
            mobsInfo.delete(slot);
        }
    }

    /* ================================================
       PROCESSAR EVENTOS DE BATALHA
    ================================================ */

    function processarBatalha(mensagem) {
        for (const evento of mensagem.ev || []) {

            if (
                evento.k === "morte" &&
                evento.quem === "selvagem" &&
                evento.slot != null
            ) {
                const slot = String(evento.slot);
                const info = window.__deckContasMobInfo?.get(slot) || {};

                const pokemon = {
                    slot: Number(evento.slot),
                    nome: evento.nome || info.nome || "",
                    nivel: Number(evento.level || evento.pokemon?.level || info.nivel) || 0,
                    shiny: !!(evento.shiny ?? evento.pokemon?.shiny ?? info.shiny),
                    expiraEm: Date.now() + 30000
                };

                caidos.set(slot, pokemon);
                tentativas.delete(slot);

                window.__deckContasLog?.(
                    "AUTOMACAO_POKEMON_CAIDO",
                    {
                        slot: pokemon.slot,
                        nome: pokemon.nome,
                        nivel: pokemon.nivel,
                        expiraEm: pokemon.expiraEm
                    }
                );
            }

            if (evento.k === "bola" && evento.slot != null) {
                const slot = String(evento.slot);

                window.__deckContasLog?.(
                    "AUTOMACAO_RESPOSTA_BOLA",
                    {
                        slot: evento.slot,
                        ballId: evento.ballId,
                        sucesso: evento.sucesso,
                        chance: evento.chance
                    }
                );

                caidos.delete(slot);
                tentativas.delete(slot);
            }
        }
    }

    window.__deckContasHandleWsMessage = function(mensagem) {
        if (mensagem.t === "campo" || mensagem.t === "campo.init") {
            processarCampo(mensagem);
        }

        if (mensagem.t === "batalha") {
            processarBatalha(mensagem);
        }
    };

    /* ================================================
       REPROCESSAR MENSAGENS PENDENTES
    ================================================ */

    const pendentes = window.__deckContasPendingGameMessages || [];

    for (const mensagem of pendentes) {
        window.__deckContasHandleWsMessage(mensagem);
    }

    window.__deckContasPendingGameMessages = [];

    /* ================================================
       IDENTIFICAR POKÉBOLA
    ================================================ */

    function identificarBola(botao) {
        const texto = (
            (botao.title || "") + " " +
            (botao.innerText || "") + " " +
            Array.from(botao.querySelectorAll("img"))
                .map(img => img.src)
                .join(" ")
        ).toLowerCase();

        if (texto.includes("beast") || texto.includes("ball-beast")) return 5;
        if (texto.includes("ultra") || texto.includes("ball-ultra")) return 4;
        if (texto.includes("super") || texto.includes("ball-super")) return 3;
        if (texto.includes("great") || texto.includes("ball-great")) return 2;
        if (texto.includes("poke") || texto.includes("ball-poke")) return 1;

        return 0;
    }

    function obterNivelDoPokemon(pokemon) {
        if (pokemon && pokemon.nivel > 0) return pokemon.nivel;
        if (!pokemon) return 0;
        
        const el = document.querySelector(`#caidos-lista .caido[data-slot="${pokemon.slot}"]`);
        if (!el) return 0;
        
        // O jogo escreve o nível em <b>Nv123</b> dentro de .caido-quem
        const forte = el.querySelector(".caido-quem b");
        const txt = (forte && forte.textContent) || el.innerText || el.textContent || "";
        const m = txt.match(/L[vV]?\.?\s*(\d+)/) || txt.match(/(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
    }

    function selecionarMelhorBola(pokemon) {
        const config = window.__deckContasBallConfig;

        const botoes = Array.from(
            document.querySelectorAll("#caidos-bolas .caidos-bola")
        );

        if (botoes.length === 0) return null;

        // Shiny morto: com a opção ligada, usa as melhores bolas
        // disponíveis (Beast > Ultra > Super > Great > Poke) para
        // maximizar a chance de captura do shiny.
        if (pokemon?.shiny && config?.shinyBestBall) {
            for (const id of [5, 4, 3, 2, 1]) {
                const btn = botoes.find(e => identificarBola(e) === id);
                if (btn) return { id, botao: btn };
            }
            return null;
        }

        // Se estiver configurado para FORÇAR ULTRA BALL
        if (config?.forceUltraBall) {
            const prioridadeUltra = config?.useBeastBall ? [5, 4] : [4];
            for (const id of prioridadeUltra) {
                const btn = botoes.find(e => identificarBola(e) === id);
                if (btn) return { id, botao: btn };
            }
            // Fallback para qualquer outra se nao tiver Ultra
            for (const id of [3, 2, 1]) {
                const btn = botoes.find(e => identificarBola(e) === id);
                if (btn) return { id, botao: btn };
            }
            return null;
        }

        // Lógica Inteligente de Nível
        const nivel = obterNivelDoPokemon(pokemon);
        let prioridade = [];

        if (nivel >= 50) {
            // Level 50 ou mais: Usar Beast Ball (se ativa) ou Ultra Ball (4), caindo para Super (3)
            prioridade = config?.useBeastBall ? [5, 4, 3] : [4, 3];
        } else {
            // Level abaixo de 50: Usar bolas de baixo nível Great (2) ou Poke Ball (1)
            prioridade = [2, 1];
        }

        // Tenta achar a bola ideal da prioridade
        for (const id of prioridade) {
            const btn = botoes.find(e => identificarBola(e) === id);
            if (btn) return { id, botao: btn };
        }

        // Se nao tem a bola ideal do nivel, usa qualquer outra disponivel
        const prioridadeGeral = config?.useBeastBall ? [5, 4, 3, 2, 1] : [4, 3, 2, 1];
        for (const id of prioridadeGeral) {
            const btn = botoes.find(e => identificarBola(e) === id);
            if (btn) return { id, botao: btn };
        }

        return null;
    }

    /* ================================================
       LOCALIZAR WEBSOCKET ATIVO
    ================================================ */

    function obterSocket() {
        const socket = window.__deckContasGameSocket;

        if (!socket) return null;
        if (socket.readyState !== WebSocket.OPEN) return null;
        if (!socket.url.includes("pokeidle.io")) return null;

        return socket;
    }

    /* ================================================
       ENVIAR LANÇAMENTO
    ================================================ */

    function lancarBola(pokemon, bola) {
        const socket = obterSocket();

        if (!socket) {
            window.__deckContasLog?.(
                "AUTOMACAO_SEM_CONEXAO",
                { slot: pokemon.slot }
            );

            return false;
        }

        const comando = {
            t: "ball.throw",
            ballId: bola.id,
            slot: pokemon.slot
        };

        try {
            socket.send(JSON.stringify(comando));

            window.__deckContasLog?.(
                "AUTOMACAO_LANCAMENTO",
                {
                    slot: pokemon.slot,
                    nome: pokemon.nome,
                    bola: bola.id,
                    metodo: "websocket"
                }
            );

            return true;

        } catch (error) {
            window.__deckContasLog?.(
                "ERRO_AUTOMACAO",
                {
                    slot: pokemon.slot,
                    erro: String(error)
                }
            );

            return false;
        }
    }

    /* ================================================
       PROCESSAR POKÉMON DISPONÍVEIS
    ================================================ */

    function procurarCaidos() {
        const config = window.__deckContasBallConfig;

        if (!config || !config.enabled) return;
        if (window.__deckContasBallBusy) return;

        const agora = Date.now();

        for (const [slot, pokemon] of caidos.entries()) {
            if (pokemon.expiraEm <= agora) {
                caidos.delete(slot);
                tentativas.delete(slot);
            }
        }

        if (caidos.size === 0) return;

        // Encontrar o pokemon mais urgente (menor tempo restante) que permita lançar
        const pokemonUrgente = Array.from(caidos.values())
            .sort((a, b) => a.expiraEm - b.expiraEm)
            .find(p => !tentativas.has(String(p.slot)));

        if (!pokemonUrgente) return;

        // Verificar se ainda podemos tentar (não passou mais de 28 segundos)
        const slot = String(pokemonUrgente.slot);
        const ultimaTentativa = tentativas.get(slot);
        if (ultimaTentativa && (agora - ultimaTentativa < 28000)) {
            return;
        }

        window.__deckContasBallBusy = true;

        try {
            const bola = selecionarMelhorBola(pokemonUrgente);
            if (!bola) {
                // Se não temos bola disponível agora, marcar que tentamos recentemente
                // para não ficarmos tentando o mesmo pokemon eternamente
                tentativas.set(slot, agora);
                return;
            }

            // O lançamento é enviado SOMENTE pelo WebSocket, com o id da bola
            // escolhido. Não clicamos no botão da bola para evitar que o jogo
            // lance uma segunda bola (bug de lançar dois tipos de Pokébola).
            tentativas.set(slot, agora);

            const enviado = lancarBola(pokemonUrgente, bola);

            if (!enviado) {
                tentativas.delete(slot);
            }

        } finally {
            window.__deckContasBallBusy = false;
        }
    }

    /* ================================================
       LIMPEZA DE TENTATIVAS ANTIGAS
    ================================================ */

    function limparTentativas() {
        const agora = Date.now();

        for (const [slot, horario] of tentativas.entries()) {
            // Limpar tentativas mais anturas de 25 segundos
            // para permitir nova tentativa se bola ficou disponível
            if (agora - horario > 25000) {
                tentativas.delete(slot);
            }
        }
    }

    window.__deckContasBallTimer = setInterval(() => {
        limparTentativas();
        
        const agora = Date.now();
        
        // Verificar se algum Pokémon está prestes a expirar (menos de 5 segundos)
        for (const [slot, pokemon] of caidos.entries()) {
            const restante = pokemon.expiraEm - agora;
            if (restante > 0 && restante < 5000) {
                // Log para diagnóstico quando um Pokémon está crítico
                window.__deckContasLog?.(
                    "AUTOMACAO_POKEMON_CRITICO",
                    {
                        slot: pokemon.slot,
                        nome: pokemon.nome,
                        restanteMs: restante
                    }
                );
            }
        }
        
        procurarCaidos();
    }, 300);

    // Uma única vez por página (o resync periódico reexecuta isto).
    if (!window.__deckContasAutomationLogged) {
        window.__deckContasAutomationLogged = true;
        window.__deckContasLog?.(
            "AUTOMACAO_INSTALADA",
            {
                websocketDisponivel: !!obterSocket(),
                caidosRecebidos: caidos.size
            }
        );
    }

    // Função de força para testar/verificar
    window.__deckContasForceCatch = function(slot) {
        const config = window.__deckContasBallConfig;
        if (!config || !config.enabled) {
            window.__deckContasLog?.("ERRO", { motivo: "Automação desativada" });
            return false;
        }
        
        const agora = Date.now();
        const allCaidos = Array.from(caidos.entries());
        
        // Se slot especificado, usar aquele
        // Se não, usar o mais urgente
        let pokemonUrgente;
        if (slot != null) {
            pokemonUrgente = caidos.get(String(slot));
        } else {
            pokemonUrgente = allCaidos
                .sort((a, b) => a[1].expiraEm - b[1].expiraEm)
                .find(([s, p]) => !tentativas.has(s) || (agora - tentativas.get(s)) > 28000)?.[1];
        }
        
        if (!pokemonUrgente) {
            window.__deckContasLog?.("ERRO", { motivo: "Pokemon nao encontrado" });
            return false;
        }
        
        const s = String(pokemonUrgente.slot);
        const bola = selecionarMelhorBola(pokemonUrgente);
        
        if (!bola) {
            window.__deckContasLog?.("ERRO", { motivo: "Nenhuma bola disponivel" });
            return false;
        }
        
        // Sem clique no botão: o envio é feito só pelo WebSocket (evita 2 bolas)
        tentativas.set(pokemonUrgente.slot, agora);
        const enviado = lancarBola(pokemonUrgente, bola);
        
        window.__deckContasLog?.("FORCE_CAUGHT", {
            slot: pokemonUrgente.slot,
            nome: pokemonUrgente.nome,
            bola: bola.id,
            enviado: enviado
        });
        
        return enviado;
    };

    // Função para limpar tentativas (útil para testes)
    window.__deckContasClearAttempts = function() {
        tentativas.clear();
        window.__deckContasLog?.("TENTATIVAS_LIMCAS", { });
    };

})();
"##;

/* =====================================================
   DESLIGAR A AUTOMAÇÃO DE BOLA PRÓPRIA DO JOGO

   Se o VIP automático do jogo estiver ligado, ele lança a
   bola dele em paralelo com a nossa e o resultado são dois
   tipos de bola no mesmo corpo. Manda o mesmo patch que a
   UI do jogo manda (auto.set espelhando o estado atual),
   só que desligando as três chaves de auto-ball.
===================================================== */

const DESLIGAR_AUTO_BOLA_DO_JOGO: &str = r##"
(() => {
    if (!window.__deckContasBallConfig?.enabled) return;
    if (window.__deckContasGameAutoBallOff) return;

    try {
        const automation = window.__deckContasEstado?.automation;
        const socket = window.__deckContasGameSocket;

        if (!automation || !socket || socket.readyState !== 1) return;

        const ativo = !!(
            automation.autoBallSemParar ||
            automation.autoBallAteCapturar ||
            automation.autoBall
        );

        if (!ativo) return;

        socket.send(JSON.stringify({
            t: "auto.set",
            ...automation,
            autoBall: false,
            autoBallSemParar: false,
            autoBallAteCapturar: false
        }));

        window.__deckContasGameAutoBallOff = true;
    } catch {}
})();
"##;

/* =====================================================
   CONFIGURAR AUTOMAÇÃO DE POKÉBOLAS
===================================================== */

#[tauri::command]
fn set_ball_automation(
    app: tauri::AppHandle,
    account_id: u64,
    enabled: bool,
    use_beast_ball: bool,
    force_ultra_ball: bool,
    shiny_best_ball: bool,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    let config = serde_json::json!({
        "enabled": enabled,
        "useBeastBall": use_beast_ball,
        "forceUltraBall": force_ultra_ball,
        "shinyBestBall": shiny_best_ball
    });

    let script = format!(
        "window.__deckContasBallConfig = {};\n{}\n{}\n{}\n",
        config,
        BALL_DIAGNOSTICS_SCRIPT,
        BALL_AUTOMATION_SCRIPT,
        DESLIGAR_AUTO_BOLA_DO_JOGO
    );

    view.eval(&script)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   MODO SOLO - MELHOR HUNT POR CONTA

   Usa o motor da extensão "_hunt for PokeIdle" (boot.js +
   jogo-bundle.js + game.js + engine.js + ritmo.js + solo.js),
   embutido no binário via include_str! e injetado na janela
   do jogo com view.eval. O eval não é bloqueado pelo CSP da
   página (script-src com nonce + strict-dynamic), diferente
   de import() dinâmico.
===================================================== */

const SOLO_BOOT_SCRIPT: &str = include_str!("solo/boot.js");
const SOLO_BUNDLE_SCRIPT: &str = include_str!("solo/jogo-bundle.js");
const SOLO_GAME_SCRIPT: &str = include_str!("solo/game.js");
const SOLO_ENGINE_SCRIPT: &str = include_str!("solo/engine.js");
const SOLO_RITMO_SCRIPT: &str = include_str!("solo/ritmo.js");
const SOLO_CONTROLLER_SCRIPT: &str = include_str!("solo/solo.js");

fn envolver_solo(nome: &str, fonte: &str) -> String {
    format!(
        "try {{\n{}\n}} catch (e) {{ console.error('[Deck Contas] solo {}:', e); }}\n",
        fonte, nome
    )
}

// Injeta o motor do Modo Solo uma única vez por página.
// Cada script é idempotente (o solo.js marca
// __deckContasSoloInstalado), então repetir é seguro.
fn injetar_motor_solo(view: &tauri::Webview) -> Result<(), String> {
    let mut script = String::with_capacity(1_100_000);

    script.push_str("if (!globalThis.__deckContasSoloInstalado) {\n");
    script.push_str(&envolver_solo("boot", SOLO_BOOT_SCRIPT));
    script.push_str(&envolver_solo("bundle", SOLO_BUNDLE_SCRIPT));
    script.push_str(&envolver_solo("game", SOLO_GAME_SCRIPT));
    script.push_str(&envolver_solo("engine", SOLO_ENGINE_SCRIPT));
    script.push_str(&envolver_solo("ritmo", SOLO_RITMO_SCRIPT));
    script.push_str(&envolver_solo("controller", SOLO_CONTROLLER_SCRIPT));
    script.push_str("}\n");

    view.eval(&script).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_solo_mode(
    app: tauri::AppHandle,
    account_id: u64,
    enabled: bool,
    ordem: String,
    shiny_best_ball: bool,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    let foco = match ordem.as_str() {
        "ouro" | "shiny" => ordem.clone(),
        _ => "xp".to_string(),
    };

    let config = serde_json::json!({
        "enabled": enabled,
        "ordem": foco,
        "shinyBestBall": shiny_best_ball
    });

    if enabled {
        injetar_motor_solo(&view)?;
    }

    let script = format!(
        "try {{\n globalThis.__deckContasSolo?.configurar({});\n}} catch (e) {{ console.error('[Deck Contas] solo config:', e); }}",
        config
    );

    view.eval(&script).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn toggle_solo_panel(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    // Se o motor ainda não foi injetado (Modo Solo desligado,
    // mas o usuário quer ver o painel), injeta agora.
    injetar_motor_solo(&view)?;

    let script = "try {\n globalThis.__deckContasSolo?.alternarPainel();\n} catch (e) { console.error('[Deck Contas] solo painel:', e); }";

    view.eval(script).map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   OPÇÕES ALTERADAS DENTRO DO PAINEL DO JOGO

   O popup do Modo Solo vive na janela da conta e altera foco e
   opções de bola por ali. O app principal é quem conhece a conta,
   então o comando lê a conta pelo label da webview ("game-view-{id}")
   e repassa para a janela principal salvar e reenviar a config.
===================================================== */

#[tauri::command]
fn aplicar_opcoes_solo(
    webview: tauri::Webview,
    ordem: Option<String>,
    force_ultra_ball: Option<bool>,
    shiny_best_ball: Option<bool>,
) -> Result<(), String> {
    let label = webview.label().to_string();

    let account_id: u64 = label
        .strip_prefix("game-view-")
        .ok_or("Este ajuste só funciona na janela de uma conta.")?
        .parse()
        .map_err(|_| "Identificador de conta inválido.".to_string())?;

    let main = webview
        .get_webview("main")
        .ok_or("Janela principal não encontrada.")?;

    let ordem_json = match ordem.as_deref() {
        Some("xp") | Some("ouro") | Some("shiny") => {
            serde_json::Value::String(ordem.clone().unwrap_or_default())
        }
        _ => serde_json::Value::Null,
    };

    let script = format!(
        "try {{\n window.__deckContasAplicarOpcoesSolo?.({}, {{ ordem: {}, forceUltraBall: {}, shinyBestBall: {} }});\n}} catch (e) {{ console.error('[Deck Contas] aplicar opções:', e); }}",
        account_id,
        ordem_json,
        force_ultra_ball.map(|b| b.to_string()).unwrap_or_else(|| "null".into()),
        shiny_best_ball.map(|b| b.to_string()).unwrap_or_else(|| "null".into()),
    );

    main.eval(&script).map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   AUTOMAÇÃO DE COMPRAS - MARKET

   - Compra somente os produtos configurados pelo usuário.
   - Não inclui Beast Ball nem compras com diamantes.
   - Usa shop.buy e espera a atualização do estoque do servidor.
   - Envia no máximo uma compra por vez, em lotes de até 100.
===================================================== */

const SHOP_AUTOMATION_SCRIPT: &str = r##"
(() => {
    const config = window.__deckContasShopConfig || {};

    const produtos = [
        { key: "ball_4", kind: "ball", id: 4, price: 130, name: "Ultra Ball" },
        { key: "ball_3", kind: "ball", id: 3, price: 50, name: "Super Ball" },
        { key: "ball_2", kind: "ball", id: 2, price: 20, name: "Great Ball" },
        { key: "ball_1", kind: "ball", id: 1, price: 5, name: "Poke Ball" },
        { key: "item_206", kind: "item", id: 206, price: 5000, name: "Max Revive" },
        { key: "item_205", kind: "item", id: 205, price: 600, name: "Revive" },
        { key: "item_70070", kind: "item", id: 70070, price: 2500, name: "Golden Potion" },
        { key: "item_204", kind: "item", id: 204, price: 1500, name: "Ultimate Potion" },
        { key: "item_203", kind: "item", id: 203, price: 800, name: "Hyper Potion" },
        { key: "item_202", kind: "item", id: 202, price: 400, name: "Ultra Potion" },
        { key: "item_201", kind: "item", id: 201, price: 150, name: "Great Potion" },
        { key: "item_200", kind: "item", id: 200, price: 50, name: "Small Potion" }
    ];

    let runtime = window.__deckContasShopRuntime;

    if (!runtime) {
        runtime = {
            state: {
                gold: null,
                balls: null,
                items: null,
                hasGold: false,
                hasBalls: false,
                hasItems: false
            },
            socket: null,
            listener: null,
            pending: null,
            cooldowns: new Map(),
            refilling: new Map(),
            nextPurchaseAt: 0,
            processTimer: null,
            pendingTimer: null
        };

        window.__deckContasShopRuntime = runtime;
    }

    runtime.config = config;

    function registrar(tipo, dados) {
        if (typeof window.__deckContasLog === "function") {
            window.__deckContasLog(tipo, dados);
        }
    }

    function obterEstoque(produto) {
        const mapa = produto.kind === "ball"
            ? runtime.state.balls
            : runtime.state.items;

        if (!mapa) return null;

        const quantidade = Number(mapa[String(produto.id)] ?? 0);
        return Number.isFinite(quantidade) && quantidade >= 0
            ? Math.floor(quantidade)
            : 0;
    }

    function limparPendente() {
        if (runtime.pendingTimer !== null) {
            clearTimeout(runtime.pendingTimer);
            runtime.pendingTimer = null;
        }

        runtime.pending = null;
    }

    function agendarProcessamento(atraso = 1200) {
        if (runtime.processTimer !== null) {
            clearTimeout(runtime.processTimer);
        }

        runtime.processTimer = setTimeout(() => {
            runtime.processTimer = null;
            tentarComprar();
        }, atraso);
    }

    function confirmarCompraSeAtualizou(estado) {
        const pendente = runtime.pending;
        if (!pendente) return;

        if (Object.prototype.hasOwnProperty.call(estado, "gold")) {
            if (runtime.state.gold !== pendente.saldoAntes) {
                pendente.saldoAtualizado = true;
            }
        }

        const campoAtualizado = pendente.kind === "ball"
            ? Object.prototype.hasOwnProperty.call(estado, "balls")
            : Object.prototype.hasOwnProperty.call(estado, "items");

        if (campoAtualizado) {
            const estoqueAtual = obterEstoque(pendente.produto);
            if (estoqueAtual !== null && estoqueAtual > pendente.estoqueAntes) {
                pendente.estoqueAtualizado = true;
                pendente.estoqueDepois = estoqueAtual;
            }
        }

        // O servidor pode entregar saldo e estoque em mensagens estado separadas.
        // Só libera a próxima compra depois de observar as duas atualizações.
        if (pendente.saldoAtualizado && pendente.estoqueAtualizado) {
            const aumento = pendente.estoqueDepois - pendente.estoqueAntes;
            const nome = pendente.produto.name;

            limparPendente();
            runtime.nextPurchaseAt = Date.now() + 1500;

            registrar("AUTOCOMPRA_CONFIRMADA", {
                produto: nome,
                quantidade: aumento,
                estoque: pendente.estoqueDepois
            });

            agendarProcessamento(1500);
        }
    }

    function processarEstado(mensagem) {
        const estado = mensagem && mensagem.estado;
        if (!estado || typeof estado !== "object") return;

        if (Object.prototype.hasOwnProperty.call(estado, "gold")) {
            const gold = Number(estado.gold);
            if (Number.isFinite(gold) && gold >= 0) {
                runtime.state.gold = Math.floor(gold);
                runtime.state.hasGold = true;
            }
        }

        // O servidor envia balls/items como mapas de estoque completos,
        // embora o objeto estado possa chegar em atualizações parciais.
        if (Object.prototype.hasOwnProperty.call(estado, "balls")) {
            runtime.state.balls = estado.balls && typeof estado.balls === "object"
                ? estado.balls
                : {};
            runtime.state.hasBalls = true;
        }

        if (Object.prototype.hasOwnProperty.call(estado, "items")) {
            runtime.state.items = estado.items && typeof estado.items === "object"
                ? estado.items
                : {};
            runtime.state.hasItems = true;
        }

        confirmarCompraSeAtualizou(estado);
        tentarComprar();
    }

    function tratarMensagem(evento) {
        if (typeof evento.data !== "string") return;

        try {
            const mensagem = JSON.parse(evento.data);

            if (mensagem.t === "estado") {
                processarEstado(mensagem);
            }
        } catch {}
    }

    function conectarSocket(socket) {
        if (!socket || !socket.url || !socket.url.includes("pokeidle.io")) {
            return;
        }

        if (runtime.socket === socket) return;

        if (runtime.socket && runtime.listener) {
            try {
                runtime.socket.removeEventListener("message", runtime.listener);
            } catch {}
        }

        runtime.socket = socket;
        runtime.listener = tratarMensagem;
        socket.addEventListener("message", runtime.listener);

        registrar("AUTOCOMPRA_WEBSOCKET_CONECTADO", {
            estado: socket.readyState
        });
    }

    function obterSocket() {
        const socket = runtime.socket || window.__deckContasGameSocket;

        if (!socket) return null;
        if (socket.readyState !== WebSocket.OPEN) return null;
        if (!socket.url || !socket.url.includes("pokeidle.io")) return null;

        return socket;
    }

    function tentarComprar() {
        if (!runtime.config || runtime.config.enabled !== true) return;
        if (runtime.pending) return;
        if (Date.now() < runtime.nextPurchaseAt) return;
        if (!runtime.state.hasGold || !runtime.state.hasBalls || !runtime.state.hasItems) return;

        const socket = obterSocket();
        if (!socket) return;

        const regras = runtime.config.rules || {};
        const agora = Date.now();

        for (const produto of produtos) {
            const regra = regras[produto.key];
            if (!regra || regra.enabled !== true) {
                runtime.refilling.delete(produto.key);
                continue;
            }

            const minimo = Math.max(0, Math.floor(Number(regra.minStock)));
            const alvo = Math.max(0, Math.floor(Number(regra.targetStock)));

            if (!Number.isFinite(minimo) || !Number.isFinite(alvo) || alvo <= minimo) {
                runtime.refilling.delete(produto.key);
                continue;
            }

            const estoque = obterEstoque(produto);
            if (estoque === null) continue;

            // Inicia uma reposição quando o estoque atinge o mínimo.
            // Depois disso, continua em lotes de até 100 até alcançar o alvo.
            if (!runtime.refilling.has(produto.key)) {
                if (estoque > minimo) continue;
                runtime.refilling.set(produto.key, alvo);
            }

            const alvoReposicao = Math.max(
                0,
                Math.floor(Number(runtime.refilling.get(produto.key)))
            );

            if (estoque >= alvoReposicao) {
                runtime.refilling.delete(produto.key);
                continue;
            }

            const bloqueadoAte = runtime.cooldowns.get(produto.key) || 0;
            if (agora < bloqueadoAte) continue;

            const saldo = runtime.state.gold;
            const podeComprar = Math.floor(saldo / produto.price);
            const quantidade = Math.min(
                alvoReposicao - estoque,
                100,
                podeComprar
            );

            if (quantidade <= 0) continue;

            const comando = {
                t: "shop.buy",
                kind: produto.kind,
                id: produto.id,
                qty: quantidade
            };

            try {
                runtime.pending = {
                    key: produto.key,
                    kind: produto.kind,
                    produto,
                    estoqueAntes: estoque,
                    quantidade,
                    saldoAntes: saldo,
                    saldoAtualizado: false,
                    estoqueAtualizado: false,
                    estoqueDepois: estoque,
                    iniciadoEm: agora
                };

                socket.send(JSON.stringify(comando));

                registrar("AUTOCOMPRA_ENVIADA", {
                    produto: produto.name,
                    id: produto.id,
                    kind: produto.kind,
                    quantidade,
                    estoqueAntes: estoque,
                    estoqueAlvo: alvoReposicao,
                    saldoAntes: saldo,
                    custoEstimado: quantidade * produto.price
                });

                runtime.pendingTimer = setTimeout(() => {
                    const pendente = runtime.pending;
                    if (!pendente || pendente.key !== produto.key) return;

                    limparPendente();
                    runtime.cooldowns.set(produto.key, Date.now() + 60000);
                    runtime.nextPurchaseAt = Date.now() + 1000;

                    registrar("AUTOCOMPRA_SEM_CONFIRMACAO", {
                        produto: produto.name,
                        quantidade
                    });

                    agendarProcessamento(1000);
                }, 15000);

                return;
            } catch (error) {
                limparPendente();
                runtime.cooldowns.set(produto.key, Date.now() + 60000);
                registrar("AUTOCOMPRA_ERRO_ENVIO", {
                    produto: produto.name,
                    erro: String(error)
                });
            }
        }
    }

    window.__deckContasOnGameSocket = conectarSocket;
    conectarSocket(window.__deckContasGameSocket);

    registrar("AUTOCOMPRA_CONFIGURADA", {
        enabled: runtime.config.enabled === true,
        regrasAtivas: Object.values(runtime.config.rules || {})
            .filter(regra => regra && regra.enabled === true).length
    });

    tentarComprar();
})();
"##;

/* =====================================================
   CONFIGURAR AUTOMAÇÃO DE COMPRAS
===================================================== */

#[tauri::command]
fn set_shop_automation(
    app: tauri::AppHandle,
    account_id: u64,
    enabled: bool,
    rules: serde_json::Value,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    let config = serde_json::json!({
        "enabled": enabled,
        "rules": rules
    });

    let script = format!(
        "window.__deckContasShopConfig = {};\n{}\n",
        config,
        SHOP_AUTOMATION_SCRIPT
    );

    view.eval(&script)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   TESTAR JAVASCRIPT EM UMA CONTA
===================================================== */

#[tauri::command]
fn test_game_webview_js(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    let view = app
        .get_webview(&label)
        .ok_or("Navegador da conta não encontrado.")?;

    let script = r#"
        console.log(
            "[Deck Contas] Teste JavaScript executado com sucesso.",
            {
                titulo: document.title,
                endereco: location.origin,
                estado: document.readyState,
                configuracaoAutomacao: window.__deckContasBallConfig ?? null,
                diagnosticoInstalado: window.__deckContasDiagnosticsInstalled ?? false,
                observadorWebSocket: window.__deckContasWsObserverInstalled ?? false,
                socketDisponivel: !!window.__deckContasGameSocket
            }
        );
    "#;

    view.eval(script)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =====================================================
   FECHAR NAVEGADOR
===================================================== */

#[tauri::command]
fn close_game_webview(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-view-{}", account_id);

    if let Some(view) = app.get_webview(&label) {
        view.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/* =====================================================
   COMANDOS ANTIGOS
===================================================== */

#[tauri::command]
fn is_account_open(
    app: tauri::AppHandle,
    account_id: u64,
) -> bool {
    let label = format!("game-account-{}", account_id);
    app.get_webview_window(&label).is_some()
}

#[tauri::command]
fn close_game_account(
    app: tauri::AppHandle,
    account_id: u64,
) -> Result<(), String> {
    let label = format!("game-account-{}", account_id);

    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

/* =====================================================
   INICIALIZAÇÃO
===================================================== */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            open_game_account,
            is_account_open,
            close_game_account,
            create_game_webview,
            update_game_webview_bounds,
            hide_game_webview,
            is_game_webview_open,
            close_game_webview,
            pause_game_webview,
            resume_game_webview,
            test_game_webview_js,
            set_ball_automation,
            set_shop_automation,
            set_solo_mode,
            toggle_solo_panel,
            aplicar_opcoes_solo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
