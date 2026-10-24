// Запуск: npm test (без зависимостей). Загружаем app.js в песочнице с поддельным браузером.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('PASS ', name); };

function makeEnv({ clientId = '123456789012345678', href = 'https://u.github.io/r/index.html', hash = '', search = '' } = {}) {
  const mk = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const sessionStorage = mk(), localStorage = mk();
  const location = { href, hash, search, pathname: '/r/dashboard.html', set href(v) { this._nav = v; }, get href() { return this._nav || href; } };
  location.href = undefined; location._nav = undefined; Object.defineProperty(location, 'href', { get() { return this._nav || href; }, set(v) { this._nav = v; } });
  const history = { replaceState(_s, _t, url) { location.hash = ''; location.search = ''; this.last = url; } };
  const win = { APP_CONFIG: { CLIENT_ID: clientId, REDIRECT_URI: '' }, location, history };
  const ctx = vm.createContext({ window: win, location, history, sessionStorage, localStorage, URL, URLSearchParams, crypto: require('crypto').webcrypto, Date, Number, String, Array, JSON, BigInt, Uint8Array, Object, Math, fetch: async () => { throw new Error('no network'); } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), ctx);
  return { app: win.ModApp, sessionStorage, localStorage, location, history };
}

t('isConfigured: пустой и неверный Client ID', () => {
  assert.strictEqual(makeEnv({ clientId: '' }).app.isConfigured(), false);
  assert.strictEqual(makeEnv({ clientId: 'abc' }).app.isConfigured(), false);
  assert.strictEqual(makeEnv().app.isConfigured(), true);
});

t('login: без настройки не уходит никуда', () => {
  const e = makeEnv({ clientId: '' });
  assert.strictEqual(e.app.login(), false);
  assert.strictEqual(e.location._nav, undefined);
});

t('login: адрес Discord, implicit grant, redirect на dashboard.html рядом', () => {
  const e = makeEnv();
  assert.strictEqual(e.app.login(), true);
  const u = new URL(e.location._nav);
  assert.strictEqual(u.origin + u.pathname, 'https://discord.com/oauth2/authorize');
  assert.strictEqual(u.searchParams.get('response_type'), 'token');
  assert.strictEqual(u.searchParams.get('scope'), 'identify guilds');
  assert.strictEqual(u.searchParams.get('client_id'), '123456789012345678');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://u.github.io/r/dashboard.html');
  assert.match(u.searchParams.get('state'), /^[0-9a-f]{32}$/);
  assert.strictEqual(e.sessionStorage.getItem('mod_state'), u.searchParams.get('state'));
});

t('callback: верный state — токен сохранён, адрес очищен', () => {
  const e = makeEnv({ hash: '#access_token=TOK&token_type=Bearer&expires_in=604800&scope=identify+guilds&state=abc&iss=https%3A%2F%2Fdiscord.com' });
  e.sessionStorage.setItem('mod_state', 'abc');
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ ok: true }));
  assert.strictEqual(e.history.last, '/r/dashboard.html');
  assert.strictEqual(e.location.hash, '');
  assert.strictEqual(e.app.getAuth().token, 'TOK');
  assert.strictEqual(e.sessionStorage.getItem('mod_state'), null);
});

t('callback: неверный state отвергается, токен не сохраняется', () => {
  const e = makeEnv({ hash: '#access_token=TOK&state=EVIL' });
  e.sessionStorage.setItem('mod_state', 'abc');
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ error: 'bad_state' }));
  assert.strictEqual(e.app.getAuth(), null);
  assert.strictEqual(e.history.last, '/r/dashboard.html'); // токен всё равно стёрт из адреса
});

t('callback: без сохранённого state отвергается', () => {
  const e = makeEnv({ hash: '#access_token=TOK&state=abc' });
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ error: 'bad_state' }));
  assert.strictEqual(e.app.getAuth(), null);
});

t('callback: чужой iss отвергается', () => {
  const e = makeEnv({ hash: '#access_token=TOK&state=abc&iss=https%3A%2F%2Fevil.example' });
  e.sessionStorage.setItem('mod_state', 'abc');
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ error: 'bad_state' }));
});

t('callback: state одноразовый', () => {
  const e = makeEnv({ hash: '#access_token=TOK&state=abc' });
  e.sessionStorage.setItem('mod_state', 'abc');
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ ok: true }));
  e.location.hash = '#access_token=TOK2&state=abc';
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ error: 'bad_state' }));
});

t('callback: отказ пользователя (?error=access_denied)', () => {
  const e = makeEnv({ search: '?error=access_denied&error_description=x' });
  assert.strictEqual(JSON.stringify(e.app.consumeCallback()), JSON.stringify({ error: 'access_denied' }));
});

t('callback: обычное открытие страницы — null', () => {
  assert.strictEqual(makeEnv().app.consumeCallback(), null);
});

t('getAuth: просроченный токен удаляется', () => {
  const e = makeEnv();
  e.sessionStorage.setItem('mod_auth', JSON.stringify({ token: 'X', expiresAt: Date.now() - 1 }));
  assert.strictEqual(e.app.getAuth(), null);
  assert.strictEqual(e.sessionStorage.getItem('mod_auth'), null);
});

t('getAuth: повреждённые данные не роняют', () => {
  const e = makeEnv();
  e.sessionStorage.setItem('mod_auth', '{не json');
  assert.strictEqual(e.app.getAuth(), null);
});

t('logout очищает токен', () => {
  const e = makeEnv();
  e.sessionStorage.setItem('mod_auth', JSON.stringify({ token: 'X', expiresAt: Date.now() + 1e6 }));
  e.app.logout();
  assert.strictEqual(e.app.getAuth(), null);
});

t('права: администратор, владелец, модератор, обычный участник', () => {
  const g = makeEnv().app.mapGuilds([
    { id: '1', name: 'admin', permissions: '8' },
    { id: '2', name: 'owner', owner: true, permissions: '0' },
    { id: '3', name: 'ban', permissions: '4' },
    { id: '4', name: 'timeout', permissions: '1099511627776' }, // бит 40 (нужен BigInt)
    { id: '5', name: 'member', permissions: '1024' },
    { id: '6', name: 'none' },
  ]);
  const by = Object.fromEntries(g.map((x) => [x.name, x]));
  assert.ok(by.admin.moderated && by.admin.admin && !by.admin.owner);
  assert.ok(by.owner.moderated && by.owner.admin && by.owner.owner);
  assert.ok(by.ban.moderated && !by.ban.admin);
  assert.ok(by.timeout.moderated);
  assert.ok(!by.member.moderated && !by.none.moderated);
});

t('mapGuilds устойчив к не-массиву; иконка и аватар', () => {
  const { app } = makeEnv();
  assert.strictEqual(JSON.stringify(app.mapGuilds(null)), JSON.stringify([]));
  assert.strictEqual(app.mapGuilds([{ id: '7', name: 'x', icon: 'h', permissions: '8' }])[0].icon, 'https://cdn.discordapp.com/icons/7/h.png?size=128');
  assert.match(app.avatarUrl({ id: '5', avatar: 'abc' }), /avatars\/5\/abc\.png/);
  assert.match(app.avatarUrl({ id: '123456789012345678', avatar: null }), /embed\/avatars\/[0-5]\.png/);
});

t('выбранный сервер хранится отдельно для каждого пользователя', () => {
  const { app } = makeEnv();
  app.setSelected('u1', 'g1'); app.setSelected('u2', 'g2');
  assert.strictEqual(app.getSelected('u1'), 'g1');
  assert.strictEqual(app.getSelected('u2'), 'g2');
});

console.log(`\nИтого: ${passed} проверок пройдено`);
