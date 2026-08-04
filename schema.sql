-- Cloudflare D1 Database Schema for Telegram Report Bot

-- Table: reports
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    group_name TEXT NOT NULL,
    reporter_id INTEGER NOT NULL,
    reporter_username TEXT,
    reported_id INTEGER NOT NULL,
    reported_username TEXT,
    reason TEXT NOT NULL,
    message_id INTEGER,
    status TEXT NOT NULL DEFAULT 'open', -- 'open', 'resolved', 'dismissed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: group_settings
CREATE TABLE IF NOT EXISTS group_settings (
    group_id INTEGER PRIMARY KEY,
    cooldown_seconds INTEGER DEFAULT 300,
    report_threshold INTEGER DEFAULT 5,
    notification_chat_id INTEGER,
    ignore_bots INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: user_cooldowns
CREATE TABLE IF NOT EXISTS user_cooldowns (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_report_time INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

-- Indexes for optimal querying
CREATE INDEX IF NOT EXISTS idx_reports_group ON reports(group_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reported ON reports(reported_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_reports_group_status ON reports(group_id, status);

-- Table: approved_groups
CREATE TABLE IF NOT EXISTS approved_groups (
    group_id INTEGER PRIMARY KEY,
    approved_by INTEGER NOT NULL,
    approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: approved_admins
CREATE TABLE IF NOT EXISTS approved_admins (
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    approved_by INTEGER NOT NULL,
    approved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_approved_admins_group ON approved_admins(group_id);

