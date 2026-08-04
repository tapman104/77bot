# Pre-deployment & Deployment Guide

## Pre-flight Checklist

- [ ] wrangler CLI installed (`npm install -g wrangler`)
- [ ] Logged in to Cloudflare (`wrangler login`)
- [ ] D1 database created (`wrangler d1 create report-bot-db`) — paste the returned `database_id` into `wrangler.toml`
- [ ] Schema applied (`wrangler d1 execute report-bot-db --file=schema.sql`)
- [ ] Bot token set (`wrangler secret put TELEGRAM_BOT_TOKEN`)
- [ ] Webhook secret set (`wrangler secret put TELEGRAM_SECRET_TOKEN`)
- [ ] `GLOBAL_ADMIN_IDS` set in `wrangler.toml` `[vars]` to your Telegram user ID
- [ ] Worker deployed (`wrangler deploy`)
- [ ] Webhook registered (curl command below)

---

## Webhook Registration

Execute the following curl command to register your Worker URL as the Telegram bot webhook:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://telegram-report-bot.<YOUR_SUBDOMAIN>.workers.dev",
    "secret_token": "<YOUR_TELEGRAM_SECRET_TOKEN>"
  }'
```

---

## First-Time Setup After Deploy

1. Add the bot to a group.
2. Bot will post the group ID in the group chat (`⏳ This bot requires owner approval before it can be used in this group. Group ID: <group_id> — forward this to the bot owner.`).
3. DM the bot in private chat with `/approvegroup <group_id>`.
4. In the group chat, run `/approve <your_telegram_user_id>` (as the bot owner, your user ID in `GLOBAL_ADMIN_IDS` allows you to seed the first approved admin).
5. Other Telegram admins can then be approved by any approved admin via `/approve <their_user_id>`.

---

## Environment Variables Reference

| Variable | Where Set | Purpose |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Secret (`wrangler secret put TELEGRAM_BOT_TOKEN`) | Authentication token provided by @BotFather for calling the Telegram Bot API. |
| `TELEGRAM_SECRET_TOKEN` | Secret (`wrangler secret put TELEGRAM_SECRET_TOKEN`) | Secret header token (`X-Telegram-Bot-Api-Secret-Token`) for verifying incoming webhook requests from Telegram. |
| `GLOBAL_ADMIN_IDS` | `wrangler.toml` (`[vars]`) | Comma-separated Telegram user IDs of bot owners (e.g. `"123456789,987654321"`). Owners bypass all admin approval checks. |
| `DEFAULT_ADMIN_CHAT_ID` | `wrangler.toml` (`[vars]`) | Fallback chat ID to send admin report notifications if a group has no custom `notification_chat` configured. |

---

## Commands Quick Reference

### Public Commands
- `/report [reason]` - Report user by reply or `/report @username [reason]`

### Approved Admin Commands
- `/reports` - List open reports
- `/view <ID>` - View full report details (or `/report <ID>`)
- `/resolve <ID>` - Mark report as resolved
- `/dismiss <ID>` - Dismiss report
- `/history @user` - View user report history
- `/stats` - Moderation analytics
- `/settings` - View & edit group settings
- `/export [json|csv]` - Export group reports
- `/clearreports` - Delete all group reports
- `/approve <user_id>` - Approve a group admin
- `/unapprove <user_id>` - Revoke admin approval
- `/admins` - List approved group admins
- `/help` - Show this menu

### Owner Commands (Private Chat Only)
- `/approvegroup <group_id>` - Approve a group for bot use
- `/revokegroup <group_id>` - Revoke group approval & purge data
