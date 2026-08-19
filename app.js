const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Lấy Token và Chat ID từ biến môi trường (Environment Variables)
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

// 1. Lấy giá Crypto
async function getCryptoData() {
    try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const btc = response.data?.bitcoin?.usd || 'N/A';
        const eth = response.data?.ethereum?.usd || 'N/A';
        return `• *Bitcoin:* $${btc}\n• *Ethereum:* $${eth}`;
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

// 2. Lấy dữ liệu thị trường
async function getMarketData() {
    try {
        const fetchQuote = async (symbol) => {
            try {
                const res = await yahooFinance.quote(symbol);
                return res?.regularMarketPrice ? `$${res.regularMarketPrice}` : 'N/A';
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
    } catch (error) {
        return "• Thị trường: Không lấy được dữ liệu";
    }
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

    // In ra console log
    console.log(report);
    
    // Gửi trực tiếp về Telegram
    await sendTelegramMessage(report);
}

// Đặt lịch gửi tự động lúc 08:00 sáng mỗi ngày
cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy trên port ${PORT}`);
});

// Chạy thử ngay 1 lần khi khởi động để test Telegram
generateDailyReport();
