// Настройки подключения к Supabase. Значения не секретные — publishable-ключ
// (бывший anon key) предназначен именно для использования в браузере, доступ
// к данным ограничивает не он, а проверка initData внутри Edge Function.
//
// Впиши сюда значения своего проекта (Supabase Dashboard → Project Settings → API):
window.APP_CONFIG = {
  SUPABASE_URL: "https://zyefqhsgwranpfqiruns.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_vhpFOrl6ohffWAC_xsegSg_7D3DmJIr",
};
