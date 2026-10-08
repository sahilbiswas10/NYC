const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const jwtSecret = require('../config/jwt');

const generateToken = (id) => {
    return jwt.sign({ id }, jwtSecret, { expiresIn: '30d' });
};

exports.register = async (req, res) => {
    try {
        const { name, password } = req.body;
        const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ success: false, error: 'Provide a name, email, and password of at least 8 characters' });
        }

        const userExists = await User.findOne({ email });
        if (userExists) return res.status(400).json({ success: false, error: 'User already exists' });
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const user = await User.create({ name: name.trim(), email, password: hashedPassword, role: 'student' });
        const token = generateToken(user._id);
        
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.status(201).json({ success: true, token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ success: false, error: 'An account with this email already exists' });
        res.status(500).json({ success: false, error: 'Unable to create account' });
    }
};


exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (typeof email !== 'string' || typeof password !== 'string' || password.length > 72) {
            return res.status(400).json({ success: false, error: 'Email and password are required' });
        }
        
        const user = await User.findOne({ email: String(email || '').trim().toLowerCase() });
        if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });
        
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ success: false, error: 'Invalid credentials' });
        
        const token = generateToken(user._id);
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000
        });

        res.json({ success: true, token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Unable to sign in' });
    }
};

exports.getMe = async (req, res) => {
    res.json({ success: true, user: req.user });
};

exports.logout = async (_req, res) => {
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    res.json({ success: true });
};

exports.updateProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 100) {
            return res.status(400).json({ success: false, error: 'Name must be between 1 and 100 characters' });
        }
        user.name = req.body.name.trim();
        
        await user.save();
        res.json({ success: true, data: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch(err) {
        res.status(500).json({ success: false, error: 'Unable to update profile' });
    }
};

exports.updatePassword = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ success: false, error: 'Provide the current password and a new password of at least 8 characters' });
        }
        
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, error: 'Invalid current password' });
        }
        
        user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
        await user.save();
        
        res.json({ success: true, message: 'Password updated successfully' });
    } catch(err) {
        res.status(500).json({ success: false, error: 'Unable to update password' });
    }
};
