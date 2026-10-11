const jwt = require('jsonwebtoken');
const User = require('../models/User');
const jwtSecret = require('../config/jwt');

const parseCookies = (cookieHeader) => {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;
        const value = rest.join('=').trim();
        if (!value) return;
        try { list[name] = decodeURIComponent(value); }
        catch (error) { /* Ignore malformed cookies instead of failing the entire request. */ }
    });
    return list;
};

exports.protect = async (req, res, next) => {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7);
    } else if (req.headers.cookie) {
        const cookies = parseCookies(req.headers.cookie);
        token = cookies.token;
    }

    if (!token) {
        return res.status(401).json({ success: false, error: 'Not authorized' });
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded.purpose || typeof decoded.id !== 'string') return res.status(401).json({ success: false, error: 'Not authorized' });
        req.user = await User.findById(decoded.id).select('-password');
        if (!req.user) return res.status(401).json({ success: false, error: 'Not authorized' });
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Not authorized' });
    }
};

exports.optionalProtect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.slice(7);
    } else if (req.headers.cookie) {
        token = parseCookies(req.headers.cookie).token;
    }
    if (!token) return next();

    try {
        const decoded = jwt.verify(token, jwtSecret);
        if (decoded.purpose || typeof decoded.id !== 'string') return res.status(401).json({ success: false, error: 'Not authorized' });
        req.user = await User.findById(decoded.id).select('-password');
        if (!req.user) return res.status(401).json({ success: false, error: 'Not authorized' });
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Not authorized' });
    }
};

exports.authorize = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ success: false, error: 'User role not authorized' });
        }
        next();
    };
};
