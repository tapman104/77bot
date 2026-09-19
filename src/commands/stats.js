import { sendTelegramMessage, escapeHtml, checkIsAdmin } from '../lib/telegram.js';

export async function handleStats(chatId, chatType, senderId, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }
  const summaryRow = await env.DB.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved
    FROM reports WHERE group_id = ?
  `).bind(chatId).first();

  const [topReportedRes, topReportersRes] = await Promise.all([
    env.DB.prepare(`SELECT reported_id, MAX(reported_username) AS reported_username, COUNT(*) AS cnt
      FROM reports WHERE group_id = ? GROUP BY reported_id ORDER BY cnt DESC LIMIT 3`).bind(chatId).all(),
    env.DB.prepare(`SELECT reporter_id, MAX(reporter_username) AS reporter_username, COUNT(*) AS cnt
      FROM reports WHERE group_id = ? GROUP BY reporter_id ORDER BY cnt DESC LIMIT 3`).bind(chatId).all()
  ]);

  const topReported = topReportedRes.results;
  const topReporters = topReportersRes.results;

  let text = `📊 <b>Group Moderation Statistics</b>\n\n` +
    `• <b>Total Reports:</b> ${summaryRow ? summaryRow.total : 0}\n` +
    `• <b>Open Reports:</b> ${summaryRow ? summaryRow.open : 0}\n` +
    `• <b>Resolved Reports:</b> ${summaryRow ? summaryRow.resolved : 0}\n\n` +
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
