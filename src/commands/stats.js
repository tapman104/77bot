import { sendTelegramMessage, escapeHtml } from '../lib/telegram.js';

export async function handleStats(chatId, env) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ?').bind(chatId).first();
  const openRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ? AND status = "open"').bind(chatId).first();
  const resolvedRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ? AND status = "resolved"').bind(chatId).first();

  const { results: topReported } = await env.DB.prepare(`
    SELECT reported_id, MAX(reported_username) AS reported_username, COUNT(*) AS cnt FROM reports 
    WHERE group_id = ? GROUP BY reported_id ORDER BY cnt DESC LIMIT 3
  `).bind(chatId).all();

  const { results: topReporters } = await env.DB.prepare(`
    SELECT reporter_id, MAX(reporter_username) AS reporter_username, COUNT(*) AS cnt FROM reports 
    WHERE group_id = ? GROUP BY reporter_id ORDER BY cnt DESC LIMIT 3
  `).bind(chatId).all();

  let text = `📊 <b>Group Moderation Statistics</b>\n\n` +
    `• <b>Total Reports:</b> ${totalRow ? totalRow.count : 0}\n` +
    `• <b>Open Reports:</b> ${openRow ? openRow.count : 0}\n` +
    `• <b>Resolved Reports:</b> ${resolvedRow ? resolvedRow.count : 0}\n\n` +
    `<b>Most Reported Users:</b>\n`;

  if (topReported && topReported.length > 0) {
    topReported.forEach(u => { text += `  - ${escapeHtml(u.reported_username)}: ${u.cnt} report(s)\n`; });
  } else {
    text += `  <i>None</i>\n`;
  }

  text += `\n<b>Most Active Reporters:</b>\n`;
  if (topReporters && topReporters.length > 0) {
    topReporters.forEach(u => { text += `  - ${escapeHtml(u.reporter_username)}: ${u.cnt} submission(s)\n`; });
  } else {
    text += `  <i>None</i>\n`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
