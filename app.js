const express = require('express');
const connectDB = require('./config/db');
const Wallet = require('./models/Wallet');
const { sendTelegramMessage } = require('./services/telegram');
const { getUSDTBalance } = require('./services/crypto');
const initBot1Jobs = require('./jobs/bot1Jobs');
const { initBot2Jobs, syncAllWallets } = require('./jobs/bot2Jobs');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;

// Kết nối DB & Khởi chạy Cron Jobs
connectDB();
initBot1Jobs();
initBot2Jobs();

// WEBHOOK BOT 2
app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        if (command === '/add') {
            if (parts.length < 4) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/add <nhóm> <tên> <địa_chỉ_usdt>`");
                return res.sendStatus(200);
            }
            const [_, group, name, address] = parts;
            const fetchedBalance = await getUSDTBalance(address);
            const initialBalance = fetchedBalance !== null ? fetchedBalance : 0;

            await Wallet.findOneAndUpdate(
                { name: name },
                { group, name, address, balance: initialBalance, updatedAt: new Date() },
                { upsert: true, new: true }
            );

            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã lưu ví vào Database!*\n• *Nhóm:* ${group}\n• *Tên:* ${name}\n• *Địa chỉ:* \`${address}\`\n• *Số dư USDT:* $${initialBalance.toLocaleString('en-US')} USDT`);
        } 
        else if (command === '/delete') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/delete <tên_hoặc_địa_chỉ>`");
                return res.sendStatus(200);
            }
            const keyword = parts[1];
            const deleted = await Wallet.findOneAndDelete({ $or: [{ name: keyword }, { address: keyword }] });
            const msg = deleted ? `🗑️ *Đã xóa ví:* ${deleted.name}` : `❌ Không tìm thấy ví nào khớp với "${keyword}".`;
            await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
        } 
        else if (command === '/list') {
            const wallets = await Wallet.find();
            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "📂 Chưa có ví nào trong Database.");
                return res.sendStatus(200);
            }
            let msg = "📂 *DANH SÁCH VÍ USDT TRONG DATABASE*\n\n";
            wallets.forEach((w, index) => {
                const timeStr = w.updatedAt ? new Date(w.updatedAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
                msg += `${index + 1}. *[${w.group}]* ${w.name}\n   • Ví: \`${w.address}\`\n   • Số dư DB: *$${w.balance.toLocaleString('en-US')} USDT* _(${timeStr})_\n\n`;
            });
            await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
        } 
        else if (command === '/get') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/get <tên / nhóm / địa_chỉ>`");
                return res.sendStatus(200);
            }
            const query = parts[1];
            const regex = new RegExp(query, 'i');
            const matches = await Wallet.find({ $or: [{ name: regex }, { group: regex }, { address: query }] });

            if (matches.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy dữ liệu khớp với "${query}".`);
            } else {
                let msg = `🔍 *KẾT QUẢ TRA CỨU DB:* "${query}"\n\n`;
                matches.forEach(w => {
                    const timeStr = w.updatedAt ? new Date(w.updatedAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
                    msg += `📌 *${w.name}* (Nhóm: ${w.group})\n• ĐC: \`${w.address}\`\n• Số dư DB: *$${w.balance.toLocaleString('en-US')} USDT* _(${timeStr})_\n\n`;
                });
                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        } 
        else if (command === '/sync') {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🔄 *Đang quét và cập nhật số dư toàn bộ ví vào DB...*");
            const count = await syncAllWallets();
            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã hoàn tất đồng bộ!* Cập nhật thành công ${count} ví.`);
        } 
        else {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🤖 *CÁC LỆNH BOT 2:*\n\n• `/add` | `/delete` | `/list` | `/get` | `/sync`");
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 2:", e.message);
    }
    res.sendStatus(200);
});

app.get('/', (req, res) => res.send('Server Modular đang hoạt động!'));
app.listen(PORT, () => console.log(`Server chạy trên port ${PORT}`));
