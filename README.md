# 🎴 Deck Contas

Aplicativo leve para Windows que gerencia **várias contas do PokeIdle ao mesmo tempo**, cada uma em seu próprio navegador isolado, com **automação de Pokébolas**, **compras automáticas na loja** e um **Modo Solo** que calcula a melhor hunt para o seu Pokémon e leva ele até lá sozinho.

Feito em **Tauri 2** (Rust + WebView2) para consumir pouca memória e CPU: as contas ficam dentro da própria janela do app, sem abrir vários navegadores pesados.

---

## ✨ Funcionalidades

### 👥 Múltiplas contas
- Cadastre quantas contas quiser (o limite é configurável nas Configurações).
- Cada conta roda em uma **WebView própria com perfil isolado** (`profiles/account-{id}`), então logins, cache e cookies não se misturam.
- Selecione a conta na barra superior para ver e controlar o jogo dela.
- **Pausar/Retomar** conta: suspende a WebView para liberar CPU e memória quando você não está usando.
- Fechar conta, testar scripts e abrir as configurações individualmente.

### ⚾ Automação de Pokébolas
Escolhe a bola automaticamente no momento da captura, conforme o nível do Pokémon derrotado:

| Situação | Bola usada (em ordem de prioridade) |
|---|---|
| Nível **abaixo de 50** | Great Ball → Poké Ball |
| Nível **50 ou mais** | Ultra Ball → Super Ball |
| **Beast Ball** ativada | Beast → Ultra → Super (conforme o nível) |
| **Forçar Ultra Ball** | Beast (se ativa) → Ultra → Super → Great → Poké |
| **Shiny morreu** + "Bolas em Shiny" | Beast → Ultra → Super → Great → Poké |

- Se a bola ideal não estiver disponível, cai automaticamente para a melhor disponível.
- Desliga a automação de bola do próprio jogo para não haver lançamento duplo.

### 🛒 Compras automáticas
Compra na loja do jogo quando o estoque cai abaixo do mínimo, até o alvo configurado. Produtos suportados:

- **Bolas:** Poké Ball, Great Ball, Super Ball, Ultra Ball
- **Itens:** Small/Great/Ultra/Hyper/Ultimate Potion, Golden Potion, Revive, Max Revive

Cada produto tem seu próprio interruptor, **estoque mínimo** e **estoque alvo**. As compras usam o ouro do jogo (não gastam diamantes).

### 🎯 Modo Solo (melhor hunt automática)
Usa o motor da extensão **/hunt for PokeIdle** para analisar todas as hunts liberadas e escolher a melhor para o Pokémon que está em campo, com três focos:

- **XP/h** — maximizar experiência por hora
- **Ouro/h** — maximizar ouro por hora
- **Shiny** — maximizar chance de Shiny por hora

O que ele faz:

- **Viaja sozinho** para a melhor hunt do foco escolhido.
- **Recalcula a cada 60 segundos** (e na hora se o Pokémon, nível ou stats mudarem), sempre verificando se a hunt atual continua sendo a melhor.
- Respeita o **cooldown de troca de hunt do servidor** e recua quando o servidor recusa a troca, mostrando o motivo no rodapé.
- **Painel dentro do jogo** (botão “Solo” na tela da conta) com as **4 melhores hunts de cada categoria**:
  - Clique no **título da seção** para mudar o foco e recalcular na hora.
  - Clique em uma **linha** para levar o Pokémon para aquela hunt manualmente.
  - Botões **Ultra fixa** e **Bolas em Shiny** direto no painel.
  - **Recalcular** e **Ir para a melhor** funcionam mesmo com o Modo Solo desligado (modo consulta).

### 🪶 Leveza
- Uma única janela com WebViews filhas, em vez de vários navegadores.
- Suspensão real da WebView ao pausar a conta.
- Scripts injetados de forma idempotente e com reenvio periódico apenas do necessário.
- Análise do Modo Solo reaproveita o mesmo cálculo para as três categorias.

---

## 🚀 Como usar

1. Dê dois cliques em **`Iniciar.bat`** na raiz do projeto (abre o executável já compilado em `src-tauri\target\release\deckcontas.exe`).
2. Abra **⚙ Configurações** e clique em **Adicionar conta**.
3. Informe o nome e o endereço do jogo (`https://pokeidle.io/app`).
4. Faça login normalmente dentro da janela da conta.
5. Ligue as automações que quiser:
   - **Automação de Pokébolas**
   - **Usar Beast Ball** / **Forçar Ultra Ball**
   - **Modo Solo** + foco (XP/h, Ouro/h ou Shiny) + **Bolas em Shiny**
   - **Compras automáticas** (⚙ por conta)

> Dica: use **Pausar** nas contas que não estão em uso para economizar recursos.

---

## 🧱 Arquitetura

```
┌──────────────────────────────┐
│ Janela principal (main)      │  Vanilla TS + Vite
│  · lista de contas           │  localStorage: deckcontas_accounts
│  · configurações             │
│  · barra de seleção          │
└──────────────┬───────────────┘
               │ Rust (Tauri 2)
   ┌───────────┴────────────┐
   │ game-view-{id}         │  WebView2 filha, perfil isolado
   │  pokeidle.io/app       │  scripts injetados via eval:
   │  + automação de bolas  │   · observador de WebSocket
   │  + loja automática     │   · automação de bolas
   │  + Modo Solo (painel)  │   · motor da extensão hunt
   └────────────────────────┘
```

- **`src/main.ts`** — interface, cadastro de contas, sincronização das automações e persistência.
- **`src-tauri/src/lib.rs`** — criação/posicionamento das WebViews, comandos Rust, injeção dos scripts, observador de WebSocket, automação de bolas e de loja.
- **`src-tauri/src/solo/`** — motor da extensão (`boot.js`, `jogo-bundle.js`, `game.js`, `engine.js`, `ritmo.js`) + `solo.js` (painel, ranking, viagem e persistência).
- **`src-tauri/build.rs`** — declara os comandos do app para a ACL do Tauri.
- **`src-tauri/capabilities/`** — permissões: `default.json` (janela principal) e `game-view.json` (janela do jogo, origem remota `pokeidle.io`, libera apenas o comando do painel Solo).

### Segurança do IPC
O painel do Modo Solo vive dentro da página do jogo (origem remota), então o Tauri só aceita o comando `aplicar_opcoes_solo` porque a capability `game-view.json` libera exatamente esse comando para `https://pokeidle.io/*`. O Rust valida o **label da WebView** (`game-view-{id}`), então uma conta só consegue alterar as próprias opções.

---

## 🛠️ Desenvolvimento

Requisitos: **Node.js**, **Rust** (toolchain MSVC) e **WebView2** (já vem no Windows 10/11).

```powershell
npm install          # dependências do frontend
npm run tauri dev    # modo desenvolvimento
npm run tauri build  # gera o executável e os instaladores
```

Saídas do build:

- `src-tauri/target/release/deckcontas.exe`
- `src-tauri/target/release/bundle/msi/deckcontas_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/deckcontas_0.1.0_x64-setup.exe`

> ⚠️ Feche o `deckcontas.exe` antes de compilar (o Windows bloqueia o arquivo em uso).

### Comandos Rust (ACL)
Todo comando registrado em `generate_handler!` precisa estar em **dois lugares**:

1. `src-tauri/build.rs` (gera as permissões `allow-<comando>`)
2. `src-tauri/capabilities/default.json` (janela principal)

Se esquecer, o app compila mas a janela principal recebe “Command not allowed by ACL”.

---

## 📦 Versões e backup

- O histórico completo fica na branch **`main`**.
- Versões anteriores ficam marcadas com **tags** (ex.: `backup-1a59ad3-20261116`) para voltar quando precisar:

```powershell
git tag                                   # lista os backups
git checkout backup-1a59ad3-20261116      # volta para a versão antiga
git checkout main                         # volta para a atual
```

---

## ⚠️ Aviso

Projeto pessoal, sem vínculo com o PokeIdle. Automação de contas pode violar os termos do jogo — use por sua conta e risco, preferencialmente em contas próprias e com moderação.
