const express = require('express');
const mongoose = require('mongoose');
const Course = require('../models/Course');
const CourseReview = require('../models/CourseReview');
const Enrollment = require('../models/Enrollment');
const { optionalProtect, protect } = require('../middleware/auth');

const router = express.Router();

const findAccessibleCourse = async (courseId, user) => {
    if (!mongoose.isValidObjectId(courseId)) return null;
    const course = await Course.findById(courseId).select('status instructor');
    if (!course) return null;
    if (course.status === 'published') return course;

    if (!user) return null;
    const isManager = user.role === 'admin' || (user.role === 'instructor' && String(course.instructor) === String(user.id));
    const isEnrolled = user.role === 'student' && await Enrollment.exists({
        student: user.id,
        course: course._id,
        status: { $in: ['active', 'completed'] }
    });
    return isManager || isEnrolled ? course : null;
};

router.get('/:courseId/reviews', optionalProtect, async (req, res) => {
    try {
        const course = await findAccessibleCourse(req.params.courseId, req.user);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

        const [reviews, stats, myReview] = await Promise.all([
            CourseReview.find({ course: course._id }).sort('-createdAt').limit(100).populate('student', 'name'),
            CourseReview.aggregate([
                { $match: { course: course._id } },
                { $group: { _id: '$course', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } }
            ]),
            req.user?.role === 'student'
                ? CourseReview.findOne({ course: course._id, student: req.user.id })
                : Promise.resolve(null)
        ]);

        res.json({
            success: true,
            data: {
                reviews: reviews.map((review) => ({
                    _id: review._id,
                    rating: review.rating,
                    comment: review.comment,
                    createdAt: review.createdAt,
                    updatedAt: review.updatedAt,
                    student: review.student ? { _id: review.student._id, name: review.student.name } : null
                })),
                averageRating: stats[0]?.averageRating ? Math.round(stats[0].averageRating * 10) / 10 : 0,
                reviewCount: stats[0]?.reviewCount || 0,
                myReview: myReview ? { rating: myReview.rating, comment: myReview.comment } : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load course reviews' });
    }
});

router.post('/:courseId/reviews', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only enrolled students can review courses' });
        const course = await findAccessibleCourse(req.params.courseId, req.user);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });

        const enrolled = await Enrollment.exists({
            student: req.user.id,
            course: course._id,
            status: { $in: ['active', 'completed'] }
        });
        if (!enrolled) return res.status(403).json({ success: false, error: 'Enroll in this course before leaving a review' });

        const rating = Number(req.body?.rating);
        const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, error: 'Choose a rating from 1 to 5 stars' });
        if (!comment || comment.length > 2000) return res.status(400).json({ success: false, error: 'Feedback must be between 1 and 2000 characters' });

        const review = await CourseReview.findOneAndUpdate(
            { course: course._id, student: req.user.id },
            { $set: { rating, comment } },
            { returnDocument: 'after', upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
        res.status(201).json({ success: true, data: review });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'Your review was updated elsewhere. Reload and try again.' });
        res.status(500).json({ success: false, error: 'Unable to save your review' });
    }
});

module.exports = router;
