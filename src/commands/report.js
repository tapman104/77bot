import { checkIsAdmin, sendTelegramMessage, escapeHtml } from '../lib/telegram.js';
import { getGroupSettings } from '../lib/settings.js';

export async function handleReportCommand(msg, argsStr, env, ctx) {
  const chatId = msg.chat.id;

  // Fix 2 (Audit): Pure integer report ID routing to detail view with admin check
  if (/^\d+$/.test(argsStr)) {
    const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.chat.type, env);
    if (!isAdmin) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Viewing report details is restricted to administrators.');
      return;
    }
    await handleResolveReportDetails(chatId, argsStr, env, msg.from.id, msg.chat.type);
    return;
  }

  const reporter = msg.from;
  const replyTo = msg.reply_to_message;
  const settings = await getGroupSettings(env.DB, chatId);

  let targetUser = null;
  let targetMessageId = null;
  let reason = argsStr;
  let reportedMessageText = null;

  // Case 1: Reporting via Reply
  if (replyTo) {
    targetUser = replyTo.from;
    targetMessageId = replyTo.message_id;
    reportedMessageText = replyTo.text || replyTo.caption || '[Media/Non-text]';
  } else {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ <b>Usage:</b> Please reply to the message you want to report with <code>/report [reason]</code>.',
      msg.message_id
    );
    return;
  }

  // Anti-Spam Check 1: Must target someone
  if (!targetUser) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ <b>Usage:</b> Please reply to the message you want to report with <code>/report [reason]</code>.',
      msg.message_id
    );
    return;
  }

  // Anti-Spam Check 2: Default empty reasons
  if (!reason || reason.trim().length === 0) {
    reason = 'No reason provided';
  }

  // Anti-Spam Check 3: Ignore self-reports
  const isSameUsername = targetUser.username && reporter.username && targetUser.username.toLowerCase() === reporter.username.toLowerCase();
  if (targetUser.id === reporter.id || isSameUsername) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ You cannot report yourself.',
      msg.message_id
    );
    return;
  }

  // Anti-Spam Check 4: Ignore reports against bots (configurable)
  if (settings.ignore_bots && targetUser.is_bot) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ Reports against bots are disabled.',
      msg.message_id
    );
    return;
  }

  // Anti-Spam Check 5: Cooldown Verification
  const now = Math.floor(Date.now() / 1000);
  if (settings.cooldown_seconds > 0) {
    const cooldownRow = await env.DB.prepare(
      'SELECT last_report_time FROM user_cooldowns WHERE group_id = ? AND user_id = ?'
    ).bind(chatId, reporter.id).first();

    if (cooldownRow) {
      const elapsed = now - cooldownRow.last_report_time;
      if (elapsed < settings.cooldown_seconds) {
        const waitTime = settings.cooldown_seconds - elapsed;
        await sendTelegramMessage(
          env.TELEGRAM_BOT_TOKEN,
          chatId,
          `⏳ Please wait ${Math.ceil(waitTime / 60)} minute(s) before submitting another report.`,
          msg.message_id
        );
        return;
      }
    }
  }

  // Anti-Spam Check 6: Duplicate Open Report Check
  if (targetMessageId) {
    const existing = await env.DB.prepare(
      'SELECT id FROM reports WHERE group_id = ? AND message_id = ? AND status = "open"'
    ).bind(chatId, targetMessageId).first();

    if (existing) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'ℹ️ This message has already been reported and is pending admin review.',
        msg.message_id
      );
      return;
    }
  } else {
    const existing = await env.DB.prepare(
      'SELECT id FROM reports WHERE group_id = ? AND reported_id = ? AND status = "open"'
    ).bind(chatId, targetUser.id).first();

    if (existing) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        'ℹ️ This user already has an open report pending review.',
        msg.message_id
      );
      return;
    }
  }

  // Store Report in Cloudflare D1
  const groupTitle = msg.chat.title || 'Private Chat';
  const reporterUserStr = reporter.username ? `@${reporter.username}` : (reporter.first_name || `User ${reporter.id}`);
  const targetUserStr = targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || `User ${targetUser.id}`);

  const insertResult = await env.DB.prepare(`
    INSERT INTO reports (
      group_id, group_name, reporter_id, reporter_username,
      reported_id, reported_username, reason, message_id, message_text, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).bind(
    chatId,
    groupTitle,
    reporter.id,
    reporterUserStr,
    targetUser.id,
    targetUserStr,
    reason,
    targetMessageId,
    reportedMessageText
  ).run();

  const reportId = insertResult.meta.last_row_id;

  // Update Cooldown
  await env.DB.prepare(`
    INSERT INTO user_cooldowns (group_id, user_id, last_report_time)
    VALUES (?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET last_report_time = excluded.last_report_time
  `).bind(chatId, reporter.id, now).run();

  // Threshold check
  const settings_threshold = settings.report_threshold || 5;
  const openCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM reports WHERE group_id = ? AND reported_id = ? AND status = "open"'
  ).bind(chatId, targetUser.id).first();

  if (openCount && openCount.cnt >= settings_threshold) {
    // Notify admins that threshold has been reached
    const thresholdAlertText =
      `⚠️ <b>Report Threshold Reached</b>\n\n` +
      `👤 <b>User:</b> ${escapeHtml(targetUserStr)}\n` +
      `📊 <b>Open Reports:</b> ${openCount.cnt}/${settings_threshold}\n` +
      `📌 <b>Group:</b> ${escapeHtml(groupTitle)}\n\n` +
      `Consider taking action: review with <code>/history ${targetUser.id}</code>`;

    // Route threshold alert same as report notifications
    const thresholdSettings = await getGroupSettings(env.DB, chatId);
    if (thresholdSettings.notification_chat_id) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        thresholdSettings.notification_chat_id,
        thresholdAlertText
      ).catch(e => console.error('Threshold alert to notification_chat failed:', e));
    } else {
      const { results: tAdmins } = await env.DB.prepare(
        'SELECT user_id FROM approved_admins WHERE group_id = ?'
      ).bind(chatId).all();
      if (tAdmins && tAdmins.length > 0) {
        await Promise.allSettled(
          tAdmins.map(a =>
            sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, a.user_id, thresholdAlertText)
              .catch(e => console.error(`Threshold alert DM failed for ${a.user_id}:`, e))
          )
        );
      }
    }
  }

  // Send Confirmation to Reporter
  await sendTelegramMessage(
    env.TELEGRAM_BOT_TOKEN,
    chatId,
    `✅ Report received.`,
    msg.message_id
  );

  // Send Notification to Admins asynchronously using ctx.waitUntil
  const adminNotificationPromise = (async () => {
    try {
      const { results: approvedAdmins } = await env.DB.prepare(
        'SELECT user_id FROM approved_admins WHERE group_id = ?'
      ).bind(chatId).all();

      if (!approvedAdmins || approvedAdmins.length === 0) {
        // No approved admins configured — skip notification
        return;
      }

      const adminIds = approvedAdmins.map(a => a.user_id);

      const reporterLink = reporter.username
        ? `@${reporter.username}`
        : `<a href="tg://user?id=${reporter.id}">${escapeHtml(reporter.first_name || 'User')}</a>`;

      const reportedLink = targetUser.username 
        ? `@${targetUser.username}` 
        : `<a href="tg://user?id=${targetUser.id}">${escapeHtml(targetUser.first_name || 'User ' + targetUser.id)}</a>`;

      let messageLinkLine = '';
      if (targetMessageId) {
        const chatIdStr = chatId.toString();
        if (chatIdStr.startsWith('-100')) {
          const strippedChatId = chatIdStr.substring(4);
          messageLinkLine = `\n💬 <b>Message:</b> https://t.me/c/${strippedChatId}/${targetMessageId}`;
        }
      }

      const adminAlertText = 
        `🚨 <b>New Report</b>\n\n` +
        `🕵️ <b>Reporter:</b> ${reporterLink}\n` +
        `👤 <b>Reported:</b> ${reportedLink}\n` +
        `📝 <b>Reason:</b> ${escapeHtml(reason)}\n` +
        `💬 <b>Message:</b> <i>${escapeHtml(reportedMessageText || 'N/A')}</i>\n` +
        `🆔 <b>Report ID:</b> #${reportId}` +
        messageLinkLine +
        `\n📌 <b>Group:</b> ${escapeHtml(groupTitle)}`;

      if (settings.notification_chat_id) {
        try {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, settings.notification_chat_id, adminAlertText);
        } catch (err) {
          console.error(`Failed to send alert to notification_chat_id ${settings.notification_chat_id}:`, err);
        }
      } else {
        await Promise.allSettled(
          adminIds.map(adminId =>
            sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, adminId, adminAlertText).catch(e =>
              console.error(`Failed DM to admin ${adminId}:`, e)
            )
          )
        );
      }
    } catch (err) {
      console.error('Failed to process admin notifications:', err);
    }
  })();

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(adminNotificationPromise);
  } else {
    await adminNotificationPromise;
  }
}

export async function handleResolveReportDetails(chatId, reportIdStr, env, userId, chatType) {
  const reportId = parseInt(reportIdStr, 10);
  if (isNaN(reportId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Invalid Report ID. Usage: <code>/view &lt;Report ID&gt;</code> or <code>/report &lt;Report ID&gt;</code>');
    return;
  }

  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Report not found.');
    return;
  }

  const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, userId, chatType, env, report.group_id);
  if (!isAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ You are not an administrator of the group this report belongs to.');
    return;
  }

  const text = 
    `🔎 <b>Report Details #${report.id}</b>\n\n` +
    `<b>Status:</b> ${report.status.toUpperCase()}\n` +
    `<b>Group:</b> ${escapeHtml(report.group_name)} (${report.group_id})\n` +
    `<b>Reporter:</b> ${escapeHtml(report.reporter_username)} (ID: ${report.reporter_id})\n` +
    `<b>Reported User:</b> ${escapeHtml(report.reported_username)} (ID: ${report.reported_id})\n` +
    `<b>Reason:</b> ${escapeHtml(report.reason)}\n` +
    `<b>Message ID:</b> ${report.message_id || 'N/A'}\n` +
    `<b>Created At:</b> ${report.created_at}\n\n` +
    `Actions: <code>/resolve ${report.id}</code> | <code>/dismiss ${report.id}</code>`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}
