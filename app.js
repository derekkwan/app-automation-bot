const cron = require('node-cron');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ==========================================
// CẤU HÌNH BIẾN MÔI TRƯỜNG (RENDER)
// ==========================================
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT1_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;
const BOT2_CHAT_ID = process.env.TELEGRAM_CHAT_ID_2 || BOT1_CHAT_ID;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
};

// Quản lý file JSON dữ liệu ví (Lưu ở thư mục /tmp an toàn trên Render)
const DATA_FILE = path.join('/tmp', 'wallets.json');

function loadWallets() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(data || '[]');
    } catch (err) {
        console.error("Lỗi đọc file wallets.json:", err);
        return [];
    }
}

function saveWallets(wallets) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(wallets, null, 2));
    } catch (err) {
        console.error("Lỗi ghi file wallets.json:", err);
    }
}

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
// API TRA CỨU SỐ DƯ USDT (TRC20 - TRON)
// ==========================================
async function getUSDTBalance(address) {
    try {
        if (address.startsWith('T')) {
            const url = `https://api.tronscan.org/api/account?address=${address}`;
            const res = await fetch(url, { headers });
            const data = await res.json();
            
            if (data && data.trc20token_balances) {
                const usdtToken = data.trc20token_balances.find(t => t.tokenId === 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
                if (usdtToken) {
                    const balance = parseFloat(usdtToken.balance) / Math.pow(10, usdtToken.tokenDecimal);
                    return balance;
                }
            }
        }
        return 0;
    } catch (err) {
        console.error(`Lỗi lấy số dư ví ${address}:`, err.message);
        return null;
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

async function runBot1Report() {
    try {
        const cryptoData = await getCryptoData();
        const now = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const message = `📊 *BÁO CÁO TÀI CHÍNH BOT 1 (${now})*\n\n🪙 *CÁC HỆ SINH THÁI CRYPTO:*\n${cryptoData}`;
        await sendTelegramMessage(BOT1_TOKEN, BOT1_CHAT_ID, message);
    } catch (e) {
        console.error("Lỗi chạy Bot 1 report:", e.message);
    }
}

// Lịch chạy Bot 1: 10 phút/lần
cron.schedule('*/10 * * * *', () => { runBot1Report(); });

// ==========================================
// BOT 2: TƯƠNG TÁC + THEO DÕI BIẾN ĐỘNG SỐ DƯ VÍ
// ==========================================

app.post('/telegram-webhook-bot2', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        let wallets = loadWallets();

        // 1. Lệnh /add <nhóm> <tên> <địa_chỉ>
        if (command === '/add') {
            if (parts.length < 4) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/add <nhóm> <tên> <địa_chỉ_usdt>`\nVí dụ: `/add my_wallets my_truewallet TBQvH71jzcoYtcqM5zs2YSdaYN9ppNXe26`");
                return res.sendStatus(200);
            }
            const group = parts[1];
            const name = parts[2];
            const address = parts[3];

            try {
                const initialBalance = await getUSDTBalance(address) || 0;
                wallets.push({ group, name, address, balance: initialBalance, updatedAt: new Date().toISOString() });
                saveWallets(wallets);

                await sendTelegramMessage(BOT2_TOKEN, chatId, `✅ *Đã thêm ví mới thành công!*\n• *Nhóm:* ${group}\n• *Tên:* ${name}\n• *Địa chỉ:* \`${address}\`\n• *Số dư USDT:* $${initialBalance.toLocaleString('en-US')} USDT`);
            } catch (err) {
                console.error("Lỗi khi thêm ví:", err);
                await sendTelegramMessage(BOT2_TOKEN, chatId, "❌ Đã xảy ra lỗi khi truy vấn số dư hoặc lưu ví.");
            }
        }

        // 2. Lệnh /delete <tên_hoặc_địa_chỉ>
        else if (command === '/delete') {
            if (parts.length < 2) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "⚠️ Cú pháp: `/delete <tên_hoặc_địa_chỉ>`");
                return res.sendStatus(200);
            }
            const keyword = parts[1];
            const newWallets = wallets.filter(w => w.name !== keyword && w.address !== keyword);
            if (newWallets.length === wallets.length) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy ví nào khớp với từ khóa "${keyword}".`);
            } else {
                saveWallets(newWallets);
                await sendTelegramMessage(BOT2_TOKEN, chatId, `🗑️ *Đã xóa thành công ví khớp với:* ${keyword}`);
            }
        }

        // 3. Lệnh /list (Xem danh sách)
        else if (command === '/list') {
            if (wallets.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, "📂 Danh sách ví hiện đang trống. Hãy thêm bằng lệnh `/add`.");
                return res.sendStatus(200);
            }
            let msg = "📂 *DANH SÁCH VÍ USDT ĐANG THEO DÕI*\n\n";
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
            const query = parts[1].toLowerCase();
            const matches = wallets.filter(w => 
                w.name.toLowerCase().includes(query) || 
                w.group.toLowerCase().includes(query) || 
                w.address.toLowerCase() === query
            );

            if (matches.length === 0) {
                await sendTelegramMessage(BOT2_TOKEN, chatId, `❌ Không tìm thấy dữ liệu phù hợp với "${parts[1]}".`);
            } else {
                let msg = `🔍 *KẾT QUẢ TRA CỨU:* "${parts[1]}"\n\n`;
                for (const w of matches) {
                    const liveBalance = await getUSDTBalance(w.address);
                    const currentBal = liveBalance !== null ? liveBalance : w.balance;
                    msg += `📌 *${w.name}* (Nhóm: ${w.group})\n• ĐC: \`${w.address}\`\n• Số dư USDT: *$${currentBal.toLocaleString('en-US')} USDT*\n\n`;
                }
                await sendTelegramMessage(BOT2_TOKEN, chatId, msg);
            }
        }

        // Trợ giúp
        else {
            await sendTelegramMessage(BOT2_TOKEN, chatId, "🤖 *CÁC LỆNH ĐƯỢC HỖ TRỢ BOT 2:*\n\n" +
                "• `/add <nhóm> <tên> <địa_chỉ>` : Thêm ví\n" +
                "• `/delete <tên_hoặc_địa_chỉ>` : Xóa ví\n" +
                "• `/list` : Danh sách tất cả ví\n" +
                "• `/get <tên/nhóm/địa_chỉ>` : Tra cứu chi tiết & số dư live");
        }
    } catch (e) {
        console.error("Lỗi Webhook Bot 2:", e.message);
    }

    res.sendStatus(200);
});

// ==========================================
// VÒNG LẶP KIỂM TRA SỐ DƯ (BALANCE WATCHER - 2 PHÚT/LẦN)
// ==========================================
async function checkWalletBalances() {
    try {
        let wallets = loadWallets();
        if (wallets.length === 0) return;

        let hasChange = false;

        for (let i = 0; i < wallets.length; i++) {
            const w = wallets[i];
            const newBalance = await getUSDTBalance(w.address);

            if (newBalance !== null && newBalance !== w.balance) {
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

                wallets[i].balance = newBalance;
                wallets[i].updatedAt = new Date().toISOString();
                hasChange = true;
            }
        }

        if (hasChange) {
            saveWallets(wallets);
        }
    } catch (e) {
        console.error("Lỗi Balance Watcher:", e.message);
    }
}

cron.schedule('*/2 * * * *', () => {
    checkWalletBalances();
});

// Endpoint Server
app.get('/', (req, res) => {
    res.send('Server Đa Bot đang hoạt động an toàn!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});
