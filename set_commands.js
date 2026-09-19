/**
 * Script to register bot commands with Telegram
 * Run with: node set_commands.js
 * Make sure TELEGRAM_BOT_TOKEN is set in your environment
 */
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('Please set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

const commands = [
  { command: 'report', description: 'Report a user (or by reply)' },
  { command: 'reports', description: 'List open reports' },
  { command: 'view', description: 'View report details' },
  { command: 'resolve', description: 'Mark report as resolved' },
  { command: 'dismiss', description: 'Dismiss a report' },
  { command: 'history', description: 'View user report history' },
  { command: 'stats', description: 'View moderation stats' },
  { command: 'settings', description: 'View or edit settings' },
  { command: 'export', description: 'Export group reports' },
  { command: 'clearreports', description: 'Delete all group reports' },
  { command: 'help', description: 'Show help menu' },
  { command: 'approve', description: 'Approve a group admin' },
  { command: 'unapprove', description: 'Revoke admin approval' },
  { command: 'admins', description: 'List approved admins' },
  { command: 'approvegroup', description: 'Approve group (Owner only)' },
  { command: 'revokegroup', description: 'Revoke group (Owner only)' }
];

fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ commands })
})
  .then(res => res.json())
  .then(data => console.log('Commands set response:', data))
  .catch(err => console.error('Error setting commands:', err));
