import { sendTelegramMessage, escapeHtml } from '../lib/telegram.js';

export async function handleListReports(chatId, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, reported_username, reason, created_at FROM reports WHERE group_id = ? AND status = "open" ORDER BY id DESC LIMIT 10'
  ).bind(chatId).all();

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ No open reports found for this group.');
    return;
  }

  let text = '📋 <b>Open Reports:</b>\n\n';
  for (const r of results) {
    text += `• <b>#${r.id}</b> | User: ${escapeHtml(r.reported_username)} | Reason: <i>${escapeHtml(r.reason)}</i>\n`;
  }
  text += '\nUse <code>/report &lt;Report ID&gt;</code> or <code>/view &lt;Report ID&gt;</code> to view details.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
