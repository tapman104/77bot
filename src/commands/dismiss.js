import { sendTelegramMessage, checkIsAdmin } from '../lib/telegram.js';

export async function handleDismissReport(chatId, reportIdStr, env, userId, chatType) {
  const reportId = parseInt(reportIdStr, 10);
  if (isNaN(reportId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/dismiss &lt;Report ID&gt;</code>');
    return;
  }

  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Report #${reportId} not found.`);
    return;
  }

  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, userId, chatType, env, report.group_id);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ You are not an administrator of the group this report belongs to.');
    return;
  }

  if (report.status === 'resolved' || report.status === 'dismissed') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `ℹ️ Report #${reportId} is already ${report.status}.`);
    return;
  }

  const result = await env.DB.prepare(
    'UPDATE reports SET status = "dismissed", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ?'
  ).bind(reportId, report.group_id).run();

  if (result.meta.changes > 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ Report <b>#${reportId}</b> dismissed.`);
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Failed to update report #${reportId}.`);
  }
}
