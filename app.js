const axios = require('axios');
const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Header giả lập trình duyệt
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

async function sendTelegramMessage(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error.message);
    }
}

// 1. Lấy Crypto qua CoinCap (Rất uy tín, không block Cloud)
async function getCryptoData() {
    try {
        const [btcRes, ethRes] = await Promise.all([
            axios.get('https://api.coincap.io/v2/assets/bitcoin', { headers }),
            axios.get('https://api.coincap.io/v2/assets/ethereum', { headers })
        ]);
        
        const btc = parseFloat(btcRes.data.data.priceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 });
        const eth = parseFloat(ethRes.data.data.priceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 });
        
        return `• *Bitcoin:* $${btc}\n• *Ethereum:* $${eth}`;
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

// 2. Lấy giá Thị trường qua Stooq API (Dạng JSON miễn phí, hoạt động 100% trên Render)
async function fetchStooqPrice(symbol) {
    try {
        const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=json`;
        const res = await axios.get(url, { headers });
        const price = res.data?.symbols?.[0]?.close;
        return price ? `$${parseFloat(price).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
    } catch (err) {
        return 'N/A';
    }
}

async function getMarketData() {
    const [apple, gold, oil] = await Promise.all([
        fetchStooqPrice('aapl.us'), // Apple
        fetchStooqPrice('xauusd'),  // Vàng
        fetchStooqPrice('cl.f')     // Dầu WTI
    ]);

    return `• *Cổ phiếu Apple:* ${apple}\n• *Vàng:* ${gold}/oz\n• *Dầu WTI:* ${oil}/thùng`;
}

// 3. Tổng hợp báo cáo
async function generateDailyReport() {
    const [cryptoData, marketData] = await Promise.all([
        getCryptoData(),
        getMarketData()
    ]);

    const report = `📊 *BÁO CÁO THỊ TRƯỜNG MỖI NGÀY*\n\n` +
                   `🪙 *Tiền mã hóa:*\n${cryptoData}\n\n` +
                   `📈 *Thị trường truyền thống:*\n${marketData}`;

    await sendTelegramMessage(report);
}

cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});

generateDailyReport();
