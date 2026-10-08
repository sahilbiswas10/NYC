const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const LessonProgress = require('../models/LessonProgress');
const Lesson = require('../models/Lesson');
const Course = require('../models/Course');
const Media = require('../models/Media');
const { protect, authorize } = require('../middleware/auth');
const instructorPhotoUpload = require('../middleware/instructorPhotoUpload');
const instructorController = require('../controllers/instructorController');
const { cleanupMedia } = require('../utils/mediaCleanup');
const { cancelMediaProcessing } = require('../utils/queueManager');

const router = express.Router();

router.get('/users', protect, authorize('admin'), async (_req, res) => {
    try {
        const users = await User.find({}).select('name email role createdAt').sort('name').lean();
        res.json({ success: true, data: users });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load users' });
    }
});

router.put('/users/:id', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid user id' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (Object.hasOwn(req.body, 'name')) {
            if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 100) return res.status(400).json({ success: false, error: 'Enter a name between 1 and 100 characters' });
            user.name = req.body.name.trim();
        }
        if (Object.hasOwn(req.body, 'email')) {
            const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });
            user.email = email;
        }
        if (Object.hasOwn(req.body, 'role')) {
            if (!['student', 'instructor', 'admin'].includes(req.body.role)) return res.status(400).json({ success: false, error: 'Choose a valid account role' });
            if (String(user._id) === String(req.user.id) && req.body.role !== user.role) return res.status(400).json({ success: false, error: 'You cannot change your own role' });
            user.role = req.body.role;
        }
        await user.save();
        res.json({ success: true, data: { _id: user._id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } });
    } catch (error) {
        res.status(error.code === 11000 ? 409 : 400).json({ success: false, error: error.code === 11000 ? 'That email address is already in use' : 'Unable to update user' });
    }
});

router.delete('/users/:id', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid user id' });
        if (String(req.params.id) === String(req.user.id)) return res.status(400).json({ success: false, error: 'You cannot delete your own account' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const enrolledCourses = await Enrollment.aggregate([
            { $match: { student: user._id, status: { $in: ['active', 'completed'] } } },
            { $group: { _id: '$course', count: { $sum: 1 } } }
        ]);
        const uploadedMedia = await Media.find({ uploadedBy: user._id });
        const uploadedMediaIds = uploadedMedia.map((item) => item._id);

        // Stop queued/active transcodes before removing their source files.
        await Promise.all(uploadedMediaIds.map((mediaId) => cancelMediaProcessing(mediaId)));

        if (uploadedMediaIds.length) {
            const affectedCourses = await Lesson.distinct('course', { media: { $in: uploadedMediaIds } });
            await Promise.all([
                Lesson.updateMany(
                    { media: { $in: uploadedMediaIds } },
                    { $unset: { media: 1 }, $set: { type: 'text', duration: 0 } }
                ),
                Course.updateMany(
                    { demoVideo: { $in: uploadedMediaIds } },
                    { $unset: { demoVideo: 1 }, $set: { status: 'unpublished' } }
                ),
                affectedCourses.length
                    ? Course.updateMany({ _id: { $in: affectedCourses } }, { $set: { status: 'unpublished' } })
                    : Promise.resolve()
            ]);

            for (const media of uploadedMedia) {
                if (['uploaded', 'processing'].includes(media.processingStatus)) {
                    media.processingStatus = 'failed';
                    await media.save();
                }
                await cleanupMedia(media);
            }
        }

        await Promise.all([
            Enrollment.deleteMany({ student: user._id }),
            LessonProgress.deleteMany({ student: user._id }),
            Course.updateMany({ instructor: user._id }, { $set: { instructor: req.user.id } }),
            ...enrolledCourses.map(({ _id, count }) => Course.updateOne(
                { _id },
                [{ $set: { totalStudents: { $max: [0, { $subtract: [{ $ifNull: ['$totalStudents', 0] }, count] }] } } }]
            ))
        ]);
        await user.deleteOne();
        res.json({ success: true, data: {} });
    } catch (error) {
        console.error('Unable to delete user and related data:', error.message);
        res.status(500).json({ success: false, error: 'Unable to delete user' });
    }
});

const handleInstructorPhoto = (req, res, next) => {
    instructorPhotoUpload.single('photo')(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ success: false, error: status === 413 ? 'Profile photo must be 5 MB or smaller' : 'Choose a JPG, PNG, or WebP image' });
    });
};

router.get('/instructors', protect, authorize('admin'), instructorController.listAdminInstructors);
router.post('/instructors', protect, authorize('admin'), handleInstructorPhoto, instructorController.createInstructor);
router.put('/instructors/:id', protect, authorize('admin'), handleInstructorPhoto, instructorController.updateInstructor);
router.delete('/instructors/:id', protect, authorize('admin'), instructorController.deleteInstructor);

router.put('/users/:id/role', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid user id' });
        if (!['student', 'instructor'].includes(req.body.role)) {
            return res.status(400).json({ success: false, error: 'Choose a student or instructor role' });
        }
        if (String(req.user.id) === req.params.id) return res.status(400).json({ success: false, error: 'You cannot change your own role' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (user.role === 'admin') return res.status(403).json({ success: false, error: 'Administrator roles must be managed through the trusted deployment process' });
        user.role = req.body.role;
        await user.save();
        res.json({ success: true, data: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to update user role' });
    }
});

module.exports = router;
