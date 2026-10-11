const express = require('express');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { protect } = require('../middleware/auth');
const Notification = require('../models/Notification');
const Course = require('../models/Course');
const { notifyCourse } = require('../utils/notifications');
const router = express.Router();
router.use(protect);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
router.get('/', async (req, res, next) => {
    try {
        const page = Math.min(10000, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
        const filter = { recipient: req.user.id };
        const [items, total, unread] = await Promise.all([
            Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 20).limit(20).select('-eventKey -recipient').lean(),
            Notification.countDocuments(filter), Notification.countDocuments({ ...filter, readAt: null })
        ]);
        res.json({ success: true, data: items, total, unread, page, pages: Math.max(1, Math.ceil(total / 20)) });
    } catch (error) { next(error); }
});
router.put('/read-all', async (req, res, next) => {
    try { await Notification.updateMany({ recipient: req.user.id, readAt: null }, { $set: { readAt: new Date() } }); res.json({ success: true }); }
    catch (error) { next(error); }
});
router.put('/:id/read', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Notification not found' });
        const item = await Notification.findOneAndUpdate({ _id: req.params.id, recipient: req.user.id }, { $set: { readAt: new Date() } });
        if (!item) return res.status(404).json({ success: false, error: 'Notification not found' });
        res.json({ success: true });
    } catch (error) { next(error); }
});
router.delete('/:id', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Notification not found' });
        const item = await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user.id });
        if (!item) return res.status(404).json({ success: false, error: 'Notification not found' });
        res.json({ success: true });
    } catch (error) { next(error); }
});
router.post('/courses/:courseId/announcement', async (req, res, next) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.courseId).select('instructor title');
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (req.user.role !== 'admin' && !(req.user.role === 'instructor' && String(course.instructor) === String(req.user.id))) return res.status(403).json({ success: false, error: 'Only course managers can send announcements' });
        const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!title || title.length > 160 || !message || message.length > 3000) return res.status(400).json({ success: false, error: 'Enter a title (up to 160 characters) and message (up to 3000 characters).' });
        const recipients = await notifyCourse(course._id, { title, message, href: `/course.html?course=${course._id}&view=preview`, eventKey: `announcement:${randomUUID()}` });
        res.status(201).json({ success: true, recipients });
    } catch (error) { next(error); }
});
module.exports = router;
