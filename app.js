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

if (MONGODB_URI) {
    mongoose.connect(MONGODB_URI)
        .then(() => console.log("✅ Đã kết nối thành công tới MongoDB Atlas"))
        .catch(err => console.error("❌ Lỗi kết nối MongoDB:", err.message));
}

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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
// API TRA CỨU SỐ DƯ LIVE (ĐA NGUỒN CHỐNG BLOCK)
// ==========================================
async function getUSDTBalance(address) {
    if (!address || !address.startsWith('T')) return 0;

    // Nguồn 1: TRONSCAN API (Ưu tiên số 1 cho danh sách nhiều ví)
    try {
        const urlScan = `https://api.tronscan.org/api/account/tokens?address=${address}&start=0&limit=20`;
        const resScan = await fetch(urlScan, { headers });
        if (resScan.ok) {
            const dataScan = await resScan.json();
            if (dataScan && dataScan.data) {
                const usdt = dataScan.data.find(t => t.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
                if (usdt) {
                    return parseFloat(usdt.balance) / Math.pow(10, usdt.tokenDecimal);
                }
                return 0; // Có dữ liệu nhưng 0 USDT
            }
        }
    } catch (err) {
        // Tự chuyển sang nguồn 2
    }

    // Nguồn 2: TRONGRID API (Dự phòng)
    try {
        const urlGrid = `https://api.trongrid.io/v1/accounts/${address}`;
        const resGrid = await fetch(urlGrid, { headers });
        if (resGrid.ok) {
            const dataGrid = await resGrid.json();
            if (dataGrid && dataGrid.data && dataGrid.data.length > 0) {
                const trc20List = dataGrid.data[0].trc20 || [];
                for (const item of trc20List) {
                    if (item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) {
                        return parseFloat(item['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t']) / 1000000;
                    }
                }
                return 0;
            }
        }
    } catch (err) {
        console.error(`❌ Không thể quét được ví ${address}`);
    }

    return null; // Không lấy được do lỗi cả 2 API
}

// ==========================================
// HÀM CHẠY ĐỒNG BỘ TOÀN BỘ VÍ VÀO DATABASE
// ==========================================
async function syncAllWallets() {
    const wallets = await Wallet.find();
    if (wallets.length === 0) return 0;

    let updatedCount = 0;
    for (const w of wallets) {
        const newBalance = await getUSDTBalance(w.address);

        if (newBalance !== null) {
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

                w.balance = newBalance;
            }
            w.updatedAt = new Date();
            await w.save();
            updatedCount++;
        }
        await sleep(500); // Giãn cách 500ms giữa các ví để không dính Rate Limit
    }
    return updatedCount;
}

// ==========================================
// BOT 1: BÁO CÁO TÀI CHÍNH (10 PHÚT/LẦN)
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
// BOT 2: TƯƠNG TÁC BOT (ĐỌC TRỰC TIẾP TỪ DB)
// ==========================================
app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // 1. Lệnh /add
        if (command === '/add') {
            if (parts.length < 4) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/add <nhóm> <tên> <địa_chỉ_usdt>`");
                return res.sendStatus(200);
            }
            const group = parts[1];
            const name = parts[2];
            const address = parts[3];

            const fetchedBalance = await getUSDTBalance(address);
            const initialBalance = fetchedBalance !== null ? fetchedBalance : 0;

            await Wallet.findOneAndUpdate(
                { name: name },
                { group, name, address, balance: initialBalance, updatedAt: new Date() },
                { upsert: true, new: true }
            );

            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã lưu ví vào Database!*\n• *Nhóm:* ${group}\n• *Tên:* ${name}\n• *Địa chỉ:* \`${address}\`\n• *Số dư USDT:* $${initialBalance.toLocaleString('en-US')} USDT`);
        }

        // 2. Lệnh /delete
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
                await sendTelegramMessage(BOT2_TOKEN, chatId, `🗑️ *Đã xóa ví:* ${deleted.name}`);
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
                const timeStr = w.updatedAt ? new Date(w.updatedAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '';
                msg += `${index + 1}. *[${w.group}]* ${w.name}\n   • Ví: \`${w.address}\`\n   • Số dư DB: *$${w.balance.toLocaleString('en-US')} USDT* _(${timeStr})_\n\n`;
            });
            
            await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
        }

        // 4. Lệnh /get
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

        // 5. Lệnh /sync: Ép hệ thống đồng bộ toàn bộ ví ngay lập tức
        else if (command === '/sync') {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🔄 *Đang tiến hành quét và cập nhật số dư cho toàn bộ ví... Vui lòng đợi trong giây lát.*");
            const count = await syncAllWallets();
            await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã hoàn tất đồng bộ!* Đã cập nhật thành công ${count} ví vào Database. Dùng lệnh \`/get companywallets\` để kiểm tra.`);
        }

        // Trợ giúp
        else {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🤖 *CÁC LỆNH BOT 2 (LƯU MONGODB):*\n\n" +
                "• `/add <nhóm> <tên> <địa_chỉ>` : Thêm ví & lấy số dư ban đầu\n" +
                "• `/delete <tên_hoặc_địa_chỉ>` : Xóa ví\n" +
                "• `/list` : Xem toàn bộ ví từ Database\n" +
                "• `/get <tên/nhóm/địa_chỉ>` : Tra cứu ví từ Database\n" +
                "• `/sync` : Ép đồng bộ số dư live tất cả các ví vào DB ngay lập tức");
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 2:", e.message);
    }

    res.sendStatus(200);
});

// ==========================================
// VÒNG LẶP CẬP NHẬT SỐ DƯ TỰ ĐỘNG (3 PHÚT / LẦN)
// ==========================================
cron.schedule('*/3 * * * *', async () => {
    try {
        await syncAllWallets();
    } catch (e) {
        console.error("Lỗi Auto Sync Database:", e.message);
    }
});

app.get('/', (req, res) => {
    res.send('Server Đa Bot (MongoDB) đang hoạt động!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});
