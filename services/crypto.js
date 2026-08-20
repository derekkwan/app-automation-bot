const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getUSDTBalance(address) {
    if (!address || !address.startsWith('T')) return 0;

    // Nguồn 1: TRONSCAN API
    try {
        const urlScan = `https://api.tronscan.org/api/account/tokens?address=${address}&start=0&limit=20`;
        const resScan = await fetch(urlScan, { headers });
        if (resScan.ok) {
            const dataScan = await resScan.json();
            if (dataScan && dataScan.data) {
                const usdt = dataScan.data.find(t => t.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
                return usdt ? parseFloat(usdt.balance) / Math.pow(10, usdt.tokenDecimal) : 0;
            }
        }
    } catch (err) {}

    // Nguồn 2: TRONGRID API (Dự phòng)
    try {
        const urlGrid = `https://api.trongrid.io/v1/accounts/${address}`;
        const resGrid = await fetch(urlGrid, { headers });
        if (resGrid.ok) {
            const dataGrid = await resGrid.json();
            if (dataGrid && dataGrid.data && dataGrid.data.length > 0) {
                const trc20List = dataGrid.data[0].trc20 || [];
                for (const item of trc20List) {
                    if (item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) {
                        return parseFloat(item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) / 1000000;
                    }
                }
                return 0;
            }
        }
    } catch (err) {
        console.error(`❌ Lỗi quét ví ${address}`);
    }

    return null;
}

async function getCryptoData() {
    try {
        const coinGroups = {
            "💎 *Hệ Bitcoin & Vàng số:*": ['BTC'],
            "🔹 *Hệ Ethereum (ETH & L2):*": ['ETH', 'POL', 'ARB', 'OP'],
            "🟣 *Hệ Solana (SOL Ecosystem):*": ['SOL', 'RAY', 'JUP'],
            "🟡 *Hệ BNB Chain (Binance):*": ['BNB', 'CAKE'],
            "🌐 *Layer 1 & Crypto chính khác:*": ['XRP', 'ADA', 'AVAX', 'LINK', 'DOGE']
        };

        const allCoins = Object.values(coinGroups).flat();
        const requests = allCoins.map(coin => 
            fetch(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`, { headers })
                .then(res => res.json())
                .then(data => ({
                    coin,
                    price: data?.data?.amount ? `$${parseFloat(data.data.amount).toLocaleString('en-US', { maximumFractionDigits: parseFloat(data.data.amount) < 1 ? 4 : 2 })}` : 'N/A'
                }))
                .catch(() => ({ coin, price: 'N/A' }))
        );

        const results = await Promise.all(requests);
        const priceMap = {};
        results.forEach(item => { priceMap[item.coin] = item.price; });

        let output = "";
        for (const [groupName, coins] of Object.entries(coinGroups)) {
            output += `${groupName}\n`;
            coins.forEach(coin => { output += `  • *${coin}:* ${priceMap[coin] || 'N/A'}\n`; });
            output += "\n";
        }
        return output.trim();
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

module.exports = { getUSDTBalance, getCryptoData, sleep, headers };
