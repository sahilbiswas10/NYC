const express = require('express');
const { uploadMedia, getMediaStatus, deleteMedia } = require('../controllers/mediaController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validateMediaUpload = require('../middleware/validateMediaUpload');
const Media = require('../models/Media');
const { canManageMedia } = require('../utils/mediaAccess');
const Lesson = require('../models/Lesson');
const Course = require('../models/Course');

const router = express.Router();


router.get('/', protect, authorize('admin', 'instructor'), async (req, res) => {
    try {
        const query = req.user.role === 'admin' ? {} : { uploadedBy: req.user.id };
        const media = await Media.find(query)
            .select('originalFilename mediaType duration fileSize processingStatus processingProgress uploadedBy createdAt +processingError')
            .sort('-createdAt');
        const ids = media.map((item) => item._id);
        const [lessons, demos] = await Promise.all([
            Lesson.find({ media: { $in: ids } }).select('media course module title order').populate('course', 'title').populate('module', 'title order'),
            Course.find({ demoVideo: { $in: ids } }).select('demoVideo title')
        ]);
        const placements = new Map(ids.map((id) => [String(id), []]));
        for (const lesson of lessons) {
            if (!lesson.course || !lesson.module) continue;
            placements.get(String(lesson.media))?.push({
                kind: 'lesson', courseId: lesson.course._id, courseTitle: lesson.course.title,
                moduleId: lesson.module._id, moduleTitle: lesson.module.title, moduleNumber: (lesson.module.order || 0) + 1,
                lessonId: lesson._id, lessonTitle: lesson.title, lessonNumber: (lesson.order || 0) + 1
            });
        }
        for (const course of demos) placements.get(String(course.demoVideo))?.push({ kind: 'demo', courseId: course._id, courseTitle: course.title });
        res.json({ success: true, data: media.map((item) => ({ ...item.toObject(), placements: placements.get(String(item._id)) || [] })) });
    } catch(err) {
        res.status(500).json({ success: false, error: 'Unable to load media' });
    }
});

const handleMediaUpload = (req, res, next) => {
    upload.single('media')(req, res, (err) => {
        if (!err) return next();
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const message = err.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the configured upload limit' : 'The selected file type is not supported';
        return res.status(status).json({ success: false, error: message });
    });
};

router.post('/upload', protect, authorize('instructor', 'admin'), handleMediaUpload, validateMediaUpload, uploadMedia);
router.get('/:id/status', protect, authorize('instructor', 'admin'), getMediaStatus);
router.delete('/:id', protect, authorize('instructor', 'admin'), deleteMedia);

module.exports = router;
