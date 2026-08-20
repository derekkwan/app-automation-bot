const express = require('express');
const connectDB = require('./config/db');
const Alert = require('./models/Alert');
const Wallet = require('./models/Wallet');
const { sendTelegramMessage } = require('./services/telegram');
const { getCryptoData, getUSDTBalance } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');
const { initBot2Jobs, syncAllWallets } = require('./jobs/bot2Jobs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;

// Kết nối Database & Khởi chạy Cron Jobs ngầm cho 2 Bot
connectDB();
initBot1Jobs();
initBot2Jobs();

// Route trang chủ kiểm tra server
app.get('/', (req, res) => {
    res.send('Server Telegram Bots đang chạy bình thường!');
});

// ====================================================
// WEBHOOK BOT 1 (CẢNH BÁO GIÁ & BÁO CÁO THỊ TRƯỜNG)
// ====================================================
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

// ====================================================
// WEBHOOK BOT 2 (QUẢN LÝ VÍ & TỔNG SỐ DƯ USDT TRON)
// ====================================================
app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // 1. Lệnh /get <tên / nhóm / địa_chỉ>
        if (command === '/get') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ *Cú pháp chưa đúng!*\n\n👉 Sử dụng: `/get <tên_ví | nhóm_ví | địa_chỉ>`\n_Ví dụ: `/get companywallets`_");
                return res.sendStatus(200);
            }

            const keyword = parts.slice(1).join(' ').trim();

            const wallets = await Wallet.find({
                $or: [
                    { groupName: { $regex: keyword, $options: 'i' } },
                    { name: { $regex: keyword, $options: 'i' } },
                    { address: { $regex: keyword, $options: 'i' } }
                ]
            });

            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy dữ liệu nào phù hợp với: *${keyword}*`);
            } else {
                let total = 0;
                let msg = `🔍 *KẾT QUẢ TÌM KIẾM CHO "${keyword}":*\n\n`;

                wallets.forEach((w, i) => {
                    const balance = w.balance || 0;
                    total += balance;
                    const groupInfo = w.groupName ? ` [${w.groupName}]` : '';
                    msg += `${i + 1}. *${w.name}*${groupInfo}\n` +
                           `   • Địa chỉ: \`${w.address}\`\n` +
                           `   • Số dư: *$${balance.toLocaleString('en-US')} USDT*\n\n`;
                });

                if (wallets.length > 1) {
                    msg += `💰 *TỔNG TẤT CẢ:* *$${total.toLocaleString('en-US')} USDT*`;
                }

                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        }

        // 2. Lệnh /add <địa_chỉ> <tên_ví> [tên_nhóm]
        else if (command === '/add') {
            // Đảm bảo đủ ít nhất 2 tham số (địa chỉ & tên)
            if (parts.length < 3) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ *Cú pháp thiếu tham số!*\n\n👉 Sử dụng: `/add <địa_chỉ_ví> <tên_ví> [tên_nhóm]`\n_Ví dụ: `/add Txxx Ví_Phụ_1 companywallets`_");
                return res.sendStatus(200);
            }

            const address = parts[1];
            const name = parts[2];
            const groupName = parts[3] || 'Default';

            try {
                const currentBalance = await getUSDTBalance(address);
                if (currentBalance === null || currentBalance === undefined) {
                    await sendTelegramMessage(BOT2_TOKEN, chatId, "❌ Địa chỉ ví TRON không hợp lệ hoặc lỗi mạng.");
                    return res.sendStatus(200);
                }

                await Wallet.findOneAndUpdate(
                    { address },
                    { name, groupName, balance: currentBalance },
                    { upsert: true, new: true }
                );

                await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã lưu ví thành công!*\n• Tên: *${name}*\n• Nhóm: *${groupName}*\n• Địa chỉ: \`${address}\`\n• Số dư: *$${currentBalance.toLocaleString('en-US')} USDT*`);
            } catch (err) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Lỗi khi xử lý ví: ${err.message}`);
            }
        }

        // 3. Lệnh /list hoặc /check
        else if (command === '/list' || command === '/check') {
            const wallets = await Wallet.find();
            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "📂 Chưa có ví nào trong hệ thống. Dùng `/add` để thêm ví.");
            } else {
                let total = 0;
                let msg = "💳 *DANH SÁCH VÍ THEO DÕI:*\n\n";
                wallets.forEach((w, i) => {
                    const balance = w.balance || 0;
                    total += balance;
                    const groupInfo = w.groupName ? ` [${w.groupName}]` : '';
                    msg += `${i + 1}. *${w.name}*${groupInfo}\n   • Số dư: *$${balance.toLocaleString('en-US')} USDT*\n`;
                });
                msg += `\n💰 *TỔNG CỘNG:* *$${total.toLocaleString('en-US')} USDT*`;
                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        }

        // 4. Lệnh /sync
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
