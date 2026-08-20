const cron = require('node-cron');
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// CẤU HÌNH BIẾN MÔI TRƯỜNG & KẾT NỐI MONGODB
// ==========================================
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT1_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;
const BOT2_CHAT_ID = process.env.TELEGRAM_CHAT_ID_2 || BOT1_CHAT_ID;

const MONGODB_URI = process.env.MONGODB_URI;

// Kết nối MongoDB Atlas
if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log("✅ Đã kết nối thành công tới MongoDB Atlas"))
        .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err.message));
}

// Định nghĩa Schema lưu Ví
const walletSchema = new mongoose.Schema({
    group: { type: String, required: true },
    name: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    balance: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
});

const Wallet = mongoose.model('Wallet', walletSchema);

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
};

// ==========================================
// HÀM GỬI TIN NHẮN TELEGRAM
// ==========================================
async function sendTelegramMessage(token, chatId, message) {
    if (!token || !chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error.message);
    }
}

// ==========================================
// API TRA CỨU SỐ DƯ USDT (TRONGRID)
// ==========================================
async function getUSDTBalance(address) {
    try {
        if (!address || !address.startsWith('T')) return 0;

        const url = `https://api.trongrid.io/v1/accounts/${address}`;
        const res = await fetch(url, { headers });
        const data = await res.json();

        if (data && data.data && data.data.length > 0) {
            const account = data.data[0];
            const trc20List = account.trc20 || [];
            
            for (const item of trc20List) {
                if (item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) {
                    const rawBalance = item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'];
                    return parseFloat(rawBalance) / 1000000;
                }
            }
        }
        return 0;
    } catch (err) {
        console.error(`Lỗi lấy số dư ví ${address}:`, err.message);
        return 0;
    }
}

// ==========================================
// BOT 1: BÁO CÁO TÀI CHÍNH ĐỊNH KỲ (10 PHÚT/LẦN)
// ==========================================
async function getCryptoData() {
    try {
        const coinGroups = {
            "💎 *Hệ Bitcoin & Vàng số:*": ['BTC'],
            "🔹 *Hệ Ethereum (ETH & L2):*": ['ETH', 'POL', 'ARB', 'OP'],
            "🟣 *Hệ Solana (SOL Ecosystem):*": ['SOL', 'RAY', 'JUP'],
            "🟡 *Hệ BNB Chain (Binance):*": ['BNB', 'CAKE'],
            "🌐 *Layer 1 & Crypto chính khác:*": ['XRP', 'ADA', 'AVAX', 'LINK', 'DOGE']
        };

        const allCoins = Object.values(coinGroups).flat();
        const requests = allCoins.map(coin => 
            fetch(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`, { headers })
                .then(res => res.json())
                .then(data => ({
                    coin,
                    price: data?.data?.amount ? `$${parseFloat(data.data.amount).toLocaleString('en-US', { maximumFractionDigits: parseFloat(data.data.amount) < 1 ? 4 : 2 })}` : 'N/A'
                }))
                .catch(() => ({ coin, price: 'N/A' }))
        );

        const results = await Promise.all(requests);
        const priceMap = {};
        results.forEach(item => { priceMap[item.coin] = item.price; });

        let output = "";
        for (const [groupName, coins] of Object.entries(coinGroups)) {
            output += `${groupName}\n`;
            coins.forEach(coin => { output += `  • *${coin}:* ${priceMap[coin] || 'N/A'}\n`; });
            output += "\n";
        }
        return output.trim();
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

cron.schedule('*/10 * * * *', async () => {
    try {
        const cryptoData = await getCryptoData();
        const now = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const message = `📊 *BÁO CÁO TÀI CHÍNH BOT 1 (${now})*\n\n🪙 *CÁC HỆ SINH THÁI CRYPTO:*\n${cryptoData}`;
        await sendTelegramMessage(BOT1_TOKEN, BOT1_CHAT_ID, message);
    } catch (e) {
        console.error("Lỗi Bot 1:", e.message);
    }
});

// ==========================================
// BOT 2: TƯƠNG TÁC + THEO DÕI SỐ DƯ (DATABASE MONGODB)
// ==========================================
app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // 1. Lệnh /add <nhóm> <tên> <địa_chỉ>
        if (command === '/add') {
            if (parts.length < 4) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/add <nhóm> <tên> <địa_chỉ_usdt>`");
                return res.sendStatus(200);
            }
            const group = parts[1];
            const name = parts[2];
            const address = parts[3];

            const initialBalance = await getUSDTBalance(address);

            // Cập nhật hoặc Thêm mới vào Database
            await Wallet.findOneAndUpdate(
                { name: name },
                { group, name, address, balance: initialBalance, updatedAt: new Date() },
                { upsert: true, new: true }
            );

            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã lưu ví thành công vào Database!*\n• *Nhóm:* ${group}\n• *Tên:* ${name}\n• *Địa chỉ:* \`${address}\`\n• *Số dư USDT:* $${initialBalance.toLocaleString('en-US')} USDT`);
        }

        // 2. Lệnh /delete <tên_hoặc_địa_chỉ>
        else if (command === '/delete') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/delete <tên_hoặc_địa_chỉ>`");
                return res.sendStatus(200);
            }
            const keyword = parts[1];
            const deleted = await Wallet.findOneAndDelete({ $or: [{ name: keyword }, { address: keyword }] });

            if (!deleted) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy ví nào khớp với "${keyword}".`);
            } else {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `🗑️ *Đã xóa vĩnh viễn ví:* ${deleted.name}`);
            }
        }

        // 3. Lệnh /list
        else if (command === '/list') {
            const wallets = await Wallet.find();
            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "📂 Chưa có ví nào trong Database. Dùng lệnh `/add` để thêm.");
                return res.sendStatus(200);
            }
            let msg = "📂 *DANH SÁCH VÍ USDT TRONG DATABASE*\n\n";
            wallets.forEach((w, index) => {
                msg += `${index + 1}. *[${w.group}]* ${w.name}\n   • Ví: \`${w.address}\`\n   • Số dư: *$${w.balance.toLocaleString('en-US')} USDT*\n\n`;
            });
            await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
        }

        // 4. Lệnh /get <tên_hoặc_nhóm_hoặc_địa_chỉ>
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
                let msg = `🔍 *KẾT QUẢ TRA CỨU:* "${query}"\n\n`;
                for (const w of matches) {
                    const liveBalance = await getUSDTBalance(w.address);
                    msg += `📌 *${w.name}* (Nhóm: ${w.group})\n• ĐC: \`${w.address}\`\n• Số dư Live: *$${liveBalance.toLocaleString('en-US')} USDT*\n\n`;
                }
                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        }

        // Trợ giúp
        else {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🤖 *CÁC LỆNH BOT 2 (LƯU MONGODB):*\n\n" +
                "• `/add <nhóm> <tên> <địa_chỉ>` : Thêm/cập nhật ví\n" +
                "• `/delete <tên_hoặc_địa_chỉ>` : Xóa ví\n" +
                "• `/list` : Xem toàn bộ ví\n" +
                "• `/get <tên/nhóm/địa_chỉ>` : Tra cứu số dư live");
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 2:", e.message);
    }

    res.sendStatus(200);
});

// ==========================================
// VÒNG LẶP KIỂM TRA SỐ DƯ (2 PHÚT/LẦN)
// ==========================================
cron.schedule('*/2 * * * *', async () => {
    try {
        const wallets = await Wallet.find();
        if (wallets.length === 0) return;

        for (const w of wallets) {
            const newBalance = await getUSDTBalance(w.address);

            if (newBalance !== w.balance) {
                const diff = newBalance - w.balance;
                const statusEmoji = diff > 0 ? "🟢 *SỐ DƯ TĂNG*" : "🔴 *SỐ DƯ GIẢM*";
                const changeStr = diff > 0 ? `+$${diff.toLocaleString('en-US')}` : `-$${Math.abs(diff).toLocaleString('en-US')}`;

                const alertMsg = `🔔 *CẢNH BÁO BIẾN ĐỘNG SỐ DƯ VÍ USDT*\n\n` +
                                 `• Status: ${statusEmoji}\n` +
                                 `• Tên ví: *${w.name}* (Nhóm: ${w.group})\n` +
                                 `• ĐC: \`${w.address}\`\n` +
                                 `• Biến động: *${changeStr} USDT*\n` +
                                 `• Số dư mới: *$${newBalance.toLocaleString('en-US')} USDT*`;

                await sendTelegramMessage(BOT2_TOKEN, BOT2_CHAT_ID, alertMsg);

                // Cập nhật số dư mới vào DB
                w.balance = newBalance;
                w.updatedAt = new Date();
                await w.save();
            }
        }
    } catch (e) {
        console.error("Lỗi Balance Watcher DB:", e.message);
    }
});

app.get('/', (req, res) => {
    res.send('Server Đa Bot (MongoDB) đang hoạt động!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});
