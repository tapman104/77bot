import { sendTelegramMessage } from '../lib/telegram.js';

export async function handleHelp(chatId, env) {
  const text = 
    `🛡️ <b>Telegram Report Bot - Administrator Manual</b>\n\n` +
    `<b>Public Commands:</b>\n` +
    `• <code>/report [reason]</code> - Report user by reply or <code>/report @username [reason]</code>\n\n` +
    `<b>Admin Commands:</b>\n` +
    `• <code>/reports</code> - List open reports\n` +
    `• <code>/view &lt;ID&gt;</code> - View full report details (or <code>/report &lt;ID&gt;</code>)\n` +
    `• <code>/resolve &lt;ID&gt;</code> - Mark report as resolved\n` +
    `• <code>/dismiss &lt;ID&gt;</code> - Dismiss report\n` +
    `• <code>/history @user</code> - View user report history\n` +
    `• <code>/stats</code> - Moderation analytics\n` +
    `• <code>/settings</code> - View & edit group settings\n` +
    `• <code>/export [json|csv]</code> - Export group reports\n` +
    `• <code>/clearreports</code> - Delete all group reports\n` +
    `• <code>/approve user_id</code> - Approve a group admin\n` +
    `• <code>/unapprove user_id</code> - Revoke admin approval\n` +
    `• <code>/admins</code> - List approved group admins\n` +
    `• <code>/help</code> - Show this menu\n\n` +
    `<b>Owner Commands (Private Chat Only):</b>\n` +
    `• <code>/approvegroup &lt;group_id&gt;</code> - Approve a group for bot use\n` +
    `• <code>/revokegroup &lt;group_id&gt;</code> - Revoke group approval & purge data`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
