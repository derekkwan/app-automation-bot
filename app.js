const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Tắt cảnh báo từ thư viện Yahoo Finance
if (yahooFinance && yahooFinance.suppressNotices) {
    yahooFinance.suppressNotices(['yahooSurvey']);
}

// Hàm gửi tin nhắn qua Telegram
async function sendTelegramMessage(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log("Thiếu TELEGRAM_TOKEN hoặc TELEGRAM_CHAT_ID!");
        return;
    }
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'Markdown'
        });
        console.log("Đã gửi báo cáo qua Telegram thành công!");
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error.message);
    }
}

// 1. Lấy giá Crypto từ Binance API (Ổn định 100% trên Cloud)
async function getCryptoData() {
    try {
        const [btcRes, ethRes] = await Promise.all([
            axios.get('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'),
            axios.get('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT')
        ]);
        
        const btc = parseFloat(btcRes.data.price).toLocaleString('en-US', { maximumFractionDigits: 2 });
        const eth = parseFloat(ethRes.data.price).toLocaleString('en-US', { maximumFractionDigits: 2 });
        
        return `• *Bitcoin:* $${btc}\n• *Ethereum:* $${eth}`;
    } catch (error) {
        return "• Crypto: Lỗi kết nối API";
    }
}

// 2. Lấy dữ liệu thị trường từ Yahoo Finance
async function getMarketData() {
    const fetchQuote = async (symbol) => {
        try {
            const res = await yahooFinance.quote(symbol);
            if (res && res.regularMarketPrice) {
                return `$${res.regularMarketPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
            }
            return 'N/A';
        } catch (err) {
            return 'N/A';
        }
    };

    const [apple, gold, oil] = await Promise.all([
        fetchQuote('AAPL'),
        fetchQuote('GC=F'),
        fetchQuote('CL=F')
    ]);

    return `• *Cổ phiếu Apple:* ${apple}\n• *Vàng:* ${gold}/oz\n• *Dầu WTI:* ${oil}/thùng`;
}

// 3. Tổng hợp và gửi Báo cáo
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu thị trường...");
    
    const [cryptoData, marketData] = await Promise.all([
        getCryptoData(),
        getMarketData()
    ]);

    const report = `📊 *BÁO CÁO THỊ TRƯỜNG MỖI NGÀY*\n\n` +
                   `🪙 *Tiền mã hóa:*\n${cryptoData}\n\n` +
                   `📈 *Thị trường truyền thống:*\n${marketData}`;

    console.log(report);
    await sendTelegramMessage(report);
}

// Đặt lịch gửi tự động 08:00 sáng mỗi ngày
cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên port ${PORT}`);
});

// Chạy test ngay 1 lần khi khởi động
generateDailyReport();
