// updateKnownSymbols.js
const fs = require("fs");
const axios = require("axios");

async function updateKnownSymbols() {
  try {
    const res = await axios.get("https://api.coingecko.com/api/v3/coins/markets", {
      params: {
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: 100,
        page: 1,
      },
    });

    const topCoins = res.data;

    const lines = [`const knownSymbols = {\n`];
    for (const coin of topCoins) {
      const key = coin.symbol.toUpperCase();
      const value = coin.id;
      // Always quote the key to handle special characters, digits, or reserved words
      lines.push(`  "${key}": "${value}",\n`);
    }
    lines.push("};\n\nmodule.exports = knownSymbols;\n");

    fs.writeFileSync("knownSymbols.js", lines.join(""));
    console.log("✅ knownSymbols.js updated with top 100 coins.");
  } catch (err) {
    console.error("❌ Failed to update knownSymbols.js:", err.message);
  }
}

updateKnownSymbols();