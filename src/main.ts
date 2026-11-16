import { invoke } from "@tauri-apps/api/core";

interface Account {
  id: number;
  name: string;
  game: string;
  url: string;
  useBeastBall: boolean;
  autoBall: boolean;
  forceUltraBall: boolean;
  shopAutomationEnabled: boolean;
  shopRules: Record<string, ShopRule>;
}

interface ShopRule {
  enabled: boolean;
  minStock: number;
  targetStock: number;
}

interface WebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MultiGridLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
}

const STORAGE_KEY = "deckcontas_accounts";
const MAX_KEY = "deckcontas_max";

const MULTI_GAP = 12;
const MULTI_PADDING = 12;
const MULTI_ASPECT_RATIO = 16 / 9;

/* =====================================================
   PRODUTOS DISPONÍVEIS PARA COMPRA AUTOMÁTICA
   Beast Ball não entra na lista. Compras usam somente moedas.
===================================================== */

const SHOP_PRODUCTS = [
  { key: "ball_4", kind: "ball", id: 4, name: "Ultra Ball", price: 130, defaultMin: 20, defaultTarget: 100 },
  { key: "ball_3", kind: "ball", id: 3, name: "Super Ball", price: 50, defaultMin: 20, defaultTarget: 100 },
  { key: "ball_2", kind: "ball", id: 2, name: "Great Ball", price: 20, defaultMin: 20, defaultTarget: 100 },
  { key: "ball_1", kind: "ball", id: 1, name: "Poke Ball", price: 5, defaultMin: 20, defaultTarget: 100 },
  { key: "item_206", kind: "item", id: 206, name: "Max Revive", price: 5000, defaultMin: 2, defaultTarget: 10 },
  { key: "item_205", kind: "item", id: 205, name: "Revive", price: 600, defaultMin: 5, defaultTarget: 20 },
  { key: "item_70070", kind: "item", id: 70070, name: "Golden Potion", price: 2500, defaultMin: 5, defaultTarget: 20 },
  { key: "item_204", kind: "item", id: 204, name: "Ultimate Potion", price: 1500, defaultMin: 5, defaultTarget: 20 },
  { key: "item_203", kind: "item", id: 203, name: "Hyper Potion", price: 800, defaultMin: 5, defaultTarget: 20 },
  { key: "item_202", kind: "item", id: 202, name: "Ultra Potion", price: 400, defaultMin: 5, defaultTarget: 20 },
  { key: "item_201", kind: "item", id: 201, name: "Great Potion", price: 150, defaultMin: 10, defaultTarget: 50 },
  { key: "item_200", kind: "item", id: 200, name: "Small Potion", price: 50, defaultMin: 10, defaultTarget: 50 }
] as const;

// Ícones dos itens (sprites públicos do PokéAPI).
const SHOP_ITEM_ICON_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";
const SHOP_ITEM_ICONS: Record<string, string> = {
  ball_4: "ultra-ball.png",
  ball_3: "quick-ball.png",
  ball_2: "great-ball.png",
  ball_1: "poke-ball.png",
  item_206: "max-revive.png",
  item_205: "revive.png",
  item_70070: "full-restore.png",
  item_204: "full-restore.png",
  item_203: "max-potion.png",
  item_202: "hyper-potion.png",
  item_201: "super-potion.png",
  item_200: "potion.png"
};

function createDefaultShopRules(): Record<string, ShopRule> {
  const rules: Record<string, ShopRule> = {};

  for (const product of SHOP_PRODUCTS) {
    rules[product.key] = {
      enabled: false,
      minStock: product.defaultMin,
      targetStock: product.defaultTarget
    };
  }

  return rules;
}

function normalizeShopRules(value: any): Record<string, ShopRule> {
  const defaults = createDefaultShopRules();

  for (const product of SHOP_PRODUCTS) {
    const saved = value?.[product.key];

    if (!saved || typeof saved !== "object") continue;

    const minStock = Number(saved.minStock);
    const targetStock = Number(saved.targetStock);

    defaults[product.key] = {
      enabled: saved.enabled === true,
      minStock: Number.isFinite(minStock) && minStock >= 0
        ? Math.floor(minStock)
        : defaults[product.key].minStock,
      targetStock: Number.isFinite(targetStock) && targetStock >= 0
        ? Math.floor(targetStock)
        : defaults[product.key].targetStock
    };
  }

  return defaults;
}

let accounts: Account[] = JSON.parse(
  localStorage.getItem(STORAGE_KEY) || "[]"
).map((account: any) => ({
  ...account,
  game: account.game ?? "PokeIdle",
  url: account.url ?? "",
  useBeastBall: account.useBeastBall ?? false,
  autoBall: account.autoBall ?? false,
  forceUltraBall: account.forceUltraBall ?? false,
  shopAutomationEnabled: account.shopAutomationEnabled ?? false,
  shopRules: normalizeShopRules(account.shopRules)
}));

let maxAccounts = Number(localStorage.getItem(MAX_KEY) || 4);

let nextId = accounts.length > 0
  ? Math.max(...accounts.map(account => account.id)) + 1
  : 1;

let selectedAccount = accounts.length > 0
  ? accounts[0].id
  : null;

let currentMode: "focus" | "multi" = "focus";

/* =====================================================
   CONTROLE DAS WEBVIEWS
===================================================== */

const createdWebviews = new Set<number>();
const visibleWebviews = new Set<number>();
const lastWebviewBounds = new Map<number, WebviewBounds>();
const pausedAccounts = new Set<number>();

/* =====================================================
   CONTROLE DE SINCRONIZAÇÃO
===================================================== */

let layoutVersion = 0;
let layoutTimer: number | undefined;
let layoutSyncRunning = false;
let layoutSyncRequested = false;

let layoutSyncPromise: Promise<void> = Promise.resolve();

const LAYOUT_DEBOUNCE_MS = 180;

/* =====================================================
   ARMAZENAMENTO
===================================================== */

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
  localStorage.setItem(MAX_KEY, String(maxAccounts));
}

/* =====================================================
   SEGURANÇA
===================================================== */

function escapeHTML(text: string): string {
  return text.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entities[character];
  });
}

function validateUrl(value: string): string | null {
  let url = value.trim();

  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  try {
    const address = new URL(url);

    if (
      address.protocol !== "https:" &&
      address.protocol !== "http:"
    ) {
      return null;
    }

    return address.href;
  } catch {
    return null;
  }
}

/* =====================================================
   SINCRONIZAR AUTOMAÇÃO DE POKÉBOLAS
===================================================== */

async function syncBallAutomation(account: Account) {
  if (pausedAccounts.has(account.id)) {
    return;
  }

  try {
    await invoke("set_ball_automation", {
      accountId: account.id,
      enabled: account.autoBall,
      useBeastBall: account.useBeastBall,
      forceUltraBall: account.forceUltraBall ?? false
    });

    console.log(
      `[Deck Contas] Configuração enviada para ${account.name}:`,
      {
        enabled: account.autoBall,
        useBeastBall: account.useBeastBall,
        forceUltraBall: account.forceUltraBall ?? false
      }
    );
  } catch (error) {
    console.error(
      `[Deck Contas] Erro ao sincronizar automação da conta ${account.name}:`,
      error
    );
  }
}

/* =====================================================
   SINCRONIZAR AUTOMAÇÃO DE COMPRAS
===================================================== */

async function syncShopAutomation(account: Account) {
  if (pausedAccounts.has(account.id)) {
    return;
  }

  try {
    await invoke("set_shop_automation", {
      accountId: account.id,
      enabled: account.shopAutomationEnabled,
      rules: account.shopRules
    });

    console.log(
      `[Deck Contas] Compras automáticas sincronizadas para ${account.name}.`,
      {
        enabled: account.shopAutomationEnabled,
        rules: account.shopRules
      }
    );
  } catch (error) {
    console.error(
      `[Deck Contas] Erro ao sincronizar compras automáticas da conta ${account.name}:`,
      error
    );
  }
}

/* =====================================================
   CONTROLE DOS NAVEGADORES INTERNOS
===================================================== */

async function hideAccountWebview(id: number) {
  if (!visibleWebviews.has(id)) {
    return;
  }

  try {
    await invoke("hide_game_webview", {
      accountId: id
    });

    visibleWebviews.delete(id);
  } catch (error) {
    console.error(
      `Erro ao esconder navegador da conta ${id}:`,
      error
    );
  }
}

async function closeAccountWebview(id: number) {
  try {
    await invoke("close_game_webview", {
      accountId: id
    });

    createdWebviews.delete(id);
    visibleWebviews.delete(id);
    lastWebviewBounds.delete(id);
  } catch (error) {
    console.error(
      `Erro ao fechar navegador da conta ${id}:`,
      error
    );
  }
}

/* =====================================================
   ESCONDER TODAS AS WEBVIEWS
===================================================== */

async function hideAllWebviews() {
  layoutVersion++;

  if (layoutTimer !== undefined) {
    window.clearTimeout(layoutTimer);
    layoutTimer = undefined;
  }

  layoutSyncRequested = false;

  await layoutSyncPromise;

  for (const account of accounts) {
    await hideAccountWebview(account.id);
  }
}

/* =====================================================
   COMPARAR DIMENSÕES
===================================================== */

function boundsChanged(
  previous: WebviewBounds | undefined,
  current: WebviewBounds
): boolean {
  if (!previous) {
    return true;
  }

  return (
    previous.x !== current.x ||
    previous.y !== current.y ||
    previous.width !== current.width ||
    previous.height !== current.height
  );
}

/* =====================================================
   EXIBIR WEBVIEW
===================================================== */

async function showAccountWebview(
  account: Account,
  element: HTMLElement
) {
  if (pausedAccounts.has(account.id)) {
    return;
  }

  const rect = element.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }

  const bounds: WebviewBounds = {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };

  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  const jaCriada = createdWebviews.has(account.id);
  const estaVisivel = visibleWebviews.has(account.id);

  const dimensoesMudaram = boundsChanged(
    lastWebviewBounds.get(account.id),
    bounds
  );

  if (!jaCriada) {
    await invoke("create_game_webview", {
      accountId: account.id,
      url: account.url,
      ...bounds
    });

    createdWebviews.add(account.id);
    visibleWebviews.add(account.id);
    lastWebviewBounds.set(account.id, bounds);

    await syncBallAutomation(account);
    await syncShopAutomation(account);

    return;
  }

  if (!estaVisivel) {
    await invoke("create_game_webview", {
      accountId: account.id,
      url: account.url,
      ...bounds
    });

    visibleWebviews.add(account.id);
    lastWebviewBounds.set(account.id, bounds);

    return;
  }

  if (!dimensoesMudaram) {
    return;
  }

  await invoke("update_game_webview_bounds", {
    accountId: account.id,
    ...bounds
  });

  lastWebviewBounds.set(account.id, bounds);
}

/* =====================================================
   PAUSAR CONTA
===================================================== */

async function pauseAccount(id: number) {
  if (pausedAccounts.has(id)) {
    return;
  }

  try {
    await invoke("pause_game_webview", {
      accountId: id
    });

    pausedAccounts.add(id);
    visibleWebviews.delete(id);
  } catch (error) {
    console.error("Erro ao pausar conta:", error);

    alert(
      "Não foi possível pausar esta conta.\n\n" +
      "Verifique o console para mais informações."
    );

    throw error;
  }
}

/* =====================================================
   RETOMAR CONTA
===================================================== */

async function resumeAccount(id: number) {
  if (!pausedAccounts.has(id)) {
    return;
  }

  try {
    await invoke("resume_game_webview", {
      accountId: id
    });

    pausedAccounts.delete(id);

    createdWebviews.add(id);
    visibleWebviews.add(id);

    const account = accounts.find(
      item => item.id === id
    );

    if (account) {
      await syncBallAutomation(account);
      await syncShopAutomation(account);
    }
  } catch (error) {
    console.error("Erro ao retomar conta:", error);

    alert(
      "Não foi possível retomar esta conta.\n\n" +
      "Verifique o console para mais informações."
    );

    throw error;
  }
}

/* =====================================================
   CALCULAR MELHOR DISTRIBUIÇÃO MULTITELAS
===================================================== */

function getMultiGridLayout(
  count: number,
  availableWidth: number,
  availableHeight: number
): MultiGridLayout {
  if (count <= 0) {
    return {
      columns: 1,
      rows: 1,
      width: 1,
      height: 1
    };
  }

  let bestLayout: MultiGridLayout | null = null;
  let bestWidth = 0;

  /*
   * Testa diferentes quantidades de colunas.
   *
   * Escolhe a distribuição que permite a maior tela
   * possível mantendo a proporção 16:9.
   *
   * Todas as telas ficam com dimensões iguais.
   */

  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);

    const widthPerColumn =
      (availableWidth - MULTI_GAP * (columns - 1)) / columns;

    const heightPerRow =
      (availableHeight - MULTI_GAP * (rows - 1)) / rows;

    const widthAllowedByHeight =
      heightPerRow * MULTI_ASPECT_RATIO;

    const possibleWidth = Math.min(
      widthPerColumn,
      widthAllowedByHeight
    );

    if (
      possibleWidth > bestWidth &&
      Number.isFinite(possibleWidth)
    ) {
      bestWidth = possibleWidth;

      bestLayout = {
        columns,
        rows,
        width: Math.floor(possibleWidth),
        height: Math.floor(
          Math.floor(possibleWidth) / MULTI_ASPECT_RATIO
        )
      };
    }
  }

  if (!bestLayout) {
    return {
      columns: 1,
      rows: count,
      width: 1,
      height: 1
    };
  }

  return bestLayout;
}

/* =====================================================
   APLICAR TAMANHO AUTOMÁTICO À GRADE
===================================================== */

function applyMultiGridLayout() {
  if (currentMode !== "multi") {
    return;
  }

  const container = document.querySelector<HTMLElement>(
    ".multi-container"
  );

  const grid = document.querySelector<HTMLElement>(
    ".multi-grid"
  );

  if (!container || !grid) {
    return;
  }

  const availableWidth = Math.max(
    1,
    container.clientWidth - MULTI_PADDING * 2
  );

  const availableHeight = Math.max(
    1,
    container.clientHeight - MULTI_PADDING * 2
  );

  const layout = getMultiGridLayout(
    accounts.length,
    availableWidth,
    availableHeight
  );

  const columnsStyle =
    `repeat(${layout.columns}, ${layout.width}px)`;

  const rowsStyle = `${layout.height}px`;

  /*
   * Só altera o CSS quando o resultado realmente mudou.
   */

  if (grid.style.gridTemplateColumns !== columnsStyle) {
    grid.style.gridTemplateColumns = columnsStyle;
  }

  if (grid.style.gridAutoRows !== rowsStyle) {
    grid.style.gridAutoRows = rowsStyle;
  }
}

/* =====================================================
   AGENDAR SINCRONIZAÇÃO
===================================================== */

function scheduleWebviewLayout() {
  layoutVersion++;

  if (layoutTimer !== undefined) {
    window.clearTimeout(layoutTimer);
  }

  layoutTimer = window.setTimeout(() => {
    layoutTimer = undefined;
    layoutSyncRequested = true;

    void runLayoutSync();
  }, LAYOUT_DEBOUNCE_MS);
}

/* =====================================================
   EXECUTAR SINCRONIZAÇÃO SERIALIZADA
===================================================== */

function runLayoutSync(): Promise<void> {
  if (layoutSyncRunning) {
    return layoutSyncPromise;
  }

  layoutSyncRunning = true;

  layoutSyncPromise = (async () => {
    try {
      while (layoutSyncRequested) {
        layoutSyncRequested = false;

        const version = layoutVersion;

        await synchronizeWebviews(version);
      }
    } finally {
      layoutSyncRunning = false;

      if (layoutSyncRequested) {
        void runLayoutSync();
      }
    }
  })();

  return layoutSyncPromise;
}

/* =====================================================
   SINCRONIZAR JOGOS COM A INTERFACE
===================================================== */

async function synchronizeWebviews(version: number) {
  if (version !== layoutVersion) {
    return;
  }

  try {
    if (currentMode === "focus") {
      const selected = accounts.find(
        account => account.id === selectedAccount
      );

      for (const account of accounts) {
        if (version !== layoutVersion) {
          return;
        }

        if (
          !selected ||
          account.id !== selected.id ||
          pausedAccounts.has(account.id)
        ) {
          await hideAccountWebview(account.id);
        }
      }

      if (!selected || version !== layoutVersion) {
        return;
      }

      if (pausedAccounts.has(selected.id)) {
        return;
      }

      if (!selected.url) {
        console.warn("A conta não possui endereço configurado.");
        return;
      }

      const screen = document.querySelector<HTMLElement>(
        ".game-screen"
      );

      if (!screen || version !== layoutVersion) {
        return;
      }

      await showAccountWebview(selected, screen);

      return;
    }

    if (currentMode === "multi") {
      /*
       * Calcula a grade antes de medir as WebViews.
       * Assim, o Rust recebe diretamente as dimensões finais.
       */

      applyMultiGridLayout();

      for (const account of accounts) {
        if (version !== layoutVersion) {
          return;
        }

        if (pausedAccounts.has(account.id)) {
          await hideAccountWebview(account.id);
          continue;
        }

        if (!account.url) {
          await hideAccountWebview(account.id);
          continue;
        }

        const screen = document.querySelector<HTMLElement>(
          `[data-monitor-screen="${account.id}"]`
        );

        if (!screen) {
          continue;
        }

        await showAccountWebview(account, screen);
      }
    }
  } catch (error) {
    console.error("Erro ao sincronizar os jogos:", error);

    alert(
      "Não foi possível atualizar uma das contas.\n\n" +
      "Verifique o console para mais informações."
    );
  }
}

/* =====================================================
   TELA PRINCIPAL
===================================================== */

function render() {
  const app = document.querySelector<HTMLDivElement>("#app");

  if (!app) {
    return;
  }

  const selected = accounts.find(
    account => account.id === selectedAccount
  );

  app.innerHTML = `
    <div class="dashboard">

      <header class="topbar">

        <div class="logo">
          <div class="logo-icon">D</div>
          <span>Deck Contas</span>
        </div>

        <div class="header-actions">

          <button
            class="mode-button ${currentMode === "focus" ? "active" : ""}"
            id="focus-mode"
          >
            Destaque
          </button>

          <button
            class="mode-button ${currentMode === "multi" ? "active" : ""}"
            id="multi-mode"
          >
            Multitelas
          </button>

          <button
            class="settings-gear"
            id="settings"
            title="Configurações"
          >
            ⚙
          </button>

        </div>

      </header>

      <div class="workspace sidebar-collapsed">

        <aside class="sidebar">

          <div class="sidebar-title">

            <div class="sidebar-account-count">
              ${accounts.length}
            </div>

          </div>

          <div class="account-list">

            ${
              accounts.length === 0
                ? `
                  <div class="sidebar-empty">
                    Nenhuma conta.
                  </div>
                `
                : accounts.map(account => `
                  <button
                    class="sidebar-account ${
                      selectedAccount === account.id ? "selected" : ""
                    }"
                    data-select="${account.id}"
                    title="${escapeHTML(account.name)}"
                  >

                    <div class="sidebar-icon">🎮</div>

                    <div class="sidebar-account-info">

                      <strong>${escapeHTML(account.name)}</strong>

                      <span>
                        ${escapeHTML(account.game)}
                        ${pausedAccounts.has(account.id) ? " · Pausada" : ""}
                      </span>

                    </div>

                  </button>
                `).join("")
            }

          </div>

        </aside>

        <main class="main-view">

          ${
            currentMode === "focus"
              ? renderFocus(selected)
              : renderMulti()
          }

        </main>

      </div>

    </div>
  `;

  scheduleWebviewLayout();

  document.getElementById("focus-mode")?.addEventListener(
    "click",
    () => {
      if (currentMode === "focus") {
        return;
      }

      currentMode = "focus";
      render();
    }
  );

  document.getElementById("multi-mode")?.addEventListener(
    "click",
    () => {
      if (currentMode === "multi") {
        return;
      }

      currentMode = "multi";
      render();
    }
  );

  document.getElementById("settings")?.addEventListener(
    "click",
    openSettings
  );

  document.querySelectorAll<HTMLButtonElement>(
    "[data-select]"
  ).forEach(button => {
    button.addEventListener("click", () => {
      selectedAccount = Number(button.dataset.select);

      if (currentMode !== "focus") {
        currentMode = "focus";
      }

      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(
    "[data-multi-select]"
  ).forEach(button => {
    button.addEventListener("click", () => {
      selectedAccount = Number(button.dataset.multiSelect);
      currentMode = "focus";
      render();
    });
  });
}

/* =====================================================
   MODO DESTAQUE
===================================================== */

function renderFocus(account: Account | undefined): string {
  if (!account) {
    return `
      <div class="no-account">

        <div class="no-account-icon">🎮</div>

        <h2>Nenhuma conta selecionada</h2>

        <p>
          Abra as configurações para adicionar sua primeira conta.
        </p>

      </div>
    `;
  }

  const isPaused = pausedAccounts.has(account.id);

  return `
    <div class="focus-container">

      <div class="game-screen" id="focus-game-screen">

        ${
          isPaused
            ? `
              <div style="
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 12px;
                color: #ffffff;
                background: #15111f;
              ">

                <div style="font-size: 42px;">⏸</div>

                <h2>Conta pausada</h2>

                <p>O jogo está suspenso.</p>

              </div>
            `
            : ""
        }

      </div>

    </div>
  `;
}

/* =====================================================
   MODO MULTITELAS
===================================================== */

function renderMulti(): string {
  if (accounts.length === 0) {
    return `
      <div class="no-account">
        <h2>Nenhuma conta cadastrada</h2>
        <p>Adicione contas nas configurações.</p>
      </div>
    `;
  }

  return `
    <div class="multi-container">

      <div class="multi-grid">

        ${accounts.map(account => {
          const isPaused = pausedAccounts.has(account.id);

          return `
            <div class="monitor-card">

              <div
                class="monitor-screen"
                data-monitor-screen="${account.id}"
              >

                ${
                  isPaused
                    ? `
                      <div style="
                        width: 100%;
                        height: 100%;
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        gap: 8px;
                        color: #ffffff;
                        background: #15111f;
                      ">

                        <div style="font-size: 30px;">⏸</div>

                        <strong>Conta pausada</strong>

                      </div>
                    `
                    : ""
                }

              </div>

            </div>
          `;
        }).join("")}

      </div>

    </div>
  `;
}

/* =====================================================
   CONFIGURAÇÕES
===================================================== */

async function openSettings() {
  await hideAllWebviews();

  const modal = document.createElement("div");

  modal.className = "modal-overlay";

  modal.innerHTML = `
    <style>
      /* Layout da janela de configurações e gerenciamento de contas */
      .modal-overlay:has(.account-management-style) {
        padding: 18px;
        overflow-y: auto;
        align-items: center;
      }
      .account-management-style {
        width: min(1040px, 96vw);
        max-height: 92vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(190,160,255,.22);
        box-shadow: 0 24px 80px rgba(0,0,0,.55);
      }
      .account-management-style .modal-header {
        flex: 0 0 auto;
        padding: 20px 24px;
        border-bottom: 1px solid rgba(255,255,255,.09);
      }
      .account-management-style .settings-content {
        min-height: 0;
        overflow-y: auto;
        padding: 22px 24px 26px;
      }
      .account-management-style .settings-section h3 {
        margin: 0 0 16px;
        color: #f4efff;
        font-size: 17px;
      }
      .account-management-style .settings-option {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        min-height: 44px;
        margin: 0 0 16px;
        border: 1px solid rgba(155,115,245,.42);
        border-radius: 10px;
        background: rgba(125,80,220,.16);
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      .account-management-style .manage-account {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
        margin: 0 0 13px;
        padding: 17px;
        border: 1px solid rgba(255,255,255,.11);
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(255,255,255,.055), rgba(255,255,255,.018));
        box-shadow: 0 8px 22px rgba(0,0,0,.14);
      }
      .account-management-style .manage-account > div:first-child {
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      .account-management-style .manage-account > div:first-child strong {
        color: #fff;
        font-size: 15px;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .account-management-style .manage-account > div:first-child span {
        color: #aaa1ba;
        font-size: 12px;
      }
      .account-management-style .manage-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 9px;
        min-width: 0;
        width: 100%;
      }
      .account-management-style .manage-actions label {
        box-sizing: border-box;
        display: inline-flex !important;
        align-items: center;
        justify-content: flex-start;
        gap: 9px !important;
        flex: 1 1 210px;
        min-width: 0;
        min-height: 42px;
        margin: 0 !important;
        padding: 9px 12px;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 9px;
        background: rgba(0,0,0,.16);
        color: #e9e3f4 !important;
        font-size: 12px !important;
        line-height: 1.25;
      }
      .account-management-style .manage-actions label input {
        flex: 0 0 17px;
        width: 17px !important;
        height: 17px !important;
        margin: 0;
        accent-color: #9b70f5;
      }
      .account-management-style .manage-actions button {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 1 1 125px;
        min-width: 0;
        min-height: 42px;
        padding: 9px 12px;
        border: 1px solid rgba(255,255,255,.13);
        border-radius: 9px;
        background: rgba(255,255,255,.075);
        color: #f7f3ff;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.2;
        white-space: normal;
        overflow-wrap: anywhere;
        cursor: pointer;
        transition: transform .15s ease, background .15s ease, border-color .15s ease;
      }
      .account-management-style .manage-actions button:hover,
      .account-management-style .settings-option:hover {
        transform: translateY(-1px);
        border-color: rgba(180,145,255,.55);
        background-color: rgba(140,100,230,.22);
      }
      .account-management-style .manage-actions button[data-shop-settings] {
        background: rgba(115,80,205,.25);
        border-color: rgba(155,115,245,.4);
      }
      .account-management-style .manage-actions button[data-test-js] {
        background: rgba(55,130,170,.18);
        border-color: rgba(80,170,210,.3);
      }
      .account-management-style .manage-actions button[data-edit] {
        background: rgba(255,255,255,.08);
      }
      .account-management-style .manage-actions button.delete-option {
        background: rgba(180,55,70,.15);
        border-color: rgba(220,85,100,.3);
        color: #ffb9c0;
      }
      .account-management-style .limit-control {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .account-management-style .limit-control input {
        flex: 1 1 150px;
        min-width: 0;
      }
      @media (max-width: 650px) {
        .modal-overlay:has(.account-management-style) { padding: 8px; }
        .account-management-style { width: 100%; max-height: 96vh; }
        .account-management-style .modal-header,
        .account-management-style .settings-content { padding: 15px; }
        .account-management-style .manage-actions label { flex-basis: 100%; }
        .account-management-style .manage-actions button { flex-basis: calc(50% - 5px); }
      }
    </style>
    <div class="settings-modal account-management-style">

      <div class="modal-header">

        <h2>⚙ Configurações</h2>

        <button class="modal-close" id="close-settings">
          ×
        </button>

      </div>

      <div class="settings-content">

        <div class="settings-section">

          <h3>Gerenciar contas</h3>

          <button class="settings-option" id="add-account">
            <span>＋</span>
            Adicionar conta
          </button>

          ${
            accounts.map(account => {
              const isPaused = pausedAccounts.has(account.id);

              return `
                <div class="manage-account">

                  <div>

                    <strong>${escapeHTML(account.name)}</strong>

                    <span>
                      ${escapeHTML(account.game)}
                      ${isPaused ? " · Pausada" : " · Em execução"}
                    </span>

                  </div>

                  <div class="manage-actions">

                    <label style="
                      display: inline-flex;
                      align-items: center;
                      gap: 6px;
                      color: #ffffff;
                      font-size: 13px;
                      cursor: pointer;
                      margin-right: 8px;
                    ">

                      <input
                        type="checkbox"
                        data-auto-ball="${account.id}"
                        ${account.autoBall ? "checked" : ""}
                        style="
                          width: 16px;
                          height: 16px;
                          cursor: pointer;
                          accent-color: #8b5cf6;
                        "
                      />

                      Automatizar Pokébolas

                    </label>

                    <label style="
                      display: inline-flex;
                      align-items: center;
                      gap: 6px;
                      color: #ffffff;
                      font-size: 13px;
                      cursor: pointer;
                      margin-right: 8px;
                    ">

                      <input
                        type="checkbox"
                        data-use-beast="${account.id}"
                        ${account.useBeastBall ? "checked" : ""}
                        style="
                          width: 16px;
                          height: 16px;
                          cursor: pointer;
                          accent-color: #8b5cf6;
                        "
                      />

                      Usar Beast Ball

                    </label>

                    <label style="
                      display: inline-flex;
                      align-items: center;
                      gap: 6px;
                      color: #ffffff;
                      font-size: 13px;
                      cursor: pointer;
                      margin-right: 8px;
                    ">

                      <input
                        type="checkbox"
                        data-force-ultra-ball="${account.id}"
                        ${account.forceUltraBall ? "checked" : ""}
                        style="
                          width: 16px;
                          height: 16px;
                          cursor: pointer;
                          accent-color: #8b5cf6;
                        "
                      />

                      Forçar Ultra Ball

                    </label>

                    <button
                      data-shop-settings="${account.id}"
                      title="Configurar compras automáticas"
                    >
                      🛒 Compras
                    </button>

                    <button
                      data-toggle-pause="${account.id}"
                      title="${isPaused ? "Retomar conta" : "Pausar conta"}"
                      style="
                        background: ${isPaused ? "#27864a" : "#a66a28"};
                        color: white;
                      "
                    >
                      ${isPaused ? "▶ Retomar" : "Ⅱ Pausar"}
                    </button>

                    <button data-test-js="${account.id}">
                      Testar JS
                    </button>

                    <button data-edit="${account.id}">
                      Editar
                    </button>

                    <button
                      class="delete-option"
                      data-remove="${account.id}"
                    >
                      Remover
                    </button>

                  </div>

                </div>
              `;
            }).join("")
          }

        </div>

        <div class="settings-section">

          <h3>Limite de contas</h3>

          <div class="limit-control">

            <input
              type="number"
              id="account-limit"
              min="1"
              value="${maxAccounts}"
            />

            <button id="save-limit">
              Salvar
            </button>

          </div>

        </div>

      </div>

    </div>
  `;

  document.body.appendChild(modal);

  function closeSettings() {
    modal.remove();
    scheduleWebviewLayout();
  }

  document.getElementById("close-settings")?.addEventListener(
    "click",
    closeSettings
  );

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeSettings();
    }
  });

  document.getElementById("add-account")?.addEventListener(
    "click",
    () => {
      modal.remove();
      addAccount();
      scheduleWebviewLayout();
    }
  );

  modal.querySelectorAll<HTMLInputElement>(
    "[data-auto-ball]"
  ).forEach(checkbox => {
    checkbox.addEventListener("change", async () => {
      const id = Number(checkbox.dataset.autoBall);

      const account = accounts.find(item => item.id === id);

      if (!account) return;

      account.autoBall = checkbox.checked;

      save();

      console.log(
        `Conta ${account.name}: automação de Pokébolas ${
          checkbox.checked ? "ativada" : "desativada"
        }.`
      );

      await syncBallAutomation(account);
    });
  });

  modal.querySelectorAll<HTMLInputElement>(
    "[data-use-beast]"
  ).forEach(checkbox => {
    checkbox.addEventListener("change", async () => {
      const id = Number(checkbox.dataset.useBeast);

      const account = accounts.find(item => item.id === id);

      if (!account) return;

      account.useBeastBall = checkbox.checked;

      save();

      console.log(
        `Conta ${account.name}: uso da Beast Ball ${
          checkbox.checked ? "ativado" : "desativado"
        }.`
      );

      await syncBallAutomation(account);
    });
  });

  modal.querySelectorAll<HTMLInputElement>(
    "[data-force-ultra-ball]"
  ).forEach(checkbox => {
    checkbox.addEventListener("change", async () => {
      const id = Number(checkbox.dataset.forceUltraBall);

      const account = accounts.find(item => item.id === id);

      if (!account) return;

      account.forceUltraBall = checkbox.checked;

      save();

      console.log(
        `Conta ${account.name}: forçar Ultra Ball ${
          checkbox.checked ? "ativado" : "desativado"
        }.`
      );

      await syncBallAutomation(account);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>(
    "[data-shop-settings]"
  ).forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.shopSettings);
      modal.remove();
      await openShopSettings(id);
    });
  });

  modal.querySelectorAll<HTMLButtonElement>(
    "[data-toggle-pause]"
  ).forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.togglePause);

      try {
        if (pausedAccounts.has(id)) {
          await resumeAccount(id);
        } else {
          await pauseAccount(id);
        }

        modal.remove();
        render();
        await openSettings();
      } catch (error) {
        console.error(
          "Erro ao alterar estado da conta:",
          error
        );
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>(
    "[data-test-js]"
  ).forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.testJs);

      try {
        await invoke("test_game_webview_js", {
          accountId: id
        });

        alert(
          "Teste enviado com sucesso para a conta " + id + "."
        );
      } catch (error) {
        console.error("Erro no teste JavaScript:", error);

        alert(
          "Falha no teste JavaScript:\n\n" + error
        );
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>(
    "[data-edit]"
  ).forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.edit);

      modal.remove();

      await editAccount(id);

      scheduleWebviewLayout();
    });
  });

  modal.querySelectorAll<HTMLButtonElement>(
    "[data-remove]"
  ).forEach(button => {
    button.addEventListener("click", async () => {
      const id = Number(button.dataset.remove);

      await removeAccount(id);

      modal.remove();

      await openSettings();
    });
  });

  document.getElementById("save-limit")?.addEventListener(
    "click",
    () => {
      const input = document.getElementById(
        "account-limit"
      ) as HTMLInputElement;

      const value = Number(input.value);

      if (!Number.isInteger(value) || value < 1) {
        alert("Digite um limite válido.");
        return;
      }

      if (value < accounts.length) {
        alert(
          "O limite não pode ser menor que a quantidade de contas cadastradas."
        );
        return;
      }

      maxAccounts = value;

      save();

      modal.remove();

      render();
    }
  );
}

/* =====================================================
   CONFIGURAR COMPRAS AUTOMÁTICAS
===================================================== */

async function openShopSettings(id: number) {
  const account = accounts.find(item => item.id === id);
  if (!account) return;

  account.shopRules = normalizeShopRules(account.shopRules);

  const modal = document.createElement("div");
  modal.className = "modal-overlay shop-modal-overlay";

  const groups = [
    { title: "Pokébolas", description: "Itens usados para capturar Pokémon.", kind: "ball" },
    { title: "Poções", description: "Recupere a vida dos seus Pokémon.", kind: "potion" },
    { title: "Revives", description: "Reviva Pokémon derrotados.", kind: "revive" }
  ];

  const getGroup = (product: typeof SHOP_PRODUCTS[number]) => {
    if (product.kind === "ball") return "ball";
    if (product.id === 205 || product.id === 206) return "revive";
    return "potion";
  };

  const groupMarkup = groups.map(group => {
    const products = SHOP_PRODUCTS.filter(product => getGroup(product) === group.kind);
    if (!products.length) return "";

    const rows = products.map(product => {
      const rule = account.shopRules[product.key];
      return `
        <article class="shop-product-card ${rule.enabled ? "is-enabled" : ""} ${product.key === "item_70070" ? "is-golden-item" : ""}">
          <div class="shop-product-main">
            <div class="shop-product-identity">
              <div class="shop-product-icon-wrap">
                <img class="shop-product-icon" src="${SHOP_ITEM_ICON_BASE}${SHOP_ITEM_ICONS[product.key]}" alt="${escapeHTML(product.name)}" loading="lazy" />
              </div>
              <div class="shop-product-title">
              <strong>${escapeHTML(product.name)}</strong>
              <span class="shop-product-price">${product.price.toLocaleString("pt-BR")} moedas / un.</span>
              </div>
            </div>
            <label class="shop-switch" title="Ativar compra de ${escapeHTML(product.name)}">
              <input type="checkbox" data-shop-enabled="${product.key}" ${rule.enabled ? "checked" : ""} />
              <span class="shop-switch-track"></span>
              <span class="shop-switch-label">Ativar</span>
            </label>
          </div>
          <div class="shop-stock-fields">
            <label class="shop-number-field">
              <span>Estoque mínimo</span>
              <input type="number" min="0" step="1" data-shop-min="${product.key}" value="${rule.minStock}" />
            </label>
            <label class="shop-number-field">
              <span>Estoque desejado</span>
              <input type="number" min="1" step="1" data-shop-target="${product.key}" value="${rule.targetStock}" />
            </label>
          </div>
        </article>
      `;
    }).join("");

    return `
      <section class="shop-group">
        <div class="shop-group-heading">
          <div><h3>${group.title}</h3><p>${group.description}</p></div>
          <span>${products.length} ${products.length === 1 ? "produto" : "produtos"}</span>
        </div>
        <div class="shop-product-grid">${rows}</div>
      </section>
    `;
  }).join("");

  modal.innerHTML = `
    <style>
      .shop-modal-overlay { padding: 18px; }
      .shop-settings-modal { width: min(900px, 96vw); max-height: 92vh; overflow: hidden; display:flex; flex-direction:column; border:1px solid rgba(190,160,255,.22); box-shadow:0 24px 80px rgba(0,0,0,.55); }
      .shop-settings-modal .modal-header { padding:20px 24px; border-bottom:1px solid rgba(255,255,255,.09); }
      .shop-settings-modal .modal-header h2 { margin:0; font-size:20px; }
      .shop-settings-body { padding:20px 24px 24px; overflow-y:auto; }
      .shop-intro { color:#c9c2d5; line-height:1.55; margin:0 0 16px; font-size:13px; }
      .shop-master-toggle { display:flex; align-items:center; gap:12px; padding:15px 16px; margin-bottom:22px; border:1px solid rgba(160,120,255,.35); border-radius:12px; background:rgba(130,80,220,.12); color:#fff; }
      .shop-master-toggle input { width:18px; height:18px; accent-color:#9b70f5; }
      .shop-master-toggle strong { display:block; font-size:14px; }
      .shop-master-toggle small { display:block; margin-top:3px; color:#bdb3ce; font-size:12px; }
      .shop-group { margin:0 0 24px; }
      .shop-group-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
      .shop-group-heading h3 { margin:0; color:#fff; font-size:16px; }
      .shop-group-heading p { margin:4px 0 0; color:#aaa1ba; font-size:12px; }
      .shop-group-heading > span { color:#bdb0d5; font-size:11px; white-space:nowrap; padding:5px 9px; border-radius:20px; background:rgba(255,255,255,.07); }
      .shop-product-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
      .shop-product-card { min-width:0; padding:13px; border:1px solid rgba(255,255,255,.10); border-radius:12px; background:rgba(255,255,255,.035); transition:border-color .15s,background .15s; }
      .shop-product-card.is-enabled { border-color:rgba(145,105,245,.55); background:rgba(125,80,210,.10); }
      .shop-product-main { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .shop-product-identity { min-width:0; display:flex; align-items:center; gap:11px; }
      .shop-product-icon-wrap { width:52px; height:52px; flex:0 0 52px; display:grid; place-items:center; border-radius:11px; background:rgba(255,255,255,.075); border:1px solid rgba(255,255,255,.09); }
      .shop-product-icon { width:42px; height:42px; object-fit:contain; image-rendering:pixelated; filter:drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .shop-product-card.is-golden-item .shop-product-icon-wrap { background:rgba(218,166,47,.13); border-color:rgba(238,190,76,.38); }
      .shop-product-title { min-width:0; display:flex; flex-direction:column; gap:4px; }
      .shop-product-title strong { color:#f5f1ff; font-size:13px; }
      .shop-product-price { color:#a9a0b8; font-size:11px; }
      .shop-switch { display:flex; align-items:center; gap:7px; flex-shrink:0; cursor:pointer; color:#cfc6df; font-size:11px; }
      .shop-switch input { position:absolute; opacity:0; width:1px; height:1px; }
      .shop-switch-track { width:30px; height:17px; border-radius:20px; background:#55505f; position:relative; transition:background .15s; }
      .shop-switch-track:after { content:""; position:absolute; width:13px; height:13px; left:2px; top:2px; border-radius:50%; background:#fff; transition:transform .15s; }
      .shop-switch input:checked + .shop-switch-track { background:#8b63e6; }
      .shop-switch input:checked + .shop-switch-track:after { transform:translateX(13px); }
      .shop-stock-fields { display:grid; grid-template-columns:1fr 1fr; gap:9px; margin-top:13px; }
      .shop-number-field { display:flex; flex-direction:column; gap:5px; color:#aaa1ba; font-size:11px; }
      .shop-number-field input { width:100%; min-width:0; box-sizing:border-box; padding:8px 9px; border:1px solid rgba(255,255,255,.13); border-radius:7px; background:rgba(0,0,0,.2); color:#fff; font-size:13px; }
      .shop-number-field input:focus { outline:1px solid #9872ef; border-color:#9872ef; }
      .shop-actions { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:10px; padding-top:16px; margin-top:8px; border-top:1px solid rgba(255,255,255,.09); }
      .shop-actions button { min-width:120px; padding:11px 18px; border:1px solid transparent; border-radius:9px; color:#fff !important; font-size:13px; font-weight:700; line-height:1.2; cursor:pointer; transition:filter .15s ease, transform .15s ease; text-shadow:0 1px 2px rgba(0,0,0,.35); }
      .shop-actions button:hover { filter:brightness(1.12); transform:translateY(-1px); }
      .shop-actions #cancel-shop-settings,
      .shop-actions #save-shop-settings { background:#3f3f46 !important; border:1px solid #71717a !important; color:#fff !important; box-shadow:none !important; text-shadow:none; }
      .shop-actions #cancel-shop-settings:hover,
      .shop-actions #save-shop-settings:hover { background:#52525b !important; border-color:#a1a1aa !important; }
      @media(max-width:420px) { .shop-actions button { flex:1 1 100%; } }
      @media(max-width:650px) { .shop-modal-overlay{padding:8px;} .shop-settings-modal{width:100%;max-height:96vh;} .shop-settings-modal .modal-header,.shop-settings-body{padding:15px;} .shop-product-grid{grid-template-columns:1fr;} .shop-settings-modal .modal-header h2{font-size:16px;} .shop-product-icon-wrap{width:46px;height:46px;flex-basis:46px;} .shop-product-icon{width:38px;height:38px;} .shop-product-main{gap:7px;} }
    </style>
    <div class="settings-modal shop-settings-modal">
      <div class="modal-header">
        <h2>🛒 Compras automáticas</h2>
        <button class="modal-close" id="close-shop-settings">×</button>
      </div>
      <div class="shop-settings-body">
        <p class="shop-intro">Configure individualmente o estoque de cada produto. Quando a quantidade atingir o mínimo, o sistema comprará até alcançar o estoque desejado. As compras usam somente moedas; Beast Ball e diamantes não são utilizados.</p>
        <label class="shop-master-toggle">
          <input type="checkbox" id="shop-automation-enabled" ${account.shopAutomationEnabled ? "checked" : ""} />
          <span><strong>Ativar compras automáticas nesta conta</strong><small>As regras abaixo só funcionam quando esta opção estiver ativada.</small></span>
        </label>
        ${groupMarkup}
        <div class="shop-actions">
          <button id="cancel-shop-settings">Cancelar</button>
          <button id="save-shop-settings">Salvar compras</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll<HTMLImageElement>(".shop-product-icon").forEach(image => {
    image.addEventListener("error", () => {
      image.style.display = "none";
      const fallback = document.createElement("span");
      fallback.textContent = "✦";
      fallback.style.cssText = "font-size:25px;color:#d7c6ff;";
      image.parentElement?.appendChild(fallback);
    }, { once: true });
  });

  function close() {
    modal.remove();
    void openSettings();
  }

  modal.querySelector("#close-shop-settings")?.addEventListener("click", close);
  modal.querySelector("#cancel-shop-settings")?.addEventListener("click", close);
  modal.addEventListener("click", event => {
    if (event.target === modal) close();
  });

  modal.querySelectorAll<HTMLInputElement>("[data-shop-enabled]").forEach(input => {
    input.addEventListener("change", () => {
      input.closest(".shop-product-card")?.classList.toggle("is-enabled", input.checked);
    });
  });

  modal.querySelector("#save-shop-settings")?.addEventListener("click", async () => {
    const globalEnabled = (
      modal.querySelector("#shop-automation-enabled") as HTMLInputElement
    ).checked;

    const newRules: Record<string, ShopRule> = {};

    for (const product of SHOP_PRODUCTS) {
      const enabled = (
        modal.querySelector(`[data-shop-enabled="${product.key}"]`) as HTMLInputElement
      ).checked;
      const minStock = Number(
        (modal.querySelector(`[data-shop-min="${product.key}"]`) as HTMLInputElement).value
      );
      const targetStock = Number(
        (modal.querySelector(`[data-shop-target="${product.key}"]`) as HTMLInputElement).value
      );

      if (!Number.isInteger(minStock) || minStock < 0 || !Number.isInteger(targetStock) || targetStock < 1) {
        alert(`Informe valores válidos para ${product.name}.`);
        return;
      }
      if (enabled && targetStock <= minStock) {
        alert(`Para ${product.name}, a quantidade desejada precisa ser maior que o estoque mínimo.`);
        return;
      }

      newRules[product.key] = { enabled, minStock, targetStock };
    }

    account.shopAutomationEnabled = globalEnabled;
    account.shopRules = newRules;
    save();

    if (createdWebviews.has(account.id) && !pausedAccounts.has(account.id)) {
      await syncShopAutomation(account);
    }

    modal.remove();
    await openSettings();
  });
}

/* =====================================================
   ADICIONAR CONTA
===================================================== */

function addAccount() {
  if (accounts.length >= maxAccounts) {
    alert("Você atingiu o limite de contas.");
    return;
  }

  const game = prompt("Qual é o jogo?");

  if (!game || !game.trim()) return;

  const name = prompt("Digite um nome para esta conta:");

  if (!name || !name.trim()) return;

  const inputUrl = prompt("Digite o endereço do jogo:");

  if (!inputUrl || !inputUrl.trim()) return;

  const url = validateUrl(inputUrl);

  if (!url) {
    alert("Endereço inválido.");
    return;
  }

  const account: Account = {
    id: nextId++,
    name: name.trim(),
    game: game.trim(),
    url,
    useBeastBall: false,
    autoBall: false,
    forceUltraBall: false,
    shopAutomationEnabled: false,
    shopRules: createDefaultShopRules()
  };

  accounts.push(account);

  if (selectedAccount === null) {
    selectedAccount = account.id;
  }

  save();
  render();
}

/* =====================================================
   EDITAR CONTA
===================================================== */

async function editAccount(id: number) {
  const account = accounts.find(item => item.id === id);

  if (!account) return;

  const name = prompt("Nome da conta:", account.name);

  if (!name || !name.trim()) return;

  const game = prompt("Jogo:", account.game);

  if (!game || !game.trim()) return;

  const inputUrl = prompt("Endereço do jogo:", account.url);

  if (!inputUrl || !inputUrl.trim()) return;

  const url = validateUrl(inputUrl);

  if (!url) {
    alert("Endereço inválido.");
    return;
  }

  await closeAccountWebview(id);

  pausedAccounts.delete(id);

  account.name = name.trim();
  account.game = game.trim();
  account.url = url;

  save();
  render();
}

/* =====================================================
   REMOVER CONTA
===================================================== */

async function removeAccount(id: number) {
  const account = accounts.find(item => item.id === id);

  if (!account) return;

  if (!confirm(`Deseja remover a conta "${account.name}"?`)) {
    return;
  }

  await closeAccountWebview(id);

  pausedAccounts.delete(id);

  accounts = accounts.filter(item => item.id !== id);

  if (selectedAccount === id) {
    selectedAccount = accounts.length > 0
      ? accounts[0].id
      : null;
  }

  save();
  render();
}

/* =====================================================
   REDIMENSIONAMENTO DA JANELA
===================================================== */

let resizeTimer: number | undefined;

window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);

  resizeTimer = window.setTimeout(() => {
    scheduleWebviewLayout();
  }, 150);
});

/* =====================================================
   INICIAR APLICAÇÃO
===================================================== */

render();