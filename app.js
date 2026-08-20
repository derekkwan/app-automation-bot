const express = require('express');
const connectDB = require('./config/db');
const Alert = require('./models/Alert');
const Wallet = require('./models/Wallet'); // Thêm Model Wallet cho Bot 2
const { sendTelegramMessage } = require('./services/telegram');
const { getCryptoData, getUSDTBalance } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');
const { initBot2Jobs, syncAllWallets } = require('./jobs/bot2Jobs'); // Khởi tạo Bot 2

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2; // Token của Bot 2

// Kết nối Database & Khởi chạy Cron Jobs cho cả 2 Bot
connectDB();
initBot1Jobs();
initBot2Jobs();

// Route trang chủ (để kiểm tra server live)
app.get('/', (req, res) => {
    res.send('Server Telegram Bots đang chạy bình thường!');
});

// ====================================================
// WEBHOOK BOT 1 (BAO CAO THI TRUONG & CANH BAO GIA)
// ====================================================
app.post('/telegram-webhook-bot1', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // Lệnh /market
        if (command === '/market') {
            const cryptoData = await getCryptoData();
            await sendTelegramMessage(BOT1_TOKEN, chatId, `🪙 *BẢNG GIÁ THỊ TRƯỜNG LIVE:*\n\n${cryptoData}`);
        }
        // Lệnh /price <coin>
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
        // Lệnh /alert <coin> <mức_giá>
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

// ====================================================
// WEBHOOK BOT 2 (QUẢN LÝ VÍ & SỐ DƯ USDT TRON)
// ====================================================
app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // Lệnh /add <địa_chỉ_ví> <tên_ví>
        if (command === '/add') {
            if (parts.length < 3) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/add <địa_chỉ_ví_TRON> <tên_ví>`\n_VD: `/add Txxx Ví_Chính`_");
                return res.sendStatus(200);
            }
            const address = parts[1];
            const name = parts.slice(2).join(' ');

            const currentBalance = await getUSDTBalance(address);
            if (currentBalance === null) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "❌ Địa chỉ ví TRON không hợp lệ hoặc lỗi kết nối.");
                return res.sendStatus(200);
            }

            await Wallet.findOneAndUpdate(
                { address },
                { name, balance: currentBalance },
                { upsert: true, new: true }
            );

            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã thêm ví thành công!*\n• Tên: *${name}*\n• Số dư: *$${currentBalance.toLocaleString('en-US')} USDT*`);
        }

        // Lệnh /list (Xem danh sách ví và tổng số dư)
        else if (command === '/list' || command === '/check') {
            const wallets = await Wallet.find();
            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "📂 Chưa có ví nào trong hệ thống. Dùng `/add` để thêm ví.");
            } else {
                let total = 0;
                let msg = "💳 *DANH SÁCH VÍ THEO DÕI:*\n\n";
                wallets.forEach((w, i) => {
                    total += w.balance;
                    msg += `${i + 1}. *${w.name}*\n   • Số dư: *$${w.balance.toLocaleString('en-US')} USDT*\n`;
                });
                msg += `\n💰 *TỔNG CỘNG:* *$${total.toLocaleString('en-US')} USDT*`;
                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        }

        // Lệnh /sync (Cập nhật thủ công số dư ngay lập tức)
        else if (command === '/sync') {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🔄 Đang đồng bộ dữ liệu ví...");
            await syncAllWallets();
            await sendTelegramMessage(BOT2_TOKEN, chatId, "✅ Đồng bộ xong! Gõ `/list` để xem lại.");
        }

    } catch (e) {
        console.error("Lỗi Webhook Bot 2:", e.message);
    }
    res.sendStatus(200);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
