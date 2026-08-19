const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000; 

// Tắt các cảnh báo không cần thiết của Yahoo Finance
try {
    yahooFinance.suppressNotices(['yahooSurvey']);
} catch (e) {
    // Bỏ qua nếu phiên bản không hỗ trợ
}

// 1. Hàm lấy giá Crypto từ CoinGecko
async function getCryptoData() {
    try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';
        const response = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        
        const btc = response.data?.bitcoin?.usd || 'N/A';
        const eth = response.data?.ethereum?.usd || 'N/A';
        
        return `Bitcoin: $${btc}, Ethereum: $${eth}`;
    } catch (error) {
        console.error("Lỗi lấy giá Crypto:", error.message);
        return "Không lấy được dữ liệu Crypto";
    }
}

// 2. Hàm lấy dữ liệu từ Yahoo Finance (Có bọc lỗi riêng từng mã)
async function getMarketData() {
    try {
        const fetchQuote = async (symbol) => {
            try {
                const res = await yahooFinance.quote(symbol);
                return res?.regularMarketPrice || 'N/A';
            } catch (err) {
                console.error(`Lỗi lấy mã ${symbol}:`, err.message);
                return 'N/A';
            }
        };

        const [applePrice, goldPrice, oilPrice] = await Promise.all([
            fetchQuote('AAPL'),
            fetchQuote('GC=F'),
            fetchQuote('CL=F')
        ]);

        return `Apple: $${applePrice}, Vàng: $${goldPrice}/oz, Dầu: $${oilPrice}/thùng`;
    } catch (error) {
        console.error("Lỗi lấy dữ liệu thị trường:", error.message);
        return "Không lấy được dữ liệu thị trường";
    }
}

// 3. Báo cáo tổng hợp
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu thị trường...");
    
    const [cryptoData, marketData] = await Promise.all([
        getCryptoData(),
        getMarketData()
    ]);

    const rawData = `Dữ liệu hôm nay:\n- Tiền ảo: ${cryptoData}\n- Thị trường: ${marketData}`;
    
    console.log("-----------------------");
    console.log(rawData);
    console.log("-----------------------");
}

// Lịch chạy 8:00 AM mỗi ngày
cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

// Endpoint kiểm tra Uptime cho Render / Cron-job.org
app.get('/', (req, res) => {
    res.send('Bot Tài chính AI đang hoạt động 24/7!');
});

app.listen(PORT, () => {
    console.log(`Server đang chạy ổn định trên port ${PORT}`);
});

console.log("Hệ thống dữ liệu đã khởi động. Đang chờ đến lịch...");

// Chạy test 1 lần ngay khi khởi động
generateDailyReport();
