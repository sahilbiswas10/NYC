require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const run = async () => {
    const email = typeof process.env.INITIAL_ADMIN_EMAIL === 'string' ? process.env.INITIAL_ADMIN_EMAIL.trim().toLowerCase() : '';
    const password = process.env.INITIAL_ADMIN_PASSWORD || '';
    const name = (process.env.INITIAL_ADMIN_NAME || 'System Administrator').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
        throw new Error('Set INITIAL_ADMIN_EMAIL and a unique INITIAL_ADMIN_PASSWORD between 12 and 72 bytes before running this command.');
    }

    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lms_platform', { serverSelectionTimeoutMS: 5000 });
    if (await User.exists({ role: 'admin' })) throw new Error('An administrator already exists. The bootstrap command only creates the first administrator.');
    if (await User.exists({ email })) throw new Error('That email already belongs to an account. The bootstrap command will not change existing accounts.');

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(12));
    await User.create({ name: name || 'System Administrator', email, password: passwordHash, role: 'admin' });
    console.log('First administrator account created. Remove the bootstrap credentials from the environment now.');
};

run()
    .catch((error) => {
        console.error(error.message || 'Unable to create the first administrator.');
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
    });
