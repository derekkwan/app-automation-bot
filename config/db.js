const mongoose = require('mongoose');

const connectDB = async () => {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) return;

    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Đã kết nối thành công tới MongoDB Atlas");
    } catch (err) {
        console.error("❌ Lỗi kết nối MongoDB:", err.message);
    }
};

module.exports = connectDB;
