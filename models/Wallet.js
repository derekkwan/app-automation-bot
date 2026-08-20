const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    group: { type: String, required: true },
    name: { type: String, required: true, unique: true },
    address: { type: String, required: true },
    balance: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Wallet', walletSchema);
