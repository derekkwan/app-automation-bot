const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Header giả lập trình duyệt bắt buộc để tránh bị chặn IP trên Render
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
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

// 1. Lấy giá Crypto từ CryptoCompare (Chuyên dùng cho Server Cloud)
// Lấy giá Crypto chuẩn từ Coinbase API
async function getCryptoData() {
    try {
        const [btcRes, ethRes] = await Promise.all([
            fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { headers }),
            fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { headers })
        ]);
        
        const btcData = await btcRes.json();
        const ethData = await ethRes.json();

        const btcPrice = parseFloat(btcData?.data?.amount);
        const ethPrice = parseFloat(ethData?.data?.amount);

        const btc = btcPrice ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
        const eth = ethPrice ? `$${ethPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
        
        return `• *Bitcoin:* ${btc}\n• *Ethereum:* ${eth}`;
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}


// 2. Lấy giá Thị trường từ Yahoo Finance v8 Chart API
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

async function getMarketData() {
    const [apple, gold, oil] = await Promise.all([
        fetchYahooPrice('AAPL'),
        fetchYahooPrice('GC=F'),
        fetchYahooPrice('CL=F')
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
