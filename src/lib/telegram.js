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
  // Owner (in GLOBAL_ADMIN_IDS) always bypasses admin checks
  if (isOwner(userId, env)) {
    return true;
  }

  if (chatType === 'private' && targetGroupId === null) {
    // Non-owner in private chat is denied without a target group
    return false;
  }

  const groupToCheck = targetGroupId || chatId;

  try {
    // Check D1 approved_admins FIRST
    const approvedAdmin = await env.DB.prepare(
      'SELECT user_id FROM approved_admins WHERE group_id = ? AND user_id = ?'
    ).bind(groupToCheck, userId).first();
    
    if (approvedAdmin) {
      return true;
    }

    // Step 1: Telegram admin status check via getChatMember API
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: groupToCheck, user_id: userId })
    });
    const data = await res.json();
    if (!data.ok || !data.result) return false;

    const status = data.result.status;
    const isTgAdmin = status === 'administrator' || status === 'creator';
    if (!isTgAdmin) return false;

    // Step 2: Treat any Telegram admin as approved (Fix 5)
    return true;
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
