const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lms_platform', {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 20
        });
        console.log('MongoDB Connected');
        return true;
    } catch (err) {
        console.error('MongoDB connection error:', err.message);
        return false;
    }
};

module.exports = connectDB;
