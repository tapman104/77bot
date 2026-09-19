import { sendTelegramMessage, escapeHtml, checkIsAdmin } from '../lib/telegram.js';

export async function handleExport(chatId, chatType, senderId, argsStr, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }
  const format = argsStr.toLowerCase() === 'csv' ? 'csv' : 'json';
  const { results } = await env.DB.prepare('SELECT * FROM reports WHERE group_id = ?').bind(chatId).all();

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'ℹ️ No reports to export.');
    return;
  }

  let content = '';
  if (format === 'json') {
    content = JSON.stringify(results, null, 2);
  } else {
    // CSV output
    const headers = Object.keys(results[0]).join(',');
    const rows = results.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    content = [headers, ...rows].join('\n');
  }

  const isTruncated = content.length > 3500;
  const snippet = isTruncated ? content.substring(0, 3500) + '\n... [truncated]' : content;

  let text = '';
  if (isTruncated) {
    text += `⚠️ Output truncated. Full data has ${results.length} rows; only partial content shown. Consider filtering or extracting directly from D1.\n\n`;
  }
  text += `📁 <b>Exported Reports (${format.toUpperCase()}):</b>\n\n<pre>${escapeHtml(snippet)}</pre>`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
