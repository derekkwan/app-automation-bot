const Alert = require('./models/Alert');
const BOT1_TOKEN = process.env.TELEGRAM_TOKEN;

// WEBHOOK BOT 1 (Tra cứu giá & Đặt cảnh báo)
app.post('/telegram-webhook-bot1', async (req, res) => {
    try {
        const message = req.body?.message;
        if (!message || !message.text) return res.sendStatus(200);

        const chatId = message.chat.id;
        const text = message.text.trim();
        const parts = text.split(/\s+/);
        const command = parts[0].toLowerCase();

        // 1. Lệnh /market (Xem toàn bộ bảng giá)
        if (command === '/market') {
            const cryptoData = await getCryptoData();
            await sendTelegramMessage(BOT1_TOKEN, chatId, `🪙 *BẢNG GIÁ THỊ TRƯỜNG LIVE:*\n\n${cryptoData}`);
        }

        // 2. Lệnh /price <coin> (VD: /price btc)
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
                    await sendTelegramMessage(BOT1_TOKEN, chatId, `❌ Không tìm thấy thông tin cho coin *${symbol}*.`);
                }
            } catch (err) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "❌ Lỗi khi lấy giá coin.");
            }
        }

        // 3. Lệnh /alert <coin> <mức_giá> (VD: /alert btc 100000)
        else if (command === '/alert') {
            if (parts.length < 3) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Cú pháp: `/alert <mã_coin> <giá_mục_tiêu>`\n_VD: `/alert btc 100000`_");
                return res.sendStatus(200);
            }
            const symbol = parts[1].toUpperCase();
            const targetPrice = parseFloat(parts[2]);

            if (isNaN(targetPrice)) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "⚠️ Mức giá không hợp lệ.");
                return res.sendStatus(200);
            }

            // Lấy giá hiện tại để xác định điều kiện Tăng lên hay Giảm xuống
            const resPrice = await fetch(`https://api.coinbase.com/v2/prices/${symbol}-USD/spot`);
            const data = await resPrice.json();
            
            if (data?.data?.amount) {
                const currentPrice = parseFloat(data.data.amount);
                const condition = targetPrice > currentPrice ? 'ABOVE' : 'BELOW';

                await Alert.create({ chatId, symbol, targetPrice, condition });
                
                const condText = condition === 'ABOVE' ? 'vượt lên trên' : 'giảm xuống dưới';
                await sendTelegramMessage(BOT1_TOKEN, chatId, `✅ *Đã đặt cảnh báo!*\n• Coin: *${symbol}*\n• Giá hiện tại: *$${currentPrice.toLocaleString('en-US')}*\n• Sẽ báo khi giá ${condText}: *$${targetPrice.toLocaleString('en-US')}*`);
            } else {
                await sendTelegramMessage(BOT1_TOKEN, chatId, `❌ Không tìm thấy coin *${symbol}*.`);
            }
        }

        // 4. Lệnh /myalerts (Xem danh sách cảnh báo đã đặt)
        else if (command === '/myalerts') {
            const list = await Alert.find({ chatId });
            if (list.length === 0) {
                await sendTelegramMessage(BOT1_TOKEN, chatId, "📂 Bạn chưa đặt cảnh báo giá nào.");
            } else {
                let msg = "🔔 *DANH SÁCH CẢNH BÁO CỦA BẠN:*\n\n";
                list.forEach((item, index) => {
                    msg += `${index + 1}. *${item.symbol}* khi chạm mốc *$${item.targetPrice.toLocaleString('en-US')}*\n`;
                });
                await sendTelegramMessage(BOT1_TOKEN, chatId, msg);
            }
        }

    } catch (e) {
        console.error("Lỗi Webhook Bot 1:", e.message);
    }
    res.sendStatus(200);
});
