(function () {
  "use strict";

  const tg = window.Telegram && window.Telegram.WebApp;
  if (!tg) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:sans-serif">Открой мини-приложение из бота в Telegram.</p>';
    return;
  }

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = window.APP_CONFIG;
  const FUNCTIONS_URL = SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/webapp-api";

  // Цвет закреплён за категорией по имени — как в дизайн-системе (fixed order,
  // никогда не назначается по рангу/позиции). Категории сверх дефолтных
  // (пользователь мог создать свою) получают нейтральную точку, а не
  // сгенерированный цвет.
  const CATEGORY_COLORS = {
    "Еда": "--cat-food",
    "Транспорт": "--cat-transport",
    "Жильё": "--cat-home",
    "Развлечения": "--cat-fun",
    "Здоровье": "--cat-health",
    "Прочее": "--cat-other",
  };
  function categoryColor(name) {
    const varName = CATEGORY_COLORS[name];
    return varName ? `var(${varName})` : "var(--ink-3)";
  }

  const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const PERIOD_LABEL = { day: "день", week: "неделю", month: "месяц" };

  // ---------- состояние ----------
  const state = {
    screen: "dashboard",
    period: "week",
    statsView: "list",
    data: null, // { isNew, categories, expenses, stats, total }
    loading: true,
    selectedCategoryId: null,
    addingCategory: false,
  };

  // ---------- вспомогательное ----------
  function formatMoney(amount) {
    const n = Number(amount);
    const rounded = Math.round(n * 100) / 100;
    const isWhole = Number.isInteger(rounded);
    const formatted = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(rounded);
    return `${formatted} ₽`;
  }

  function formatWhen(iso) {
    const date = new Date(iso);
    const now = new Date();
    const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
    if (diffDays === 0) return `Сегодня, ${time}`;
    if (diffDays === 1) return `Вчера, ${time}`;
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + `, ${time}`;
  }

  async function api(action, { method = "GET", period, body } = {}) {
    const url = new URL(FUNCTIONS_URL);
    url.searchParams.set("action", action);
    if (period) url.searchParams.set("period", period);
    // initData передаём параметром запроса, а не заголовком: кастомный
    // заголовок (X-Telegram-Init-Data) не проходит CORS-preflight на уровне
    // API-шлюза Supabase (он его не знает и не пропускает), а стандартные
    // apikey/content-type — пропускает. Теперь, когда фронтенд и бэкенд на
    // разных доменах (GitHub Pages + Supabase), это стало заметно.
    url.searchParams.set("initData", tg.initData || "");

    const res = await fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Ошибка запроса (${res.status})`);
    return json;
  }

  // ---------- тема ----------
  function applyTheme() {
    document.documentElement.setAttribute(
      "data-theme",
      tg.colorScheme === "dark" ? "dark" : "light",
    );
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    const paper = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
    tg.setHeaderColor(paper);
    tg.setBackgroundColor(paper);
    tg.MainButton.setParams({ color: accent, text_color: "#ffffff" });
  }

  // ---------- загрузка данных ----------
  async function loadBootstrap() {
    state.loading = true;
    render();
    try {
      state.data = await api("bootstrap", { period: state.period });
    } catch (err) {
      tg.showAlert("Не удалось загрузить данные: " + err.message);
      state.data = state.data || { categories: [], expenses: [], stats: [], total: 0 };
    } finally {
      state.loading = false;
      render();
    }
  }

  // ---------- навигация ----------
  function showScreen(name) {
    state.screen = name;
    if (name === "add") {
      state.selectedCategoryId = null;
      state.addingCategory = false;
    }
    render();
  }

  tg.BackButton.onClick(() => showScreen("dashboard"));

  // MainButton-обработчик регистрируется один раз и просто смотрит на текущий
  // экран — иначе повторный onClick() при каждом render() копил бы
  // обработчики (реальный SDK не гарантирует автозамену/дедупликацию).
  tg.MainButton.onClick(() => {
    if (state.screen === "dashboard") goToAdd();
    else if (state.screen === "add") submitExpense();
  });

  // ---------- рендер: сводка ----------
  function renderDashboard() {
    const label = document.querySelector('[data-role="hero-label"]');
    const total = document.querySelector('[data-role="hero-total"]');
    const weekBars = document.querySelector('[data-role="week-bars"]');
    const list = document.querySelector('[data-role="recent-list"]');

    label.textContent = `Потрачено за ${PERIOD_LABEL[state.period]}`;

    document.querySelectorAll('[data-role="period"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === state.period);
    });

    if (state.loading || !state.data) {
      total.textContent = "…";
      list.innerHTML = '<p class="empty-hint">Загрузка…</p>';
      weekBars.hidden = true;
      return;
    }

    total.textContent = formatMoney(state.data.total);

    if (state.period === "week") {
      weekBars.hidden = false;
      renderWeekBars(weekBars, state.data.expenses);
    } else {
      weekBars.hidden = true;
    }

    const items = state.data.expenses.slice(0, 6);
    if (items.length === 0) {
      list.innerHTML = '<p class="empty-hint">Пока нет расходов за этот период.</p>';
    } else {
      list.innerHTML = items
        .map((e) => {
          const when = e.comment
            ? `${formatWhen(e.created_at)} · ${escapeHtml(e.category)}`
            : formatWhen(e.created_at);
          return `
        <div class="row">
          <div class="dot" style="background:${categoryColor(e.category)}"></div>
          <div class="meta">
            <div class="what">${escapeHtml(e.comment || e.category)}</div>
            <div class="when">${when}</div>
          </div>
          <div class="amt">${formatMoney(e.amount)}</div>
        </div>`;
        })
        .join("");
    }
  }

  function renderWeekBars(container, expenses) {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({ key: d.toDateString(), label: WEEKDAY_SHORT[d.getDay()], total: 0, isToday: i === 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const e of expenses) {
      const key = new Date(e.created_at).toDateString();
      const bucket = byKey.get(key);
      if (bucket) bucket.total += Number(e.amount);
    }
    const max = Math.max(1, ...days.map((d) => d.total));
    container.innerHTML = days
      .map(
        (d) => `
      <div class="col ${d.isToday ? "today" : ""}">
        <div class="bar" style="height:${Math.max(4, Math.round((d.total / max) * 100))}%"></div>
        <div class="dlabel">${d.label}</div>
      </div>`,
      )
      .join("");
  }

  // ---------- рендер: добавление ----------
  function renderAdd() {
    const grid = document.querySelector('[data-role="category-grid"]');
    const categories = (state.data && state.data.categories) || [];

    grid.innerHTML =
      categories
        .map(
          (c) => `
      <button type="button" class="chip ${c.id === state.selectedCategoryId ? "sel" : ""}" data-cat-id="${c.id}">
        <span class="dot" style="background:${categoryColor(c.name)}"></span>${escapeHtml(c.name)}
      </button>`,
        )
        .join("") +
      `<button type="button" class="chip new" data-role="new-cat-toggle">＋ Своя категория</button>`;

    document.querySelector('[data-role="new-cat-row"]').hidden = !state.addingCategory;
    updateAddMainButton();
  }

  function currentAmount() {
    const input = document.querySelector('[data-role="amount-input"]');
    const value = parseFloat((input.value || "").replace(",", "."));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function updateAddMainButton() {
    const amount = currentAmount();
    if (!state.selectedCategoryId) {
      tg.MainButton.setText("Выбери категорию");
      tg.MainButton.disable();
    } else if (!amount) {
      tg.MainButton.setText("Введи сумму расхода");
      tg.MainButton.disable();
    } else {
      tg.MainButton.setText(`Записать ${formatMoney(amount)}`);
      tg.MainButton.enable();
    }
  }

  async function submitExpense() {
    const amount = currentAmount();
    if (!state.selectedCategoryId || !amount) return;

    const comment = document.querySelector('[data-role="comment-input"]').value.trim();

    tg.MainButton.showProgress();
    try {
      await api("add_expense", {
        method: "POST",
        body: { categoryId: state.selectedCategoryId, amount, comment: comment || null },
      });
      tg.HapticFeedback.notificationOccurred("success");
      showScreen("dashboard");
      await loadBootstrap();
    } catch (err) {
      tg.showAlert("Не получилось записать расход: " + err.message);
    } finally {
      tg.MainButton.hideProgress();
    }
  }

  async function submitNewCategory() {
    const input = document.querySelector('[data-role="new-cat-input"]');
    const name = input.value.trim();
    if (!name) return;
    try {
      const { category } = await api("add_category", { method: "POST", body: { name } });
      state.data.categories.push(category);
      state.selectedCategoryId = category.id;
      state.addingCategory = false;
      input.value = "";
      renderAdd();
    } catch (err) {
      tg.showAlert(err.message);
    }
  }

  // ---------- рендер: статистика ----------
  function renderStats() {
    document.querySelectorAll('[data-role="period-stats"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === state.period);
    });
    document.querySelectorAll('[data-role="view-toggle"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === state.statsView);
    });

    const listEl = document.querySelector('[data-role="stats-list"]');
    const donutWrap = document.querySelector('[data-role="stats-donut"]');
    const legendEl = document.querySelector('[data-role="legend-list"]');
    const totalLabel = document.querySelector('[data-role="stats-total-label"]');
    const totalVal = document.querySelector('[data-role="stats-total"]');

    totalLabel.textContent = `Итого за ${PERIOD_LABEL[state.period]}`;

    if (state.loading || !state.data) {
      listEl.innerHTML = '<p class="empty-hint">Загрузка…</p>';
      donutWrap.hidden = true;
      legendEl.hidden = true;
      totalVal.textContent = "…";
      return;
    }

    const stats = state.data.stats;
    const total = state.data.total;
    totalVal.textContent = formatMoney(total);

    const isDonut = state.statsView === "donut";
    listEl.hidden = isDonut;
    donutWrap.hidden = !isDonut;
    legendEl.hidden = !isDonut;

    if (stats.length === 0) {
      listEl.innerHTML = `<p class="empty-hint">За ${PERIOD_LABEL[state.period]} расходов нет.</p>`;
      legendEl.innerHTML = "";
      document.querySelector('[data-role="donut-circle"]').style.background = "var(--hairline)";
      document.querySelector('[data-role="donut-total"]').textContent = formatMoney(0);
      return;
    }

    listEl.innerHTML = stats
      .map((s) => {
        const pct = total > 0 ? Math.round((s.total / total) * 100) : 0;
        const width = total > 0 ? Math.max(4, Math.round((s.total / stats[0].total) * 100)) : 0;
        return `
      <div class="statbar">
        <div class="top">
          <span class="name"><span class="dot" style="background:${categoryColor(s.category)}"></span>${escapeHtml(s.category)}</span>
          <span class="val">${formatMoney(s.total)} · ${pct}%</span>
        </div>
        <div class="track"><div class="fill" style="width:${width}%; background:${categoryColor(s.category)}"></div></div>
      </div>`;
      })
      .join("");

    legendEl.innerHTML = stats
      .map((s) => {
        const pct = total > 0 ? Math.round((s.total / total) * 100) : 0;
        return `
      <div class="legend-row">
        <span class="dot" style="background:${categoryColor(s.category)}"></span>
        <span class="name">${escapeHtml(s.category)}</span>
        <span class="pct">${pct}%</span>
      </div>`;
      })
      .join("");

    document.querySelector('[data-role="donut-period-label"]').textContent = `За ${PERIOD_LABEL[state.period]}`;
    document.querySelector('[data-role="donut-total"]').textContent = formatMoney(total);
    document.querySelector('[data-role="donut-circle"]').style.background = buildConicGradient(stats, total);
  }

  function buildConicGradient(stats, total) {
    if (total <= 0) return "var(--hairline)";
    const gapDeg = 1.6;
    const paper = "var(--paper)";
    let angle = 0;
    const stops = [];
    stats.forEach((s) => {
      const share = (s.total / total) * (360 - gapDeg * stats.length);
      const start = angle;
      const end = angle + share;
      stops.push(`${categoryColor(s.category)} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`);
      stops.push(`${paper} ${end.toFixed(1)}deg ${(end + gapDeg).toFixed(1)}deg`);
      angle = end + gapDeg;
    });
    return `conic-gradient(${stops.join(", ")})`;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ---------- главный render ----------
  function render() {
    document.getElementById("screen-dashboard").hidden = state.screen !== "dashboard";
    document.getElementById("screen-add").hidden = state.screen !== "add";
    document.getElementById("screen-stats").hidden = state.screen !== "stats";

    if (state.screen === "dashboard") {
      tg.BackButton.hide();
      tg.MainButton.setText("➕ Добавить расход");
      tg.MainButton.enable();
      tg.MainButton.show();
      renderDashboard();
    } else if (state.screen === "add") {
      tg.BackButton.show();
      tg.MainButton.show();
      renderAdd();
    } else if (state.screen === "stats") {
      tg.BackButton.show();
      tg.MainButton.hide();
      renderStats();
    }
  }

  function goToAdd() {
    showScreen("add");
  }

  // ---------- события ----------
  document.querySelector('[data-role="period"]').addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn || btn.dataset.period === state.period) return;
    state.period = btn.dataset.period;
    loadBootstrap();
  });

  document.querySelector('[data-role="period-stats"]').addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn || btn.dataset.period === state.period) return;
    state.period = btn.dataset.period;
    loadBootstrap();
  });

  document.querySelector('[data-role="view-toggle"]').addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    state.statsView = btn.dataset.view;
    renderStats();
  });

  document.querySelector('[data-role="open-stats"]').addEventListener("click", () => showScreen("stats"));

  document.querySelector('[data-role="category-grid"]').addEventListener("click", (e) => {
    const newBtn = e.target.closest('[data-role="new-cat-toggle"]');
    if (newBtn) {
      state.addingCategory = !state.addingCategory;
      renderAdd();
      if (state.addingCategory) document.querySelector('[data-role="new-cat-input"]').focus();
      return;
    }
    const chip = e.target.closest("button[data-cat-id]");
    if (chip) {
      state.selectedCategoryId = Number(chip.dataset.catId);
      renderAdd();
    }
  });

  document.querySelector('[data-role="new-cat-confirm"]').addEventListener("click", submitNewCategory);
  document.querySelector('[data-role="new-cat-input"]').addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitNewCategory();
  });

  document.querySelector('[data-role="amount-input"]').addEventListener("input", updateAddMainButton);

  // ---------- инициализация ----------
  tg.ready();
  tg.expand();
  applyTheme();
  tg.onEvent("themeChanged", applyTheme);
  loadBootstrap();
  render();
})();
