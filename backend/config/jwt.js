const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const secretFile = path.join(__dirname, '.jwt-secret');
const readLocalSecret = () => fs.readFileSync(secretFile, 'utf8').trim();

const createLocalSecret = () => {
    const generated = crypto.randomBytes(48).toString('hex');
    try {
        fs.writeFileSync(secretFile, `${generated}\n`, { flag: 'wx', mode: 0o600 });
        return generated;
    } catch (error) {
        if (error.code === 'EEXIST') return readLocalSecret();
        throw error;
    }
};

let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET must be set in production.');
    }
    try {
        jwtSecret = readLocalSecret();
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        jwtSecret = createLocalSecret();
    }
    if (Buffer.byteLength(jwtSecret) < 32) throw new Error('The local JWT signing key must be at least 32 bytes.');
    console.warn('JWT_SECRET is not set; using a persistent local development key. Set JWT_SECRET in production.');
}

module.exports = jwtSecret;
