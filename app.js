const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

async function sendTelegramMessage(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error.message);
    }
}

// 1. Lấy giá Crypto phân nhóm rõ ràng theo Hệ sinh thái
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
                .then(data => {
                    const amount = parseFloat(data?.data?.amount);
                    let formatted = 'N/A';
                    if (amount) {
                        formatted = `$${amount.toLocaleString('en-US', { maximumFractionDigits: amount < 1 ? 4 : 2 })}`;
                    }
                    return { coin, price: formatted };
                })
                .catch(() => ({ coin, price: 'N/A' }))
        );

        const results = await Promise.all(requests);
        const priceMap = {};
        results.forEach(item => { priceMap[item.coin] = item.price; });

        let output = "";
        for (const [groupName, coins] of Object.entries(coinGroups)) {
            output += `${groupName}\n`;
            coins.forEach(coin => {
                output += `  • *${coin}:* ${priceMap[coin] || 'N/A'}\n`;
            });
            output += "\n";
        }

        return output.trim();
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

// 2. Lấy giá Thị trường Quốc tế từ Yahoo Finance
async function fetchYahooPrice(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        return price ? `$${parseFloat(price).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
    } catch (err) {
        return 'N/A';
    }
}

async function getGlobalMarketData() {
    const [apple, gold, oil] = await Promise.all([
        fetchYahooPrice('AAPL'),
        fetchYahooPrice('GC=F'),
        fetchYahooPrice('CL=F')
    ]);

    return `• *Cổ phiếu Apple:* ${apple}\n` +
           `• *Vàng:* ${gold}/oz\n` +
           `• *Dầu WTI:* ${oil}/thùng`;
}

// 3. Lãi suất tiết kiệm động 12 tháng
async function getBankRates() {
    try {
        const res = await fetch('https://api.webtygia.com/api/bank-rates', { headers });
        const json = await res.json();
        
        if (json && json.data) {
            const vcb = json.data.find(b => b.code === 'VCB' || b.name.includes('Vietcombank'))?.rate12m || '7.2%';
            const mb = json.data.find(b => b.code === 'MB' || b.name.includes('MB'))?.rate12m || '7.4%';
            const tcb = json.data.find(b => b.code === 'TCB' || b.name.includes('Techcombank'))?.rate12m || '7.3%';
            const acb = json.data.find(b => b.code === 'ACB' || b.name.includes('ACB'))?.rate12m || '7.1%';

            return `• *Vietcombank (12T):* ${vcb}\n` +
                   `• *MB Bank (12T):* ${mb}\n` +
                   `• *Techcombank (12T):* ${tcb}\n` +
                   `• *ACB (12T):* ${acb}`;
        }
    } catch (error) {
        return `• *Vietcombank (12T):* ~7.2%/năm\n` +
               `• *MB Bank (12T):* ~7.4%/năm\n` +
               `• *Techcombank (12T):* ~7.3%/năm\n` +
               `• *ACB (12T):* ~7.1%/năm`;
    }
}

// 4. Tổng hợp và gửi báo cáo
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu báo cáo...");
    const [cryptoData, globalMarketData, bankData] = await Promise.all([
        getCryptoData(),
        getGlobalMarketData(),
        getBankRates()
    ]);

    const now = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

    const overviewReport = `📊 *BÁO CÁO TÀI CHÍNH (TEST 10 PHÚT - ${now})*\n\n` +
                            `🪙 *CÁC HỆ SINH THÁI CRYPTO:*\n${cryptoData}\n\n` +
                            `📈 *Thị trường quốc tế:*\n${globalMarketData}\n\n` +
                            `🏦 *Lãi suất tiết kiệm động (12 tháng):*\n${bankData}`;
    
    await sendTelegramMessage(overviewReport);
}

// Lịch gửi 10 phút/lần
cron.schedule('*/10 * * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động (Test 10 phút/lần)!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});

// Chạy test lập tức khi start
generateDailyReport();
