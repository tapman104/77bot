import { sendTelegramMessage, checkIsAdmin } from '../lib/telegram.js';
import { getGroupSettings } from '../lib/settings.js';

export async function handleSettings(chatId, chatType, senderId, argsStr, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }
  const current = await getGroupSettings(env.DB, chatId);

  if (!argsStr) {
    const text = 
      `⚙️ <b>Group Settings</b>\n\n` +
      `• <b>Cooldown:</b> ${current.cooldown_seconds}s\n` +
      `• <b>Ignore Bots:</b> ${current.ignore_bots ? 'Yes' : 'No'}\n` +
      `• <b>Notification Destination:</b> ${current.notification_chat_id || 'Current Group'}\n\n` +
      `<i>To update settings, use:</i>\n` +
      `<code>/settings cooldown 300</code>\n` +
      `<code>/settings ignore_bots 1</code>\n` +
      `<code>/settings notification_chat -100123456789</code>`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
    return;
  }

  const parts = argsStr.split(' ');
  const key = parts[0].toLowerCase();
  const val = parts[1];

  // Fix 5 (Audit): Added updated_at = CURRENT_TIMESTAMP to all DO UPDATE SET clauses
  if (key === 'cooldown' && !isNaN(val)) {
    const cd = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, cooldown_seconds) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET cooldown_seconds = excluded.cooldown_seconds, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, cd).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Cooldown updated to ${cd} seconds.`);
  } else if (key === 'ignore_bots' && (val === '0' || val === '1')) {
    const ib = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, ignore_bots) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET ignore_bots = excluded.ignore_bots, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, ib).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Ignore bots updated to ${ib === 1 ? 'Yes (1)' : 'No (0)'}.`);
  } else if (key === 'notification_chat' && !isNaN(val)) {
    const destId = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, notification_chat_id) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET notification_chat_id = excluded.notification_chat_id, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, destId).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Notification destination set to <code>${destId}</code>.`);
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Invalid setting key or value.');
  }
}
