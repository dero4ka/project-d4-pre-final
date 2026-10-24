// Вход через Discord без сервера (implicit grant).
// Токен живёт только в sessionStorage этой вкладки и никуда, кроме Discord, не отправляется.
(() => {
  const API = 'https://discord.com/api/v10';
  const AUTH_URL = 'https://discord.com/oauth2/authorize';
  const ISSUER = 'https://discord.com';
  const AUTH_KEY = 'mod_auth';
  const STATE_KEY = 'mod_state';
  const SELECTED_PREFIX = 'mod_selected_';
  const cfg = window.APP_CONFIG || {};

  // Права Discord (битовые флаги), по которым считаем, что человек модерирует сервер
  const PERMS = {
    ADMINISTRATOR: 1n << 3n,
    MANAGE_GUILD: 1n << 5n,
    KICK_MEMBERS: 1n << 1n,
    BAN_MEMBERS: 1n << 2n,
    MANAGE_MESSAGES: 1n << 13n,
    MODERATE_MEMBERS: 1n << 40n,
  };
  const MOD_MASK = Object.values(PERMS).reduce((a, b) => a | b, 0n);

  // Хранилище может быть недоступно (приватный режим и т.п.), поэтому всё в try/catch
  const store = {
    get(area, k) { try { return area.getItem(k); } catch { return null; } },
    set(area, k, v) { try { area.setItem(k, v); } catch {} },
    del(area, k) { try { area.removeItem(k); } catch {} },
  };

  const clientId = () => String(cfg.CLIENT_ID || '').trim();
  const isConfigured = () => /^\d{15,25}$/.test(clientId());
  const redirectUri = () =>
    (cfg.REDIRECT_URI && String(cfg.REDIRECT_URI).trim()) || new URL('dashboard.html', location.href).href;

  function randomState() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Отправляем на страницу авторизации Discord. Возвращает false, если сайт не настроен.
  function login() {
    if (!isConfigured()) return false;
    const state = randomState();
    store.set(sessionStorage, STATE_KEY, state);
    location.href =
      AUTH_URL + '?' +
      new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        response_type: 'token',
        scope: 'identify guilds',
        state,
      });
    return true;
  }

  // Вызывается на странице возврата (dashboard.html). Забирает токен из адреса и сразу стирает его оттуда.
  // Возвращает null (это не возврат из Discord), {ok:true} или {error:'код'}.
  function consumeCallback() {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(location.search);
    const hasToken = hash.has('access_token');
    const hasError = query.has('error') || hash.has('error');
    if (!hasToken && !hasError) return null;

    history.replaceState(null, '', location.pathname); // убираем токен из адресной строки и истории

    const expected = store.get(sessionStorage, STATE_KEY);
    store.del(sessionStorage, STATE_KEY);
    if (hasError) return { error: 'access_denied' };
    if (!expected || hash.get('state') !== expected) return { error: 'bad_state' };
    const iss = hash.get('iss');
    if (iss && iss !== ISSUER) return { error: 'bad_state' };

    const expiresIn = Number(hash.get('expires_in')) || 3600;
    store.set(sessionStorage, AUTH_KEY, JSON.stringify({
      token: hash.get('access_token'),
      expiresAt: Date.now() + expiresIn * 1000,
    }));
    return { ok: true };
  }

  function getAuth() {
    const raw = store.get(sessionStorage, AUTH_KEY);
    if (!raw) return null;
    try {
      const a = JSON.parse(raw);
      if (a && a.token && a.expiresAt > Date.now()) return a;
    } catch {}
    store.del(sessionStorage, AUTH_KEY);
    return null;
  }

  function logout() {
    store.del(sessionStorage, AUTH_KEY);
    store.del(sessionStorage, STATE_KEY);
  }

  async function api(path) {
    const auth = getAuth();
    if (!auth) { const e = new Error('no auth'); e.status = 401; throw e; }
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + auth.token } });
    if (r.status === 401) { logout(); const e = new Error('unauthorized'); e.status = 401; throw e; }
    if (!r.ok) { const e = new Error('discord ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  function avatarUrl(user) {
    if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`;
  }

  function mapGuilds(list) {
    return (Array.isArray(list) ? list : []).map((g) => {
      const perms = BigInt(g.permissions || 0);
      const owner = Boolean(g.owner);
      return {
        id: String(g.id),
        name: String(g.name),
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
        owner,
        admin: owner || (perms & PERMS.ADMINISTRATOR) !== 0n,
        moderated: owner || (perms & MOD_MASK) !== 0n,
      };
    });
  }

  const getSelected = (userId) => store.get(localStorage, SELECTED_PREFIX + userId);
  const setSelected = (userId, guildId) => store.set(localStorage, SELECTED_PREFIX + userId, guildId);

  window.ModApp = {
    isConfigured, login, consumeCallback, getAuth, logout, api,
    avatarUrl, mapGuilds, getSelected, setSelected,
  };
})();
