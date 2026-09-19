import { isOwner } from './owner.js';

/**
 * Helper: Send Telegram API Message
 */
export async function sendTelegramMessage(botToken, chatId, text, replyToMessageId = null, parseMode = 'HTML') {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode,
    disable_web_page_preview: true
  };
  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

/**
 * Helper: Verify Admin Status (Telegram admin check + D1 approved_admins check)
 */
export async function checkIsAdmin(botToken, chatId, userId, chatType, env, targetGroupId = null) {
  // 1. Owner bypass
  if (isOwner(userId, env)) {
    return true;
  }

  const groupToCheck = targetGroupId ?? chatId;

  // 2. Query approved_admins
  try {
    const approvedAdmin = await env.DB.prepare(
      'SELECT user_id FROM approved_admins WHERE group_id = ? AND user_id = ?'
    ).bind(groupToCheck, userId).first();
    
    if (approvedAdmin) {
      return true;
    }
  } catch (err) {
    console.error('Admin DB check failed:', err);
  }

  // 3. If targetGroupId is null and chatType is private -> return false
  if (chatType === 'private' && targetGroupId === null) {
    return false;
  }

  // 4, 5, 6. getChatMember check against targetGroupId (groupToCheck)
  try {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: groupToCheck, user_id: userId })
    });
    const data = await res.json();
    if (!data.ok || !data.result) return false;

    const status = data.result.status;
    return status === 'administrator' || status === 'creator';
  } catch (err) {
    console.error('Admin check failed:', err);
    return false;
  }
}

/**
 * Helper: Escape HTML string
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
