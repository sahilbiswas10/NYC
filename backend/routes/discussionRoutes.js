const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const DiscussionPost = require('../models/DiscussionPost');

const router = express.Router();

const getCourseAccess = async (courseId, user) => {
    if (!mongoose.isValidObjectId(courseId)) return { error: 404 };
    const course = await Course.findById(courseId).select('instructor status');
    if (!course) return { error: 404 };
    const isManager = user.role === 'admin' || (user.role === 'instructor' && String(course.instructor) === String(user.id));
    const isEnrolled = user.role === 'student' && Boolean(await Enrollment.exists({
        student: user.id,
        course: course._id,
        status: { $in: ['active', 'completed'] }
    }));
    return isManager || isEnrolled ? { course, isEnrolled } : { error: 403 };
};

router.get('/:courseId/discussions', protect, async (req, res) => {
    try {
        const access = await getCourseAccess(req.params.courseId, req.user);
        if (access.error) return res.status(access.error).json({ success: false, error: access.error === 404 ? 'Course not found' : 'Enroll in this course to view its discussion' });
        const posts = await DiscussionPost.find({ course: access.course._id, parent: null })
            .sort({ createdAt: -1 }).limit(100).populate('author', 'name');
        const postIds = posts.map((post) => post._id);
        const replies = postIds.length
            ? await DiscussionPost.find({ course: access.course._id, parent: { $in: postIds } }).sort({ createdAt: 1 }).populate('author', 'name')
            : [];
        const replyMap = new Map();
        for (const reply of replies) {
            const parentId = String(reply.parent);
            if (!replyMap.has(parentId)) replyMap.set(parentId, []);
            replyMap.get(parentId).push(reply);
        }
        res.json({ success: true, data: posts.reverse().map((post) => ({ ...post.toObject(), replies: replyMap.get(String(post._id)) || [] })) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load course discussion' });
    }
});

router.post('/:courseId/discussions', protect, async (req, res) => {
    try {
        if (req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only enrolled students can post in course discussions' });
        const access = await getCourseAccess(req.params.courseId, req.user);
        if (!access.course || !access.isEnrolled) return res.status(access.error || 403).json({ success: false, error: access.error === 404 ? 'Course not found' : 'Enroll in this course to join its discussion' });
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!message || message.length > 3000) return res.status(400).json({ success: false, error: 'Write a message of 1 to 3000 characters' });
        let parent = null;
        if (req.body?.parentId) {
            if (!mongoose.isValidObjectId(req.body.parentId)) return res.status(400).json({ success: false, error: 'Discussion thread not found' });
            parent = await DiscussionPost.findOne({ _id: req.body.parentId, course: access.course._id, parent: null }).select('_id');
            if (!parent) return res.status(404).json({ success: false, error: 'Discussion thread not found' });
        }
        const post = await DiscussionPost.create({ course: access.course._id, author: req.user.id, parent: parent?._id || null, message });
        await post.populate('author', 'name');
        res.status(201).json({ success: true, data: post });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to post to the discussion' });
    }
});

module.exports = router;
