export async function getGroupSettings(db, groupId) {
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
