const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const LessonProgress = require('../models/LessonProgress');
const Enrollment = require('../models/Enrollment');
const Lesson = require('../models/Lesson');
const Media = require('../models/Media');
const { recalculateEnrollment } = require('../utils/courseProgress');

const router = express.Router();

const findStudentEnrollment = (studentId, courseId) => Enrollment.findOne({
    student: studentId,
    course: courseId,
    status: { $in: ['active', 'completed'] }
});

router.put('/lessons/:lessonId/progress', protect, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.lessonId)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        const currentTimeInput = Number(req.body.currentTime);
        const clientDuration = Number(req.body.duration);
        if (!Number.isFinite(currentTimeInput) || currentTimeInput < 0 || !Number.isFinite(clientDuration) || clientDuration <= 0) {
            return res.status(400).json({ success: false, error: 'Valid playback time and duration are required' });
        }
        const lesson = await Lesson.findById(req.params.lessonId);
        if (!lesson) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (!['video', 'audio'].includes(lesson.type) || !lesson.media) return res.status(400).json({ success: false, error: 'This lesson does not have playable media' });
        const enrollment = await findStudentEnrollment(req.user.id, lesson.course);
        if (!enrollment) return res.status(403).json({ success: false, error: 'Not enrolled in course' });
        const media = await Media.findById(lesson.media).select('duration processingStatus');
        if (!media || media.processingStatus !== 'ready') return res.status(409).json({ success: false, error: 'Lesson media is not ready' });

        // Prefer media duration measured by FFprobe. Use the client value only for records uploaded before duration probing was added.
        const duration = media.duration > 0 ? media.duration : (lesson.duration > 0 ? lesson.duration : clientDuration);
        const currentTime = Math.min(duration, currentTimeInput);
        const percentage = Math.max(0, Math.min(100, Math.round((currentTime / duration) * 100)));
        const progress = await LessonProgress.findOneAndUpdate(
            { student: req.user.id, lesson: lesson._id },
            {
                $set: { course: lesson.course, module: lesson.module, currentTime, duration, percentage, lastWatchedAt: new Date() },
                $setOnInsert: { completed: false }
            },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        );
        if (percentage >= 90 && !progress.completed) {
            progress.completed = true;
            await progress.save();
        }

        enrollment.lastAccessedLesson = lesson._id;
        enrollment.lastAccessedAt = new Date();
        await enrollment.save();
        await recalculateEnrollment(enrollment);
        res.json({ success: true, data: progress });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to save lesson progress' });
    }
});

router.post('/lessons/:lessonId/complete', protect, async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.lessonId)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        const lesson = await Lesson.findById(req.params.lessonId);
        if (!lesson) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (!['text', 'document'].includes(lesson.type)) return res.status(400).json({ success: false, error: 'Use playback progress to complete a media lesson' });
        const enrollment = await findStudentEnrollment(req.user.id, lesson.course);
        if (!enrollment) return res.status(403).json({ success: false, error: 'Not enrolled in course' });
        const progress = await LessonProgress.findOneAndUpdate(
            { student: req.user.id, lesson: lesson._id },
            { $set: { course: lesson.course, module: lesson.module, currentTime: 0, duration: 0, percentage: 100, completed: true, lastWatchedAt: new Date() } },
            { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
        );
        enrollment.lastAccessedLesson = lesson._id;
        enrollment.lastAccessedAt = new Date();
        await enrollment.save();
        await recalculateEnrollment(enrollment);
        res.json({ success: true, data: progress });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to complete this lesson' });
    }
});

router.get('/student/continue-watching', protect, async (req, res) => {
    try {
        const inProgress = await LessonProgress.find({ student: req.user.id, completed: false })
            .sort({ lastWatchedAt: -1 }).limit(30).populate('lesson', 'title').populate('course', 'title');
        const activeEnrollments = await Enrollment.find({ student: req.user.id, status: 'active' }).select('course').lean();
        const activeCourseIds = new Set(activeEnrollments.map((item) => String(item.course)));
        const continueWatching = [];
        for (const progress of inProgress) {
            if (!progress.lesson || !progress.course) continue;
            if (!activeCourseIds.has(String(progress.course._id))) continue;
            continueWatching.push({
                courseId: progress.course._id,
                courseTitle: progress.course.title,
                lessonId: progress.lesson._id,
                lessonTitle: progress.lesson.title,
                progress: progress.percentage,
                currentTime: progress.currentTime
            });
        }
        res.json({ success: true, data: continueWatching });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load continue watching' });
    }
});

router.get('/student/completed-courses', protect, async (req, res) => {
    try {
        const enrollments = await Enrollment.find({ student: req.user.id, status: 'completed' }).populate('course');
        res.json({ success: true, data: enrollments.filter((entry) => entry.course) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load completed courses' });
    }
});

module.exports = router;
