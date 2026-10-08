const fs = require('fs/promises');
const path = require('path');

const signatures = {
    '.mp4': (header) => header.subarray(4, 8).toString() === 'ftyp',
    '.m4v': (header) => header.subarray(4, 8).toString() === 'ftyp',
    '.mov': (header) => header.subarray(4, 8).toString() === 'ftyp',
    '.webm': (header) => header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    '.mkv': (header) => header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
    '.mp3': (header) => header.subarray(0, 3).toString() === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0),
    '.wav': (header) => header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE',
    '.wave': (header) => header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WAVE',
    '.aac': (header) => header[0] === 0xff && (header[1] & 0xf6) === 0xf0
};

module.exports = async (req, res, next) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Please upload a file' });
    try {
        const ext = path.extname(req.file.originalname).toLowerCase();
        const isValid = signatures[ext];
        const handle = await fs.open(req.file.path, 'r');
        const header = Buffer.alloc(16);
        let bytesRead;
        try {
            ({ bytesRead } = await handle.read(header, 0, header.length, 0));
        } finally {
            await handle.close();
        }
        if (!isValid || !isValid(header.subarray(0, bytesRead))) {
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ success: false, error: 'The uploaded file does not match its declared media format' });
        }
        next();
    } catch (error) {
        await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ success: false, error: 'Unable to validate the uploaded media file' });
    }
};
