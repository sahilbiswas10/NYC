const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storageDir = path.join(__dirname, '../../storage/module-notes');
fs.mkdirSync(storageDir, { recursive: true });
const allowed = {
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt', '.md', '.markdown'],
    'text/markdown': ['.md', '.markdown']
};

module.exports = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, storageDir),
        filename: (_req, file, callback) => {
            const ext = path.extname(file.originalname).toLowerCase() === '.markdown' ? '.md' : path.extname(file.originalname).toLowerCase();
            callback(null, `module-notes-${crypto.randomUUID()}${ext}`);
        }
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const ext = path.extname(file.originalname).toLowerCase();
        callback(null, Boolean(allowed[file.mimetype]?.includes(ext)));
    }
});
