const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Enrollment = require('../models/Enrollment');
const { getCourses, getCourseById, createCourse, updateCourse, deleteCourse, uploadCourseThumbnail, getCourseThumbnail } = require('../controllers/courseController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const thumbnailUpload = require('../middleware/courseThumbnailUpload');

const router = express.Router();

router.get('/admin', protect, authorize('admin', 'instructor'), async (req, res) => {
    try {
        const Course = require('../models/Course');
        let query = {};
        if (req.user.role === 'instructor') {
            query.instructor = req.user.id;
        }
        const courses = await Course.find(query).populate('instructor', 'name').populate('instructorProfile', 'name title').sort('-createdAt');
        res.json({ success: true, data: courses });
    } catch(err) {
        res.status(500).json({ success: false, error: 'Unable to load courses' });
    }
});

router.route('/')
    .get(getCourses)
    .post(protect, authorize('instructor', 'admin'), createCourse);

router.get('/:id/certificate', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Certificates are available to students only' });
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Course not found' });

        let enrollment = await Enrollment.findOne({
            student: req.user._id,
            course: req.params.id,
            status: 'completed'
        }).populate('course', 'title');
        if (!enrollment || !enrollment.course) {
            return res.status(403).json({ success: false, error: 'Complete all required lessons to receive your certificate' });
        }

        if (!enrollment.certificateId) {
            const issuedAt = new Date();
            const certificateId = `NYC-${crypto.randomUUID().toUpperCase()}`;
            await Enrollment.updateOne(
                {
                    _id: enrollment._id,
                    status: 'completed',
                    $or: [
                        { certificateId: { $exists: false } },
                        { certificateId: null },
                        { certificateId: '' }
                    ]
                },
                {
                    $set: {
                        certificateId,
                        certificateIssuedAt: issuedAt,
                        certificateStudentName: req.user.name,
                        certificateCourseTitle: enrollment.course.title
                    }
                }
            );
            enrollment = await Enrollment.findById(enrollment._id).populate('course', 'title');
        }

        if (!enrollment?.certificateId) {
            return res.status(409).json({ success: false, error: 'Unable to issue the certificate. Please try again.' });
        }

        res.json({
            success: true,
            data: {
                certificateId: enrollment.certificateId,
                issuedAt: enrollment.certificateIssuedAt || enrollment.completedAt || enrollment.createdAt,
                studentName: enrollment.certificateStudentName || req.user.name,
                courseTitle: enrollment.certificateCourseTitle || enrollment.course.title
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load your certificate' });
    }
});

router.get('/:id/thumbnail', getCourseThumbnail);
router.post('/:id/thumbnail', protect, authorize('instructor', 'admin'), (req, res, next) => {
    thumbnailUpload.single('thumbnail')(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        const message = status === 413 ? 'Course image must be 5 MB or smaller' : 'Choose a JPG, PNG, or WebP course image';
        return res.status(status).json({ success: false, error: message });
    });
}, uploadCourseThumbnail);

router.route('/:id')
    .get(optionalProtect, getCourseById)
    .put(protect, authorize('instructor', 'admin'), updateCourse)
    .delete(protect, authorize('instructor', 'admin'), deleteCourse);

module.exports = router;
