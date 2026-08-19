const axios = require('axios');
const yahooFinance = require('yahoo-finance2').default;
const cron = require('node-cron');

// 1. Hàm lấy giá Tiền ảo từ CoinGecko (Miễn phí, không cần API Key)
async function getCryptoData() {
    try {
        // Lấy giá Bitcoin và Ethereum theo USD
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd';
        const response = await axios.get(url);
        
        const btc = response.data.bitcoin.usd;
        const eth = response.data.ethereum.usd;
        
        return `Bitcoin: $${btc}, Ethereum: $${eth}`;
    } catch (error) {
        console.error("Lỗi lấy giá Crypto:", error.message);
        return "Không lấy được dữ liệu Crypto";
    }
}

// 2. Hàm lấy giá Cổ phiếu, Vàng, Dầu từ Yahoo Finance
async function getMarketData() {
    try {
        // Các mã ticker chuẩn: AAPL (Apple), GC=F (Vàng hợp đồng tương lai), CL=F (Dầu thô WTI)
        const apple = await yahooFinance.quote('AAPL');
        const gold = await yahooFinance.quote('GC=F');
        const oil = await yahooFinance.quote('CL=F');

        return `Apple: $${apple.regularMarketPrice}, Vàng: $${gold.regularMarketPrice}/oz, Dầu: $${oil.regularMarketPrice}/thùng`;
    } catch (error) {
        console.error("Lỗi lấy dữ liệu thị trường:", error.message);
        return "Không lấy được dữ liệu thị trường";
    }
}

// 3. Hàm tổng hợp và kịch bản tự động hóa
async function generateDailyReport() {
    console.log("Đang tổng hợp dữ liệu thị trường...");
    
    // Gọi song song các hàm để tiết kiệm thời gian
    const [cryptoData, marketData] = await Promise.all([
        getCryptoData(),
        getMarketData()
    ]);

    // Gộp thành một khối dữ liệu thô
    const rawData = `Dữ liệu hôm nay:\n- Tiền ảo: ${cryptoData}\n- Thị trường: ${marketData}`;
    
    console.log("-----------------------");
    console.log(rawData);
    console.log("-----------------------");
    
    // Ở bước tiếp theo, biến 'rawData' này sẽ được gửi vào AI API để phân tích và nhắn qua Telegram
}

// Lên lịch chạy tự động bằng node-cron
// Cú pháp '* * * * *' tương ứng với: Phút, Giờ, Ngày trong tháng, Tháng, Ngày trong tuần
// Ví dụ dưới đây: Chạy vào đúng 08:00 sáng mỗi ngày
cron.schedule('0 8 * * *', () => {
    generateDailyReport();
});

console.log("Hệ thống dữ liệu đã khởi động. Đang chờ đến lịch...");

// Chạy thử một lần ngay khi khởi động để kiểm tra code
generateDailyReport();
