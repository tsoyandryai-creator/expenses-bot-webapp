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

  // Расход и доход — независимые сущности (свои категории, своя таблица в
  // БД, свои цвета здесь), чтобы визуально они тоже не смешивались. Цвет
  // закреплён за категорией по имени — как в дизайн-системе (fixed order,
  // никогда не назначается по рангу/позиции). Категории сверх дефолтных
  // (пользователь мог создать свою) получают нейтральную точку, а не
  // сгенерированный цвет.
  const CATEGORY_COLORS = {
    expense: {
      "🍔 Еда": "--cat-food",
      "🚌 Транспорт": "--cat-transport",
      "🏠 Жильё": "--cat-home",
      "🎉 Развлечения": "--cat-fun",
      "💊 Здоровье": "--cat-health",
      "👕 Одежда": "--cat-clothes",
      "📱 Связь": "--cat-comm",
      "📚 Образование": "--cat-edu",
      "🎁 Подарки": "--cat-gifts",
      "💰 Прочее": "--cat-other",
    },
    income: {
      "💼 Зарплата": "--cat-salary",
      "💵 Подработка": "--cat-sidejob",
      "🎁 Подарок": "--cat-gift-income",
      "🤑 Прочее": "--cat-other-income",
    },
  };
  function categoryColor(name) {
    const varName = CATEGORY_COLORS[state.txType][name];
    return varName ? `var(${varName})` : "var(--ink-3)";
  }

  const WEEKDAY_SHORT = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  const PERIOD_LABEL = { day: "день", week: "неделю", month: "месяц" };
  const TYPE_LABEL = { expense: "расхода", income: "дохода" };
  const TYPE_VERB = { expense: "Потрачено", income: "Заработано" };
  const TYPE_ACTION = { expense: "add_expense", income: "add_income" };
  const TYPE_TITLE = { expense: "Добавить расход", income: "Добавить доход" };

  // ---------- состояние ----------
  const state = {
    screen: "dashboard",
    period: "week",
    txType: "expense", // что сейчас показываем/добавляем: "expense" | "income"
    statsView: "list",
    data: null, // { isNew, balance, expense: {categories, transactions, stats, total}, income: {...} }
    loading: true,
    selectedCategoryId: null,
    addingCategory: false,
  };

  // текущий срез данных (расход или доход — смотря что выбрано)
  function currentSlice() {
    return state.data ? state.data[state.txType] : null;
  }

  // ---------- вспомогательное ----------
  function formatMoney(amount, { signed = false } = {}) {
    const n = Number(amount);
    const rounded = Math.round(n * 100) / 100;
    const isWhole = Number.isInteger(rounded);
    const formatted = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: isWhole ? 0 : 2,
      maximumFractionDigits: 2,
      signDisplay: signed ? "exceptZero" : "auto",
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
      state.data = state.data || {
        balance: 0,
        expense: { categories: [], transactions: [], stats: [], total: 0 },
        income: { categories: [], transactions: [], stats: [], total: 0 },
      };
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

  function setTxType(type) {
    if (type === state.txType) return;
    state.txType = type;
    render();
  }

  tg.BackButton.onClick(() => showScreen("dashboard"));

  // MainButton-обработчик регистрируется один раз и просто смотрит на текущий
  // экран — иначе повторный onClick() при каждом render() копил бы
  // обработчики (реальный SDK не гарантирует автозамену/дедупликацию).
  tg.MainButton.onClick(() => {
    if (state.screen === "dashboard") goToAdd();
    else if (state.screen === "add") submitTransaction();
  });

  // ---------- рендер: сводка ----------
  function renderDashboard() {
    const label = document.querySelector('[data-role="hero-label"]');
    const total = document.querySelector('[data-role="hero-total"]');
    const weekBars = document.querySelector('[data-role="week-bars"]');
    const list = document.querySelector('[data-role="recent-list"]');
    const recentHead = document.querySelector('[data-role="recent-head"]');

    document.querySelectorAll('[data-role="tx-type"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === state.txType);
    });

    label.textContent = `${TYPE_VERB[state.txType]} за ${PERIOD_LABEL[state.period]}`;
    recentHead.textContent = state.txType === "expense" ? "Недавние расходы" : "Недавний доход";

    document.querySelectorAll('[data-role="period"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.period === state.period);
    });

    const slice = currentSlice();
    if (state.loading || !slice) {
      total.textContent = "…";
      list.innerHTML = '<p class="empty-hint">Загрузка…</p>';
      weekBars.hidden = true;
      return;
    }

    total.textContent = formatMoney(slice.total);

    if (state.period === "week") {
      weekBars.hidden = false;
      renderWeekBars(weekBars, slice.transactions);
    } else {
      weekBars.hidden = true;
    }

    const items = slice.transactions.slice(0, 6);
    if (items.length === 0) {
      list.innerHTML = `<p class="empty-hint">Пока нет ${TYPE_LABEL[state.txType]} за этот период.</p>`;
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

  function renderWeekBars(container, transactions) {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      days.push({ key: d.toDateString(), label: WEEKDAY_SHORT[d.getDay()], total: 0, isToday: i === 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const e of transactions) {
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
    const slice = currentSlice();
    const categories = (slice && slice.categories) || [];

    document.querySelector('[data-role="add-title"]').textContent = TYPE_TITLE[state.txType];
    document.querySelector('[data-role="amount-label"]').textContent =
      state.txType === "expense" ? "Сумма расхода" : "Сумма дохода";

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
      tg.MainButton.setText(`Введи сумму ${TYPE_LABEL[state.txType]}`);
      tg.MainButton.disable();
    } else {
      tg.MainButton.setText(`Записать ${formatMoney(amount)}`);
      tg.MainButton.enable();
    }
  }

  async function submitTransaction() {
    const amount = currentAmount();
    if (!state.selectedCategoryId || !amount) return;

    const comment = document.querySelector('[data-role="comment-input"]').value.trim();

    tg.MainButton.showProgress();
    try {
      await api(TYPE_ACTION[state.txType], {
        method: "POST",
        body: { categoryId: state.selectedCategoryId, amount, comment: comment || null },
      });
      tg.HapticFeedback.notificationOccurred("success");
      showScreen("dashboard");
      await loadBootstrap();
    } catch (err) {
      tg.showAlert(`Не получилось записать ${TYPE_LABEL[state.txType]}: ` + err.message);
    } finally {
      tg.MainButton.hideProgress();
    }
  }

  async function submitNewCategory() {
    const input = document.querySelector('[data-role="new-cat-input"]');
    const name = input.value.trim();
    if (!name) return;
    try {
      const { category } = await api("add_category", {
        method: "POST",
        body: { name, type: state.txType },
      });
      currentSlice().categories.push(category);
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
    document.querySelectorAll('[data-role="tx-type-stats"] button').forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.type === state.txType);
    });
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
    const balanceLabel = document.querySelector('[data-role="balance-label"]');
    const balanceVal = document.querySelector('[data-role="balance-value"]');
    const balanceLine = document.querySelector('[data-role="balance-line"]');

    totalLabel.textContent =
      (state.txType === "expense" ? "Итого расход за " : "Итого доход за ") + PERIOD_LABEL[state.period];
    balanceLabel.textContent = `Баланс за ${PERIOD_LABEL[state.period]}`;

    if (state.loading || !state.data) {
      listEl.innerHTML = '<p class="empty-hint">Загрузка…</p>';
      donutWrap.hidden = true;
      legendEl.hidden = true;
      totalVal.textContent = "…";
      balanceVal.textContent = "…";
      return;
    }

    // Баланс — расход и доход, посчитанные раздельно, сведённые в одну
    // строку в самом конце. Не зависит от того, какой тип сейчас выбран
    // в переключателе выше.
    const balance = state.data.balance;
    balanceVal.textContent = formatMoney(balance, { signed: true });
    balanceLine.classList.toggle("positive", balance > 0);
    balanceLine.classList.toggle("negative", balance < 0);

    const slice = currentSlice();
    const stats = slice.stats;
    const total = slice.total;
    totalVal.textContent = formatMoney(total);

    const isDonut = state.statsView === "donut";
    listEl.hidden = isDonut;
    donutWrap.hidden = !isDonut;
    legendEl.hidden = !isDonut;

    if (stats.length === 0) {
      listEl.innerHTML = `<p class="empty-hint">За ${PERIOD_LABEL[state.period]} ${TYPE_LABEL[state.txType]} нет.</p>`;
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
      tg.MainButton.setText(state.txType === "expense" ? "➕ Добавить расход" : "➕ Добавить доход");
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
  document.querySelector('[data-role="tx-type"]').addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    setTxType(btn.dataset.type);
  });

  document.querySelector('[data-role="tx-type-stats"]').addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    setTxType(btn.dataset.type);
  });

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
