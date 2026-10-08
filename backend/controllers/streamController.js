const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Media = require('../models/Media');
const { canStreamMedia } = require('../utils/mediaAccess');
const jwt = require('jsonwebtoken');
const jwtSecret = require('../config/jwt');

exports.issueStreamTicket = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.mediaId)) return res.status(404).json({ success: false, error: 'Media not found' });
        const media = await Media.findById(req.params.mediaId);
        if (!media) return res.status(404).json({ success: false, error: 'Media not found' });
        if (media.processingStatus !== 'ready') return res.status(400).json({ success: false, error: 'Media not ready' });
        if (!(await canStreamMedia(media, req.user))) return res.status(403).json({ success: false, error: 'Not authorized to stream this media' });

        const claims = { mediaId: String(media._id), purpose: 'hls' };
        if (req.user) claims.id = req.user.id;
        else claims.publicPreview = true;
        const ticket = jwt.sign(claims, jwtSecret, { expiresIn: '5m' });
        res.cookie('streamTicket', ticket, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: `/api/media/play/${media._id}`,
            maxAge: 5 * 60 * 1000
        });
        res.json({ success: true, expiresIn: 300 });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to authorize stream' });
    }
};

exports.getManifest = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.mediaId)) return res.status(404).send('Media not found');
        const media = await Media.findById(req.params.mediaId);
        if (!media) return res.status(404).send('Media not found');
        if (!(await canStreamMedia(media, req.user))) return res.status(403).send('Not authorized to stream this media');
        if (media.processingStatus !== 'ready') return res.status(400).send('Media not ready');

        const hlsDir = path.resolve(__dirname, '../../storage/hls', req.params.mediaId);
        const manifestPath = path.resolve(hlsDir, 'master.m3u8');
        if (!media.hlsManifestPath || path.resolve(media.hlsManifestPath) !== manifestPath) {
            return res.status(404).send('Manifest missing');
        }

        const manifest = await fs.promises.readFile(manifestPath, 'utf8');
        const lines = manifest.split(/\r?\n/).map((line) => {
            if (!line || line.startsWith('#')) return line;
            const filename = path.basename(line);
            if (filename !== line || !/^[A-Za-z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') {
                throw new Error('Invalid HLS manifest entry');
            }
            return `/api/media/play/${encodeURIComponent(req.params.mediaId)}/segment/${encodeURIComponent(filename)}`;
        });
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'private, no-store');
        res.send(lines.join('\n'));
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).send('Manifest missing');
        res.status(500).send('Unable to load manifest');
    }
};

exports.getSegment = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.mediaId)) return res.status(404).send('Media not found');
        const media = await Media.findById(req.params.mediaId);
        if (!media) return res.status(404).send('Media not found');
        if (!(await canStreamMedia(media, req.user))) return res.status(403).send('Not authorized to stream this media');
        if (media.processingStatus !== 'ready') return res.status(400).send('Media not ready');

        const filename = req.params.filename;
        if (!/^[A-Za-z0-9_.-]+$/.test(filename) || filename === '.' || filename === '..') {
            return res.status(400).send('Invalid segment filename');
        }
        const hlsDir = path.resolve(__dirname, '../../storage/hls', req.params.mediaId);
        const segmentPath = path.resolve(hlsDir, filename);
        const relativePath = path.relative(hlsDir, segmentPath);
        if (!relativePath || relativePath.startsWith(`..${path.sep}`) || relativePath === '..' || path.isAbsolute(relativePath)) {
            return res.status(400).send('Invalid segment filename');
        }

        await fs.promises.access(segmentPath, fs.constants.R_OK);
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'private, no-store');
        res.sendFile(segmentPath);
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).send('Segment not found');
        res.status(500).send('Unable to load segment');
    }
};
