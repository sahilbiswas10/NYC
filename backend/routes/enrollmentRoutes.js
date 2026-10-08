const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');

const router = express.Router();

router.post('/courses/:courseId/enroll', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only students can enroll' });
        const { courseId } = req.params;
        const studentId = req.user.id;
        if (!mongoose.isValidObjectId(courseId)) return res.status(404).json({ success: false, error: 'Course not found' });
        
        const existing = await Enrollment.findOne({ student: studentId, course: courseId });
        if (existing && existing.status !== 'cancelled') return res.json({ success: true, data: existing, alreadyEnrolled: true });
        
        const course = await Course.findById(courseId);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (course.status !== 'published') return res.status(404).json({ success: false, error: 'Course not found' });
        if (Number(course.price) > 0) return res.status(402).json({ success: false, error: 'Payment is required before enrolling in this course' });
        
        let enrollment;
        if (existing) {
            existing.status = 'active';
            existing.progress = 0;
            existing.completedAt = undefined;
            enrollment = await existing.save();
        } else {
            try {
                enrollment = await Enrollment.create({ student: studentId, course: courseId });
            } catch (error) {
                if (error.code !== 11000) throw error;
                enrollment = await Enrollment.findOne({ student: studentId, course: courseId });
                if (enrollment) return res.json({ success: true, data: enrollment, alreadyEnrolled: true });
                throw error;
            }
        }
        
        await Course.updateOne({ _id: courseId }, { $inc: { totalStudents: 1 } });
        res.status(201).json({ success: true, data: enrollment });
    } catch(err) {
        res.status(500).json({ success: false, error: 'Unable to enroll in this course' });
    }
});

router.get('/student/courses', protect, async (req, res) => {
    try {
        const enrollments = await Enrollment.find({
            student: req.user.id,
            status: { $in: ['active', 'completed'] }
        }).populate('course');
        res.json({ success: true, data: enrollments });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Unable to load enrolled courses' });
    }
});

module.exports = router;
