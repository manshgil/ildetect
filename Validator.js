require('dotenv').config();
const got = require('got');
const lookup = require('safe-browse-url-lookup');

const eggs = require('./resources/easterEggsDomains.json');
const iploggerServers = require('./resources/iploggerDomains.json');
const userAgents = require('./resources/userAgents.json')

const MSG_IPLOGGER_DETECTED = "‼️По ссылке обнаружен IPLogger. Ни в коем случае не открывайте её, это деанонимизирует вас!";
const MSG_404 = "❗️Невозможно найти страницу по ссылке. Проверка не выполнена.";
const MSG_500 = "❗️Страница по ссылке возвращает ошибку. Проверка не выполнена."
const MSG_LGTM = "✅ IPLogger не обнаружен, но это не является гарантией вашей безопасности. Открывайте на свой страх и риск.";
const MSG_NOT_AN_URL = "ℹ️Это не ссылка.";

const MSG_GOOGLE_SBC_FAIL = "‼️Google Safe Browsing сообщает, что данная страница небезопасна для посещения. Ни в коем случае " +
  "не открывайте её, это может деанонимизировать вас или заразить ваше устройство вирусом!";

// Init google safe browser
const googleLookup = lookup({ apiKey: process.env.GOOGLE_API_KEY });

// Generate pattern string for iplogger domains validation
const iploggerServersPattern = `(${iploggerServers.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;

let logger;

const init = (log) => {
  logger = log;
}

const parseUrlFromText = (text) => {
  const normalizedText = !text ? '' : text.trim();
  if (!text) {
    return false;
  }
  let q = false;
  try {
    q = new URL(normalizedText);
  } catch (e) {}
  return q;
}

// Easter effs validator
const easterEggsValidate = async (ctx, next, url) => {
  if (eggs.filter((domain) => url.hostname.endsWith(domain)).length > 0) {
    return ctx.reply('А вот грязь в меня попрошу не кидать! Я к этим доменам не прикоснусь!');
  }
  return iploggerValidate(ctx, next, url);
}

// Google Safe Browsing APIs (v4) validator
const googleSafeBrowsingValidate = async (ctx, next, url) => {
  let checkOnGoogle = false;

  logger.debug(`googleSafeBrowsingValidate check on ${url}`);

  try {
    checkOnGoogle = await googleLookup.checkSingle(url.toString());
  } catch (e) {
    logger.error(`googleSafeBrowsingValidate error on ${url}`, e);
    return next();
  }

  if (checkOnGoogle) {
    return ctx.reply(MSG_GOOGLE_SBC_FAIL);
  }

  return next();
}

// IPLogger validator
const iploggerValidate = async (ctx, next, url) => {
  logger.debug(`IPLogger surface check on ${url}`);

  if (isIpLoggerUrl(url)) {
    return ctx.reply(MSG_IPLOGGER_DETECTED);
  }

  let hasILLinks = false;
  let hasIlRedirect = false;
  let hasError = false;
  let hasErrorCode = false;
  let response = false;

  try {
    response = await checkIPLoggerRedirect(url.toString());
  } catch (error) {
    hasError = true;
    hasErrorCode = error.response && error.response.statusCode ? error.response.statusCode : false;
    hasIlRedirect = error.message === 'ipLoggerRedirect';
  }

  if (hasIlRedirect) {
    return ctx.reply(MSG_IPLOGGER_DETECTED);
  }

  if (hasError && hasErrorCode && hasErrorCode === 404) {
    return ctx.reply(MSG_404);
  }

  if (hasError && hasErrorCode) {
    return ctx.reply(MSG_500);
  }

  if (hasError) {
    return ctx.reply(MSG_500);
  }

  try {
    hasILLinks = new RegExp(iploggerServersPattern, 'i').test(response.body);
  } catch (error) {}

  if (hasILLinks) {
    return ctx.reply(MSG_IPLOGGER_DETECTED);
  }

  // If all ok
  await ctx.reply(MSG_LGTM);

  return googleSafeBrowsingValidate(ctx, next, url);
}

const isIpLoggerUrl = (url) => {
  if (!url) return false;

  return !!(iploggerServers.find((domain) => url.hostname.endsWith(domain)));
};

const checkIPLoggerRedirect = async (url) => {
  logger.debug(`IPLogger redirect check on ${url}`);

  const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

  const client = got.extend(
    {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8'
      }
    }
  );

  return client(url, {
    timeout: 10000,
    hooks: {
      beforeRedirect: [
        (options, response) => {
          const urlText = response.headers.location;
          if (!urlText) return;
          const url = parseUrlFromText(urlText);

          if (isIpLoggerUrl(url)) {
            throw new Error('ipLoggerRedirect');
          }
        }
      ]
    }
  });
}

const urlValidateFromContext = async (ctx, next) => {
  const { message } = ctx.update || { message: { text: '' } };
  const { text } = message;

  // skip processing if this looks like a bot command
  if (text.startsWith("/")) {
    return next();
  }

  return urlValidateFromMessage(ctx, message.text, next);
}

const urlValidateFromMessage = async (ctx, messageText, next) => {
  const url = parseUrlFromText(messageText);
  return urlValidateFromUrl(ctx, url, next);
}

const urlValidateFromUrl = async (ctx, url, next) => {
  if (!url) {
    return ctx.reply(MSG_NOT_AN_URL);
  }

  return easterEggsValidate(ctx, next, url);
}

module.exports = {
  urlValidateFromContext,
  urlValidateFromMessage,
  init
};