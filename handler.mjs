// Обработчик Interactions Endpoint URL для Discord.
// Написан на стандартном Web API (Request / Response / crypto.subtle), поэтому работает без изменений
// в Node 20+, Cloudflare Workers, Deno Deploy и т.п.
//
// Что требует Discord:
//  - каждый запрос подписан Ed25519: заголовки X-Signature-Ed25519 и X-Signature-Timestamp,
//    подписывается строка (timestamp + сырое тело запроса);
//  - на неверную подпись нужно отвечать 401;
//  - на PING (type 1) нужно отвечать PONG ({"type":1}).
// Публичный ключ: Discord Developer Portal -> General Information -> Public Key (он не секретный).

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, AUTOCOMPLETE: 4, MODAL_SUBMIT: 5 };
const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_UPDATE: 6 };
const EPHEMERAL = 64; // сообщение видит только вызвавший

const MAX_BODY = 100 * 1024;

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const keyCache = new Map();
async function importKey(publicKeyHex) {
  if (keyCache.has(publicKeyHex)) return keyCache.get(publicKeyHex);
  const raw = hexToBytes(publicKeyHex);
  if (!raw || raw.length !== 32) throw new Error('DISCORD_PUBLIC_KEY должен быть 64 hex-символа');
  let key;
  try {
    key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    // старое имя алгоритма в некоторых версиях Cloudflare Workers
    key = await crypto.subtle.importKey('raw', raw, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['verify']);
  }
  keyCache.set(publicKeyHex, key);
  return key;
}

/** true, если подпись корректна. Никогда не бросает исключение для плохих входных данных. */
export async function verifySignature(publicKeyHex, signatureHex, timestamp, bodyText) {
  const sig = hexToBytes(signatureHex);
  if (!sig || sig.length !== 64 || !timestamp) return false;
  const key = await importKey(publicKeyHex); // ошибка настройки ключа пробрасывается наверх
  const data = new TextEncoder().encode(String(timestamp) + bodyText);
  const alg = key.algorithm.name === 'Ed25519' ? { name: 'Ed25519' } : { name: 'NODE-ED25519' };
  try {
    return await crypto.subtle.verify(alg, key, sig, data);
  } catch {
    return false;
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

// ---------------------------------------------------------------------------------------------
// Команды. Добавляй свои сюда: ключ — имя слэш-команды (как оно зарегистрировано в Discord).
// ---------------------------------------------------------------------------------------------
const commands = {
  ping: () => ({ content: 'Pong! 🏓' }),
  about: () => ({ content: 'Панель модератора. Подробнее на сайте проекта.', flags: EPHEMERAL }),
};

function handleInteraction(body) {
  switch (body.type) {
    case InteractionType.PING:
      return json({ type: ResponseType.PONG });

    case InteractionType.APPLICATION_COMMAND: {
      const name = body.data && body.data.name;
      const run = Object.prototype.hasOwnProperty.call(commands, name) ? commands[name] : null;
      const data = run ? run(body) : { content: 'Эта команда пока не реализована.', flags: EPHEMERAL };
      return json({ type: ResponseType.CHANNEL_MESSAGE, data });
    }

    case InteractionType.MESSAGE_COMPONENT:
      return json({ type: ResponseType.DEFERRED_UPDATE }); // подтверждаем нажатие, ничего не меняя

    default:
      return json({ type: ResponseType.CHANNEL_MESSAGE, data: { content: 'Неподдерживаемый тип взаимодействия.', flags: EPHEMERAL } });
  }
}

/**
 * Главная функция: (Request, env) -> Response.
 * env: { DISCORD_PUBLIC_KEY, PAGE_URL? }. Если задан PAGE_URL, GET перенаправляет на страницу сайта.
 */
export async function handleRequest(request, env = {}) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (env.PAGE_URL) return Response.redirect(env.PAGE_URL, 302);
    return new Response('Interactions endpoint is running.', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD, POST' } });
  }
  if (!env.DISCORD_PUBLIC_KEY) {
    console.error('DISCORD_PUBLIC_KEY не задан');
    return new Response('Server misconfigured', { status: 500 });
  }

  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_BODY) return new Response('Payload Too Large', { status: 413 });

  const bodyText = await request.text(); // сырое тело: подпись считается именно по нему
  if (bodyText.length > MAX_BODY) return new Response('Payload Too Large', { status: 413 });

  let valid;
  try {
    valid = await verifySignature(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get('x-signature-ed25519'),
      request.headers.get('x-signature-timestamp'),
      bodyText
    );
  } catch (e) {
    console.error('Ошибка проверки подписи:', e.message);
    return new Response('Server misconfigured', { status: 500 });
  }
  if (!valid) return new Response('Invalid request signature', { status: 401 });

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  try {
    return handleInteraction(body);
  } catch (e) {
    console.error('Ошибка обработки взаимодействия:', e);
    return json({ type: ResponseType.CHANNEL_MESSAGE, data: { content: 'Внутренняя ошибка.', flags: EPHEMERAL } });
  }
}
