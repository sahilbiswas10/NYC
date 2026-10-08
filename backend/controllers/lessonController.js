const mongoose = require('mongoose');
const { cleanupMedia } = require('../utils/mediaCleanup');
const { canManageMedia } = require('../utils/mediaAccess');
const Media = require('../models/Media');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const LessonProgress = require('../models/LessonProgress');
const { recalculateCourseEnrollments } = require('../utils/courseProgress');

const canManage = (course, user) => Boolean(course && user && (user.role === 'admin' || (user.role === 'instructor' && String(course.instructor) === String(user.id))));
const allowedTypes = new Set(['video', 'audio', 'text', 'document']);

const validateMedia = async (mediaId, type, user) => {
    if (!mediaId) return { media: null };
    if (!mongoose.isValidObjectId(mediaId)) return { error: 'Invalid media id' };
    const media = await Media.findById(mediaId);
    if (!media || !(await canManageMedia(media, user))) return { error: 'Media is missing or you are not authorized to use it' };
    if (type !== media.mediaType) return { error: `A ${media.mediaType} upload cannot be used for a ${type} lesson` };
    return { media };
};

exports.createLesson = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.moduleId)) return res.status(404).json({ success: false, error: 'Module not found' });
        const mod = await Module.findById(req.params.moduleId).populate('course');
        if (!mod || !mod.course) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!canManage(mod.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this course' });
        const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        const type = req.body.type;
        if (!title || title.length > 160 || !allowedTypes.has(type)) return res.status(400).json({ success: false, error: 'Provide a lesson title and valid lesson type' });
        const mediaResult = await validateMedia(req.body.media, type, req.user);
        if (mediaResult.error) return res.status(400).json({ success: false, error: mediaResult.error });
        const lastLesson = await Lesson.findOne({ module: mod._id }).sort({ order: -1 }).select('order').lean();
        const order = Number.isInteger(Number(req.body.order)) && Number(req.body.order) >= 0
            ? Number(req.body.order)
            : (lastLesson?.order ?? -1) + 1;
        const lesson = await Lesson.create({
            module: mod._id,
            course: mod.course._id,
            title,
            type,
            description: typeof req.body.description === 'string' ? req.body.description : '',
            media: mediaResult.media?._id,
            content: typeof req.body.content === 'string' ? req.body.content : '',
            duration: mediaResult.media?.duration || 0,
            order,
            isPreview: false,
            isRequired: req.body.isRequired !== false
        });
        await Course.updateOne({ _id: mod.course._id }, { $inc: { totalLessons: 1 } });
        await recalculateCourseEnrollments(mod.course._id);
        res.status(201).json({ success: true, data: lesson });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Unable to create lesson' });
    }
};

exports.updateLesson = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        const lesson = await Lesson.findById(req.params.id).populate('course');
        if (!lesson || !lesson.course) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (req.params.moduleId && String(lesson.module) !== String(req.params.moduleId)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (!canManage(lesson.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this lesson' });
        if (Object.hasOwn(req.body, 'title')) {
            if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 160) return res.status(400).json({ success: false, error: 'Lesson title is required' });
            lesson.title = req.body.title.trim();
        }
        if (Object.hasOwn(req.body, 'type')) {
            if (!allowedTypes.has(req.body.type)) return res.status(400).json({ success: false, error: 'Invalid lesson type' });
            lesson.type = req.body.type;
        }
        const oldMediaId = lesson.media ? String(lesson.media) : null;
        if (Object.hasOwn(req.body, 'media') || (Object.hasOwn(req.body, 'type') && lesson.media)) {
            const requestedMedia = Object.hasOwn(req.body, 'media') ? req.body.media : lesson.media;
            const mediaResult = await validateMedia(requestedMedia, lesson.type, req.user);
            if (mediaResult.error) return res.status(400).json({ success: false, error: mediaResult.error });
            lesson.media = mediaResult.media?._id || null;
            lesson.duration = mediaResult.media?.duration || 0;
        }
        if (Object.hasOwn(req.body, 'description')) lesson.description = String(req.body.description || '');
        if (Object.hasOwn(req.body, 'content')) lesson.content = String(req.body.content || '');
        if (Object.hasOwn(req.body, 'isPreview')) {
            if (typeof req.body.isPreview !== 'boolean') return res.status(400).json({ success: false, error: 'isPreview must be a boolean' });
            lesson.isPreview = req.body.isPreview;
        }
        if (Object.hasOwn(req.body, 'isRequired') && typeof req.body.isRequired !== 'boolean') return res.status(400).json({ success: false, error: 'isRequired must be a boolean' });
        const requirementChanged = Object.hasOwn(req.body, 'isRequired') && lesson.isRequired !== req.body.isRequired;
        if (Object.hasOwn(req.body, 'isRequired')) lesson.isRequired = req.body.isRequired;
        if (Object.hasOwn(req.body, 'order')) {
            const order = Number(req.body.order);
            if (!Number.isInteger(order) || order < 0) return res.status(400).json({ success: false, error: 'Lesson order must be a non-negative whole number' });
            lesson.order = order;
        }
        await lesson.save();
        if (requirementChanged) await recalculateCourseEnrollments(lesson.course._id);
        if (oldMediaId && oldMediaId !== String(lesson.media || '')) {
            const oldMedia = await Media.findById(oldMediaId);
            if (oldMedia) await cleanupMedia(oldMedia);
        }
        res.json({ success: true, data: lesson });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Unable to update lesson' });
    }
};

exports.deleteLesson = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        const lesson = await Lesson.findById(req.params.id).populate('course');
        if (!lesson || !lesson.course) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (req.params.moduleId && String(lesson.module) !== String(req.params.moduleId)) return res.status(404).json({ success: false, error: 'Lesson not found' });
        if (!canManage(lesson.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this lesson' });
        const media = lesson.media ? await Media.findById(lesson.media) : null;
        await LessonProgress.deleteMany({ lesson: lesson._id });
        await Enrollment.updateMany({ lastAccessedLesson: lesson._id }, { $unset: { lastAccessedLesson: 1, lastAccessedAt: 1 } });
        await lesson.deleteOne();
        const totalLessons = await Lesson.countDocuments({ course: lesson.course._id });
        await Course.updateOne({ _id: lesson.course._id }, { $set: { totalLessons } });
        await recalculateCourseEnrollments(lesson.course._id);
        if (media) await cleanupMedia(media);
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete lesson' });
    }
};

exports.getLessonsByModule = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.moduleId)) return res.status(404).json({ success: false, error: 'Module not found' });
        const module = await Module.findById(req.params.moduleId).populate('course', 'instructor status');
        if (!module || !module.course) return res.status(404).json({ success: false, error: 'Module not found' });
        const course = module.course;
        const isOwner = req.user?.role === 'instructor' && String(course.instructor) === String(req.user.id);
        const isAdmin = req.user?.role === 'admin';
        const isLearner = req.user?.role === 'student' && await Enrollment.exists({
            student: req.user.id,
            course: course._id,
            status: { $in: ['active', 'completed'] }
        });
        if (course.status !== 'published' && !isAdmin && !isOwner && !isLearner) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!isAdmin && !isOwner && !isLearner) return res.status(403).json({ success: false, error: 'Enroll in this course to view its lessons' });
        const lessons = await Lesson.find({ module: module._id }).sort({ order: 1, _id: 1 });
        res.json({ success: true, data: lessons });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load lessons' });
    }
};
