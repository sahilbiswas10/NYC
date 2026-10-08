const express = require('express');
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
