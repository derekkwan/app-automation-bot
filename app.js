const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Gửi tin nhắn Telegram
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

// 1. Lấy giá Crypto từ CoinCap API
async function getCryptoData() {
    try {
        const [btcRes, ethRes] = await Promise.all([
            fetch('https://api.coincap.io/v2/assets/bitcoin'),
            fetch('https://api.coincap.io/v2/assets/ethereum')
        ]);
        
        const btcJson = await btcRes.json();
        const ethJson = await ethRes.json();

        const btc = parseFloat(btcJson.data.priceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 });
        const eth = parseFloat(ethJson.data.priceUsd).toLocaleString('en-US', { maximumFractionDigits: 2 });
        
        return `• *Bitcoin:* $${btc}\n• *Ethereum:* $${eth}`;
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

// 2. Lấy giá Thị trường từ Stooq API
async function fetchStooqPrice(symbol) {
    try {
        const res = await fetch(`https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=json`);
        const json = await res.json();
        const price = json?.symbols?.[0]?.close;
        return price ? `$${parseFloat(price).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
    } catch (err) {
        return 'N/A';
    }
}

async function getMarketData() {
    const [apple, gold, oil] = await Promise.all([
        fetchStooqPrice('aapl.us'),
        fetchStooqPrice('xauusd'),
        fetchStooqPrice('cl.f')
    ]);

    return `• *Cổ phiếu Apple:* ${apple}\n• *Vàng:* ${gold}/oz\n• *Dầu WTI:* ${oil}/thùng`;
}

// 3. Tổng hợp báo cáo
async function generateDailyReport() {
    console.log("Đang lấy dữ liệu thị trường...");
    const [cryptoData, marketData] = await Promise.all([
        getCryptoData(),
        getMarketData()
    ]);

    const report = `📊 *BÁO CÁO THỊ TRƯỜNG MỖI NGÀY*\n\n` +
                   `🪙 *Tiền mã hóa:*\n${cryptoData}\n\n` +
                   `📈 *Thị trường truyền thống:*\n${marketData}`;

    await sendTelegramMessage(report);
}

// Lên lịch chạy lúc 8 giờ sáng mỗi ngày
cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});

// Chạy thử ngay lập tức khi khởi động
generateDailyReport();
