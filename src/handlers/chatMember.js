import { sendTelegramMessage, escapeHtml } from '../lib/telegram.js';

export async function handleChatMemberUpdate(update, env) {
  const chatId = update.chat.id;
  const groupTitle = update.chat.title || String(chatId);
  const actor = update.from;
  const target = update.new_chat_member.user;
  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;

  const botIdStr = env.TELEGRAM_BOT_TOKEN.split(':')[0];
  if (String(target.id) === botIdStr) return;

  const approvedGroup = await env.DB.prepare(
    'SELECT group_id FROM approved_groups WHERE group_id = ?'
  ).bind(chatId).first();
  if (!approvedGroup) return;

  const isKick   = newStatus === 'kicked' && oldStatus !== 'kicked';
  const isMute   = newStatus === 'restricted' && oldStatus !== 'restricted';
  const isUnmute = oldStatus === 'restricted' && (newStatus === 'member' || newStatus === 'administrator');
  const isUnban  = oldStatus === 'kicked'     && (newStatus === 'member' || newStatus === 'left');

  let emoji, action;
  if      (isKick)   { emoji = '🔨'; action = 'Banned/Kicked'; }
  else if (isMute)   { emoji = '🔇'; action = 'Muted/Restricted'; }
  else if (isUnmute) { emoji = '🔊'; action = 'Unmuted'; }
  else if (isUnban)  { emoji = '✅'; action = 'Unbanned'; }
  else return;

  const actorLink = actor.username
    ? `@${actor.username}`
    : `<a href="tg://user?id=${actor.id}">${escapeHtml(actor.first_name || 'Admin')}</a>`;
  const targetLink = target.username
    ? `@${target.username}`
    : `<a href="tg://user?id=${target.id}">${escapeHtml(target.first_name || 'User')}</a>`;

  let durationLine = '';
  if (isMute && update.new_chat_member.until_date) {
    const until = new Date(update.new_chat_member.until_date * 1000).toUTCString();
    durationLine = `\n⏰ <b>Until:</b> ${until}`;
  }

  const alertText =
    `${emoji} <b>Admin Action: ${action}</b>\n\n` +
    `👮 <b>By:</b> ${actorLink}\n` +
    `👤 <b>Target:</b> ${targetLink}` +
    durationLine +
    `\n📌 <b>Group:</b> ${escapeHtml(groupTitle)}`;

  let adminIds = [];
  const { results: approvedAdmins } = await env.DB.prepare(
    'SELECT user_id FROM approved_admins WHERE group_id = ?'
  ).bind(chatId).all();

  if (approvedAdmins && approvedAdmins.length > 0) {
    adminIds = approvedAdmins.map(a => a.user_id);
  } else {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatAdministrators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId })
    });
    const data = await res.json();
    if (data.ok && data.result) {
      for (const a of data.result) {
        if (!a.user.is_bot && !a.is_anonymous) adminIds.push(a.user.id);
      }
    }
  }

  for (const adminId of adminIds) {
    try {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, adminId, alertText);
    } catch (e) {
      console.error(`Failed DM to admin ${adminId}:`, e);
    }
  }
}
