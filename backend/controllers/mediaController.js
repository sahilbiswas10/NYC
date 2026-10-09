const Media = require('../models/Media');
const mongoose = require('mongoose');
const Lesson = require('../models/Lesson');
const fs = require('fs');
const { canManageMedia } = require('../utils/mediaAccess');
const { cleanupMedia } = require('../utils/mediaCleanup');
const Course = require('../models/Course');

exports.uploadMedia = async (req, res) => {
    let createdMedia;
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'Please upload a file' });
        
        const media = await Media.create({
            originalFilename: req.file.originalname,
            originalPath: req.file.path,
            uploadedBy: req.user.id,
            mediaType: req.file.mimetype.startsWith('video') ? 'video' : 'audio',
            fileSize: req.file.size,
            processingStatus: 'uploaded'
        });
        createdMedia = media;

        // Trigger background processing script
        
        const { addToQueue } = require('../utils/queueManager');
        addToQueue(media._id);


        res.status(201).json({
            success: true,
            data: { _id: media._id, originalFilename: media.originalFilename, mediaType: media.mediaType, processingStatus: media.processingStatus },
            message: 'Media processing started in background'
        });
    } catch (err) {
        if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
        if (createdMedia) Media.deleteOne({ _id: createdMedia._id }).catch(() => {});
        res.status(500).json({ success: false, error: 'Unable to save uploaded media' });
    }
};

exports.getMediaStatus = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Media not found' });
        const media = await Media.findById(req.params.id).select('+processingError');
        if (!media) return res.status(404).json({ success: false, error: 'Media not found' });
        if (!(await canManageMedia(media, req.user))) {
            return res.status(403).json({ success: false, error: 'Not authorized to view this media' });
        }
        res.json({ success: true, data: {
            status: media.processingStatus,
            progress: media.processingProgress,
            error: media.processingStatus === 'failed'
                ? (media.processingError || 'Media processing failed. Check the server logs for details.')
                : undefined
        } });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Unable to read media status' });
    }
};

exports.deleteMedia = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Media not found' });
        const media = await Media.findById(req.params.id);
        if (!media) return res.status(404).json({ success: false, error: 'Media not found' });
        if (!(await canManageMedia(media, req.user))) return res.status(403).json({ success: false, error: 'Not authorized to manage this media' });
        if (['uploaded', 'processing'].includes(media.processingStatus)) return res.status(409).json({ success: false, error: 'Wait for media processing to finish before deleting it' });
        const [usedByLesson, usedByCourse] = await Promise.all([
            Lesson.exists({ media: media._id }),
            Course.exists({ demoVideo: media._id })
        ]);
        if (usedByLesson || usedByCourse) return res.status(409).json({ success: false, error: 'Remove this media from its lesson or course before deleting it' });
        await cleanupMedia(media);
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete media' });
    }
};
