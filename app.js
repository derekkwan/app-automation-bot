const express = require('express');
const connectDB = require('./config/db');
const Wallet = require('./models/Wallet');
const Alert = require('./models/Alert');
const { sendTelegramMessage } = require('./services/telegram');
const { getCryptoData } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');

// Khởi tạo app TRƯỚC khi dùng app.post
const app = express();
app.use(express.json());

// Khởi chạy DB & Jobs
connectDB();
initBot1Jobs();

// Webhook Bot 1
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
            await sendTelegramMessage(process.env.TELEGRAM_TOKEN, chatId, `🪙 *BẢNG GIÁ THỊ TRƯỜNG LIVE:*\n\n${cryptoData}`);
        } else if (command === '/price') {
            if (parts.length < 2) {
                await sendTelegramMessage(process.env.TELEGRAM_TOKEN, chatId, "⚠️ Cú pháp: `/price <mã_coin>`");
                return res.sendStatus(200);
            }
            const symbol = parts[1].toUpperCase();
            const resPrice = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
            const data = await resPrice.json();
            if (data?.data?.amount) {
                const price = parseFloat(data.data.amount).toLocaleString('en-US');
                await sendTelegramMessage(process.env.TELEGRAM_TOKEN, chatId, `💰 Giá *${symbol}* hiện tại: *$${price} USDT*`);
            } else {
                await sendTelegramMessage(process.env.TELEGRAM_TOKEN, chatId, `❌ Không tìm thấy coin *${symbol}*.`);
            }
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 1:", e.message);
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
