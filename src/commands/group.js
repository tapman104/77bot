import { sendTelegramMessage } from '../lib/telegram.js';
import { isOwner } from '../lib/owner.js';

export async function handleApproveGroup(chatId, chatType, senderId, argsStr, env) {
  if (chatType !== 'private') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in private chat.');
    return;
  }

  if (!isOwner(senderId, env)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to the bot owner.');
    return;
  }

  const groupId = parseInt(argsStr.trim(), 10);
  if (isNaN(groupId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/approvegroup &lt;group_id&gt;</code>');
    return;
  }

  await env.DB.prepare(`
    INSERT INTO approved_groups (group_id, approved_by) VALUES (?, ?)
    ON CONFLICT(group_id) DO UPDATE SET approved_by = excluded.approved_by, approved_at = CURRENT_TIMESTAMP
  `).bind(groupId, senderId).run();

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Group <code>${groupId}</code> is now approved.`);
}

export async function handleRevokeGroup(chatId, chatType, senderId, argsStr, env) {
  if (chatType !== 'private') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in private chat.');
    return;
  }

  if (!isOwner(senderId, env)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to the bot owner.');
    return;
  }

  const groupId = parseInt(argsStr.trim(), 10);
  if (isNaN(groupId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/revokegroup &lt;group_id&gt;</code>');
    return;
  }

  await env.DB.prepare('DELETE FROM approved_groups WHERE group_id = ?').bind(groupId).run();
  await env.DB.prepare('DELETE FROM reports WHERE group_id = ?').bind(groupId).run();
  await env.DB.prepare('DELETE FROM group_settings WHERE group_id = ?').bind(groupId).run();
  await env.DB.prepare('DELETE FROM user_cooldowns WHERE group_id = ?').bind(groupId).run();
  await env.DB.prepare('DELETE FROM approved_admins WHERE group_id = ?').bind(groupId).run();

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ Group <code>${groupId}</code> revoked and all data purged.`);
}
