import { sendTelegramMessage, escapeHtml, checkIsAdmin } from '../lib/telegram.js';

export async function handleListReports(chatId, chatType, senderId, argsStr, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }
  let page = 1;
  if (argsStr && /^\d+$/.test(argsStr.trim())) {
    page = parseInt(argsStr.trim(), 10);
    if (page < 1) page = 1;
  }

  const limit = 10;
  const offset = (page - 1) * limit;

  const countResult = await env.DB.prepare(
    'SELECT COUNT(*) as total FROM reports WHERE group_id = ? AND status = "open"'
  ).bind(chatId).first();
  const total = countResult ? countResult.total : 0;

  if (total === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ No open reports found for this group.');
    return;
  }

  const { results } = await env.DB.prepare(
    'SELECT id, reported_username, reason, created_at FROM reports WHERE group_id = ? AND status = "open" ORDER BY id DESC LIMIT ? OFFSET ?'
  ).bind(chatId, limit, offset).all();

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ No open reports found on page ${page}.`);
    return;
  }

  const startIdx = offset + 1;
  const endIdx = offset + results.length;

  let text = '📋 <b>Open Reports:</b>\n\n';
  for (const r of results) {
    text += `• <b>#${r.id}</b> | User: ${escapeHtml(r.reported_username)} | Reason: <i>${escapeHtml(r.reason)}</i>\n`;
  }
  
  text += `\nPage ${page} — showing ${startIdx}–${endIdx} of ${total} reports.`;
  if (total > endIdx) {
    text += `\nUse /reports ${page + 1} for next page.`;
  }
  text += '\nUse <code>/report &lt;Report ID&gt;</code> or <code>/view &lt;Report ID&gt;</code> to view details.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
