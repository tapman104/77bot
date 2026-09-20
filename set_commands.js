/**
 * Script to register bot commands with Telegram
 * Run with: node set_commands.js
 * Make sure TELEGRAM_BOT_TOKEN and OWNER_CHAT_ID are set in your environment
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

if (!TOKEN || !OWNER_CHAT_ID) {
  console.error('Please set TELEGRAM_BOT_TOKEN and OWNER_CHAT_ID environment variables');
  process.exit(1);
}

const publicCommands = [
  { command: 'report', description: 'Report a user (reply to their message)' },
  { command: 'help', description: 'Show command guide' }
];

const adminCommands = [
  { command: 'reports', description: 'List open reports' },
  { command: 'view', description: 'View report details by ID' },
  { command: 'resolve', description: 'Resolve a report by ID' },
  { command: 'dismiss', description: 'Dismiss a report by ID' },
  { command: 'history', description: 'View report history for a user' },
  { command: 'stats', description: 'Group moderation statistics' },
  { command: 'settings', description: 'View or edit group settings' },
  { command: 'export', description: 'Export reports as JSON or CSV' },
  { command: 'clearreports', description: 'Delete all group reports' },
  { command: 'approve', description: 'Approve a user as bot moderator' },
  { command: 'unapprove', description: 'Revoke bot moderator access' },
  { command: 'admins', description: 'List approved bot moderators' }
];

const ownerCommands = [
  { command: 'approvegroup', description: 'Approve a group for bot use' },
  { command: 'revokegroup', description: 'Revoke group approval and purge data' }
];

async function setCommands() {
  try {
    // Call 1 - public commands
    let res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: publicCommands, scope: { type: 'default' } })
    });
    console.log('Public commands set:', await res.json());

    // Call 2 - admin commands
    res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: adminCommands, scope: { type: 'all_chat_administrators' } })
    });
    console.log('Admin commands set:', await res.json());

    // Call 3 - owner commands
    res = await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: ownerCommands, scope: { type: 'chat', chat_id: Number(OWNER_CHAT_ID) } })
    });
    console.log('Owner commands set:', await res.json());

  } catch (err) {
    console.error('Error setting commands:', err);
  }
}

setCommands();
