const express = require('express');
const connectDB = require('./config/db');
const Wallet = require('./models/Wallet');
const Alert = require('./models/Alert'); // Bổ sung import Alert nếu dùng /alert
const { sendTelegramMessage } = require('./services/telegram');
const { getUSDTBalance, getCryptoData } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');
const { initBot2Jobs, syncAllWallets } = require('./jobs/bot2Jobs');

// ⚠️ QUAN TRỌNG: Phải khởi tạo 'app' trước khi gọi app.use hay app.post
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;

// Kết nối DB & Khởi chạy Cron Jobs
connectDB();
initBot1Jobs();
initBot2Jobs();

// ==========================================
// WEBHOOK BOT 1 (CẢNH BÁO & TRA GIÁ)
// ==========================================
app.post('/telegram-webhook-bot1', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        if (command === '/market') {
            const cryptoData = await getCryptoData();
            await sendTelegramMessage(BOT1_TOKEN, chatId, `🪙 *BẢNG GIÁ THỊ TRƯỜNG LIVE:*\n\n${cryptoData}`);
        }
        else if (command === '/price') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Cú pháp: `/price <mã_coin>` (VD: `/price btc`)");
                return res.sendStatus(200);
            }
            const symbol = parts[1].toUpperCase();
            const resPrice = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
            const data = await resPrice.json();
            if (data?.data?.amount) {
                const price = parseFloat(data.data.amount).toLocaleString('en-US');
                await sendTelegramMessage(BOT1_TOKEN, chatId, `💰 Giá *${symbol}* hiện tại: *$${price} USDT*`);
            } else {
                await sendTelegramMessage(BOT1_TOKEN, chatId, `❌ Không tìm thấy coin *${symbol}*.`);
            }
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 1:", e.message);
    }
    res.sendStatus(200);
});

// ==========================================
// WEBHOOK BOT 2 (QUẢN LÝ VÍ)
// ==========================================
// ... (Giữ nguyên đoạn app.post('/telegram-webhook-bot2') của Bot 2 bên dưới)
