const cron = require('node-cron');
const { sendTelegramMessage } = require('../services/telegram');
const { getCryptoData, headers, sleep } = require('../services/crypto');

const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT1_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let previousPrices = {};

function initBot1Jobs() {
    // 1. Cảnh báo biến động giá mỗi 5 phút (> 2.5%)
    cron.schedule('*/5 * * * *', async () => {
        try {
            const watchCoins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
            let alerts = [];

            for (const coin of watchCoins) {
                const res = await fetch(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`, { headers });
                const data = await res.json();
                if (data?.data?.amount) {
                    const currentPrice = parseFloat(data.data.amount);
                    const lastPrice = previousPrices[coin];

                    if (lastPrice) {
                        const percentChange = ((currentPrice - lastPrice) / lastPrice) * 100;
                        if (Math.abs(percentChange) >= 2.5) {
                            const icon = percentChange > 0 ? "🚀 *TĂNG VỌT*" : "🔻 *GIẢM MẠNH*";
                            alerts.push(`• *${coin}:* ${icon} *${percentChange.toFixed(2)}%*\n  Giá hiện tại: *$${currentPrice.toLocaleString('en-US')}* (Giá cũ: $${lastPrice.toLocaleString('en-US')})`);
                        }
                    }
                    previousPrices[coin] = currentPrice;
                }
                await sleep(200);
            }

            if (alerts.length > 0) {
                const alertMessage = `⚡ *CẢNH BÁO BIẾN ĐỘNG THỊ TRƯỜNG*\n\n` + alerts.join('\n\n');
                await sendTelegramMessage(BOT1_TOKEN, BOT1_CHAT_ID, alertMessage);
            }
        } catch (e) {
            console.error("Lỗi Alert Bot 1:", e.message);
        }
    });

    // 2. Báo cáo định kỳ (7h, 12h, 20h)
    cron.schedule('0 7,12,20 * * *', async () => {
        try {
            const cryptoData = await getCryptoData();
            const now = new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
            const message = `☀️ *BÁO CÁO THỊ TRƯỜNG ĐỊNH KỲ (${now})*\n\n🪙 *BẢNG GIÁ CRYPTO:* \n${cryptoData}`;
            await sendTelegramMessage(BOT1_TOKEN, BOT1_CHAT_ID, message);
        } catch (e) {
            console.error("Lỗi Cron Bot 1:", e.message);
        }
    });
}

module.exports = initBot1Jobs;
