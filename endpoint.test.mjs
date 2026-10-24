// Запуск: npm test. Настоящие подписи Ed25519 (генерируются на лету), реальный HTTP-сервер.
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import { handleRequest, verifySignature } from '../endpoint/handler.mjs';
import { createServer } from '../endpoint/node.mjs';
import { PUBLIC_KEY } from '../endpoint/config.mjs';
import worker from '../endpoint/worker.js';
import fs from 'node:fs';

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log('PASS ', name); };

// Пара ключей Ed25519; публичный ключ в «сыром» виде (32 байта) как показывает Discord
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
const other = crypto.generateKeyPairSync('ed25519');

const sign = (ts, body, key = privateKey) => crypto.sign(null, Buffer.from(ts + body), key).toString('hex');
const env = { DISCORD_PUBLIC_KEY: PUB };
const post = (body, { ts = String(Math.floor(Date.now() / 1000)), sig, headers = {} } = {}) =>
  new Request('https://x.test/interactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature-timestamp': ts, 'x-signature-ed25519': sig ?? sign(ts, body), ...headers },
    body,
  });
const PING = JSON.stringify({ type: 1, id: '1', application_id: '2', version: 1 });
const cmd = (name) => JSON.stringify({ type: 2, id: '1', data: { name } });

await t('verifySignature: верная подпись принимается', async () => {
  assert.strictEqual(await verifySignature(PUB, sign('123', 'abc'), '123', 'abc'), true);
});
await t('verifySignature: изменённое тело / timestamp / чужой ключ отвергаются', async () => {
  const s = sign('123', 'abc');
  assert.strictEqual(await verifySignature(PUB, s, '123', 'abd'), false);
  assert.strictEqual(await verifySignature(PUB, s, '124', 'abc'), false);
  assert.strictEqual(await verifySignature(PUB, sign('123', 'abc', other.privateKey), '123', 'abc'), false);
});
await t('verifySignature: мусор в подписи не бросает исключение', async () => {
  for (const bad of [undefined, null, '', 'zz', 'ab', 'a'.repeat(128), '0'.repeat(128)]) assert.strictEqual(await verifySignature(PUB, bad, '1', 'x'), false);
  assert.strictEqual(await verifySignature(PUB, sign('1', 'x'), '', 'x'), false);
});
await t('PING → PONG {"type":1}', async () => {
  const r = await handleRequest(post(PING), env);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await r.json(), { type: 1 });
});
await t('неверная подпись → 401', async () => {
  assert.strictEqual((await handleRequest(post(PING, { sig: sign('1', PING, other.privateKey) }), env)).status, 401);
});
await t('подпись от другого тела → 401 (подмена содержимого)', async () => {
  const ts = '555';
  assert.strictEqual((await handleRequest(post(cmd('ping'), { ts, sig: sign(ts, PING) }), env)).status, 401);
});
await t('нет заголовков подписи → 401', async () => {
  const r = await handleRequest(new Request('https://x.test/', { method: 'POST', body: PING }), env);
  assert.strictEqual(r.status, 401);
});
await t('команда /ping → сообщение', async () => {
  const j = await (await handleRequest(post(cmd('ping')), env)).json();
  assert.strictEqual(j.type, 4); assert.match(j.data.content, /Pong/);
});
await t('неизвестная команда → ephemeral-ответ; имена вроде "constructor" не исполняются', async () => {
  for (const n of ['nope', 'constructor', '__proto__', 'toString']) {
    const j = await (await handleRequest(post(cmd(n)), env)).json();
    assert.strictEqual(j.type, 4); assert.strictEqual(j.data.flags, 64);
  }
});
await t('кнопка (type 3) → DEFERRED_UPDATE (6)', async () => {
  assert.deepStrictEqual(await (await handleRequest(post(JSON.stringify({ type: 3 })), env)).json(), { type: 6 });
});
await t('валидная подпись, но не JSON → 400', async () => {
  assert.strictEqual((await handleRequest(post('{не json'), env)).status, 400);
});
await t('GET → страница/сообщение, PAGE_URL → редирект, PUT → 405', async () => {
  assert.strictEqual((await handleRequest(new Request('https://x.test/'), env)).status, 200);
  const rd = await handleRequest(new Request('https://x.test/'), { ...env, PAGE_URL: 'https://p.test/interactions.html' });
  assert.strictEqual(rd.status, 302); assert.strictEqual(rd.headers.get('location'), 'https://p.test/interactions.html');
  assert.strictEqual((await handleRequest(new Request('https://x.test/', { method: 'PUT' }), env)).status, 405);
});
await t('ключ не задан → 500, ключ неверной длины → 500 (не 200)', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    assert.strictEqual((await handleRequest(post(PING), {})).status, 500);
    assert.strictEqual((await handleRequest(post(PING), { DISCORD_PUBLIC_KEY: 'abcd' })).status, 500);
  } finally { console.error = quiet; }
});
await t('слишком большое тело → 413', async () => {
  const big = JSON.stringify({ type: 2, data: { name: 'x'.repeat(120 * 1024) } });
  assert.strictEqual((await handleRequest(post(big), env)).status, 413);
});

// ---- настоящий HTTP-сервер (как его увидит Discord) ----
const server = createServer(env);
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
const httpPost = async (url, body, extra = {}) => {
  const ts = String(Math.floor(Date.now() / 1000));
  return fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-signature-ed25519': sign(ts, body), 'x-signature-timestamp': ts, ...extra }, body });
};
await t('HTTP: PING на /interactions → 200 {"type":1}', async () => {
  const r = await httpPost('/interactions', PING);
  assert.strictEqual(r.status, 200); assert.deepStrictEqual(await r.json(), { type: 1 });
});
await t('HTTP: PING на / тоже работает; с кириллицей в теле подпись сходится', async () => {
  assert.strictEqual((await httpPost('/', PING)).status, 200);
  const j = await (await httpPost('/interactions', JSON.stringify({ type: 2, data: { name: 'ping', options: [{ value: 'Привет, мир 🌍' }] } }))).json();
  assert.strictEqual(j.type, 4);
});
await t('HTTP: неверная подпись → 401', async () => {
  const ts = '1';
  const r = await fetch(base + '/interactions', { method: 'POST', headers: { 'x-signature-ed25519': sign(ts, 'other'), 'x-signature-timestamp': ts }, body: PING });
  assert.strictEqual(r.status, 401);
});
await t('HTTP: GET отдаёт страницу с бесконечностью', async () => {
  const r = await fetch(base + '/interactions');
  const html = await r.text();
  assert.strictEqual(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.match(html, /<canvas id="c"/);
});
await t('HTTP: чужие пути → 404, огромное тело → 413', async () => {
  assert.strictEqual((await fetch(base + '/.env')).status, 404);
  assert.strictEqual((await fetch(base + '/../package.json')).status, 404);
  const big = 'x'.repeat(200 * 1024);
  const r = await httpPost('/interactions', big).catch(() => null);
  assert.ok(r === null || r.status === 413);
});
server.close();

// ---- настоящий публичный ключ бота из конфигурации ----
await t('PUBLIC_KEY в endpoint/config.mjs и в config.js одинаковый и валидный Ed25519', async () => {
  assert.match(PUBLIC_KEY, /^[0-9a-f]{64}$/);
  const m = fs.readFileSync(new URL('../config.js', import.meta.url), 'utf8').match(/PUBLIC_KEY:\s*'([0-9a-f]{64})'/);
  assert.ok(m, 'в config.js нет PUBLIC_KEY');
  assert.strictEqual(m[1], PUBLIC_KEY);
  await crypto.subtle.importKey('raw', Buffer.from(PUBLIC_KEY, 'hex'), { name: 'Ed25519' }, false, ['verify']);
});
await t('Worker без переменных использует ключ из config.mjs: чужая подпись → 401 (а не 500)', async () => {
  const r = await worker.fetch(post(PING), {}); // подписано НЕ ключом бота
  assert.strictEqual(r.status, 401);
});
await t('Node-сервер без DISCORD_PUBLIC_KEY тоже берёт ключ из config.mjs → 401 на чужую подпись', async () => {
  const s = createServer({}); await new Promise((r) => s.listen(0, r));
  try {
    const ts = '1';
    const r = await fetch(`http://127.0.0.1:${s.address().port}/interactions`, { method: 'POST', headers: { 'x-signature-ed25519': sign(ts, PING), 'x-signature-timestamp': ts }, body: PING });
    assert.strictEqual(r.status, 401);
  } finally { s.close(); }
});
await t('переменная окружения переопределяет ключ из config.mjs', async () => {
  const r = await worker.fetch(post(PING), { DISCORD_PUBLIC_KEY: PUB }); // теперь подпись нашим тестовым ключом верна
  assert.strictEqual(r.status, 200);
});

console.log(`\nИтого: ${passed} проверок пройдено`);
