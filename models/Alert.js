const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    chatId: { type: String, required: true },
    symbol: { type: String, required: true }, // VD: BTC, ETH
    targetPrice: { type: Number, required: true }, // Mức giá muốn cảnh báo
    condition: { type: String, enum: ['ABOVE', 'BELOW'], required: true }, // Cao hơn hoặc Thấp hơn giá lúc đặt
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Alert', alertSchema);
