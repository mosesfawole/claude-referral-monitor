# Claude referral monitor

Checks public feeds and a guest pass directory for new `claude.ai/referral/` links and sends them to Telegram. Runs on standard GitHub Actions Ubuntu runners every thirty minutes. Your computer can be off.

The repository is public so standard Actions compute is free. Telegram credentials live in encrypted repository secrets. State contains hashes of delivered referral codes and daily source availability. No paid search or model API is used. No Actions artifacts or caches are created.

## Sources and filtering

Reads the public guest pass directory at claudecoworkcourse.com, NodeLoc and Linux.do RSS feeds, Hacker News search, and public Reddit posts and comments. Source access varies, especially Reddit, which may block cloud runners. Each run logs accessible and unavailable sources. If all sources fail, the bot sends an outage alert once per day and subsequent runs retry.

X/Twitter uses Weir's public-post keyword search for `url:claude.ai/referral`, with no author restriction. Store its API key in the `WEIR_API_KEY` repository secret. Search results include publication times and expanded link targets. Replies can qualify. Native retweets are excluded to avoid repeating older offers. Coverage depends on the provider and X search indexing.

Weir provides 5,000 recurring free credits per month with no card. Each search costs one credit plus one per X post or three per Reddit post. The monitor divides the remaining free balance over the days until the reset, checks the worst-case page cost before each call, and persists actual credits spent each day. Search calls are serialized to protect the shared budget. A daily cap pauses those searches until tomorrow. Insufficient free credits pause them until the monthly reset, with one Telegram notice per month. It never purchases credits or deliberately consumes a paid balance. Overlapping windows reduce missed posts, cursors preserve backlog, and checkpoints advance after successful Telegram delivery.

Reddit public keyword search also uses Weir, across communities rather than a fixed account list. This searches post titles and bodies, not all comment text. Direct Reddit developer access was requested on November 18, 2026 and is awaiting approval. The provider integration is independent of that request.

On HTTP 429 or 503 the monitor waits at least 30 minutes, respecting longer Retry-After headers. On HTTP 403 it waits at least six hours. Access to blocked Reddit sources through the approved Data API requires separate credentials and Reddit approval. At setup, Weir also reported that Reddit was refusing its requests. Failed provider calls are not charged, and scheduled retries resume when that source recovers.

Only links with source publication dates within the last 20 minutes qualify. Crossed-out links, directory entries marked retired, and offers explicitly marked claimed or expired are excluded. Query strings are removed and sent codes are deduplicated persistently. Availability at redemption remains unverified.

## Operation

The Telegram bot has an instant, owner-only webhook on Vercel Hobby. Use its pinned dashboard, persistent keyboard, or /menu. Recent finds, source health, the stored credit budget, pause/resume, and 30/60/120-minute settings are available there. Menus do not call the search provider. Alerts batch up to five passes and include open, source, and used buttons. Marking one pass used keeps the other links in its batch available.

Controls and the most recent 30 pass records live in a private Vercel Blob store, with conditional writes for settings. Only the configured Telegram user can operate the bot, and webhook requests require Telegram's secret header. GitHub still owns scan scheduling and durable deduplication. It reads the controls before source requests, applies the chosen interval, and publishes one status snapshot per scan. At a 30-minute interval this uses about 1,488 snapshot writes in a 31-day month, within Hobby's 2,000 included advanced Blob operations, with the remainder available for interactive controls. Hobby caps access if its quota is reached, without overage billing.

The bot's compact hierarchy and primary actions were inspired by [Saasbright](https://www.framer.com/marketplace/templates/saasbright/), adapted to Telegram-native typography and buttons.

Open Actions → Claude referral monitor → Run workflow for an immediate scan. Enable the test-delivery input for a Telegram connectivity test. Disable the workflow from its Actions menu to stop monitoring.

GitHub schedules can be delayed or skipped during high load, so the thirty-minute cadence is approximate. A small daily state commit keeps normal repository activity present. GitHub can disable public-repository schedules after 60 days without activity, so check Actions if alerts stop.

## Development

Use Node.js 22 or newer. Run `npm ci`, then `npm test`. Use `node monitor.mjs --dry-run` to scan without sending messages or updating state. For delivery, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in the environment. Never commit credentials.
