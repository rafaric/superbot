import TelegramBot from 'node-telegram-bot-api';

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let bot = null;

// Callback handler registry — set by initBot caller
let onCallback = null;

let closeHandler = null;

export function setCloseHandler(fn) { closeHandler = fn; }

export function initBot(handlers, callbackHandler) {
  if (!TOKEN || !CHAT_ID) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — bot disabled');
    return null;
  }

  onCallback = callbackHandler;

  // Delete webhook AND reset allowed_updates before starting polling
  const cleanUrl = `https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true`;
  fetch(cleanUrl)
    .then((r) => r.json())
    .then((data) => {
      console.log('[Telegram] deleteWebhook:', data.ok ? 'OK' : data.description);
      return fetch(`https://api.telegram.org/bot${TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: '', allowed_updates: ['message', 'callback_query'] }),
      });
    })
    .then((r) => r.json())
    .then((data) => {
      console.log('[Telegram] setWebhook reset:', data.ok ? 'OK' : data.description);
      startPolling(handlers);
    })
    .catch((err) => {
      console.warn('[Telegram] Webhook cleanup error:', err.message);
      startPolling(handlers);
    });

  return { send, sendWithButtons };
}

function startPolling(handlers) {
  bot = new TelegramBot(TOKEN, {
    polling: {
      interval: 1000,
      autoStart: true,
      params: { timeout: 10, allowed_updates: ['message', 'callback_query'] },
    },
  });

  console.log('[Telegram] Polling started');

  // ── Text commands ──────────────────────────────────────────────────────────
  bot.on('message', (msg) => {
    console.log(`[Telegram] ← chat_id=${msg.chat.id} text="${msg.text}"`);
    if (String(msg.chat.id) !== String(CHAT_ID)) return;

    const text     = (msg.text ?? '').trim();
    const spaceIdx = text.indexOf(' ');
    const cmd      = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args     = spaceIdx === -1 ? [] : text.slice(spaceIdx + 1).trim().split(/\s+/);

    const handler = handlers[cmd];
    if (handler) {
      handler(args, msg).catch((err) => {
        console.error(`[Telegram] Handler error for "${cmd}":`, err.message);
        send(`⚠️ Error: ${esc(err.message)}`);
      });
    }
  });

  // ── Inline button callbacks ────────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    if (String(query.message.chat.id) !== String(CHAT_ID)) return;

    const data = query.data;
    console.log(`[Telegram] Callback: "${data}"`);

    // Always answer the callback to remove the loading spinner on the button
    await bot.answerCallbackQuery(query.id).catch(() => {});

    if (data === 'ignore') {
      // Edit message to show it was ignored
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      ).catch(() => {});
      send('❌ Señal ignorada\\.');
      return;
    }

    if (data.startsWith('close|') && closeHandler) {
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: '⏳ Cerrando...', callback_data: 'noop' }]] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      ).catch(() => {});

      try {
        await closeHandler(data);
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      } catch (err) {
        console.error('[Telegram] Close error:', err.message);
        send(`❌ Error al cerrar: ${esc(err.message)}`);
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      }
      return;
    }

    if (data.startsWith('exec|') && onCallback) {
      // Disable buttons immediately to prevent double-tap
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [[{ text: '⏳ Ejecutando...', callback_data: 'noop' }]] },
        { chat_id: query.message.chat.id, message_id: query.message.message_id }
      ).catch(() => {});

      try {
        await onCallback(data);
        // Remove buttons after execution
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      } catch (err) {
        console.error('[Telegram] Callback execution error:', err.message);
        send(`❌ Error al ejecutar orden: ${esc(err.message)}`);
        // Restore original buttons on error
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          { chat_id: query.message.chat.id, message_id: query.message.message_id }
        ).catch(() => {});
      }
    }
  });

  bot.on('polling_error', (err) => {
    console.error(`[Telegram] Polling error ${err.code}: ${err.message}`);
    // ECONNRESET / EFATAL = network dropped — restart polling after delay
    if (err.code === 'EFATAL' || err.code === 'ECONNRESET') {
      console.log('[Telegram] Connection lost — restarting polling in 10s...');
      bot.stopPolling().catch(() => {});
      setTimeout(() => {
        bot.startPolling({ params: { timeout: 10, allowed_updates: ['message', 'callback_query'] } })
          .catch((e) => console.error('[Telegram] Restart polling error:', e.message));
        console.log('[Telegram] Polling restarted');
      }, 10000);
    }
  });
}

// ─── Send plain message ────────────────────────────────────────────────────────
export function send(text) {
  if (!bot || !CHAT_ID) return;
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    bot.sendMessage(CHAT_ID, chunk, { parse_mode: 'HTML' })
      .catch((err) => console.error('[Telegram] Send error:', err.message));
  }
}

// ─── Send message with inline keyboard buttons ────────────────────────────────
export function sendWithButtons(text, buttons) {
  if (!bot || !CHAT_ID) return;
  bot.sendMessage(CHAT_ID, text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: buttons },
  }).catch((err) => console.error('[Telegram] SendWithButtons error:', err.message));
}

// HTML mode: only escape &, <, >
export function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isEnabled() {
  return !!bot;
}
