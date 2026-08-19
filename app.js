const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
};

// Phân ngành danh sách VN30
const VN30_SECTORS = {
    "🏦 Ngân hàng": ["ACB", "BID", "CTG", "HDB", "MBB", "SSB", "STB", "TCB", "TPB", "VCB", "VIB", "VPB"],
    "🏢 Bất động sản": ["BCM", "VHM", "VIC", "VRE"],
    "🥩 Tiêu dùng & Bán lẻ": ["MSN", "MWG", "SAB", "VNM"],
    "🧱 Công nghiệp & Vật liệu": ["BVH", "HPG", "GVR"],
    "⚡ Năng lượng & Tiện ích": ["GAS", "POW", "PLX"],
    "💻 Công nghệ": ["FPT"],
    "✈️ Hàng không": ["VJC"],
    "📈 Chứng khoán": ["SSI"]
};

async function sendTelegramMessage(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'Markdown'
            })
        });
    } catch (error) {
        console.error("Lỗi gửi Telegram:", error.message);
    }
}

// 1. Lấy giá Crypto (Coinbase API)
async function getCryptoData() {
    try {
        const [btcRes, ethRes] = await Promise.all([
            fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot', { headers }),
            fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', { headers })
        ]);
        
        const btcData = await btcRes.json();
        const ethData = await ethRes.json();

        const btc = parseFloat(btcData?.data?.amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
        const eth = parseFloat(ethData?.data?.amount).toLocaleString('en-US', { maximumFractionDigits: 2 });
        
        return `• *Bitcoin:* $${btc}\n• *Ethereum:* $${eth}`;
    } catch (error) {
        return "• Crypto: Không lấy được dữ liệu";
    }
}

// 2. Lấy giá Thị trường Quốc tế (Yahoo Finance API)
async function fetchYahooPrice(symbol) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`;
        const res = await fetch(url, { headers });
        const data = await res.json();
        const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
        return price ? `$${parseFloat(price).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : 'N/A';
    } catch (err) {
        return 'N/A';
    }
}

async function getGlobalMarketData() {
    const [apple, gold, oil] = await Promise.all([
        fetchYahooPrice('AAPL'),
        fetchYahooPrice('GC=F'),
        fetchYahooPrice('CL=F')
    ]);

    return `• *Cổ phiếu Apple:* ${apple}\n` +
           `• *Vàng:* ${gold}/oz\n` +
           `• *Dầu WTI:* ${oil}/thùng`;
}

// 3. Lấy giá VN30 phân ngành (TCBS API)
async function getVN30Data() {
    try {
        const vn30Tickers = Object.values(VN30_SECTORS).flat().join(',');
        const url = `https://apipubks.tcbs.com.vn/stock-insight/v1/stock/second-price?tickers=${vn30Tickers}`;
        const res = await fetch(url, { headers });
        const json = await res.json();

        const priceMap = {};
        if (json?.data) {
            json.data.forEach(item => {
                priceMap[item.ticker] = item.cp ? (item.cp * 1000).toLocaleString('vi-VN') + 'đ' : 'N/A';
            });
        }

        let output = "🇻🇳 *CỔ PHIẾU VN30 THEO NGÀNH*\n";
        for (const [sector, tickers] of Object.entries(VN30_SECTORS)) {
            output += `\n*${sector}:*\n`;
            tickers.forEach(ticker => {
                const price = priceMap[ticker] || 'N/A';
                output += `  • ${ticker}: ${price}\n`;
            });
        }

        return output;
    } catch (error) {
        return "• VN30: Không lấy được dữ liệu từ TCBS";
    }
}

// 4. Lãi suất Ngân hàng (Kỳ hạn 12 tháng)
function getBankRates() {
    return `• *Vietcombank:* 4.7%/năm\n` +
           `• *MB Bank:* 4.8%/năm\n` +
           `• *Techcombank:* 4.85%/năm\n` +
           `• *ACB:* 4.5%/năm`;
}

// 5. Tổng hợp báo cáo
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu báo cáo...");
    const [cryptoData, globalMarketData, vn30Data] = await Promise.all([
        getCryptoData(),
        getGlobalMarketData(),
        getVN30Data()
    ]);

    const bankData = getBankRates();

    // Tin nhắn 1: Tổng quan Quốc tế & Tiền gửi
    const overviewReport = `📊 *BÁO CÁO TÀI CHÍNH MỖI NGÀY*\n\n` +
                            `🪙 *Tiền mã hóa:*\n${cryptoData}\n\n` +
                            `📈 *Thị trường quốc tế:*\n${globalMarketData}\n\n` +
                            `🏦 *Lãi suất tiết kiệm (12 tháng):*\n${bankData}`;
    
    await sendTelegramMessage(overviewReport);

    // Tin nhắn 2: Chi tiết VN30 phân ngành
    await sendTelegramMessage(vn30Data);
}

// Đặt lịch gửi lúc 08:00 sáng giờ VN (01:00 UTC)
cron.schedule('0 1 * * *', () => {
    generateDailyReport();
});

app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server chạy trên port ${PORT}`);
});

// Chạy test lập tức khi khởi động/deploy
generateDailyReport();
