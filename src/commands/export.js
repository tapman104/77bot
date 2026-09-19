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
    const rows = results.map(row => Object.values(row).map(v => {
      let str = String(v);
      if (/^[=+\-@]/.test(str)) {
        str = "'" + str;
      }
      return `"${str.replace(/"/g, '""')}"`;
    }).join(','));
    content = [headers, ...rows].join('\n');
  }

  const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', blob, `reports.${format}`);
  form.append('caption', `📁 Exported ${results.length} reports as ${format.toUpperCase()}.`);

  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (!data.ok) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ Export failed: ${data.description || 'Unknown error'}`);
  }
}
