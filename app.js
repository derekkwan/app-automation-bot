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
        // Trong phần app.post('/telegram-webhook-bot2', ...)

// 1. Lệnh /get <tên_ví> (Xem chi tiết 1 ví cụ thể)
if (command === '/get') {
    if (parts.length < 2) {
        await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/get <tên_ví>`\n_VD: `/get companywallets`_");
        return res.sendStatus(200);
    }
    
    // Tìm ví theo tên (không phân biệt chữ hoa/thường)
    const searchName = parts.slice(1).join(' ');
    const wallet = await Wallet.findOne({ name: { $regex: new RegExp(`^${searchName}$`, 'i') } });

    if (!wallet) {
        await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy ví nào có tên: *${searchName}*`);
    } else {
        const msg = `💳 *THÔNG TIN CHI TIẾT VÍ*\n\n` +
                    `• Tên ví: *${wallet.name}*\n` +
                    `• Địa chỉ: \`${wallet.address}\`\n` +
                    `• Số dư USDT: *$${wallet.balance.toLocaleString('en-US')} USDT*`;
        await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
    }
}

// 2. Lệnh /add
else if (command === '/add') {
    // ... (Code /add giữ nguyên)
}

// 3. Lệnh /list hoặc /check
else if (command === '/list' || command === '/check') {
    // ... (Code /list giữ nguyên)
}

// 4. Lệnh /sync (Chỉ chạy khi đúng chữ /sync)
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
