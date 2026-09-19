import { sendTelegramMessage, escapeHtml, checkIsAdmin } from '../lib/telegram.js';

export async function handleUserHistory(chatId, msg, argsStr, env) {
  const chatType = msg.chat.type;

  if (chatType !== 'private') {
    const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, chatType, env);
    if (!isAdmin) return;
  }

  let targetQuery = argsStr.trim();
  if (msg.reply_to_message) {
    const u = msg.reply_to_message.from;
    targetQuery = u.username ? `@${u.username}` : String(u.id);
  }

  if (!targetQuery) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/history @username</code> or reply to a user.');
    return;
  }

  // Fix 4 (Audit): Conditional querying to separate numeric ID lookups from username searches
  const cleanTarget = targetQuery.replace('@', '');
  const isNumeric = /^\d+$/.test(cleanTarget);

  let results;
  if (chatType === 'private') {
    if (isNumeric) {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at, group_name FROM reports
        WHERE reported_id = ?
        ORDER BY id DESC LIMIT 20
      `).bind(parseInt(cleanTarget, 10)).all());
    } else {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at, group_name FROM reports
        WHERE reported_username = ?
        ORDER BY id DESC LIMIT 20
      `).bind(`@${cleanTarget}`).all());
    }
  } else {
    if (isNumeric) {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at FROM reports
        WHERE group_id = ? AND reported_id = ?
        ORDER BY id DESC LIMIT 10
      `).bind(chatId, parseInt(cleanTarget, 10)).all());
    } else {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at FROM reports
        WHERE group_id = ? AND reported_username = ?
        ORDER BY id DESC LIMIT 10
      `).bind(chatId, `@${cleanTarget}`).all());
    }
  }

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `ℹ️ No report history found for <b>${escapeHtml(targetQuery)}</b>.`);
    return;
  }

  let text = `📜 <b>Report History for ${escapeHtml(targetQuery)}:</b>\n\n`;
  for (const r of results) {
    if (chatType === 'private') {
      text += `• <b>#${r.id}</b> | Group: ${escapeHtml(r.group_name)} | Status: ${r.status} | Reason: ${escapeHtml(r.reason)} (${r.created_at})\n`;
    } else {
      text += `• <b>#${r.id}</b> | Status: ${r.status} | Reason: ${escapeHtml(r.reason)} (${r.created_at})\n`;
    }
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
