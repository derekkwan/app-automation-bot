const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json'
};

// Danh sách các mã VN30 phân theo ngành
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

// 1. Lấy giá Crypto từ Coinbase
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

// 2. Lấy giá Thị trường Quốc tế từ Yahoo Finance
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

// 3. Lấy giá VN30 từ VNDirect API v2 (1 request cực nhanh và không bị chặn IP)
async function getVN30Data() {
    try {
        const allTickers = Object.values(VN30_SECTORS).flat().join(',');
        const url = `https://api-price.vndirect.com.vn/v2/stock/multi?q=code:${allTickers}`;
        
        const res = await fetch(url, { headers });
        const json = await res.json();

        const priceMap = {};
        if (json && json.data && Array.isArray(json.data)) {
            json.data.forEach(item => {
                const ticker = item.code;
                // Lấy giá khớp gần nhất -> nếu không có thì lấy giá tham chiếu/đóng cửa
                const price = item.matchPrice || item.closePrice || item.basicPrice;
                if (ticker && price) {
                    priceMap[ticker] = (parseFloat(price) * 1000).toLocaleString('vi-VN') + 'đ';
                }
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
        console.error("Lỗi lấy dữ liệu VN30:", error.message);
        return "• VN30: Không lấy được dữ liệu";
    }
}

// 4. Lãi suất tiết kiệm động 12 tháng
async function getBankRates() {
    try {
        const res = await fetch('https://api.webtygia.com/api/bank-rates', { headers });
        const json = await res.json();
        
        if (json && json.data) {
            const vcb = json.data.find(b => b.code === 'VCB' || b.name.includes('Vietcombank'))?.rate12m || '7.2%';
            const mb = json.data.find(b => b.code === 'MB' || b.name.includes('MB'))?.rate12m || '7.4%';
            const tcb = json.data.find(b => b.code === 'TCB' || b.name.includes('Techcombank'))?.rate12m || '7.3%';
            const acb = json.data.find(b => b.code === 'ACB' || b.name.includes('ACB'))?.rate12m || '7.1%';

            return `• *Vietcombank (12T):* ${vcb}\n` +
                   `• *MB Bank (12T):* ${mb}\n` +
                   `• *Techcombank (12T):* ${tcb}\n` +
                   `• *ACB (12T):* ${acb}`;
        }
    } catch (error) {
        return `• *Vietcombank (12T):* ~7.2%/năm\n` +
               `• *MB Bank (12T):* ~7.4%/năm\n` +
               `• *Techcombank (12T):* ~7.3%/năm\n` +
               `• *ACB (12T):* ~7.1%/năm`;
    }
}

// 5. Tổng hợp báo cáo
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu báo cáo...");
    const [cryptoData, globalMarketData, vn30Data, bankData] = await Promise.all([
        getCryptoData(),
        getGlobalMarketData(),
        getVN30Data(),
        getBankRates()
    ]);

    const overviewReport = `📊 *BÁO CÁO TÀI CHÍNH MỖI NGÀY*\n\n` +
                            `🪙 *Tiền mã hóa:*\n${cryptoData}\n\n` +
                            `📈 *Thị trường quốc tế:*\n${globalMarketData}\n\n` +
                            `🏦 *Lãi suất tiết kiệm động (12 tháng):*\n${bankData}`;
    
    await sendTelegramMessage(overviewReport);
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

generateDailyReport();
