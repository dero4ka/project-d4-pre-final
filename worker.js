// Cloudflare Workers: та же логика. Деплой: `npx wrangler deploy` из папки endpoint/.
// Public Key уже указан в endpoint/config.mjs (он не секретный). При желании его можно переопределить:
//   npx wrangler secret put DISCORD_PUBLIC_KEY      (или добавить в Settings → Variables)
// Необязательно: PAGE_URL — адрес страницы сайта (например на GitHub Pages), куда браузер
// будет перенаправлен при открытии адреса endpoint.
import { handleRequest } from './handler.mjs';
import { PUBLIC_KEY } from './config.mjs';

export default {
  fetch(request, env) {
    // Ключ из переменной окружения Worker имеет приоритет, иначе берётся из endpoint/config.mjs
    return handleRequest(request, { ...env, DISCORD_PUBLIC_KEY: env.DISCORD_PUBLIC_KEY || PUBLIC_KEY });
  },
};
