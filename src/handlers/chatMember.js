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
  if (String(actor.id) === botIdStr) return;

  const approvedGroup = await env.DB.prepare(
    'SELECT group_id FROM approved_groups WHERE group_id = ?'
  ).bind(chatId).first();
  if (!approvedGroup) return;

  const isKick   = newStatus === 'kicked' && oldStatus !== 'kicked';
  const newRestricted = update.new_chat_member;
  const oldRestricted = update.old_chat_member;
  const isMute = newStatus === 'restricted' &&
    newRestricted.can_send_messages === false &&
    !(oldStatus === 'restricted' && oldRestricted.can_send_messages === false);
  const wasActuallyMuted = update.old_chat_member.can_send_messages === false;
  const isUnmute = oldStatus === 'restricted' && wasActuallyMuted &&
    (newStatus === 'member' || newStatus === 'administrator' ||
     (newStatus === 'restricted' && update.new_chat_member.can_send_messages === true));
  const isUnban  = oldStatus === 'kicked'     && (newStatus === 'member' || newStatus === 'left');

  const isMuteUpdate = oldStatus === 'restricted' && newStatus === 'restricted' &&
    update.old_chat_member.can_send_messages === false &&
    update.new_chat_member.can_send_messages === false &&
    update.old_chat_member.until_date !== update.new_chat_member.until_date;

  const isBanUpdate = oldStatus === 'kicked' && newStatus === 'kicked' &&
    update.old_chat_member.until_date !== update.new_chat_member.until_date;

  let emoji, action;
  if      (isKick)   { emoji = '🔨'; action = 'Banned/Kicked'; }
  else if (isMute)   { emoji = '🔇'; action = 'Muted/Restricted'; }
  else if (isUnmute) { emoji = '🔊'; action = 'Unmuted'; }
  else if (isUnban)  { emoji = '✅'; action = 'Unbanned'; }
  else if (isMuteUpdate) { emoji = '🔇'; action = 'Mute Duration Updated'; }
  else if (isBanUpdate)  { emoji = '🔨'; action = 'Ban Duration Updated'; }
  else return;

  let actorLink;
  if (actor.id === 1087968824) {
    actorLink = '🕵️ Anonymous Admin';
  } else if (actor.username) {
    actorLink = `@${actor.username}`;
  } else {
    actorLink = `<a href="tg://user?id=${actor.id}">${escapeHtml(actor.first_name || 'Admin')}</a>`;
  }
  const targetLink = target.username
    ? `@${target.username}`
    : `<a href="tg://user?id=${target.id}">${escapeHtml(target.first_name || 'User')}</a>`;

  let durationLine = '';
  if ((isMute || isMuteUpdate) && update.new_chat_member.until_date !== undefined) {
    if (update.new_chat_member.until_date === 0) {
      durationLine = '\n⏰ <b>Until:</b> Forever';
    } else if (update.new_chat_member.until_date) {
      const until = new Date(update.new_chat_member.until_date * 1000).toUTCString();
      durationLine = `\n⏰ <b>Until:</b> ${until}`;
    }
  }

  const alertText =
    `${emoji} <b>Admin Action: ${action}</b>\n\n` +
    `👮 <b>By:</b> ${actorLink}\n` +
    `👤 <b>Target:</b> ${targetLink}` +
    durationLine +
    `\n📌 <b>Group:</b> ${escapeHtml(groupTitle)}`;

  // Check for notification_chat_id in group_settings
  const settings = await env.DB.prepare(
    'SELECT notification_chat_id FROM group_settings WHERE group_id = ?'
  ).bind(chatId).first();

  if (settings && settings.notification_chat_id) {
    // Send single alert to configured notification chat
    try {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, settings.notification_chat_id, alertText);
    } catch (e) {
      console.error('Failed to send to notification_chat_id:', e);
    }
  } else {
    // Fall back to approved_admins DMs only — no getChatAdministrators fallback
    const { results: approvedAdmins } = await env.DB.prepare(
      'SELECT user_id FROM approved_admins WHERE group_id = ?'
    ).bind(chatId).all();

    if (approvedAdmins && approvedAdmins.length > 0) {
      await Promise.allSettled(
        approvedAdmins.map(a =>
          sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, a.user_id, alertText).catch(e =>
            console.error(`Failed DM to admin ${a.user_id}:`, e)
          )
        )
      );
    }
    // If no approved_admins configured, silently skip — no spam fallback
  }
}
