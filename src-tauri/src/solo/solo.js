/* =====================================================
   MODO SOLO - Deck Contas

   Usa o motor da extensao "/hunt for PokeIdle" (engine.js)
   para achar a melhor hunt do pokemon em campo, por XP/h,
   Ouro/h ou Shiny, e leva o pokemon para la sozinho.

   Precisa que boot.js + jogo-bundle.js + game.js + engine.js
   + ritmo.js ja tenham sido injetados (ver set_solo_mode no
   lib.rs). O estado do jogo vem de window.__deckContasWelcome
   (mensagem "welcome") e window.__deckContasEstado (deltas).
===================================================== */

(function (root) {
    "use strict";

    if (root.__deckContasSoloInstalado) return;
    root.__deckContasSoloInstalado = true;

    const PIH = (root.__pokeidleHunt ??= {});

    const FOCOS = {
        xp: "XP/h",
        ouro: "Ouro/h",
        shiny: "Shiny"
    };

    /* Coluna do motor usada para ordenar cada categoria. */
    const METRICAS = {
        xp: "xpPokemonH",
        ouro: "ouroH",
        shiny: "shinyH"
    };

    /* Enquanto o Modo Solo estiver ligado o programa fica sempre
       verificando qual e a melhor hunt do foco escolhido: recalcula
       de 60 em 60 segundos (e antes disso se o pokemon mudar). */
    const INTERVALO_MS = 60 * 1000;
    const TICK_MS = 10 * 1000;

    /* Controle da viagem: espera minima entre envios de hunt.select e
       recuo apos o servidor recusar uma troca. */
    const TENTATIVA_MIN_MS = 8 * 1000;
    const RECUSA_BACKOFF_MS = 20 * 1000;

    let timer = null;
    let painelAberto = false;
    let analisando = false;
    let ultimaAnalise = 0;
    let ultimaTentativa = 0;
    let assinaturaAtual = null;
    let ultimoResultado = null;
    let ultimoJogo = null;
    let ultimoErro = null;
    let ultimoAviso = null;

    /* -------------------------------------------------
       ESTADO DO JOGO
    ------------------------------------------------- */

    const cfg = () => root.__deckContasSoloConfig || { enabled: false, ordem: "xp" };
    const eu = () => root.__deckContasEstado || null;
    const welcome = () => root.__deckContasWelcome || null;

    /* Opcoes de bola mostradas no painel. O valor canonico vem do
       __deckContasBallConfig (escrito pelo Rust); o fallback e a
       config do proprio solo. */
    const bolaCfg = () => {
        const b = root.__deckContasBallConfig || {};
        const s = root.__deckContasSoloConfig || {};
        return {
            forceUltraBall: !!b.forceUltraBall,
            shinyBestBall: typeof b.shinyBestBall === "boolean" ? b.shinyBestBall : !!s.shinyBestBall
        };
    };

    const pkAtivo = () => {
        const e = eu();
        return e?.pokemons?.find(p => p.id === e.activeId) ?? null;
    };

    const TIPOS_DO_DIA = ["NORMAL", "FIRE", "WATER", "GRASS", "ELECTRIC", "ICE", "FIGHTING", "POISON", "GROUND",
        "FLYING", "PSYCHIC", "BUG", "ROCK", "GHOST", "DRAGON", "DARK", "STEEL", "FAIRY"];

    const tipoDoDia = () => (TIPOS_DO_DIA.includes(eu()?.diaSazonal?.tipo) ? eu().diaSazonal.tipo : null);

    const assinaturaDe = (pk) => (pk ? `${pk.id}|${pk.level}|${JSON.stringify(pk.stats)}|${tipoDoDia() ?? ""}` : "");

    const REGIAO = {
        kanto: "Kanto", johto: "Johto", outland: "Outland", orre: "Orre",
        hoenn: "Hoenn", sinnoh: "Sinnoh", unova: "Unova", kalos: "Kalos",
        alola: "Alola", galar: "Galar", paldea: "Paldea"
    };

    const regiao = (r) => REGIAO[r] ?? (r ? String(r)[0].toUpperCase() + String(r).slice(1) : "");

    /* -------------------------------------------------
       CONTEXTO DO MOTOR (igual ao da extensao)
    ------------------------------------------------- */

    function contexto(jogo, pk) {
        const w = welcome();
        return {
            mod: jogo.mod,
            especies: jogo.especies,
            hunts: w?.hunts ?? [],
            consts: {
                tabelaTipos: w?.tabelaTipos,
                ampliacaoHunt: w?.ampliacaoHunt,
                multHpSelvagem: w?.multHpSelvagem,
                multDanoSelvagem: w?.multDanoSelvagem,
                tiposBoost: w?.tiposBoost,
                catalogoBolas: w?.catalogoBolas,
                captura: w?.captura,
                chanceShiny: w?.chanceShiny,
                shinyLooks: w?.shinyLooks
            },
            eu: eu(),
            ritmo: PIH.ritmo ?? null,
            mapaVisto: () => null,
            ritmoMedido: () => null
        };
    }

    function comTimeout(promessa, ms) {
        return Promise.race([
            promessa,
            new Promise((_, rejeitar) =>
                setTimeout(() => rejeitar(new Error("Tempo esgotado ao carregar os dados do jogo")), ms)
            )
        ]);
    }

    async function analisar() {
        const w = welcome();
        const e = eu();

        if (!w || !e) throw new Error("Aguardando o jogo conectar");
        if (!Array.isArray(w.hunts) || !w.hunts.length) throw new Error("O jogo ainda nao mandou a lista de hunts");

        const pk = pkAtivo();
        if (!pk) throw new Error("Coloque um pokemon em campo");

        const jogo = await comTimeout(PIH.carregarJogo(), 20000);
        const c = cfg();
        const ordem = Object.prototype.hasOwnProperty.call(FOCOS, c.ordem) ? c.ordem : "xp";

        const r = PIH.engine.analisar(pk, contexto(jogo, pk), {
            ordem,
            soLiberadas: true,
            comPocao: true,
            tipoDoDia: tipoDoDia()
        });

        ultimoResultado = r;
        ultimoJogo = jogo;
        ultimoErro = null;
        return r;
    }

    /* -------------------------------------------------
       VIAGEM
    ------------------------------------------------- */

    function enviar(obj) {
        const socket = root.__deckContasGameSocket;
        if (!socket || socket.readyState !== 1) return false;
        try {
            socket.send(JSON.stringify(obj));
            return true;
        } catch {
            return false;
        }
    }

    function melhorDe(r) {
        if (!r || !Array.isArray(r.linhas)) return null;
        return r.linhas.find(l => !l.inviavel && l.liberada) ?? null;
    }

    /* Relogio do servidor: o cooldown de troca de hunt
       (trocaLivreEm) e uma marca em hora do servidor, entao a
       comparacao precisa ser feita na mesma escala. O relogio vem
       de window.__deckContasClock (servidorAgora dos deltas). */
    function agoraServidor() {
        const c = root.__deckContasClock;
        if (c && c.ts > 0) return c.ts + (Date.now() - (c.em || Date.now()));
        return Date.now();
    }

    /* Texto do bloqueio atual (cooldown do servidor ou recusa
       recente); null quando esta livre para trocar de hunt. */
    function textoPortao() {
        const troca = Number(root.__deckContasTrocaLivreEm || 0);
        const resta = troca - agoraServidor();
        if (resta > 0) {
            return `troca de hunt livre em ${Math.ceil(resta / 1000)}s`;
        }

        const erro = root.__deckContasHuntErro;
        if (erro && Date.now() - erro.em < RECUSA_BACKOFF_MS) {
            const falta = Math.ceil((RECUSA_BACKOFF_MS - (Date.now() - erro.em)) / 1000);
            const motivo = erro.chave || erro.msg || "erro do servidor";
            return `servidor recusou (${motivo}) - nova tentativa em ${falta}s`;
        }

        return null;
    }

    /* Manda o pokemon para a hunt indicada, respeitando o cooldown
       do servidor e as recusas. Retorna true quando ja la estamos
       ou quando o envio foi feito. */
    function irParaSlug(slug) {
        if (!slug) return false;

        const atual = eu()?.huntSlug ?? null;
        if (atual === slug) {
            ultimoAviso = null;
            root.__deckContasHuntErro = null;
            return true;
        }

        const socket = root.__deckContasGameSocket;
        if (!socket || socket.readyState !== 1) {
            ultimoAviso = "Sem conexao com o jogo";
            return false;
        }

        const portao = textoPortao();
        if (portao) {
            ultimoAviso = portao;
            return false;
        }

        if (Date.now() - ultimaTentativa < TENTATIVA_MIN_MS) {
            ultimoAviso = null;
            return false;
        }

        // Limpa a recusa anterior e marca o instante do envio: o init
        // script do Rust usa essa marca para capturar a resposta do
        // servidor (window.__deckContasHuntErro).
        root.__deckContasHuntErro = null;
        root.__deckContasHuntSelectEm = Date.now();

        if (!enviar({ t: "hunt.select", slug })) {
            ultimoAviso = "Sem conexao com o jogo";
            return false;
        }

        ultimaTentativa = Date.now();
        ultimoAviso = null;
        return true;
    }

    function irParaMelhor(r) {
        const melhor = melhorDe(r);
        if (!melhor) {
            ultimoAviso = "Nenhuma hunt utilizavel com este pokemon";
            return null;
        }

        irParaSlug(melhor.slug);
        return melhor;
    }

    /* -------------------------------------------------
       FORMATACAO
    ------------------------------------------------- */

    function curto(n) {
        if (n == null || !isFinite(n)) return "—";
        const a = Math.abs(n);
        if (a >= 1e9) return (n / 1e9).toFixed(1).replace(".", ",") + "B";
        if (a >= 1e6) return (n / 1e6).toFixed(1).replace(".", ",") + "M";
        if (a >= 1e3) return (n / 1e3).toFixed(1).replace(".", ",") + "k";
        if (a >= 100) return String(Math.round(n));
        if (a >= 10) return String(Math.round(n));
        return n.toFixed(1).replace(".", ",");
    }

    function tempoAte(porHora) {
        if (!porHora || porHora <= 0 || !isFinite(porHora)) return "—";
        const s = 3600 / porHora;
        if (s < 60) return `${Math.round(s)}s`;
        if (s < 3600) return `${Math.round(s / 60)}min`;
        if (s < 86400) return `${(s / 3600).toFixed(1).replace(".", ",")}h`;
        if (s < 86400 * 365) return `${(s / 86400).toFixed(1).replace(".", ",")}d`;
        return "—";
    }

    function risco(l) {
        if (l.umHit) return '<span style="color:#ff6b5a" title="Um golpe do selvagem passa do seu HP">1 hit</span>';
        if (l.mortesH >= 0.5) return `<span style="color:#ff6b5a" title="Mortes estimadas por hora">${l.mortesH.toFixed(1).replace(".", ",")}/h</span>`;
        const pct = Math.round(l.hitPct * 100);
        if (pct >= 50) return `<span style="color:#ffc857" title="O pior golpe do selvagem tira ${pct}% do seu HP">${pct}%</span>`;
        return `<span style="color:#68d391" title="O pior golpe do selvagem tira ${pct}% do seu HP">${pct}%</span>`;
    }

    function valorDoModo(l, ordem) {
        if (l.inviavel) return '<span style="color:#ff6b5a">nao mata</span>';
        if (ordem === "ouro") return curto(l.ouroH);
        if (ordem === "shiny") return tempoAte(l.shinyH);
        return curto(l.xpPokemonH);
    }

    function esc(s) {
        return String(s ?? "").replace(/[&<>"']/g, c => (
            { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
        ));
    }

    /* -------------------------------------------------
       PAINEL DENTRO DO JOGO
    ------------------------------------------------- */

    const ESTILO = `
#dc-solo-btn{position:absolute;top:8px;right:8px;z-index:60;display:flex;gap:6px;align-items:center;
  font:600 12px/1 system-ui,sans-serif;color:#e8eef6;background:linear-gradient(180deg,#1b2634,#131b26);
  border:1px solid #2f4056;border-radius:20px;padding:7px 12px;cursor:pointer;box-shadow:0 4px 14px #0008;
  user-select:none;transition:transform .12s ease,background .12s ease}
#dc-solo-btn:hover{transform:translateY(-1px);background:linear-gradient(180deg,#243246,#18212e)}
#dc-solo-btn .dc-ativo{width:7px;height:7px;border-radius:50%;background:#68d391;box-shadow:0 0 6px #68d391}
#dc-solo-btn .dc-parado{width:7px;height:7px;border-radius:50%;background:#667}
#dc-solo-painel{position:absolute;top:8px;right:8px;z-index:61;width:min(560px,calc(100% - 16px));
  max-height:calc(100% - 16px);display:flex;flex-direction:column;overflow:hidden;
  background:rgba(9,13,19,.97);border:1px solid #2f4056;border-radius:10px;
  box-shadow:0 12px 40px #000c;font:12px/1.45 system-ui,sans-serif;color:#e8eef6}
#dc-solo-painel .dc-topo{display:flex;align-items:center;gap:8px;padding:9px 12px;
  background:linear-gradient(180deg,#16202c,#111925);border-bottom:1px solid #253346}
#dc-solo-painel .dc-titulo{font-weight:700;font-size:13px;letter-spacing:.3px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#dc-solo-painel .dc-x{background:none;border:0;color:#8fa3bd;font-size:17px;cursor:pointer;line-height:1;padding:0 4px}
#dc-solo-painel .dc-x:hover{color:#fff}
#dc-solo-painel .dc-info{display:flex;flex-wrap:wrap;gap:6px 14px;padding:8px 12px;border-bottom:1px solid #1d2836;color:#a9bccf}
#dc-solo-painel .dc-info b{color:#e8eef6}
#dc-solo-painel .dc-acoes{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-bottom:1px solid #1d2836}
#dc-solo-painel .dc-acoes button{font:600 11px/1 system-ui,sans-serif;padding:7px 11px;border-radius:6px;cursor:pointer;
  border:1px solid #33465e;background:#1a2534;color:#dbe6f3}
#dc-solo-painel .dc-acoes button:hover{background:#233246}
#dc-solo-painel .dc-acoes .dc-primario{background:#2b6cb0;border-color:#3b82c4;color:#fff}
#dc-solo-painel .dc-acoes .dc-primario:hover{background:#3579c4}
#dc-solo-painel .dc-foco{display:flex;gap:4px;margin-left:auto}
#dc-solo-painel .dc-foco button{padding:6px 9px}
#dc-solo-painel .dc-foco button.on{background:#2b6cb0;border-color:#5b9bd8;color:#fff}
#dc-solo-painel .dc-acoes button.on{background:#2b6cb0;border-color:#5b9bd8;color:#fff}
#dc-solo-painel .dc-secao-titulo{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:6px;
  background:#101825;border-top:1px solid #1d2836;border-bottom:1px solid #253346;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:.5px;text-transform:uppercase;color:#8fa3bd;cursor:pointer}
#dc-solo-painel .dc-secao-titulo:hover{color:#e8eef6;background:#152031}
#dc-solo-painel .dc-secao-titulo.on{color:#7cc0ff;background:rgba(43,108,176,.2)}
#dc-solo-painel .dc-secao-titulo .dc-dica{margin-left:auto;font-weight:400;text-transform:none;
  letter-spacing:0;color:#6b7f95;font-size:10.5px}
#dc-solo-painel tr[data-slug]{cursor:pointer}
#dc-solo-painel tr[data-slug]:hover td{background:rgba(43,108,176,.14)}
#dc-solo-painel .dc-corpo{overflow:auto;padding:4px 0 8px}
#dc-solo-painel table{width:100%;border-collapse:collapse}
#dc-solo-painel th{position:sticky;top:0;background:#0e151f;color:#8fa3bd;font-weight:600;font-size:10.5px;
  text-transform:uppercase;letter-spacing:.4px;text-align:left;padding:7px 10px;border-bottom:1px solid #253346;z-index:1}
#dc-solo-painel td{padding:7px 10px;border-bottom:1px solid #161f2b;vertical-align:middle}
#dc-solo-painel tr.dc-topo-linha{background:rgba(43,108,176,.16)}
#dc-solo-painel tr.dc-bloq{opacity:.5}
#dc-solo-painel .dc-pos{color:#7d92ab;width:26px;text-align:right;font-variant-numeric:tabular-nums}
#dc-solo-painel .dc-hunt{font-weight:600}
#dc-solo-painel .dc-sub{display:block;color:#7d92ab;font-weight:400;font-size:10.5px;margin-top:1px}
#dc-solo-painel .dc-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
#dc-solo-painel .dc-status{padding:7px 12px;color:#8fa3bd;font-size:11px;border-top:1px solid #1d2836;
  display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#dc-solo-painel .dc-erro{color:#ff9d8f}
#dc-solo-painel .dc-aviso{color:#ffc857}
#dc-solo-painel .dc-ok{color:#68d391}
`;

    function host() {
        const palco = document.getElementById("palco");
        return palco || document.body;
    }

    // O botão e o painel precisam ficar dentro do palco do jogo;
    // se o #palco ainda não existia quando foram criados, move
    // assim que ele aparecer.
    function moverParaPalco() {
        const palco = document.getElementById("palco");
        if (!palco) return;

        const b = document.getElementById("dc-solo-btn");
        if (b && b.parentElement !== palco) palco.appendChild(b);

        const p = document.getElementById("dc-solo-painel");
        if (p && p.parentElement !== palco) palco.appendChild(p);
    }

    function garantirEstilo() {
        if (document.getElementById("dc-solo-estilo")) return;
        const s = document.createElement("style");
        s.id = "dc-solo-estilo";
        s.textContent = ESTILO;
        document.head.appendChild(s);
    }

    function botao() {
        let b = document.getElementById("dc-solo-btn");
        if (b) return b;
        garantirEstilo();
        b = document.createElement("div");
        b.id = "dc-solo-btn";
        b.title = "Modo Solo - melhor hunt para o seu pokemon";
        b.addEventListener("click", () => (painelAberto ? fecharPainel() : abrirPainel()));
        host().appendChild(b);
        return b;
    }

    function pintarBotao() {
        const b = document.getElementById("dc-solo-btn");
        if (!b) return;
        b.style.display = "";
        const on = !!cfg().enabled;
        b.innerHTML = `<span class="${on ? "dc-ativo" : "dc-parado"}"></span>Solo`;
        b.title = on
            ? `Modo Solo ligado - foco em ${FOCOS[cfg().ordem] ?? "XP/h"}. Clique para ver o ranking.`
            : "Modo Solo desligado. Clique para abrir o painel.";
    }

    function abrirPainel() {
        painelAberto = true;
        garantirEstilo();

        // O painel precisa do tick vivo para se atualizar mesmo com
        // o Modo Solo desligado (o botao 🎯 do app abre ele assim).
        if (!timer) timer = setInterval(tick, TICK_MS);
        botao();
        desenhar();

        // Primeiro calculo assim que abre (se ainda nao ha resultado).
        if (!ultimoResultado && !analisando) rodar(true);
    }

    function fecharPainel() {
        painelAberto = false;
        document.getElementById("dc-solo-painel")?.remove();

        if (cfg().enabled) {
            pintarBotao();
        } else {
            // Solo desligado e painel fechado: nao precisa mais do tick.
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            document.getElementById("dc-solo-btn")?.remove();
        }
    }

    /* Top 4 de uma categoria: o motor ja calcula todas as metricas
       de cada hunt, entao basta reordenar pela coluna da categoria
       e cortar no topo. */
    function top4Por(r, metrica) {
        if (!r || !Array.isArray(r.linhas)) return [];
        return [...r.linhas]
            .sort((a, b) =>
                ((Number(b[metrica]) || 0) - (Number(a[metrica]) || 0)) ||
                ((Number(b.xpPokemonH) || 0) - (Number(a.xpPokemonH) || 0)) ||
                ((Number(a.nivel) || 0) - (Number(b.nivel) || 0))
            )
            .slice(0, 4);
    }

    function secaoHtml(r, foco, ordem, atualSlug) {
        const linhas = top4Por(r, METRICAS[foco]);

        const corpo = linhas.length
            ? linhas.map((l, i) => {
                const neste = l.slug === atualSlug;
                const cls = [neste ? "dc-topo-linha" : "", l.inviavel ? "dc-bloq" : ""].filter(Boolean).join(" ");
                const travavel = !!l.slug && !l.inviavel && l.liberada !== false;
                return `<tr class="${cls}"${travavel ? ` data-slug="${esc(l.slug)}"` : ""}>
                    <td class="dc-pos">${i + 1}</td>
                    <td class="dc-hunt">${esc(l.nome)}<span class="dc-sub">${esc(regiao(l.regiao))} · Nv ${l.nivel}${neste ? " · você está aqui" : ""}</span></td>
                    <td class="dc-num">${valorDoModo(l, foco)}</td>
                    <td class="dc-num">${l.inviavel ? "—" : curto(l.kph)}</td>
                    <td class="dc-num">${l.inviavel ? "—" : risco(l)}</td>
                </tr>`;
            }).join("")
            : `<tr><td colspan="5" style="color:#7d92ab">Sem hunts nesta categoria</td></tr>`;

        return `
            <div class="dc-secao-titulo ${ordem === foco ? "on" : ""}" data-foco="${foco}"
                 title="Clique para o Modo Solo focar em ${esc(FOCOS[foco])}">
                ${esc(FOCOS[foco])}
                <span class="dc-dica">${ordem === foco ? "foco atual · clique para recalcular" : "clique para focar aqui"}</span>
            </div>
            <table>
                <thead><tr>
                    <th class="dc-pos">#</th>
                    <th>Hunt</th>
                    <th class="dc-num">${esc(FOCOS[foco])}</th>
                    <th class="dc-num">Abates/h</th>
                    <th class="dc-num">Risco</th>
                </tr></thead>
                <tbody>${corpo}</tbody>
            </table>`;
    }

    function desenhar() {
        if (!painelAberto) return;

        garantirEstilo();

        let p = document.getElementById("dc-solo-painel");
        if (!p) {
            p = document.createElement("div");
            p.id = "dc-solo-painel";
            host().appendChild(p);
        }

        moverParaPalco();

        document.getElementById("dc-solo-btn")?.setAttribute("style", "display:none");

        const c = cfg();
        const e = eu();
        const pk = pkAtivo();
        const r = ultimoResultado;
        const ordem = Object.prototype.hasOwnProperty.call(FOCOS, c.ordem) ? c.ordem : "xp";
        const atual = e?.huntSlug ?? "—";
        const bola = bolaCfg();
        const portao = textoPortao();
        const melhor = r ? melhorDe(r) : null;

        // Mantem a posicao de rolagem ao redesenhar a cada tick.
        const rolagem = p.querySelector(".dc-corpo")?.scrollTop ?? 0;

        let corpo = "";
        if (ultimoErro && !r) {
            corpo = `<div class="dc-status"><span class="dc-erro">${esc(ultimoErro)}</span></div>`;
        } else if (!r) {
            corpo = `<div class="dc-status">${analisando ? "Calculando a melhor hunt..." : "Sem resultado ainda - clique em Recalcular."}</div>`;
        } else {
            // Tres categorias, as 4 melhores de cada. O titulo define
            // o foco do Modo Solo; a linha leva o pokemon para la.
            corpo = `<div class="dc-corpo">
                ${secaoHtml(r, "xp", ordem, e?.huntSlug ?? null)}
                ${secaoHtml(r, "ouro", ordem, e?.huntSlug ?? null)}
                ${secaoHtml(r, "shiny", ordem, e?.huntSlug ?? null)}
            </div>`;
        }

        p.innerHTML = `
            <div class="dc-topo">
                <span class="dc-titulo">🎯 Modo Solo</span>
                <button class="dc-x" title="Fechar">×</button>
            </div>
            <div class="dc-info">
                <span>Pokémon: <b>${esc(pk?.nome ?? "—")} Nv ${pk?.level ?? "—"}</b></span>
                <span>Hunt atual: <b>${esc(atual)}</b></span>
                <span>Foco: <b>${esc(FOCOS[ordem] ?? "XP/h")}</b></span>
                <span>Melhor agora: <b>${esc(melhor?.nome ?? "—")}</b></span>
            </div>
            <div class="dc-acoes">
                <button data-dc="recalcular">🔄 Recalcular</button>
                <button data-dc="ir" class="dc-primario">➡ Ir para a melhor</button>
                <button data-bola="forceUltraBall" class="${bola.forceUltraBall ? "on" : ""}"
                        title="Sempre usar Ultra Ball, qualquer que seja o nivel">Ultra fixa${bola.forceUltraBall ? " ✓" : ""}</button>
                <button data-bola="shinyBestBall" class="${bola.shinyBestBall ? "on" : ""}"
                        title="Usar as melhores bolas quando um Shiny morrer">Bolas em Shiny${bola.shinyBestBall ? " ✓" : ""}</button>
                <div class="dc-foco">
                    <button data-foco="xp" class="${ordem === "xp" ? "on" : ""}">XP/h</button>
                    <button data-foco="ouro" class="${ordem === "ouro" ? "on" : ""}">Ouro/h</button>
                    <button data-foco="shiny" class="${ordem === "shiny" ? "on" : ""}">Shiny</button>
                </div>
            </div>
            ${corpo}
            <div class="dc-status">
                ${ultimoErro ? `<span class="dc-erro">${esc(ultimoErro)}</span>` : ""}
                ${!ultimoErro && !c.enabled && !ultimoAviso ? `<span class="dc-aviso">Modo Solo desligado - painel só para consulta.</span>` : ""}
                ${!ultimoErro && portao ? `<span class="dc-aviso">⏳ ${esc(portao)}</span>` : ""}
                ${!ultimoErro && !portao && ultimoAviso ? `<span class="dc-aviso">${esc(ultimoAviso)}</span>` : ""}
                ${!ultimoErro && c.enabled && !portao && !ultimoAviso && melhor ? `<span class="dc-ok">${melhor.slug === (e?.huntSlug ?? null) ? "✓ Na melhor hunt" : "✓ Pronto para viajar"}</span>` : ""}
                <span style="margin-left:auto;color:#6b7f95">${analisando ? "⏳ calculando · " : ""}${r ? `${r.linhas.length} hunts · cálculo em ${r.ms} ms` : ""}</span>
            </div>`;

        p.querySelector(".dc-corpo")?.scrollTo?.({ top: rolagem });

        p.querySelector(".dc-x")?.addEventListener("click", fecharPainel);

        // Foco do Modo Solo: titulos das secoes e botoes do grupo.
        p.querySelectorAll("[data-foco]").forEach(b => {
            b.addEventListener("click", async () => {
                const ordemNovo = b.dataset.foco;
                if (!FOCOS[ordemNovo]) return;

                const mudou = ordemNovo !== ordem;
                if (mudou) {
                    root.__deckContasSoloConfig = { ...cfg(), ordem: ordemNovo };
                    assinaturaAtual = null;
                }
                ultimaAnalise = 0;

                // Persiste a escolha na conta: o Rust encaminha para a
                // janela principal, que salva e reenvia a config.
                if (mudou) {
                    try {
                        const invoke = root.__TAURI_INTERNALS__?.invoke;
                        if (invoke) await invoke("aplicar_opcoes_solo", { ordem: ordemNovo });
                    } catch (err) {
                        ultimoAviso = "Nao foi possivel salvar o foco: " + String(err?.message || err);
                    }
                }

                await rodar(true);
                desenhar();
            });
        });

        // Opcoes de bola do popup: atualiza na hora e persiste no app.
        p.querySelectorAll("[data-bola]").forEach(b => {
            b.addEventListener("click", async () => {
                const chave = b.dataset.bola;
                if (chave !== "forceUltraBall" && chave !== "shinyBestBall") return;

                const opts = bolaCfg();
                opts[chave] = !opts[chave];

                root.__deckContasBallConfig = { ...(root.__deckContasBallConfig || {}), ...opts };
                desenhar();

                try {
                    const invoke = root.__TAURI_INTERNALS__?.invoke;
                    if (!invoke) throw new Error("IPC do Tauri indisponivel");
                    await invoke("aplicar_opcoes_solo", {
                        forceUltraBall: opts.forceUltraBall,
                        shinyBestBall: opts.shinyBestBall
                    });
                } catch (err) {
                    ultimoAviso = "Erro ao salvar opcao de bola: " + String(err?.message || err);
                    desenhar();
                }
            });
        });

        // Clique numa linha: leva o pokemon para aquela hunt.
        p.querySelectorAll("tr[data-slug]").forEach(linha => {
            linha.addEventListener("click", () => {
                irParaSlug(linha.dataset.slug);
                desenhar();
            });
        });

        p.querySelector('[data-dc="recalcular"]')?.addEventListener("click", async () => {
            ultimaAnalise = 0;
            assinaturaAtual = null;
            await rodar(true);
            desenhar();
        });

        p.querySelector('[data-dc="ir"]')?.addEventListener("click", async () => {
            ultimaAnalise = 0;
            assinaturaAtual = null;
            const r2 = await rodar(true);
            // Com o Modo Solo ligado o proprio rodar() ja viaja;
            // desligado, o botao faz a viagem na mao.
            if (r2 && !cfg().enabled) irParaMelhor(r2);
            desenhar();
        });
    }

    /* -------------------------------------------------
       LOOP
    ------------------------------------------------- */

    /* Roda a analise e, com o Modo Solo ligado, ja tenta viajar
       para a melhor hunt. `forcar` ignora os bloqueios de ativacao
       (usado pelos botoes do painel). Retorna o resultado ou null. */
    async function rodar(forcar) {
        if (analisando) return null;
        if (!forcar && !cfg().enabled && !painelAberto) return null;

        analisando = true;
        let r = null;
        try {
            r = await analisar();
            ultimaAnalise = Date.now();
            assinaturaAtual = assinaturaDe(pkAtivo());
            ultimoErro = null;
            if (cfg().enabled) irParaMelhor(r);
        } catch (err) {
            ultimoErro = String(err?.message || err);
        } finally {
            analisando = false;
        }

        if (painelAberto) desenhar();
        return r;
    }

    function precisaRodar() {
        if (analisando) return false;
        // Desligado e painel fechado nao faz nada.
        if (!cfg().enabled && !painelAberto) return false;
        // Erro (jogo ainda conectando, sem pokemon...) tenta de novo.
        if (ultimoErro) return true;
        if (!cfg().enabled) return false;
        // Pokemon novo ou nivel/stats novos recalculam na hora.
        const sig = assinaturaDe(pkAtivo());
        if (sig !== assinaturaAtual) return true;
        // E de 60 em 60 segundos, para ficar sempre verificando.
        if (Date.now() - ultimaAnalise > INTERVALO_MS) return true;
        return false;
    }

    function tick() {
        garantirEstilo();
        if (!document.getElementById("dc-solo-btn") && !painelAberto) botao();
        moverParaPalco();
        pintarBotao();

        if (painelAberto && !analisando) desenhar();

        if (precisaRodar()) {
            rodar();
        } else if (cfg().enabled && ultimoResultado) {
            // Re-tenta a viagem enquanto a melhor hunt nao for a
            // atual (cooldown do servidor, recusa, etc.).
            irParaMelhor(ultimoResultado);
        }
    }

    function iniciar() {
        botao();
        pintarBotao();
        if (!timer) timer = setInterval(tick, TICK_MS);
        tick();
    }

    function parar() {
        // Com o painel aberto o tick continua rodando (para os
        // botoes responderem); ele so para quando o painel fechar.
        if (painelAberto) {
            pintarBotao();
            return;
        }

        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        document.getElementById("dc-solo-btn")?.remove();
    }

    /* -------------------------------------------------
       API CHAMADA PELO RUST
    ------------------------------------------------- */

    root.__deckContasSolo = {
        configurar(config) {
            const anterior = root.__deckContasSoloConfig;
            root.__deckContasSoloConfig = { enabled: false, ordem: "xp", shinyBestBall: false, ...(config || {}) };

            const ligou = !!root.__deckContasSoloConfig.enabled && !anterior?.enabled;
            const mudouFoco = !!anterior && anterior.ordem !== root.__deckContasSoloConfig.ordem;

            // Foco alterado ou Modo Solo recem-ligado: recalcula ja,
            // sem esperar o intervalo, e viaja para a melhor hunt.
            if (mudouFoco || ligou) {
                assinaturaAtual = null;
                ultimaAnalise = 0;
            }

            if (root.__deckContasSoloConfig.enabled) iniciar();
            else parar();
        },
        alternarPainel() {
            if (painelAberto) fecharPainel();
            else abrirPainel();
        },
        analisarAgora: rodar,
        status() {
            return {
                enabled: !!cfg().enabled,
                ordem: cfg().ordem,
                atual: eu()?.huntSlug ?? null,
                melhor: melhorDe(ultimoResultado)?.nome ?? null,
                erro: ultimoErro,
                hunts: ultimoResultado?.linhas?.length ?? 0,
                pronto: root.__deckContasSoloBootOk === true
            };
        }
    };

})(globalThis);
