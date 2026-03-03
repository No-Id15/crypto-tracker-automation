# Crypto Price & Logo Automation for Notion

Automatically update cryptocurrency prices and logos in your Notion Trading History database using GitHub Actions. This automation runs every 5 minutes, 24/7, fetching real-time data from CoinGecko and CoinRanking APIs.


## Automated Schedule

The GitHub Actions workflow runs:
- **Every 5 minutes, 24/7** — no blackout windows

You can also trigger the workflow manually anytime from the GitHub Actions tab.

> **Why 24/7?** This repo is public, so GitHub Actions minutes are unlimited. No need to restrict hours.

---

## Setup Guide

### Prerequisites

Before starting, make sure you have:
- ✅ A GitHub account (free)
- ✅ A Notion account (free)
- ✅ CoinRanking account (free tier is fine)

---

## Step 1: Get Your API Keys

### 1.1 Notion API Token

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Give it a name (e.g., "Crypto Tracker Automation")
4. Select your workspace
5. Click **"Submit"**
6. Copy the **"Internal Integration Token"** (starts with `secret_` or `ntn_`)
7. Save this token (write it down somewhere safe) - you'll need it for GitHub Secrets

### 1.2 Share Your Database with the Integration

1. Open your **Trading History** database in Notion
2. Click the **"..."** menu in the top right
3. Scroll to **"Connections"** and click **"Connect to"**
4. Find your integration and click it

### 1.3 Get Your Trading History Database ID

1. Open your Trading History database in Notion
2. Copy the URL - it looks like: `https://www.notion.so/workspace/18ebb8a1ec8b8065be5dff7192f8b45f?v=...`
3. The database ID is the **32-character hex string**: `18ebb8a1ec8b8065be5dff7192f8b45f`
4. Save this ID - you'll need it for GitHub Secrets

### 1.4 Get Your CoinRanking API Key

1. Go to [https://coinranking.com/](https://coinranking.com/)
2. Sign up for a free account
3. Go to your dashboard
4. Copy your API key (starts with `coinranking`)
5. Save this key - you'll need it for GitHub Secrets

**Note:** CoinGecko API is used without authentication (free tier, rate limited to 10-50 calls/min)

### 1.5 Get Your Toggle Block ID (Optional - for status updates)

If you want the script to update a toggle block in your Notion page with run summaries:

1. Create a **toggle block** in your Notion page (any page in your workspace)
2. Right-click the toggle block → **"Copy link to block"**
3. The URL looks like: `https://notion.so/Page-Title#2eebb8a1ec8b8019a0cdfa417c93379b`
4. The block ID is the **32-character hex string after the #**: `2eebb8a1ec8b8019a0cdfa417c93379b`
5. Save this ID - you'll need it for GitHub Secrets

The toggle block will show:
- Run timestamps (human-readable format)
- Pages processed, prices updated, logos updated
- Error count and details (if any)
- Color-coded title (gray for success, red for errors)

---

## Step 2: Set Up GitHub Repository

### 2.1 Create a New Repository

1. Go to [github.com/new](https://github.com/new)
2. Name your repository (e.g., `crypto-tracker-automation`)
3. Set visibility to **Public** (recommended — gives unlimited GitHub Actions minutes; your trading data stays private in Notion, and all credentials are stored in GitHub Secrets, never in the code)
4. **Do NOT** initialize with README, .gitignore, or license
5. Click **"Create repository"**

### 2.2 Upload Files to GitHub

Upload these files to your repository:
- `updateCoins.js`
- `knownSymbols.js`
- `updateKnownSymbols.js`
- `package.json`
- `package-lock.json`
- `.github/workflows/cronjob.yml`
- `README.md`
- `.gitignore`
- `.env.example` (**do NOT upload `.env`**)

**Via GitHub Web Interface:**
1. Click **"uploading an existing file"** on the Quick Setup page
2. Drag and drop all files listed above
3. Commit directly to main branch

**Via Git CLI:**
```bash
git init
git add updateCoins.js knownSymbols.js updateKnownSymbols.js package.json package-lock.json .github .gitignore .env.example README.md
git commit -m "Initial commit: Crypto tracker automation"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

**Important:** Never commit `.env` files with real credentials!

---

## Step 3: Add GitHub Secrets

GitHub Secrets allow you to securely store sensitive credentials that your workflow needs.

### How to Add Secrets

1. Go to your repository on GitHub
2. Click **Settings** (top menu)
3. In the left sidebar, expand **Secrets and variables** → click **Actions**
4. Click the green **"New repository secret"** button

### Required Secrets

Add the following secrets **one by one**:

#### Secret 1: NOTION_TOKEN
- **Name:** `NOTION_TOKEN` (exactly as shown, case-sensitive)
- **Value:** Your Notion integration token from Step 1.1
- Click **"Add secret"**

#### Secret 2: DB_TRADING_HISTORY_ID
- **Name:** `DB_TRADING_HISTORY_ID` (exactly as shown, case-sensitive)
- **Value:** Your Trading History database ID from Step 1.3
- Click **"Add secret"**

#### Secret 3: COINRANKING_API_KEY
- **Name:** `COINRANKING_API_KEY` (exactly as shown, case-sensitive)
- **Value:** Your CoinRanking API key from Step 1.4
- Click **"Add secret"**

#### Secret 4: NOTION_TOGGLE_BLOCK_ID (Optional)
- **Name:** `NOTION_TOGGLE_BLOCK_ID` (exactly as shown, case-sensitive)
- **Value:** Your toggle block ID from Step 1.5
- Click **"Add secret"**
- **Note:** If you skip this, the script will still run but won't update a status block

### Verify Secrets Are Added

After adding all secrets, you should see them listed on the Actions secrets page:
```
NOTION_TOKEN
DB_TRADING_HISTORY_ID
COINRANKING_API_KEY
NOTION_TOGGLE_BLOCK_ID (optional)
```

**Important:** You cannot view secret values after saving them. If you need to update a secret, you must delete and re-add it.

---

## Step 4: Enable GitHub Actions

GitHub Actions should be enabled by default, but let's verify:

1. Go to your repository's **Settings**
2. In the left sidebar, click **Actions** → **General**
3. Under "Actions permissions", select:
   - ✅ **Allow all actions and reusable workflows**
4. Scroll down to "Workflow permissions"
5. Select:
   - ✅ **Read and write permissions**
6. Click **Save**

---

## Step 5: Test the Workflow

Now let's make sure everything works!

### 5.1 Manual Test Run

1. Go to the **Actions** tab in your repository
2. In the left sidebar, click **"Run Crypto Notion Sync"**
3. On the right side, click the **"Run workflow"** dropdown
4. Leave the branch as `main` (or `master`)
5. Click the green **"Run workflow"** button

### 5.2 Monitor the Run

1. Wait a few seconds, then refresh the page
2. You should see a new workflow run appear (yellow indicator = in progress)
3. Click on the workflow run to see details
4. Click on the **"run-script"** job to see logs

### 5.3 Expected Successful Output

If everything is configured correctly, you should see logs like:
```
🔧 Script started at 2026-01-20T10:30:00.000Z

📄 Fetched 25 total pages from Notion
✅ 25 pages with valid tickers

============================================================
📊 SUMMARY
============================================================
⏰ Started:  2026-01-20T10:30:00.000Z
⏰ Finished: 2026-01-20T10:30:15.000Z
📄 Total pages processed: 25
💰 Prices updated: 10
🎨 Logos updated: 3
❌ Errors: 0
============================================================

✅ Toggle block updated successfully
Script Duration: 15.234s
```

### 5.4 Verify Updates in Notion

1. Open your **Trading History** database in Notion
2. Verify that:
   - ✅ **Current Price** values are updated for active trades
   - ✅ **Logos** appear as page icons for coins that were missing them
3. If you configured a toggle block, check that it shows the run summary

---

## Step 6: Verify Scheduled Runs

The workflow is configured to run automatically every 5 minutes, 24/7.

### Check Scheduled Runs

1. Go to the **Actions** tab
2. Within the next 5-10 minutes you should see a new workflow run appear automatically
3. Each run should show a "schedule" trigger (not "workflow_dispatch")

> **Note:** GitHub's scheduler can sometimes delay the first few cron runs by a few minutes after a workflow is first enabled. This is normal.

---

## Features

### 4 Integrated Automations

1. **Automatic Price Updates**: Fetches real-time crypto prices from CoinGecko for trades where `Trading = true`
2. **Logo Management**: Fetches and caches crypto logos from CoinRanking (with CoinGecko fallback) for `Active = true` entries
3. **Time Hierarchy Auto-fill**: Automatically links closed trades to Day/Week/Month tracker pages based on Exit Date, creating tracker pages as needed
4. **Realized Balance Auto-fill**: Copies the calculated Realised Balance from linked Trading Accounts to active non-trading positions

### Supporting Features

- **Smart Caching**: Stores UUIDs and logos locally to minimize API calls
- **Error Handling**: Continues processing other tickers if one fails, with detailed error reporting
- **Summary Statistics**: Clean output showing all 4 automations and any errors encountered
- **Notion Status Updates**: Automatically updates a toggle block in your Notion page with run summaries and error details
- **GitHub Actions Integration**: Runs automatically on a schedule - no manual intervention needed
- **Tracker Creation**: Automatically creates Day/Week/Month tracker pages if they don't exist

## How It Works

### Automation Pipeline

1. **Fetches all pages** from your Trading History database
2. **Filters pages** with valid ticker symbols

### Automation 1: Price Updates
3. **Updates prices** only for entries where the `Trading` formula returns `true`:
   - Trading = true when: `Active = true` AND `Entry Price` is filled AND `Current Price` is filled AND `Initial Margin` is filled
4. **Caches data** to reduce API calls on subsequent runs

### Automation 2: Logo Updates
5. **Updates logos** only for entries where `Active = true` (including planned trades)
6. **Uses CoinRanking API** as primary source, with CoinGecko fallback

### Automation 3: Time Hierarchy Auto-fill
7. **Processes closed trades** where `Active = false`
8. **Extracts Exit Date** from each closed trade
9. **Generates tracker page titles** in the format:
   - Daily: `YYYY/MM/DD` (e.g., "2025/12/04")
   - Weekly: `YYYY/MM - WEEK WW` (e.g., "2025/12 - WEEK 49")
   - Monthly: `YYYY/MM - MMM` (e.g., "2025/11 - NOV")
10. **Queries or creates tracker pages** if they don't exist
11. **Links the trade** to Day/Week/Month tracker pages via relation properties

### Automation 4: Realized Balance Auto-fill
12. **Processes non-trading positions** where `Active = true` AND `Trading = false`
13. **Extracts linked Trading Account** from each position
14. **Fetches Realised Balance** from the Account's formula property
15. **Updates the trade's Realised Balance** property

### Summary & Logging
16. **Updates Notion toggle block** with run summary and error details (optional)
17. **Displays statistics** for all 4 automations: prices, logos, time hierarchy, realized balances

---

## Database Schema Requirements

Your Trading History database must have these properties for the automation to work:

### Required Properties

- **Ticker** (Title): The crypto symbol (e.g., BTC, ETH, SOL)
- **Current Price** (Number): Will be auto-updated by this script
- **Trading** (Formula): Returns `true` when the trade is actively trading
- **Active** (Formula): Returns `true` when the trade is active (including planned)


### Update Scenarios

| Scenario | Price Updated? | Logo Updated? |
|----------|----------------|---------------|
| Active trade (Trading=true) | ✅ Yes | ✅ Yes (if missing) |
| Planned trade (Active=true, Trading=false) | ❌ No | ✅ Yes (if missing) |
| Closed trade (Active=false) | ❌ No | ❌ No |
| Entry with existing logo | Depends on Trading | ❌ No (already has logo) |

---

## Caching System

The script uses `coinranking_cache.json` to store:
- CoinRanking UUIDs for each ticker
- Logo URLs for each ticker

**Benefits:**
- Reduces API calls (faster, cheaper)
- CoinRanking has lower rate limits than CoinGecko
- Logos rarely change, so cache them indefinitely

**When cache is used:**
- On every run after the first
- Only fetches new data for new tickers

**Note:** The cache file is stored in the GitHub Actions runner and persists across workflow runs.

---

## Known Symbols

The `knownSymbols.js` file contains a mapping of the top 100+ crypto symbols to their CoinGecko IDs. This speeds up price lookups and reduces API calls.

**To update known symbols:**
The `updateKnownSymbols.js` script fetches the latest top 100 coins by market cap from CoinGecko. You can run this periodically to keep the mapping current.

---

## Troubleshooting

### Error: "Required secrets are missing"

**Problem:** The workflow log shows:
```
Error: Required secrets are missing. Please configure NOTION_TOKEN, DB_TRADING_HISTORY_ID, and COINRANKING_API_KEY in repository secrets.
```

**Solution:**
1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Verify all three required secrets are present
3. Check that secret names are **exactly** as specified (case-sensitive):
   - `NOTION_TOKEN`
   - `DB_TRADING_HISTORY_ID`
   - `COINRANKING_API_KEY`
4. If any are missing or misspelled, add/update them
5. Re-run the workflow

### Error: "Could not find database"

**Problem:** Script fails with Notion API error about database not found.

**Solution:**
1. Verify your `DB_TRADING_HISTORY_ID` is correct:
   - Open your Trading History database in Notion
   - Copy the URL
   - Extract the 32-character hex string
2. **Make sure you've shared the database with your Notion integration:**
   - Open the database in Notion
   - Click "..." menu → Connections → Connect to [your integration]
3. Update the `DB_TRADING_HISTORY_ID` secret if needed

### Error: "No price for SYMBOL"

**Problem:** Script logs show "No price data for SYMBOL" errors.

**Causes & Solutions:**
- The symbol might not be in the top coins list
- CoinGecko might not recognize the symbol
- Check if the ticker is spelled correctly in Notion
- Add custom mapping to `knownSymbols.js` if needed

### Error: "No UUID for SYMBOL"

**Problem:** Script logs show "No UUID found for SYMBOL" errors.

**Causes & Solutions:**
- CoinRanking doesn't have this coin in their database
- The symbol might be misspelled
- Try updating the ticker in Notion to match the official symbol

### Error: CoinRanking API failures

**Problem:** Many UUID lookup failures in logs.

**Solution:**
1. Check your `COINRANKING_API_KEY` is valid:
   - Log into [coinranking.com](https://coinranking.com)
   - Go to your dashboard
   - Verify your API key is active
2. Check if you've exceeded your rate limit (varies by plan)
3. Update the secret if needed

### Error: Notion API failures

**Problem:** "Failed to update SYMBOL" errors in logs.

**Solution:**
1. Check your Notion API token is valid and not expired
2. Verify the database is shared with your integration
3. Verify the database ID is correct (32-character hex string)
4. Check Notion API status: [https://status.notion.so/](https://status.notion.so/)

### API Rate Limits Exceeded

**Problem:** Script logs show rate limit errors.

**Solutions:**
1. **CoinGecko:** Free tier is 10-50 calls/min
   - The script batches requests to minimize calls
   - Consider reducing run frequency if you have many trades
2. **CoinRanking:** Check your plan's rate limits
   - Upgrade your plan if needed
   - The script caches UUIDs to minimize calls
3. **Notion:** 3 requests/sec per integration
   - This is rarely an issue unless you have 100+ trades

**Adjust schedule if needed:** See "Customizing the Schedule" section below.

### Workflow Not Running Automatically

**Problem:** Scheduled runs aren't happening.

**Solution:**
1. Check that the `.github/workflows/cronjob.yml` file exists in your repo
2. Go to **Settings** → **Actions** → **General**
3. Verify Actions are enabled (not disabled)
4. Check that the repository isn't archived or suspended
5. Wait 10-15 minutes - sometimes the first scheduled run takes time
6. GitHub may disable schedules on inactive repos - push a commit to reactivate

### Toggle Block Not Updating

**Problem:** Script runs successfully but toggle block doesn't update.

**Solution:**
1. Verify `NOTION_TOGGLE_BLOCK_ID` secret is set correctly
2. Check that the toggle block ID is the correct 32-character hex string
3. Verify the page containing the toggle block is shared with your integration
4. The script will log "⚠️ NOTION_TOGGLE_BLOCK_ID not set" if the secret is missing

---

## Customizing the Schedule

Want to change when the workflow runs? Edit `.github/workflows/cronjob.yml`:

### Run Every 5 Minutes (All Day)
```yaml
schedule:
  - cron: '*/5 * * * *'
```

### Run Every 30 Minutes (During Trading Hours)
```yaml
schedule:
  - cron: '*/30 0-9 * * *'   # Every 30 min from 00:00–09:59 UTC
  - cron: '*/30 15-23 * * *' # Every 30 min from 15:00–23:59 UTC
```

### Run Every Hour (All Day)
```yaml
schedule:
  - cron: '0 * * * *'
```

### Run Only During US Trading Hours
```yaml
schedule:
  - cron: '*/10 13-21 * * 1-5'  # Every 10 min, 1pm-9pm UTC, Mon-Fri
```

### Cron Syntax Reference
```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-6, Sunday=0)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

**Examples:**
- `*/10 * * * *` = Every 10 minutes
- `0 */2 * * *` = Every 2 hours (on the hour)
- `0 9 * * 1-5` = 9am UTC, Monday-Friday only
- `*/15 9-17 * * *` = Every 15 min, 9am-5pm UTC

After editing, commit and push the changes to GitHub. The new schedule will take effect on the next run.

---

## Advanced Configuration

### Custom CoinGecko ID Mappings

If a crypto symbol maps to the wrong CoinGecko ID, edit `knownSymbols.js`:

```javascript
const knownSymbols = {
  "BTC": "bitcoin",
  "ETH": "ethereum",
  "MYCOIN": "correct-coingecko-id", // Add custom mapping here
  // ...
};
```

Commit and push the changes to GitHub.

---

## API Rate Limits Reference

| Service | Free Tier Limit | Notes |
|---------|----------------|-------|
| CoinGecko | 10-50 calls/min | No API key needed, rate varies |
| CoinRanking | Varies by plan | Free tier has limited calls/day |
| Notion | 3 requests/sec | Per integration token |

The script is optimized to minimize API calls through:
- Batch price fetching (one call for all symbols)
- UUID and logo caching
- Smart filtering (only updates where needed)

---

## Cost Considerations

### GitHub Actions — $0

This repository is **public**, so GitHub Actions minutes are **unlimited and free**.

With the default schedule (every 5 minutes, 24/7):
- ~30 seconds per run
- ~288 runs/day
- ~8,640 runs/month
- **Cost: $0**

### API Costs — $0

| Service | Usage | Cost |
|---------|-------|------|
| CoinGecko | Prices (no API key needed) | Free |
| CoinRanking | Logo fetching (10,000 req/month free, caching reduces this to ~300-500/month) | Free |
| Notion API | Database reads/writes | Free |

**Total monthly cost: $0**

---

## Security Best Practices

1. ✅ **Keep your repository public** — the code contains no credentials or trading data. All sensitive values (Notion token, database IDs, API keys) are stored in GitHub Secrets, never in the code.
2. ✅ **Never commit `.env` files** - they're in `.gitignore` for a reason
3. ✅ **Use GitHub Secrets** for all sensitive credentials
4. ✅ **Rotate API keys periodically** (every 3-6 months)
5. ✅ **Monitor workflow logs** for suspicious activity or unexpected errors
6. ✅ **Review Actions logs regularly** to ensure automation is working correctly
7. ✅ **Limit integration permissions** in Notion to only the databases you need

---

## Monitoring & Notifications

### Enable Email Notifications

Get notified when workflows fail:

1. Go to your GitHub **Settings** (user settings, not repo)
2. Click **Notifications** in the left sidebar
3. Scroll to **Actions**
4. Check ✅ **"Send notifications for failed workflows only"**
5. Choose email or web notifications

### Check Workflow Status

- **Actions tab**: See all workflow runs (success/failure)
- **Badge**: Add a status badge to your repo README (optional)
- **Notion toggle block**: Check the latest run summary in your Notion page

---

## Summary Checklist

Before considering setup complete, verify:

- [ ] Repository created on GitHub (**public** recommended for unlimited Actions minutes)
- [ ] All files uploaded (including `.github/workflows/cronjob.yml`)
- [ ] All required secrets added:
  - [ ] `NOTION_TOKEN`
  - [ ] `DB_TRADING_HISTORY_ID`
  - [ ] `COINRANKING_API_KEY`
  - [ ] `NOTION_TOGGLE_BLOCK_ID` (optional)
- [ ] GitHub Actions enabled in repository settings
- [ ] Manual test run completed successfully
- [ ] Notion database shows updated prices
- [ ] Notion database shows updated logos (for entries missing them)
- [ ] Scheduled runs are working (check after 1 hour)
- [ ] No errors in workflow logs
- [ ] Toggle block status updates working (if configured)
- [ ] Email notifications enabled (optional but recommended)

---

## Support

If you encounter issues not covered in the troubleshooting section:

1. ✅ Check the GitHub Actions logs for detailed error messages
2. ✅ Verify all prerequisites are met (API keys, database shared, etc.)
3. ✅ Check API service status pages (Notion, CoinGecko, CoinRanking)
4. ✅ Review the workflow file for syntax errors
5. ✅ Try a manual workflow run to test immediately

---

## What's Next?

Once your automation is running smoothly:

1. ✅ Monitor the first few days to ensure accuracy
2. ✅ Adjust the schedule if needed for your timezone
3. ✅ Add more custom symbol mappings to `knownSymbols.js` as needed
4. ✅ Set up email notifications for workflow failures
5. ✅ Consider expanding to other automation tasks (balance reconciliation, etc.)

**Congratulations!** Your crypto tracker automation is now live and running on autopilot. 🚀

---

## License

This automation script is provided as-is for personal use with your Notion workspace.
