const express = require('express');
const connectDB = require('./config/db');
const Alert = require('./models/Alert');
const { sendTelegramMessage } = require('./services/telegram');
const { getCryptoData } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');

// Khởi tạo Express App trước
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;

// Kết nối DB & Khởi chạy Cron Jobs ngầm
connectDB();
initBot1Jobs();

// WEBHOOK BOT 1 (Tra cứu giá & Cảnh báo)
app.post('/telegram-webhook-bot1', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // 1. Lệnh /market
        if (command === '/market') {
            const cryptoData = await getCryptoData();
            await sendTelegramMessage(BOT1_TOKEN, chatId, `🪙 *BẢNG GIÁ THỊ TRƯỜNG LIVE:*\n\n${cryptoData}`);
        }

        // 2. Lệnh /price <coin>
        else if (command === '/price') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Cú pháp: `/price <mã_coin>` (VD: `/price btc`)");
                return res.sendStatus(200);
            }
            const symbol = parts[1].toUpperCase();
            try {
                const resPrice = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
                const data = await resPrice.json();
                if (data?.data?.amount) {
                    const price = parseFloat(data.data.amount).toLocaleString('en-US');
                    await sendTelegramMessage(BOT1_TOKEN, chatId, `💰 Giá *${symbol}* hiện tại: *$${price} USDT*`);
                } else {
                    await sendTelegramMessage(BOT1_TOKEN, chatId, `❌ Không tìm thấy coin *${symbol}*.`);
                }
            } catch (err) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "❌ Lỗi khi lấy giá.");
            }
        }

        // 3. Lệnh /alert <coin> <mức_giá>
        else if (command === '/alert') {
            if (parts.length < 3) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Cú pháp: `/alert <mã_coin> <giá>`\n_VD: `/alert btc 100000`_");
                return res.sendStatus(200);
            }
            const symbol = parts[1].toUpperCase();
            const targetPrice = parseFloat(parts[2]);

            if (isNaN(targetPrice)) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Mức giá không hợp lệ.");
                return res.sendStatus(200);
            }

            const resPrice = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
            const data = await resPrice.json();
            
            if (data?.data?.amount) {
                const currentPrice = parseFloat(data.data.amount);
                const condition = targetPrice > currentPrice ? 'ABOVE' : 'BELOW';

                await Alert.create({ chatId, symbol, targetPrice, condition });
                
                const condText = condition === 'ABOVE' ? 'vượt lên trên' : 'giảm xuống dưới';
                await sendTelegramMessage(BOT1_TOKEN, chatId, `✅ *Đã đặt cảnh báo!*\n• Coin: *${symbol}*\n• Giá hiện tại: *$${currentPrice.toLocaleString('en-US')}*\n• Cảnh báo khi giá ${condText}: *$${targetPrice.toLocaleString('en-US')}*`);
            } else {
                await sendTelegramMessage(BOT1_TOKEN, chatId, `❌ Không tìm thấy coin *${symbol}*.`);
            }
        }

    } catch (e) {
        console.error("Lỗi Webhook Bot 1:", e.message);
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
