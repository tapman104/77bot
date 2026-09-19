import { sendTelegramMessage, escapeHtml, checkIsAdmin } from '../lib/telegram.js';

export async function handleApproveAdmin(chatId, chatType, senderId, msg, argsStr, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }

  if (chatType === 'private') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in a group chat.');
    return;
  }

  let targetUserId = null;
  const cleanArgs = argsStr.trim();

  if (/^-?\d+$/.test(cleanArgs)) {
    targetUserId = parseInt(cleanArgs, 10);
  } else if (msg.reply_to_message && msg.reply_to_message.from) {
    targetUserId = msg.reply_to_message.from.id;
  }

  if (!targetUserId || isNaN(targetUserId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/approve user_id</code> or reply to a user.');
    return;
  }

  // 2. Check if already approved
  const existing = await env.DB.prepare(
    'SELECT user_id FROM approved_admins WHERE group_id = ? AND user_id = ?'
  ).bind(chatId, targetUserId).first();

  if (existing) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `ℹ️ User ${targetUserId} is already an approved admin.`);
    return;
  }

  // 3. Insert into approved_admins
  await env.DB.prepare(`
    INSERT INTO approved_admins (group_id, user_id, approved_by) VALUES (?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET approved_by = excluded.approved_by, approved_at = CURRENT_TIMESTAMP
  `).bind(chatId, targetUserId, senderId).run();

  const approverUsername = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || `User ${senderId}`);
  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ User ${targetUserId} approved as bot moderator by ${escapeHtml(approverUsername)}.`
  );
}

export async function handleUnapproveAdmin(chatId, chatType, senderId, msg, argsStr, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }

  if (chatType === 'private') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in a group chat.');
    return;
  }

  let targetUserId = null;
  const cleanArgs = argsStr.trim();

  if (/^-?\d+$/.test(cleanArgs)) {
    targetUserId = parseInt(cleanArgs, 10);
  } else if (msg.reply_to_message && msg.reply_to_message.from) {
    targetUserId = msg.reply_to_message.from.id;
  }

  if (!targetUserId || isNaN(targetUserId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/unapprove user_id</code> or reply to a user.');
    return;
  }

  await env.DB.prepare(
    'DELETE FROM approved_admins WHERE group_id = ? AND user_id = ?'
  ).bind(chatId, targetUserId).run();

  let isStillTgAdmin = false;
  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: targetUserId })
    });
    const data = await res.json();
    if (data.ok && data.result) {
      const status = data.result.status;
      isStillTgAdmin = status === 'administrator' || status === 'creator';
    }
  } catch (err) {
    console.error('getChatMember failed in handleUnapproveAdmin:', err);
  }

  let text = `🗑️ Admin approval for ${targetUserId} revoked.`;
  if (isStillTgAdmin) {
    text += `\n⚠️ Note: This user is still a Telegram admin of this group and retains access through Telegram admin status.`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

export async function handleListAdmins(chatId, chatType, senderId, env) {
  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env, chatId);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    return;
  }

  if (chatType === 'private') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in a group chat.');
    return;
  }

  const { results } = await env.DB.prepare(
    'SELECT user_id, approved_by, approved_at FROM approved_admins WHERE group_id = ? ORDER BY approved_at ASC'
  ).bind(chatId).all();

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '👥 <b>Approved Admins:</b>\n<i>None</i>');
    return;
  }

  let text = '👥 <b>Approved Admins:</b>\n';
  for (const admin of results) {
    text += `• ${admin.user_id} (approved by ${admin.approved_by} on ${admin.approved_at})\n`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
