// Запуск обработчика как обычного Node-сервера (VPS, Render, Railway, Replit и т.п.). Зависимостей нет.
//   DISCORD_PUBLIC_KEY=... node endpoint/node.mjs
// Адрес для Discord: https://ТВОЙ-ДОМЕН/interactions  (Discord требует HTTPS: поставь сервер за прокси
// хостинга или nginx/Caddy; для локальной проверки можно использовать туннель).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest } from './handler.mjs';
import { PUBLIC_KEY } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(here, '..', 'interactions.html');
const MAX_BODY = 100 * 1024;

export function createServer(rawEnv = process.env) {
  const env = { ...rawEnv, DISCORD_PUBLIC_KEY: rawEnv.DISCORD_PUBLIC_KEY || PUBLIC_KEY };
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const isEndpoint = url.pathname === '/' || url.pathname === '/interactions';

    if (!isEndpoint) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found'); }

    // Страница с бесконечностью для браузера
    if ((req.method === 'GET' || req.method === 'HEAD') && fs.existsSync(PAGE)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(PAGE));
    }

    // Читаем тело целиком как байты, не разбирая его: подпись считается по сырому тексту
    const chunks = []; let size = 0; let tooBig = false;
    if (req.method === 'POST') {
      for await (const c of req) { size += c.length; if (size > MAX_BODY) { tooBig = true; break; } chunks.push(c); }
      if (tooBig) { res.writeHead(413); return res.end('Payload Too Large'); }
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    const request = new Request(url, { method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });

    try {
      const r = await handleRequest(request, env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.error(e);
      res.writeHead(500); res.end('Internal Server Error');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8787;
  createServer().listen(port, () => {
    console.log(`Interactions endpoint: http://localhost:${port}/interactions`);
    if (!process.env.DISCORD_PUBLIC_KEY) console.log('Публичный ключ взят из endpoint/config.mjs (можно переопределить переменной DISCORD_PUBLIC_KEY)');
  });
}
