const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Enrollment = require('../models/Enrollment');
const LessonProgress = require('../models/LessonProgress');
const CourseReview = require('../models/CourseReview');
const DiscussionPost = require('../models/DiscussionPost');
const PaymentOrder = require('../models/PaymentOrder');
const Lesson = require('../models/Lesson');
const Course = require('../models/Course');
const Media = require('../models/Media');
const { protect, authorize } = require('../middleware/auth');
const instructorPhotoUpload = require('../middleware/instructorPhotoUpload');
const instructorController = require('../controllers/instructorController');
const { cleanupMedia } = require('../utils/mediaCleanup');
const { cancelMediaProcessing } = require('../utils/queueManager');

const router = express.Router();
const getPage = (value) => {
    const page = Number.parseInt(value, 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
};
const ADMIN_PAGE_SIZE = 50;

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
            if (!['student', 'instructor'].includes(req.body.role)) return res.status(400).json({ success: false, error: 'Choose a student or instructor role' });
            if (user.role === 'admin') return res.status(403).json({ success: false, error: 'Administrator roles are managed through the trusted deployment process' });
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
        if (user.role === 'admin') return res.status(403).json({ success: false, error: 'Administrator accounts are managed through the trusted deployment process' });
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

        const authoredThreads = await DiscussionPost.find({ author: user._id, parent: null }).distinct('_id');
        await Promise.all([
            Enrollment.deleteMany({ student: user._id }),
            LessonProgress.deleteMany({ student: user._id }),
            CourseReview.deleteMany({ student: user._id }),
            DiscussionPost.deleteMany({ $or: [{ author: user._id }, { parent: { $in: authoredThreads } }] }),
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

router.get('/enrollments', protect, authorize('admin'), async (req, res) => {
    try {
        const page = getPage(req.query.page);
        const [enrollments, total] = await Promise.all([
            Enrollment.find({}).sort('-updatedAt').skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE)
                .populate('student', 'name email').populate('course', 'title status').lean(),
            Enrollment.countDocuments({})
        ]);
        res.json({ success: true, data: enrollments, pagination: { page, pageSize: ADMIN_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load enrollments' });
    }
});

router.post('/enrollments', protect, authorize('admin'), async (req, res) => {
    try {
        const { studentId, courseId } = req.body || {};
        if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(courseId)) return res.status(400).json({ success: false, error: 'Choose a valid student and course' });
        const [student, course] = await Promise.all([
            User.findOne({ _id: studentId, role: 'student' }).select('_id'),
            Course.findOne({ _id: courseId, status: 'published' }).select('_id')
        ]);
        if (!student) return res.status(404).json({ success: false, error: 'Student account not found' });
        if (!course) return res.status(404).json({ success: false, error: 'Published course not found' });

        let enrollment = await Enrollment.findOne({ student: student._id, course: course._id });
        if (enrollment && enrollment.status !== 'cancelled') return res.status(409).json({ success: false, error: 'This student already has access to the course' });
        if (enrollment) {
            await LessonProgress.deleteMany({ student: student._id, course: course._id });
            enrollment.status = 'active';
            enrollment.progress = 0;
            enrollment.completedAt = undefined;
            enrollment.lastAccessedLesson = undefined;
            enrollment.lastAccessedAt = undefined;
            enrollment.certificateId = undefined;
            enrollment.certificateIssuedAt = undefined;
            enrollment.certificateStudentName = undefined;
            enrollment.certificateCourseTitle = undefined;
            await enrollment.save();
        } else {
            enrollment = await Enrollment.create({ student: student._id, course: course._id });
        }
        const totalStudents = await Enrollment.countDocuments({ course: course._id, status: { $in: ['active', 'completed'] } });
        await Course.updateOne({ _id: course._id }, { $set: { totalStudents } });
        res.status(201).json({ success: true, data: enrollment });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'This student already has access to the course' });
        res.status(500).json({ success: false, error: 'Unable to grant course access' });
    }
});

router.put('/enrollments/:id', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Enrollment not found' });
        const enrollment = await Enrollment.findById(req.params.id);
        if (!enrollment) return res.status(404).json({ success: false, error: 'Enrollment not found' });
        const action = req.body?.action;
        if (!['revoke', 'restore', 'reset-progress'].includes(action)) return res.status(400).json({ success: false, error: 'Choose revoke, restore, or reset-progress' });

        if (action === 'restore') {
            if (enrollment.status !== 'cancelled') return res.status(409).json({ success: false, error: 'This enrollment is already active' });
            if (!(await Course.exists({ _id: enrollment.course, status: 'published' }))) return res.status(409).json({ success: false, error: 'Publish this course before restoring access' });
            await LessonProgress.deleteMany({ student: enrollment.student, course: enrollment.course });
            enrollment.status = 'active';
            enrollment.progress = 0;
            enrollment.completedAt = undefined;
            enrollment.lastAccessedLesson = undefined;
            enrollment.lastAccessedAt = undefined;
            enrollment.certificateId = undefined;
            enrollment.certificateIssuedAt = undefined;
            enrollment.certificateStudentName = undefined;
            enrollment.certificateCourseTitle = undefined;
        } else if (action === 'revoke') {
            if (enrollment.status === 'cancelled') return res.status(409).json({ success: false, error: 'This enrollment is already revoked' });
            await LessonProgress.deleteMany({ student: enrollment.student, course: enrollment.course });
            enrollment.status = 'cancelled';
            enrollment.progress = 0;
            enrollment.completedAt = undefined;
            enrollment.lastAccessedLesson = undefined;
            enrollment.lastAccessedAt = undefined;
            enrollment.certificateId = undefined;
            enrollment.certificateIssuedAt = undefined;
            enrollment.certificateStudentName = undefined;
            enrollment.certificateCourseTitle = undefined;
        } else {
            if (enrollment.status === 'cancelled') return res.status(409).json({ success: false, error: 'Restore access before resetting progress' });
            await LessonProgress.deleteMany({ student: enrollment.student, course: enrollment.course });
            enrollment.status = 'active';
            enrollment.progress = 0;
            enrollment.completedAt = undefined;
            enrollment.lastAccessedLesson = undefined;
            enrollment.lastAccessedAt = undefined;
            enrollment.certificateId = undefined;
            enrollment.certificateIssuedAt = undefined;
            enrollment.certificateStudentName = undefined;
            enrollment.certificateCourseTitle = undefined;
        }

        await enrollment.save();
        const totalStudents = await Enrollment.countDocuments({ course: enrollment.course, status: { $in: ['active', 'completed'] } });
        await Course.updateOne({ _id: enrollment.course }, { $set: { totalStudents } });
        res.json({ success: true, data: enrollment });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to update enrollment' });
    }
});

router.get('/payments', protect, authorize('admin'), async (req, res) => {
    try {
        const page = getPage(req.query.page);
        const [payments, total] = await Promise.all([
            PaymentOrder.find({}).sort('-createdAt').skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE)
                .populate('student', 'name email').populate('course', 'title').lean(),
            PaymentOrder.countDocuments({})
        ]);
        res.json({ success: true, data: payments, pagination: { page, pageSize: ADMIN_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load payment records' });
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

router.get('/community/discussions', protect, authorize('admin'), async (req, res) => {
    try {
        const page = getPage(req.query.page);
        const [discussions, total] = await Promise.all([
            DiscussionPost.find({}).sort('-createdAt').skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE)
                .populate('author', 'name').populate('course', 'title').lean(),
            DiscussionPost.countDocuments({})
        ]);
        res.json({ success: true, data: discussions, pagination: { page, pageSize: ADMIN_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load discussion posts' });
    }
});

router.delete('/community/discussions/:id', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Discussion post not found' });
        const post = await DiscussionPost.findById(req.params.id).select('_id parent');
        if (!post) return res.status(404).json({ success: false, error: 'Discussion post not found' });
        if (post.parent) await post.deleteOne();
        else await DiscussionPost.deleteMany({ $or: [{ _id: post._id }, { parent: post._id }] });
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete discussion post' });
    }
});

router.get('/community/reviews', protect, authorize('admin'), async (req, res) => {
    try {
        const page = getPage(req.query.page);
        const [reviews, total] = await Promise.all([
            CourseReview.find({}).sort('-createdAt').skip((page - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE)
                .populate('student', 'name').populate('course', 'title').lean(),
            CourseReview.countDocuments({})
        ]);
        res.json({ success: true, data: reviews, pagination: { page, pageSize: ADMIN_PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) } });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load course reviews' });
    }
});

router.delete('/community/reviews/:id', protect, authorize('admin'), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Course review not found' });
        const result = await CourseReview.deleteOne({ _id: req.params.id });
        if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Course review not found' });
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete course review' });
    }
});

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
