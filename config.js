// Настройки сайта. Здесь нет секретов: Client ID и Public Key приложения Discord публичные.
// Client Secret и токен бота сюда вставлять НЕЛЬЗЯ: этот файл виден всем.
window.APP_CONFIG = {
  // Application ID из https://discord.com/developers/applications (General Information)
  CLIENT_ID: '1563552139064639528',

  // Public Key бота (General Information). Нужен endpoint интеракций (endpoint/), сайт им не пользуется.
  // То же значение лежит в endpoint/config.mjs: при смене меняй в обоих местах (тест это проверяет).
  PUBLIC_KEY: '2591efe525f83833812e151404de37ecf440aeeb987944885ee6c796b32b230a',

  // Необязательно. Если пусто, берётся адрес страницы dashboard.html рядом с index.html,
  // например https://ИМЯ.github.io/РЕПОЗИТОРИЙ/dashboard.html
  // Этот адрес нужно добавить в Discord Developer Portal -> OAuth2 -> Redirects (точное совпадение).
  REDIRECT_URI: '',
};
