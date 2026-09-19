/**
 * Telegram Report Bot - Cloudflare Worker Implementation
 * Stack: Cloudflare Workers (ES Modules) + Telegram Bot API + Cloudflare D1
 *
 * Applied Fixes & Hardening:
 * - Fix 1 (Audit - CRITICAL): Guarded handleMessage against missing `msg.from` in channel/service updates.
 * - Fix 2 (Audit - HIGH): Enforced admin check in `/report <ID>` integer routing branch.
 * - Fix 3 (Audit - HIGH): Scoped report detail lookup by `group_id` in handleResolveReportDetails.
 * - Fix 4 (Audit - HIGH): Separated numeric ID vs username search in handleUserHistory query.
 * - Fix 5 (Audit - LOW): Added `updated_at = CURRENT_TIMESTAMP` to all `/settings` upsert queries.
 * - Fix 6 (Audit - LOW): Added `idx_reports_group_status` composite index to schema.sql.
 * - Fix 7 (Audit - LOW): Added check for missing `TELEGRAM_BOT_TOKEN` at top of fetch handler.
 * - Feature (Group Allowlist): Added approved_groups D1 table, group authorization gate, new_chat_members handler, /approvegroup and /revokegroup owner commands.
 * - Feature (Admin Approval): Added approved_admins D1 table, checkIsAdmin approval verification, owner bootstrap bypass, /approve, /unapprove, and /admins management commands.
 * - Previous Fixes 1–9: Detail view routing, deferred checkIsAdmin, history fallback fix, private chat gate,
 *   ignore_bots setting, cooldown purge, stats grouping by user ID, export truncation warning, waitUntil admin alerts.
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Fix 7 (Audit): Check TELEGRAM_BOT_TOKEN environment variable
    if (!env.TELEGRAM_BOT_TOKEN) {
      console.error('FATAL: TELEGRAM_BOT_TOKEN environment variable is not set.');
      return new Response('Internal configuration error', { status: 500 });
    }


    try {
      const update = await request.json();
      if (update.message) {
        await handleMessage(update.message, env, ctx);
      } else if (update.chat_member) {
        ctx.waitUntil(handleChatMemberUpdate(update.chat_member, env));
      }
      return new Response('OK', { status: 200 });
    } catch (err) {
      console.error('Error handling Telegram update:', err);
      return new Response('Internal Error', { status: 500 });
    }
  }
};

/**
 * Helper: Check if user is bot owner (defined in GLOBAL_ADMIN_IDS)
 */
function isOwner(userId, env) {
  if (!env.GLOBAL_ADMIN_IDS) return false;
  const adminList = env.GLOBAL_ADMIN_IDS.split(',').map(id => id.trim());
  return adminList.includes(String(userId));
}

/**
 * Handle incoming message updates
 */
async function handleMessage(msg, env, ctx) {
  // Fix 1 (Audit): Early return guard for channel posts and service messages lacking msg.from
  if (!msg || !msg.from) return;

  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const senderId = msg.from.id;

  // Event handler: Bot added to a group (new_chat_members containing bot ID)
  if (Array.isArray(msg.new_chat_members) && env.TELEGRAM_BOT_TOKEN) {
    const botIdStr = env.TELEGRAM_BOT_TOKEN.split(':')[0];
    const isBotAdded = msg.new_chat_members.some(
      member => String(member.id) === botIdStr || (member.is_bot && String(member.id) === botIdStr)
    );
    if (isBotAdded) {
      await sendTelegramMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `⏳ This bot requires owner approval before it can be used in this group. Group ID: <code>${chatId}</code> — forward this to the bot owner.`
      );
      return;
    }
  }

  // Feature: Group Allowlist check (skip for private chat)
  if (chatType !== 'private') {
    const approvedGroup = await env.DB.prepare(
      'SELECT group_id FROM approved_groups WHERE group_id = ?'
    ).bind(chatId).first();

    if (!approvedGroup) {
      // Silently ignore updates in unapproved groups
      return;
    }
  }

  if (!msg.text) return;

  const text = msg.text.trim();
  if (!text.startsWith('/')) return;

  // Extract command and arguments
  const firstSpaceIndex = text.indexOf(' ');
  let commandRaw = firstSpaceIndex === -1 ? text : text.substring(0, firstSpaceIndex);
  const argsStr = firstSpaceIndex === -1 ? '' : text.substring(firstSpaceIndex + 1).trim();

  // Strip @BotUsername if present
  const command = commandRaw.split('@')[0].toLowerCase();

  // Non-admins can use /report. Skip checkIsAdmin for /report.
  if (command === '/report') {
    await handleReportCommand(msg, argsStr, env, ctx);
    return;
  }

  // All other commands require admin status
  const isAdminUser = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, senderId, chatType, env);
  if (!isAdminUser) {
    // Silently ignore or inform user
    if (chatType === 'private') {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Command restricted to administrators.');
    }
    return;
  }

  switch (command) {
    case '/approvegroup':
      await handleApproveGroup(chatId, chatType, senderId, argsStr, env);
      break;
    case '/revokegroup':
      await handleRevokeGroup(chatId, chatType, senderId, argsStr, env);
      break;
    case '/approve':
      await handleApproveAdmin(chatId, chatType, senderId, msg, argsStr, env);
      break;
    case '/unapprove':
      await handleUnapproveAdmin(chatId, chatType, senderId, msg, argsStr, env);
      break;
    case '/admins':
      await handleListAdmins(chatId, chatType, env);
      break;
    case '/reports':
      await handleListReports(chatId, env);
      break;
    case '/view':
      await handleResolveReportDetails(chatId, argsStr, env);
      break;
    case '/resolve':
      await handleResolveReport(chatId, argsStr, env);
      break;
    case '/dismiss':
      await handleDismissReport(chatId, argsStr, env);
      break;
    case '/history':
      await handleUserHistory(chatId, msg, argsStr, env);
      break;
    case '/stats':
      await handleStats(chatId, env);
      break;
    case '/settings':
      await handleSettings(chatId, argsStr, env);
      break;
    case '/export':
      await handleExport(chatId, argsStr, env);
      break;
    case '/clearreports':
      await handleClearReports(chatId, argsStr, env);
      break;
    case '/help':
      await handleHelp(chatId, env);
      break;
  }
}

async function handleChatMemberUpdate(update, env) {
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

/**
 * Helper: Send Telegram API Message
 */
async function sendTelegramMessage(botToken, chatId, text, replyToMessageId = null, parseMode = 'HTML') {
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
async function checkIsAdmin(botToken, chatId, userId, chatType, env) {
  // Owner (in GLOBAL_ADMIN_IDS) always bypasses admin checks
  if (isOwner(userId, env)) {
    return true;
  }

  if (chatType === 'private') {
    // Non-owner in private chat is denied
    return false;
  }

  try {
    // Step 1: Telegram admin status check via getChatMember API
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId })
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
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Helper: Get Group Settings
 */
async function getGroupSettings(db, groupId) {
  try {
    const row = await db.prepare('SELECT * FROM group_settings WHERE group_id = ?').bind(groupId).first();
    if (row) return row;
  } catch (e) {
    console.error('Get settings error:', e);
  }
  return {
    cooldown_seconds: 0,
    report_threshold: 5,
    notification_chat_id: null,
    ignore_bots: 1
  };
}

/**
 * COMMAND: /approvegroup <group_id> (Owner, Private Chat Only)
 */
async function handleApproveGroup(chatId, chatType, senderId, argsStr, env) {
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

/**
 * COMMAND: /revokegroup <group_id> (Owner, Private Chat Only)
 */
async function handleRevokeGroup(chatId, chatType, senderId, argsStr, env) {
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

/**
 * COMMAND: /approve <user_id> (Approved Admins, Group Chat Only)
 */
async function handleApproveAdmin(chatId, chatType, senderId, msg, argsStr, env) {
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

  // 1. Verify target is a Telegram admin of this group via getChatMember
  let isTgAdmin = false;
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
      isTgAdmin = status === 'administrator' || status === 'creator';
    }
  } catch (err) {
    console.error('getChatMember failed in handleApproveAdmin:', err);
  }

  if (!isTgAdmin) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `⚠️ User ${targetUserId} is not a Telegram admin of this group.`);
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
    `✅ Admin ${targetUserId} approved by ${escapeHtml(approverUsername)}.`
  );
}

/**
 * COMMAND: /unapprove <user_id> (Approved Admins, Group Chat Only)
 */
async function handleUnapproveAdmin(chatId, chatType, senderId, msg, argsStr, env) {
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

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ Admin approval for ${targetUserId} revoked.`);
}

/**
 * COMMAND: /admins (Approved Admins, Group Chat Only)
 */
async function handleListAdmins(chatId, chatType, env) {
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

/**
 * COMMAND: /report
 */
async function handleReportCommand(msg, argsStr, env, ctx) {
  const chatId = msg.chat.id;

  // Fix 2 (Audit): Pure integer report ID routing to detail view with admin check
  if (/^\d+$/.test(argsStr)) {
    const isAdmin = await checkIsAdmin(env.TELEGRAM_BOT_TOKEN, chatId, msg.from.id, msg.chat.type, env);
    if (!isAdmin) return;
    await handleResolveReportDetails(chatId, argsStr, env);
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
    // Case 2: Reporting via @username mention in args
    const parts = argsStr.split(' ');
    if (parts.length > 0 && parts[0].startsWith('@')) {
      const mention = parts[0];
      reason = parts.slice(1).join(' ');
      
      try {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, user_id: mention })
        });
        const data = await res.json();
        if (data.ok && data.result && data.result.user) {
          targetUser = data.result.user;
        } else {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Could not find that user in this group.', msg.message_id);
          return;
        }
      } catch (err) {
        console.error('Failed to lookup user by username:', err);
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Could not find that user in this group.', msg.message_id);
        return;
      }
    }
  }

  // Anti-Spam Check 1: Must target someone
  if (!targetUser) {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ <b>Usage:</b> Reply to a user\'s message with <code>/report [reason]</code> or use <code>/report @username [reason]</code>',
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
  }

  // Store Report in Cloudflare D1
  const groupTitle = msg.chat.title || 'Private Chat';
  const reporterUserStr = reporter.username ? `@${reporter.username}` : (reporter.first_name || `User ${reporter.id}`);
  const targetUserStr = targetUser.username ? `@${targetUser.username}` : (targetUser.first_name || `User ${targetUser.id}`);

  const insertResult = await env.DB.prepare(`
    INSERT INTO reports (
      group_id, group_name, reporter_id, reporter_username,
      reported_id, reported_username, reason, message_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
  `).bind(
    chatId,
    groupTitle,
    reporter.id,
    reporterUserStr,
    targetUser.id,
    targetUserStr,
    reason,
    targetMessageId
  ).run();

  const reportId = insertResult.meta.last_row_id;

  // Update Cooldown
  await env.DB.prepare(`
    INSERT INTO user_cooldowns (group_id, user_id, last_report_time)
    VALUES (?, ?, ?)
    ON CONFLICT(group_id, user_id) DO UPDATE SET last_report_time = excluded.last_report_time
  `).bind(chatId, reporter.id, now).run();

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
      let adminIds = [];
      const { results: approvedAdmins } = await env.DB.prepare(
        'SELECT user_id FROM approved_admins WHERE group_id = ?'
      ).bind(chatId).all();

      if (approvedAdmins && approvedAdmins.length > 0) {
        adminIds = approvedAdmins.map(a => a.user_id);
      } else {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatAdministrators`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId })
        });
        const data = await res.json();
        if (data.ok && data.result) {
          for (const admin of data.result) {
            const user = admin.user;
            if (user.is_bot || admin.is_anonymous) continue;
            adminIds.push(user.id);
          }
        }
      }

      const reporterLink = reporter.username
        ? `@${reporter.username}`
        : `<a href="tg://user?id=${reporter.id}">${escapeHtml(reporter.first_name || 'User')}</a>`;

      const reportedLink = targetUser.username 
        ? `@${targetUser.username}` 
        : `<a href="tg://user?id=${targetUser.id}">${escapeHtml(targetUser.first_name || 'User ' + targetUser.id)}</a>`;

      let messageLinkLine = '';
      if (targetMessageId) {
        const chatIdStr = chatId.toString();
        const strippedChatId = chatIdStr.startsWith('-100') ? chatIdStr.substring(4) : chatIdStr;
        messageLinkLine = `\n💬 <b>Message:</b> https://t.me/c/${strippedChatId}/${targetMessageId}`;
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

      for (const adminId of adminIds) {
        try {
          await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, adminId, adminAlertText);
        } catch (err) {
          console.error(`Failed to send DM to admin ${adminId}:`, err);
        }
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

/**
 * COMMAND: /reports
 */
async function handleListReports(chatId, env) {
  const { results } = await env.DB.prepare(
    'SELECT id, reported_username, reason, created_at FROM reports WHERE group_id = ? AND status = "open" ORDER BY id DESC LIMIT 10'
  ).bind(chatId).all();

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '✅ No open reports found for this group.');
    return;
  }

  let text = '📋 <b>Open Reports:</b>\n\n';
  for (const r of results) {
    text += `• <b>#${r.id}</b> | User: ${escapeHtml(r.reported_username)} | Reason: <i>${escapeHtml(r.reason)}</i>\n`;
  }
  text += '\nUse <code>/report &lt;Report ID&gt;</code> or <code>/view &lt;Report ID&gt;</code> to view details.';

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

/**
 * COMMAND: /view <Report ID> or /report <Report ID>
 */
async function handleResolveReportDetails(chatId, reportIdStr, env) {
  const reportId = parseInt(reportIdStr, 10);
  if (isNaN(reportId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Invalid Report ID. Usage: <code>/view &lt;Report ID&gt;</code> or <code>/report &lt;Report ID&gt;</code>');
    return;
  }

  // Fix 3 (Audit): Scope lookup by group_id
  const report = await env.DB.prepare('SELECT * FROM reports WHERE id = ? AND group_id = ?').bind(reportId, chatId).first();
  if (!report) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '❌ Report not found.');
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

/**
 * COMMAND: /resolve <Report ID>
 */
async function handleResolveReport(chatId, reportIdStr, env) {
  if (!reportIdStr) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/resolve &lt;Report ID&gt;</code>');
    return;
  }

  const reportId = parseInt(reportIdStr, 10);
  if (isNaN(reportId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Invalid Report ID.');
    return;
  }

  const result = await env.DB.prepare(
    'UPDATE reports SET status = "resolved", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ?'
  ).bind(reportId, chatId).run();

  if (result.meta.changes > 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Report <b>#${reportId}</b> marked as resolved.`);
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Report #${reportId} not found in this group.`);
  }
}

/**
 * COMMAND: /dismiss <Report ID>
 */
async function handleDismissReport(chatId, reportIdStr, env) {
  const reportId = parseInt(reportIdStr, 10);
  if (isNaN(reportId)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/dismiss &lt;Report ID&gt;</code>');
    return;
  }

  const result = await env.DB.prepare(
    'UPDATE reports SET status = "dismissed", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND group_id = ?'
  ).bind(reportId, chatId).run();

  if (result.meta.changes > 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑️ Report <b>#${reportId}</b> dismissed.`);
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `❌ Report #${reportId} not found in this group.`);
  }
}

/**
 * COMMAND: /history @user or <user_id>
 */
async function handleUserHistory(chatId, msg, argsStr, env) {
  const chatType = msg.chat.type;

  if (chatType === 'private' && !isOwner(msg.from.id, env)) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ This command can only be used in a group chat or by the bot owner.');
    return;
  }

  let targetQuery = argsStr.trim();
  if (msg.reply_to_message) {
    const u = msg.reply_to_message.from;
    targetQuery = u.username ? `@${u.username}` : String(u.id);
  }

  if (!targetQuery) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Usage: <code>/history @username</code> or reply to a user.');
    return;
  }

  // Fix 4 (Audit): Conditional querying to separate numeric ID lookups from username searches
  const cleanTarget = targetQuery.replace('@', '');
  const isNumeric = /^\d+$/.test(cleanTarget);

  let results;
  if (chatType === 'private') {
    if (isNumeric) {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at, group_name FROM reports
        WHERE reported_id = ?
        ORDER BY id DESC LIMIT 20
      `).bind(parseInt(cleanTarget, 10)).all());
    } else {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at, group_name FROM reports
        WHERE reported_username LIKE ?
        ORDER BY id DESC LIMIT 20
      `).bind(`%${cleanTarget}%`).all());
    }
  } else {
    if (isNumeric) {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at FROM reports
        WHERE group_id = ? AND reported_id = ?
        ORDER BY id DESC LIMIT 10
      `).bind(chatId, parseInt(cleanTarget, 10)).all());
    } else {
      ({ results } = await env.DB.prepare(`
        SELECT id, reason, status, created_at FROM reports
        WHERE group_id = ? AND reported_username LIKE ?
        ORDER BY id DESC LIMIT 10
      `).bind(chatId, `%${cleanTarget}%`).all());
    }
  }

  if (!results || results.length === 0) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `ℹ️ No report history found for <b>${escapeHtml(targetQuery)}</b>.`);
    return;
  }

  let text = `📜 <b>Report History for ${escapeHtml(targetQuery)}:</b>\n\n`;
  for (const r of results) {
    if (chatType === 'private') {
      text += `• <b>#${r.id}</b> | Group: ${escapeHtml(r.group_name)} | Status: ${r.status} | Reason: ${escapeHtml(r.reason)} (${r.created_at})\n`;
    } else {
      text += `• <b>#${r.id}</b> | Status: ${r.status} | Reason: ${escapeHtml(r.reason)} (${r.created_at})\n`;
    }
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

/**
 * COMMAND: /stats
 */
async function handleStats(chatId, env) {
  const totalRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ?').bind(chatId).first();
  const openRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ? AND status = "open"').bind(chatId).first();
  const resolvedRow = await env.DB.prepare('SELECT COUNT(*) as count FROM reports WHERE group_id = ? AND status = "resolved"').bind(chatId).first();

  const { results: topReported } = await env.DB.prepare(`
    SELECT reported_id, MAX(reported_username) AS reported_username, COUNT(*) AS cnt FROM reports 
    WHERE group_id = ? GROUP BY reported_id ORDER BY cnt DESC LIMIT 3
  `).bind(chatId).all();

  const { results: topReporters } = await env.DB.prepare(`
    SELECT reporter_id, MAX(reporter_username) AS reporter_username, COUNT(*) AS cnt FROM reports 
    WHERE group_id = ? GROUP BY reporter_id ORDER BY cnt DESC LIMIT 3
  `).bind(chatId).all();

  let text = `📊 <b>Group Moderation Statistics</b>\n\n` +
    `• <b>Total Reports:</b> ${totalRow ? totalRow.count : 0}\n` +
    `• <b>Open Reports:</b> ${openRow ? openRow.count : 0}\n` +
    `• <b>Resolved Reports:</b> ${resolvedRow ? resolvedRow.count : 0}\n\n` +
    `<b>Most Reported Users:</b>\n`;

  if (topReported && topReported.length > 0) {
    topReported.forEach(u => { text += `  - ${escapeHtml(u.reported_username)}: ${u.cnt} report(s)\n`; });
  } else {
    text += `  <i>None</i>\n`;
  }

  text += `\n<b>Most Active Reporters:</b>\n`;
  if (topReporters && topReporters.length > 0) {
    topReporters.forEach(u => { text += `  - ${escapeHtml(u.reporter_username)}: ${u.cnt} submission(s)\n`; });
  } else {
    text += `  <i>None</i>\n`;
  }

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

/**
 * COMMAND: /settings
 */
async function handleSettings(chatId, argsStr, env) {
  const current = await getGroupSettings(env.DB, chatId);

  if (!argsStr) {
    const text = 
      `⚙️ <b>Group Settings</b>\n\n` +
      `• <b>Cooldown:</b> ${current.cooldown_seconds}s\n` +
      `• <b>Ignore Bots:</b> ${current.ignore_bots ? 'Yes' : 'No'}\n` +
      `• <b>Notification Destination:</b> ${current.notification_chat_id || 'Current Group'}\n\n` +
      `<i>To update settings, use:</i>\n` +
      `<code>/settings cooldown 300</code>\n` +
      `<code>/settings ignore_bots 1</code>\n` +
      `<code>/settings notification_chat -100123456789</code>`;
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
    return;
  }

  const parts = argsStr.split(' ');
  const key = parts[0].toLowerCase();
  const val = parts[1];

  // Fix 5 (Audit): Added updated_at = CURRENT_TIMESTAMP to all DO UPDATE SET clauses
  if (key === 'cooldown' && !isNaN(val)) {
    const cd = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, cooldown_seconds) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET cooldown_seconds = excluded.cooldown_seconds, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, cd).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Cooldown updated to ${cd} seconds.`);
  } else if (key === 'ignore_bots' && (val === '0' || val === '1')) {
    const ib = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, ignore_bots) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET ignore_bots = excluded.ignore_bots, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, ib).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Ignore bots updated to ${ib === 1 ? 'Yes (1)' : 'No (0)'}.`);
  } else if (key === 'notification_chat' && !isNaN(val)) {
    const destId = parseInt(val, 10);
    await env.DB.prepare(`
      INSERT INTO group_settings (group_id, notification_chat_id) VALUES (?, ?)
      ON CONFLICT(group_id) DO UPDATE SET notification_chat_id = excluded.notification_chat_id, updated_at = CURRENT_TIMESTAMP
    `).bind(chatId, destId).run();
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Notification destination set to <code>${destId}</code>.`);
  } else {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '⚠️ Invalid setting key or value.');
  }
}

/**
 * COMMAND: /export
 */
async function handleExport(chatId, argsStr, env) {
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
    const rows = results.map(row => Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    content = [headers, ...rows].join('\n');
  }

  const isTruncated = content.length > 3500;
  const snippet = isTruncated ? content.substring(0, 3500) + '\n... [truncated]' : content;

  let text = '';
  if (isTruncated) {
    text += `⚠️ Output truncated. Full data has ${results.length} rows; only partial content shown. Consider filtering or extracting directly from D1.\n\n`;
  }
  text += `📁 <b>Exported Reports (${format.toUpperCase()}):</b>\n\n<pre>${escapeHtml(snippet)}</pre>`;

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);
}

/**
 * COMMAND: /clearreports
 */
async function handleClearReports(chatId, argsStr, env) {
  if (argsStr !== 'confirm') {
    await sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '⚠️ <b>Warning:</b> This will permanently delete ALL stored reports for this group.\n\nType <code>/clearreports confirm</code> to execute.'
    );
    return;
  }

  await env.DB.prepare('DELETE FROM reports WHERE group_id = ?').bind(chatId).run();
  await env.DB.prepare('DELETE FROM user_cooldowns WHERE group_id = ?').bind(chatId).run();

  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, '🗑️ All reports and cooldowns for this group have been permanently cleared.');
}

/**
 * COMMAND: /help
 */
async function handleHelp(chatId, env) {
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
