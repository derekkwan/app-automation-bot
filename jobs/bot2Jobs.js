const cron = require('node-cron');
const Wallet = require('../models/Wallet');
const { sendTelegramMessage } = require('../services/telegram');
const { getUSDTBalance, sleep } = require('../services/crypto');

const BOT2_TOKEN = process.env.TELEGRAM_TOKEN_2;
const BOT2_CHAT_ID = process.env.TELEGRAM_CHAT_ID_2 || process.env.TELEGRAM_CHAT_ID;

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
        await sleep(500);
    }
    return updatedCount;
}

function initBot2Jobs() {
    cron.schedule('*/3 * * * *', async () => {
        try {
            await syncAllWallets();
        } catch (e) {
            console.error("Lỗi Auto Sync Database:", e.message);
        }
    });
}

module.exports = { initBot2Jobs, syncAllWallets };
