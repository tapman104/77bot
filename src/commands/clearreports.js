import { sendTelegramMessage } from '../lib/telegram.js';

export async function handleClearReports(chatId, argsStr, env) {
  if (argsStr !== 'confirm') {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ <b>Warning:</b> This will permanently delete ALL stored reports for this group.\n\nType <code>/clearreports confirm</code> to execute.'
    );
    return;
  }

  await env.DB.prepare('DELETE FROM reports WHERE group_id = ?').bind(chatId).run();
  await env.DB.prepare('DELETE FROM user_cooldowns WHERE group_id = ?').bind(chatId).run();

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🗑️ All reports and cooldowns for this group have been permanently cleared.');
}
