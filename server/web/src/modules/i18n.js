// ── Lightweight i18n module ─────────────────────────────────────────────────
import { ref, computed } from 'vue';

/**
 * Creates i18n functionality: t() translator, locale switching, persistence.
 * Locale data is loaded dynamically from /locales/<lang>.json.
 *
 * @returns {{ t: Function, locale: import('vue').Ref<string>, setLocale: Function }}
 */
export function createI18n() {
  const STORAGE_KEY = 'agentlink-language';
  const SUPPORTED = ['en', 'zh'];
  const DEFAULT_LOCALE = 'en';

  // Detect initial locale
  function detectLocale() {
    // 1. Explicit user choice
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;

    // 2. Browser preference
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('zh')) return 'zh';

    // 3. Default
    return DEFAULT_LOCALE;
  }

  const locale = ref(detectLocale());
  const _messages = ref({});
  let _loadedLocale = null;

  // Load locale JSON
  async function loadMessages(lang) {
    if (_loadedLocale === lang && Object.keys(_messages.value).length > 0) return;
    try {
      const resp = await fetch(`/locales/${lang}.json`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      _messages.value = await resp.json();
      _loadedLocale = lang;
    } catch (e) {
      console.warn(`[i18n] Failed to load locale "${lang}":`, e);
      // Fallback: try loading English
      if (lang !== DEFAULT_LOCALE) {
        try {
          const resp = await fetch(`/locales/${DEFAULT_LOCALE}.json`);
          if (resp.ok) {
            _messages.value = await resp.json();
            _loadedLocale = DEFAULT_LOCALE;
          }
        } catch { /* give up */ }
      }
    }
  }

  /**
   * Translate a key, with optional parameter substitution.
   * Returns the key itself if no translation is found (fallback).
   *
   * @param {string} key - Dot-notation key, e.g. "button.send"
   * @param {object} [params] - Substitution params, e.g. { n: 5 }
   * @returns {string}
   */
  function t(key, params) {
    let str = _messages.value[key];
    if (str === undefined) return key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  }

  /**
   * Switch locale, persist choice, and reload strings.
   * @param {string} lang
   */
  async function setLocale(lang) {
    if (!SUPPORTED.includes(lang)) return;
    locale.value = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    await loadMessages(lang);
  }

  /**
   * Toggle between supported locales (EN ↔ 中).
   */
  async function toggleLocale() {
    const next = locale.value === 'en' ? 'zh' : 'en';
    await setLocale(next);
  }

  // The display label for the language switcher button
  const localeLabel = computed(() => locale.value === 'en' ? 'EN' : '中');

  // Load initial messages
  loadMessages(locale.value);

  return { t, locale, setLocale, toggleLocale, localeLabel };
}
