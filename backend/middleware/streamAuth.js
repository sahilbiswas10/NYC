const jwt = require('jsonwebtoken');
const User = require('../models/User');
const jwtSecret = require('../config/jwt');

const readCookie = (header, name) => {
    for (const part of (header || '').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try { return decodeURIComponent(part.slice(separator + 1).trim()); }
        catch (error) { return null; }
    }
    return null;
};

const loadUser = async (token) => {
    if (!token) return null;
    try {
        const decoded = jwt.verify(token, jwtSecret);
        return await User.findById(decoded.id).select('-password');
    } catch (error) {
        return null;
    }
};

module.exports = async (req, res, next) => {
    try {
        const authorization = req.headers.authorization || '';
        const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
        req.user = await loadUser(bearer) || await loadUser(readCookie(req.headers.cookie, 'token'));
        if (!req.user) {
            const ticket = readCookie(req.headers.cookie, 'streamTicket');
            if (!ticket) return res.status(401).send('Stream authorization required');
            let decoded;
            try { decoded = jwt.verify(ticket, jwtSecret); }
            catch (error) { return res.status(401).send('Stream authorization expired'); }
            if (decoded.purpose !== 'hls' || decoded.mediaId !== req.params.mediaId) {
                return res.status(401).send('Stream authorization invalid');
            }
            if (decoded.publicPreview !== true) {
                req.user = await User.findById(decoded.id).select('-password');
                if (!req.user) return res.status(401).send('Stream authorization invalid');
            }
        }
        next();
    } catch (error) {
        next(error);
    }
};
