const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storageDir = path.join(__dirname, '../../storage/course-thumbnails');
fs.mkdirSync(storageDir, { recursive: true });

const allowed = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp']
};

module.exports = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, storageDir),
        filename: (_req, file, callback) => callback(null, `course-thumbnail-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowed[file.mimetype]?.includes(ext)) return callback(new Error('Choose a JPG, PNG, or WebP course image'));
        callback(null, true);
    }
});
