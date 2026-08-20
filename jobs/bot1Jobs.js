const cron = require('node-cron');
const Alert = require('../models/Alert');
const { sendTelegramMessage } = require('../services/telegram');
const { getCryptoData, headers, sleep } = require('../services/crypto');

const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;
const BOT1_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let previousPrices = {};

function initBot1Jobs() {
    // 1. Kiểm tra biến động & Ngưỡng giá cảnh báo (/alert) mỗi 2 phút
    cron.schedule('*/2 * * * *', async () => {
        try {
            const watchCoins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
            let spikeAlerts = [];

            for (const coin of watchCoins) {
                const res = await fetch(`https://api.coinbase.com/v2/prices/${coin}-USD/spot`, { headers });
                const data = await res.json();
                if (data?.data?.amount) {
                    const currentPrice = parseFloat(data.data.amount);
                    const lastPrice = previousPrices[coin];

                    // Biến động mạnh
                    if (lastPrice) {
                        const percentChange = ((currentPrice - lastPrice) / lastPrice) * 100;
                        if (Math.abs(percentChange) >= 2.5) {
                            const icon = percentChange > 0 ? "🚀 *TĂNG VỌT*" : "🔻 *GIẢM MẠNH*";
                            spikeAlerts.push(`• *${coin}:* ${icon} *${percentChange.toFixed(2)}%*\n  Giá: *$${currentPrice.toLocaleString('en-US')}* (Cũ: $${lastPrice.toLocaleString('en-US')})`);
                        }
                    }
                    previousPrices[coin] = currentPrice;

                    // Kiểm tra cảnh báo /alert từ Database
                    const activeAlerts = await Alert.find({ symbol: coin });
                    for (const alert of activeAlerts) {
                        let triggered = false;
                        if (alert.condition === 'ABOVE' && currentPrice >= alert.targetPrice) triggered = true;
                        if (alert.condition === 'BELOW' && currentPrice <= alert.targetPrice) triggered = true;

                        if (triggered) {
                            const alertMsg = `🎯 *CẢNH BÁO MỤC TIÊU GIÁ!*\n\n` +
                                             `• Coin: *${alert.symbol}*\n` +
                                             `• Giá hiện tại: *$${currentPrice.toLocaleString('en-US')}*\n` +
                                             `• Mức giá bạn đặt: *$${alert.targetPrice.toLocaleString('en-US')}*`;
                            await sendTelegramMessage(BOT1_TOKEN, alert.chatId, alertMsg);
                            await Alert.findByIdAndDelete(alert._id); // Xóa cảnh báo sau khi đã báo
                        }
                    }
                }
                await sleep(200);
            }

            if (spikeAlerts.length > 0) {
                const msg = `⚡ *CẢNH BÁO BIẾN ĐỘNG THỊ TRƯỜNG*\n\n` + spikeAlerts.join('\n\n');
                await sendTelegramMessage(BOT1_TOKEN, BOT1_CHAT_ID, msg);
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
