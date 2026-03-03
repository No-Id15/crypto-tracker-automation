const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { Client } = require("@notionhq/client");

// Load .env only if it exists (for local development)
// On GitHub Actions, environment variables are injected via secrets
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  timeoutMs: 60000,
  notionVersion: "2025-09-03", // Required for template support
});
const CACHE_PATH = path.resolve(__dirname, "coinranking_cache.json");
const GECKO_LIST_CACHE_PATH = path.resolve(__dirname, "coingecko_list_cache.json");
const GECKO_LIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const knownSymbols = require("./knownSymbols");

/* ------------------------ UTILITIES ------------------------ */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Batch processing with controlled concurrency
async function batchProcess(items, fn, concurrency = 3, delayMs = 350) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) {
      await sleep(delayMs); // Throttle between batches
    }
  }
  return results;
}

function textBlock(content, { color, ...annotations } = {}) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content }, annotations }],
      ...(color && { color }),
    },
  };
}

function getTicker(page) {
  return page.properties["Ticker"]?.title?.[0]?.plain_text?.trim()?.toUpperCase();
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
}

/* ------------------------ RETRY LOGIC ------------------------ */

async function retryNotionCall(fn, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTimeout = err.code === 'notionhq_client_request_timeout';
      const isRateLimit = err.code === 'rate_limited' || err.status === 429;
      const isConnectionTimeout = err.cause?.code === 'UND_ERR_CONNECT_TIMEOUT';
      const isNetworkError = err.message?.includes('fetch failed');
      const shouldRetry = isTimeout || isRateLimit || isConnectionTimeout || isNetworkError;

      if (!shouldRetry || attempt === maxRetries) {
        throw err;
      }

      const backoffDelay = delayMs * Math.pow(2, attempt - 1);
      const errorMsg = err.cause?.code || err.code || err.message;
      console.log(`⚠️ Retry ${attempt}/${maxRetries} after ${backoffDelay}ms (${errorMsg})`);
      await sleep(backoffDelay);
    }
  }
  throw new Error('retryNotionCall: All retries exhausted without returning a value');
}

/* ------------------------ CACHE ------------------------ */

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("⚠️ Failed to load cache:", e.message);
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error("⚠️ Failed to save cache:", e.message);
  }
}

/* ------------------------ NOTION ------------------------ */

// Cache for database ID to data source ID mapping
const dataSourceCache = {};

async function getDataSourceId(databaseId) {
  if (dataSourceCache[databaseId]) {
    return dataSourceCache[databaseId];
  }

  const database = await retryNotionCall(async () =>
    notion.databases.retrieve({ database_id: databaseId })
  );

  // For single-source databases, use the first data source ID
  const dataSourceId = database.data_sources?.[0]?.id || databaseId;
  dataSourceCache[databaseId] = dataSourceId;
  return dataSourceId;
}

async function fetchAllPages(databaseId) {
  const dataSourceId = await getDataSourceId(databaseId);
  const pages = [];
  let cursor = undefined;

  do {
    const response = await retryNotionCall(async () =>
      notion.dataSources.query({
        data_source_id: dataSourceId,
        start_cursor: cursor,
      })
    );

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/* ------------------------ COINRANKING ------------------------ */

async function findUUIDForSymbol(symbol) {
  symbol = symbol.toUpperCase();

  try {
    const res = await axios.get("https://api.coinranking.com/v2/coins", {
      headers: { "x-access-token": process.env.COINRANKING_API_KEY || "" },
      params: { search: symbol, limit: 5 },
    });

    const coins = res.data.data.coins;
    if (!coins || coins.length === 0) return null;

    return coins.find(c => c.symbol.toUpperCase() === symbol) || null;
  } catch (err) {
    console.error(`❌ Failed UUID search for ${symbol}: ${err.message}`);
    return null;
  }
}

async function fetchCoinDataFromCoinRanking(uuid) {
  try {
    const res = await axios.get(`https://api.coinranking.com/v2/coin/${uuid}`, {
      headers: { "x-access-token": process.env.COINRANKING_API_KEY || "" },
    });

    return { logo: res.data.data.coin.iconUrl };
  } catch (err) {
    console.error(`⚠️ Failed to fetch coin data for UUID ${uuid}: ${err.message}`);
    return null;
  }
}

/* ------------------------ COINGECKO ------------------------ */

async function loadSymbolToIdMap() {
  // Check disk cache first
  try {
    if (fs.existsSync(GECKO_LIST_CACHE_PATH)) {
      const cached = JSON.parse(fs.readFileSync(GECKO_LIST_CACHE_PATH, "utf-8"));
      if (Date.now() - cached.timestamp < GECKO_LIST_TTL_MS) {
        console.log("✅ Using cached CoinGecko list (valid for 24h)");
        return { ...knownSymbols, ...cached.symbolMap };
      }
    }
  } catch (err) {
    console.error("⚠️ Failed to load CoinGecko cache:", err.message);
  }

  // Fetch fresh list from API
  try {
    console.log("🔄 Fetching fresh CoinGecko list...");
    const res = await axios.get("https://api.coingecko.com/api/v3/coins/list");
    const symbolMap = {};

    for (const coin of res.data) {
      const sym = coin.symbol.toUpperCase();
      if (!symbolMap[sym]) symbolMap[sym] = coin.id;
    }

    // Save to cache
    try {
      fs.writeFileSync(GECKO_LIST_CACHE_PATH, JSON.stringify({ timestamp: Date.now(), symbolMap }, null, 2));
      console.log("✅ CoinGecko list cached successfully");
    } catch (err) {
      console.error("⚠️ Failed to save CoinGecko cache:", err.message);
    }

    return { ...knownSymbols, ...symbolMap };
  } catch (err) {
    console.error("❌ Failed to load CoinGecko list:", err.message);
    return knownSymbols;
  }
}

async function fetchPricesBatch(ids) {
  if (ids.length === 0) return {};

  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
      params: { ids: ids.join(","), vs_currencies: "usd" },
    });

    return res.data;
  } catch (err) {
    console.error(`⚠️ Failed to fetch prices batch: ${err.message}`);
    return {};
  }
}

async function fetchCoinLogoFromCoinGecko(id) {
  if (!id) return null;

  try {
    const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}`);
    return (
      res.data.image?.large ||
      res.data.image?.thumb ||
      res.data.image?.small ||
      null
    );
  } catch {
    return null;
  }
}

/* ------------------------ SECTION 1: PRICES AND LOGOS ------------------------ */

async function updatePricesAndLogos(pages, cache) {
  const errors = [];
  let updatedPriceCount = 0;
  let updatedLogoCount = 0;

  console.log("\n💰 Starting price and logo updates...");

  const symbolToIdMap = await loadSymbolToIdMap();

  const usablePages = pages.filter(page => {
    const ticker = page.properties["Ticker"]?.title?.[0]?.plain_text?.trim();
    return !!ticker;
  });

  console.log(`✅ ${usablePages.length} pages with valid tickers`);

  const uniqueSymbols = [
    ...new Set(
      usablePages.map(
        page => page.properties["Ticker"]?.title?.[0]?.plain_text?.trim().toUpperCase()
      )
    ),
  ];

  // Pre-fetch UUIDs for uncached symbols
  console.log(`🔍 Checking ${uniqueSymbols.length} unique symbols...`);
  const uncachedSymbols = uniqueSymbols.filter(sym => !cache[sym]?.uuid);

  if (uncachedSymbols.length > 0) {
    console.log(`🔄 Fetching UUIDs for ${uncachedSymbols.length} uncached symbols in parallel...`);
    await batchProcess(
      uncachedSymbols,
      async (symbol) => {
        const info = await findUUIDForSymbol(symbol);
        if (info) {
          cache[symbol] = { uuid: info.uuid, logo: info.iconUrl || null };
        } else {
          errors.push(`No UUID found for ${symbol}`);
        }
      },
      3,
      350
    );
  }

  // Build price data
  const symbolToGeckoId = {};
  const idsToFetch = [];

  for (const sym of uniqueSymbols) {
    const id = symbolToIdMap[sym];
    if (id) {
      symbolToGeckoId[sym] = id;
      idsToFetch.push(id);
    }
  }

  const priceData = await fetchPricesBatch(idsToFetch);

  // Pre-fetch missing logos in parallel
  const pagesNeedingLogos = usablePages.filter(page => {
    const ticker = getTicker(page);
    const active = page.properties["Active"]?.formula?.boolean === true;
    return active && !page.icon && cache[ticker] && !cache[ticker].logo;
  });

  if (pagesNeedingLogos.length > 0) {
    console.log(`🎨 Fetching ${pagesNeedingLogos.length} missing logos in parallel...`);
    await batchProcess(
      pagesNeedingLogos,
      async (page) => {
        const ticker = getTicker(page);
        const cachedEntry = cache[ticker];
        const geckoId = symbolToGeckoId[ticker];
        try {
          const crData = await fetchCoinDataFromCoinRanking(cachedEntry.uuid);
          if (crData?.logo) {
            cachedEntry.logo = crData.logo;
          } else {
            const geckoLogo = await fetchCoinLogoFromCoinGecko(geckoId);
            if (geckoLogo) {
              cachedEntry.logo = geckoLogo;
            }
          }
        } catch (err) {
          errors.push(`Failed to fetch logo for ${ticker}: ${err.message}`);
        }
      },
      3,
      350
    );
  }

  // Process pages with batch updates
  const updateTasks = [];

  for (const page of usablePages) {
    const ticker = getTicker(page);
    const trading = page.properties["Trading"]?.formula?.boolean === true;
    const active = page.properties["Active"]?.formula?.boolean === true;

    const cachedEntry = cache[ticker];
    if (!cachedEntry) continue; // Skip if UUID lookup failed

    const geckoId = symbolToGeckoId[ticker];

    // Price handling (only when Trading = true)
    let coinPrice = null;
    let priceError = false;

    if (trading) {
      coinPrice = priceData[geckoId]?.usd;
      if (coinPrice == null) {
        errors.push(`No price data for ${ticker} (geckoId: ${geckoId || 'not found'})`);
        priceError = true;
        // Don't skip - still try logo update
      }
    }

    // Logo handling (only for Active = true) - logo is now pre-fetched
    const coinLogo = cachedEntry.logo;

    // Build update payload
    const updatePayload = { page_id: page.id, properties: {} };
    let hasUpdates = false;

    if (trading && coinPrice !== null && !priceError) {
      updatePayload.properties["Current Price"] = { number: coinPrice };
      hasUpdates = true;
    }

    if (active && !page.icon && coinLogo) {
      updatePayload.icon = {
        type: "external",
        external: { url: coinLogo },
      };
      hasUpdates = true;
    }

    if (hasUpdates) {
      updateTasks.push({
        payload: updatePayload,
        ticker,
        hasPriceUpdate: trading && coinPrice !== null && !priceError,
        hasLogoUpdate: active && !page.icon && coinLogo,
      });
    }
  }

  // Batch update with concurrency control
  if (updateTasks.length > 0) {
    console.log(`🔄 Updating ${updateTasks.length} pages in batches (3 concurrent)...`);

    const results = await batchProcess(
      updateTasks,
      async (task) => {
        await retryNotionCall(async () => notion.pages.update(task.payload));
        return task; // Return task for counting
      },
      3,
      350
    );

    // Count successes and failures
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        if (updateTasks[idx].hasPriceUpdate) updatedPriceCount++;
        if (updateTasks[idx].hasLogoUpdate) updatedLogoCount++;
      } else {
        errors.push(`Failed to update ${updateTasks[idx].ticker}: ${result.reason?.message}`);
      }
    });
  }

  saveCache(cache);

  return { updatedPriceCount, updatedLogoCount, errors };
}

/* ------------------------ SECTION 2: TIME HIERARCHY ------------------------ */

/**
 * Parse a Notion date string into a Date using UTC date components.
 * - Date-only ("2026-02-16"): parsed directly from the string
 * - Date+time ("2025-12-02T07:42:00.000+00:00"): uses UTC date components
 */
function parseNotionDate(dateString) {
  if (!dateString.includes('T')) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  const d = new Date(dateString);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function formatDaily(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function getWeekNumber(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNum = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function formatWeekly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const week = String(getWeekNumber(date)).padStart(2, "0");
  return `${year}/${month} - WEEK ${week}`;
}

function formatMonthly(date) {
  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const monthAbbrev = monthNames[date.getMonth()];
  return `${year}/${month} - ${monthAbbrev}`;
}

async function deduplicateTrackerPages(pages, propertyName, trackerType) {
  const titleMap = new Map();
  const duplicates = [];

  for (const page of pages) {
    const title = page.properties[propertyName]?.title?.[0]?.plain_text;
    if (!title) continue;

    if (titleMap.has(title)) {
      duplicates.push(page);
    } else {
      titleMap.set(title, page);
    }
  }

  let trackersArchived = 0;

  if (duplicates.length > 0) {
    console.log(`🗑️  Found ${duplicates.length} duplicate ${trackerType} trackers, archiving...`);

    await batchProcess(
      duplicates,
      async (duplicate) => {
        await retryNotionCall(async () =>
          notion.pages.update({
            page_id: duplicate.id,
            archived: true,
          })
        );
        trackersArchived++;
      },
      3,
      350
    );

    console.log(`✅ Archived ${trackersArchived} duplicate ${trackerType} trackers`);
  }

  return {
    trackers: Array.from(titleMap.values()),
    trackersArchived
  };
}

async function getOrCreateTrackerPage(databaseId, propertyName, title, cachedTrackersMap) {
  const existingPage = cachedTrackersMap.get(title);

  if (existingPage) {
    return { id: existingPage.id, created: false };
  }

  const dataSourceId = await getDataSourceId(databaseId);

  const newPage = await retryNotionCall(async () =>
    notion.pages.create({
      parent: { data_source_id: dataSourceId },
      template: {
        type: "default", // Use the database's default template
      },
      properties: {
        [propertyName]: {
          title: [
            {
              text: {
                content: title,
              },
            },
          ],
        },
      },
    })
  );

  cachedTrackersMap.set(title, newPage);
  return { id: newPage.id, created: true };
}

async function updateTimeHierarchy(pages) {
  const errors = [];
  let timeHierarchyUpdated = 0;
  let trackersCreated = 0;
  let trackersArchived = 0;

  console.log("\n📅 Starting time hierarchy updates...");

  try {
    // Fetch all tracker pages
    console.log("📅 Fetching tracker pages...");
    const [dailyTrackersRaw, weeklyTrackersRaw, monthlyTrackersRaw] = await Promise.all([
      fetchAllPages(process.env.DB_DAILY_TRACKER_ID),
      fetchAllPages(process.env.DB_WEEKLY_TRACKER_ID),
      fetchAllPages(process.env.DB_MONTHLY_TRACKER_ID),
    ]);

    console.log(`✅ Loaded ${dailyTrackersRaw.length} daily, ${weeklyTrackersRaw.length} weekly, ${monthlyTrackersRaw.length} monthly trackers`);

    // Deduplicate
    console.log("🧹 Deduplicating tracker pages...");
    const dailyResult = await deduplicateTrackerPages(dailyTrackersRaw, "Day", "daily");
    const weeklyResult = await deduplicateTrackerPages(weeklyTrackersRaw, "Week", "weekly");
    const monthlyResult = await deduplicateTrackerPages(monthlyTrackersRaw, "Month", "monthly");

    const dailyTrackers = dailyResult.trackers;
    const weeklyTrackers = weeklyResult.trackers;
    const monthlyTrackers = monthlyResult.trackers;
    trackersArchived = dailyResult.trackersArchived + weeklyResult.trackersArchived + monthlyResult.trackersArchived;

    console.log(`✅ Deduplicated trackers: ${dailyTrackers.length} daily, ${weeklyTrackers.length} weekly, ${monthlyTrackers.length} monthly`);

    // Build fast lookup maps for O(1) tracker title retrieval and page creation
    const dailyTrackerTitleMap = new Map(
      dailyTrackers.map(t => [t.properties["Day"]?.title?.[0]?.plain_text, t])
    );
    const weeklyTrackerTitleMap = new Map(
      weeklyTrackers.map(t => [t.properties["Week"]?.title?.[0]?.plain_text, t])
    );
    const monthlyTrackerTitleMap = new Map(
      monthlyTrackers.map(t => [t.properties["Month"]?.title?.[0]?.plain_text, t])
    );

    // Also build ID-to-title maps for validation
    const dailyTrackerIdMap = new Map(
      dailyTrackers.map(t => [t.id, t.properties["Day"]?.title?.[0]?.plain_text])
    );
    const weeklyTrackerIdMap = new Map(
      weeklyTrackers.map(t => [t.id, t.properties["Week"]?.title?.[0]?.plain_text])
    );
    const monthlyTrackerIdMap = new Map(
      monthlyTrackers.map(t => [t.id, t.properties["Month"]?.title?.[0]?.plain_text])
    );

    // Filter closed trades from already-fetched pages (no extra query!)
    const closedTrades = pages.filter(page =>
      page.properties["Active"]?.formula?.boolean === false &&
      page.properties["Exit Date"]?.date?.start
    );

    console.log(`🔍 Validating ${closedTrades.length} closed trades for time hierarchy...`);

    // Validate and filter trades needing hierarchy updates
    const tradesNeedingHierarchy = [];
    const correctionReasons = [];
    let alreadyCorrect = 0;

    for (const trade of closedTrades) {
      const ticker = trade.properties["Ticker"]?.title?.[0]?.plain_text?.trim();
      const exitDateObj = trade.properties["Exit Date"]?.date;

      if (!exitDateObj?.start) continue;

      // Fast path: check if relations are missing
      const dayRelation = trade.properties["Day"]?.relation?.[0];
      const weekRelation = trade.properties["Week"]?.relation?.[0];
      const monthRelation = trade.properties["Month"]?.relation?.[0];

      if (!dayRelation || !weekRelation || !monthRelation) {
        // Missing relations - definitely needs update
        tradesNeedingHierarchy.push(trade);
        if (ticker) {
          correctionReasons.push(`${ticker}: Missing ${!dayRelation ? 'Day' : ''}${!weekRelation ? ' Week' : ''}${!monthRelation ? ' Month' : ''}`);
        }
        continue;
      }

      // Slow path: validate existing relations are correct
      const exitDate = parseNotionDate(exitDateObj.start);
      const expectedDay = formatDaily(exitDate);
      const expectedWeek = formatWeekly(exitDate);
      const expectedMonth = formatMonthly(exitDate);

      const actualDay = dailyTrackerIdMap.get(dayRelation.id);
      const actualWeek = weeklyTrackerIdMap.get(weekRelation.id);
      const actualMonth = monthlyTrackerIdMap.get(monthRelation.id);

      // Check if any tracker doesn't match expected format
      if (actualDay !== expectedDay || actualWeek !== expectedWeek || actualMonth !== expectedMonth) {
        tradesNeedingHierarchy.push(trade);
        if (ticker) {
          const mismatches = [];
          if (actualDay !== expectedDay) mismatches.push(`Day (${actualDay} → ${expectedDay})`);
          if (actualWeek !== expectedWeek) mismatches.push(`Week (${actualWeek} → ${expectedWeek})`);
          if (actualMonth !== expectedMonth) mismatches.push(`Month (${actualMonth} → ${expectedMonth})`);
          correctionReasons.push(`${ticker}: ${mismatches.join(', ')}`);
        }
      } else {
        alreadyCorrect++;
      }
    }

    console.log(`✅ ${alreadyCorrect} trades already correct (skipped)`);

    if (correctionReasons.length > 0) {
      console.log(`🔧 Correcting ${tradesNeedingHierarchy.length} trades:`);
      correctionReasons.slice(0, 5).forEach(reason => console.log(`   - ${reason}`));
      if (correctionReasons.length > 5) {
        console.log(`   ... and ${correctionReasons.length - 5} more`);
      }
    } else if (tradesNeedingHierarchy.length > 0) {
      console.log(`🔄 Processing ${tradesNeedingHierarchy.length} trades needing time hierarchy...`);
    }

    const updateTasks = [];

    for (const trade of tradesNeedingHierarchy) {
      const ticker = getTicker(trade);
      if (!ticker) continue;

      const exitDateObj = trade.properties["Exit Date"]?.date;
      if (!exitDateObj?.start) continue;

      const exitDate = parseNotionDate(exitDateObj.start);

      const dayTitle = formatDaily(exitDate);
      const weekTitle = formatWeekly(exitDate);
      const monthTitle = formatMonthly(exitDate);

      try {
        // Parallelize tracker page creation
        const [dayResult, weekResult, monthResult] = await Promise.all([
          getOrCreateTrackerPage(process.env.DB_DAILY_TRACKER_ID, "Day", dayTitle, dailyTrackerTitleMap),
          getOrCreateTrackerPage(process.env.DB_WEEKLY_TRACKER_ID, "Week", weekTitle, weeklyTrackerTitleMap),
          getOrCreateTrackerPage(process.env.DB_MONTHLY_TRACKER_ID, "Month", monthTitle, monthlyTrackerTitleMap),
        ]);

        if (dayResult.created) trackersCreated++;
        if (weekResult.created) trackersCreated++;
        if (monthResult.created) trackersCreated++;

        updateTasks.push({
          tradeId: trade.id,
          ticker,
          dayPageId: dayResult.id,
          weekPageId: weekResult.id,
          monthPageId: monthResult.id,
        });
      } catch (err) {
        errors.push(`Failed to get/create tracker pages for ${ticker}: ${err.message}`);
      }
    }

    // Batch update trades
    if (updateTasks.length > 0) {
      console.log(`🔄 Updating ${updateTasks.length} trades with time hierarchy in batches...`);

      const results = await batchProcess(
        updateTasks,
        async (task) => {
          await retryNotionCall(async () =>
            notion.pages.update({
              page_id: task.tradeId,
              properties: {
                Day: {
                  relation: [{ id: task.dayPageId }],
                },
                Week: {
                  relation: [{ id: task.weekPageId }],
                },
                Month: {
                  relation: [{ id: task.monthPageId }],
                },
              },
            })
          );
          return task; // Return task for counting
        },
        3,
        350
      );

      // Count successes and failures
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          timeHierarchyUpdated++;
        } else {
          errors.push(`Failed to update time hierarchy for ${updateTasks[idx].ticker}: ${result.reason?.message}`);
        }
      });
    }
  } catch (err) {
    errors.push(`Failed to process time hierarchy: ${err.message}`);
  }

  return { timeHierarchyUpdated, trackersCreated, trackersArchived, errors };
}

/* ------------------------ SECTION 3: REALIZED BALANCE ------------------------ */

async function updateRealizedBalances(pages) {
  const errors = [];
  let realizedBalanceUpdated = 0;

  console.log("\n💵 Starting realized balance updates...");

  try {
    // Filter non-trading positions from already-fetched pages (no extra query!)
    const nonTradingPositions = pages.filter(page =>
      page.properties["Active"]?.formula?.boolean === true &&
      page.properties["Trading"]?.formula?.boolean === false
    );

    console.log(`🔄 Processing ${nonTradingPositions.length} non-trading positions for realized balance...`);

    // Extract unique account IDs
    const accountIds = [
      ...new Set(
        nonTradingPositions
          .map(trade => trade.properties["Trading Account"]?.relation?.[0]?.id)
          .filter(Boolean)
      ),
    ];

    // Batch fetch all account pages
    console.log(`📊 Fetching ${accountIds.length} unique account pages...`);
    const accountPagesResults = await Promise.allSettled(
      accountIds.map(id => retryNotionCall(() => notion.pages.retrieve({ page_id: id })))
    );

    const accountMap = {};
    accountPagesResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        accountMap[accountIds[idx]] = result.value;
      } else {
        errors.push(`Failed to fetch account ${accountIds[idx]}: ${result.reason?.message}`);
      }
    });

    // Build update tasks
    const updateTasks = [];

    for (const trade of nonTradingPositions) {
      const ticker = getTicker(trade);
      if (!ticker) continue;

      const accountRelation = trade.properties["Trading Account"]?.relation || [];

      if (accountRelation.length === 0) {
        errors.push(`⚠️ Trade ${ticker} has no linked Trading Account`);
        continue;
      }

      if (accountRelation.length > 1) {
        errors.push(`⚠️ Trade ${ticker} has multiple Trading Accounts (${accountRelation.length} accounts)`);
        continue;
      }

      const accountPageId = accountRelation[0].id;
      const accountPage = accountMap[accountPageId];

      if (!accountPage) continue; // Already logged error above

      const realizedBalance = accountPage.properties["Realised Balance"]?.formula?.number;

      if (realizedBalance == null) {
        const accountName = accountPage.properties["Trading Account"]?.title?.[0]?.plain_text || "Unknown";
        errors.push(`⚠️ Account ${accountName} has null Realised Balance`);
        continue;
      }

      updateTasks.push({
        tradeId: trade.id,
        ticker,
        realizedBalance,
      });
    }

    // Batch update trades
    if (updateTasks.length > 0) {
      console.log(`🔄 Updating ${updateTasks.length} positions with realized balance in batches...`);

      const results = await batchProcess(
        updateTasks,
        async (task) => {
          await retryNotionCall(async () =>
            notion.pages.update({
              page_id: task.tradeId,
              properties: {
                "Realised Balance": {
                  number: task.realizedBalance,
                },
              },
            })
          );
          return task; // Return task for counting
        },
        3,
        350
      );

      // Count successes and failures
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          realizedBalanceUpdated++;
        } else {
          errors.push(`Failed to update realized balance for ${updateTasks[idx].ticker}: ${result.reason?.message}`);
        }
      });
    }
  } catch (err) {
    errors.push(`Failed to process realized balances: ${err.message}`);
  }

  return { realizedBalanceUpdated, errors };
}

/* ------------------------ NOTION TOGGLE BLOCK UPDATE ------------------------ */

async function updateToggleBlock(summary) {
  const toggleBlockId = process.env.NOTION_TOGGLE_BLOCK_ID;

  if (!toggleBlockId) {
    console.log("⚠️ NOTION_TOGGLE_BLOCK_ID not set, skipping toggle block update");
    return;
  }

  const hasErrors = summary.errors.length > 0;
  const titleText = hasErrors ? "Latest automation run ⚠️" : "Latest automation run";
  const titleColor = hasErrors ? "red" : "gray";

  try {
    // Update toggle title and fetch children in parallel
    const [, existingChildren] = await Promise.all([
      retryNotionCall(async () =>
        notion.blocks.update({
          block_id: toggleBlockId,
          toggle: {
            rich_text: [
              {
                type: "text",
                text: { content: titleText },
                annotations: {
                  italic: true,
                  color: titleColor,
                },
              },
            ],
            color: titleColor,
          },
        })
      ),
      retryNotionCall(async () =>
        notion.blocks.children.list({ block_id: toggleBlockId })
      ),
    ]);

    // Delete old children in parallel with higher concurrency (Notion API limit is ~3 req/sec but deletes are fast)
    if (existingChildren.results.length > 0) {
      await batchProcess(
        existingChildren.results,
        async (child) => {
          await retryNotionCall(async () =>
            notion.blocks.delete({ block_id: child.id })
          );
        },
        10, // Increase concurrency from 3 to 10 for deletes
        100 // Reduce delay from 350ms to 100ms
      );
    }

    const contentBlocks = [
      textBlock(`⏰ Started: ${formatTime(summary.startTime)}`),
      textBlock(`⏰ Finished: ${formatTime(summary.endTime)}`),
      textBlock(`📄 Total pages processed: ${summary.totalPages}`),
      textBlock(`💰 Prices updated: ${summary.pricesUpdated}`),
      textBlock(`🎨 Logos updated: ${summary.logosUpdated}`),
      textBlock(`📊 Time hierarchy updated: ${summary.timeHierarchyUpdated} trades`),
      textBlock(`📅 Tracker pages created: ${summary.trackersCreated} pages`),
      textBlock(`🗑️ Duplicate trackers archived: ${summary.trackersArchived} pages`),
      textBlock(`💵 Realized balances updated: ${summary.realizedBalanceUpdated} positions`),
      textBlock(`❌ Errors: ${summary.errors.length}`, hasErrors ? { color: "red" } : {}),
    ];

    if (hasErrors) {
      contentBlocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [
            {
              type: "text",
              text: { content: "⚠️ Error Details:" },
              annotations: { color: "red" },
            },
          ],
        },
      });

      for (const error of summary.errors) {
        contentBlocks.push({
          object: "block",
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              {
                type: "text",
                text: { content: error },
                annotations: { color: "red" },
              },
            ],
          },
        });
      }
    }

    await retryNotionCall(async () =>
      notion.blocks.children.append({
        block_id: toggleBlockId,
        children: contentBlocks,
      })
    );

    console.log("✅ Toggle block updated successfully");
  } catch (err) {
    console.error(`❌ Failed to update toggle block: ${err.message}`);
  }
}

/* ------------------------ MAIN ORCHESTRATOR ------------------------ */

async function main() {
  console.time("Script Duration");
  const startTime = new Date().toISOString();
  console.log(`\n🔧 Script started at ${startTime}\n`);

  // Fetch all pages once
  const pages = await fetchAllPages(process.env.DB_TRADING_HISTORY_ID);

  if (pages.length === 0) {
    console.log("⚠️ No pages found.");
    return;
  }

  console.log(`📄 Fetched ${pages.length} total pages from Notion`);

  const cache = loadCache();

  // Run all sections in parallel for speed (~50% faster than sequential).
  // Each section uses batchProcess with concurrency 3, so up to 9 concurrent
  // Notion requests may occur. If your data volume grows significantly and you
  // start seeing frequent 429 rate-limit retries in the logs, switch to
  // sequential execution (await each section one by one) to stay under the
  // Notion API rate limit of ~3 requests/second.
  const [priceLogoResult, timeResult, balanceResult] = await Promise.all([
    updatePricesAndLogos(pages, cache),
    updateTimeHierarchy(pages),
    updateRealizedBalances(pages),
  ]);

  // Aggregate results
  const summary = {
    startTime,
    endTime: new Date().toISOString(),
    totalPages: pages.length,
    pricesUpdated: priceLogoResult.updatedPriceCount,
    logosUpdated: priceLogoResult.updatedLogoCount,
    timeHierarchyUpdated: timeResult.timeHierarchyUpdated,
    trackersCreated: timeResult.trackersCreated,
    trackersArchived: timeResult.trackersArchived,
    realizedBalanceUpdated: balanceResult.realizedBalanceUpdated,
    errors: [
      ...priceLogoResult.errors,
      ...timeResult.errors,
      ...balanceResult.errors,
    ],
  };

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  console.log(`⏰ Started:  ${startTime}`);
  console.log(`⏰ Finished: ${summary.endTime}`);
  console.log(`📄 Total pages processed: ${summary.totalPages}`);
  console.log(`💰 Prices updated: ${summary.pricesUpdated}`);
  console.log(`🎨 Logos updated: ${summary.logosUpdated}`);
  console.log(`📊 Time hierarchy updated: ${summary.timeHierarchyUpdated} trades`);
  console.log(`📅 Tracker pages created: ${summary.trackersCreated} pages`);
  console.log(`🗑️  Duplicate trackers archived: ${summary.trackersArchived} pages`);
  console.log(`💵 Realized balances updated: ${summary.realizedBalanceUpdated} positions`);
  console.log(`❌ Errors: ${summary.errors.length}`);

  if (summary.errors.length > 0) {
    console.log(`\n⚠️  ERRORS:`);
    summary.errors.forEach((err, idx) => console.log(`   ${idx + 1}. ${err}`));
  }

  console.log(`${'='.repeat(60)}\n`);

  // Update toggle block
  await updateToggleBlock(summary);

  console.timeEnd("Script Duration");
}

main().catch(err => console.error("🚨 Script failed:", err));
