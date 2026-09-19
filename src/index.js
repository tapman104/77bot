import { handleChatMemberUpdate } from './handlers/chatMember.js';
import { sendTelegramMessage } from './lib/telegram.js';
import { handleApproveGroup, handleRevokeGroup } from './commands/group.js';
import { handleApproveAdmin, handleUnapproveAdmin, handleListAdmins } from './commands/approve.js';
import { handleListReports } from './commands/reports.js';
import { handleReportCommand, handleResolveReportDetails } from './commands/report.js';
import { handleResolveReport } from './commands/resolve.js';
import { handleDismissReport } from './commands/dismiss.js';
import { handleUserHistory } from './commands/history.js';
import { handleStats } from './commands/stats.js';
import { handleSettings } from './commands/settings.js';
import { handleExport } from './commands/export.js';
import { handleClearReports } from './commands/clearreports.js';
import { handleHelp } from './commands/help.js';

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
      await handleListAdmins(chatId, chatType, senderId, env);
      break;
    case '/reports':
      await handleListReports(chatId, chatType, senderId, argsStr, env);
      break;
    case '/view':
      await handleResolveReportDetails(chatId, argsStr, env, senderId, chatType);
      break;
    case '/resolve':
      await handleResolveReport(chatId, argsStr, env, senderId, chatType);
      break;
    case '/dismiss':
      await handleDismissReport(chatId, argsStr, env, senderId, chatType);
      break;
    case '/history':
      await handleUserHistory(chatId, msg, argsStr, env);
      break;
    case '/stats':
      await handleStats(chatId, chatType, senderId, env);
      break;
    case '/settings':
      await handleSettings(chatId, chatType, senderId, argsStr, env);
      break;
    case '/export':
      await handleExport(chatId, chatType, senderId, argsStr, env);
      break;
    case '/clearreports':
      await handleClearReports(chatId, chatType, senderId, argsStr, env);
      break;
    case '/help':
      await handleHelp(chatId, env);
      break;
  }
}
