fetch('https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN_PLAIN + '/setMyCommands', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    commands: [
      { command: 'report', description: 'Report a user (reply to their message)' },
      { command: 'reports', description: 'List open reports' },
      { command: 'resolve', description: 'Resolve a report by ID' },
      { command: 'dismiss', description: 'Dismiss a report by ID' },
      { command: 'history', description: 'View report history for a user' },
      { command: 'stats', description: 'Group moderation statistics' },
      { command: 'settings', description: 'View or edit group settings' },
      { command: 'export', description: 'Export reports as JSON or CSV' },
      { command: 'clearreports', description: 'Delete all group reports' },
      { command: 'help', description: 'Show command guide' }
    ]
  })
}).then(r => r.json()).then(console.log).catch(console.error);
