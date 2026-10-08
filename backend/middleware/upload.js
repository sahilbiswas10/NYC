const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const storageDir = path.join(__dirname, '../../storage/originals');
if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, storageDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `media-${crypto.randomUUID()}${ext}`);
    }
});

const allowedExtensions = {
    'video/mp4': ['.mp4', '.m4v'],
    'video/quicktime': ['.mov'],
    'video/webm': ['.webm'],
    'video/x-matroska': ['.mkv'],
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav', '.wave'],
    'audio/aac': ['.aac']
};

const configuredMaxMb = Number.parseInt(process.env.MAX_UPLOAD_SIZE_MB || '2048', 10);
const maxUploadBytes = Number.isInteger(configuredMaxMb) && configuredMaxMb > 0
    ? configuredMaxMb * 1024 * 1024
    : 2048 * 1024 * 1024;

const upload = multer({ 
    storage,
    limits: { fileSize: maxUploadBytes },
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedExtensions[file.mimetype]?.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Upload a supported video or audio file with a matching file extension'), false);
        }
    }
});

module.exports = upload;
