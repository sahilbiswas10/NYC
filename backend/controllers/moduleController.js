const mongoose = require('mongoose');
const Module = require('../models/Module');
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const LessonProgress = require('../models/LessonProgress');
const Lesson = require('../models/Lesson');
const { recalculateCourseEnrollments } = require('../utils/courseProgress');
const path = require('path');
const fs = require('fs/promises');

const notesRoot = path.resolve(__dirname, '../../storage/module-notes');

const removeNotesFile = async (filename) => {
    if (!filename || path.basename(filename) !== filename || !/^module-notes-[a-f0-9-]+\.(pdf|txt|md)$/i.test(filename)) return;
    const filePath = path.resolve(notesRoot, filename);
    const relative = path.relative(notesRoot, filePath);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.unlink(filePath).catch(() => {});
};

const canManage = (course, user) => Boolean(course && user && (user.role === 'admin' || (user.role === 'instructor' && String(course.instructor) === String(user.id))));

exports.createModule = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.courseId);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!canManage(course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this course' });
        const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        if (!title || title.length > 160) return res.status(400).json({ success: false, error: 'Module title is required' });
        const lastModule = await Module.findOne({ course: course._id }).sort({ order: -1 }).select('order').lean();
        const order = Number.isInteger(Number(req.body.order)) && Number(req.body.order) >= 0
            ? Number(req.body.order)
            : (lastModule?.order ?? -1) + 1;
        const module = await Module.create({ course: course._id, title, description: typeof req.body.description === 'string' ? req.body.description : '', order });
        res.status(201).json({ success: true, data: module });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Unable to create module' });
    }
};

exports.updateModule = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Module not found' });
        const module = await Module.findById(req.params.id).populate('course');
        if (!module || !module.course) return res.status(404).json({ success: false, error: 'Module not found' });
        if (String(module.course._id) !== String(req.params.courseId)) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!canManage(module.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this module' });
        if (Object.hasOwn(req.body, 'title')) {
            if (typeof req.body.title !== 'string' || !req.body.title.trim()) return res.status(400).json({ success: false, error: 'Module title is required' });
            module.title = req.body.title.trim();
        }
        if (Object.hasOwn(req.body, 'description')) module.description = String(req.body.description || '');
        if (Object.hasOwn(req.body, 'order')) {
            const order = Number(req.body.order);
            if (!Number.isInteger(order) || order < 0) return res.status(400).json({ success: false, error: 'Module order must be a non-negative whole number' });
            module.order = order;
        }
        await module.save();
        res.json({ success: true, data: module });
    } catch (error) {
        res.status(400).json({ success: false, error: 'Unable to update module' });
    }
};

exports.deleteModule = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Module not found' });
        const module = await Module.findById(req.params.id).populate('course');
        if (!module || !module.course) return res.status(404).json({ success: false, error: 'Module not found' });
        if (String(module.course._id) !== String(req.params.courseId)) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!canManage(module.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this module' });
        const lessons = await Lesson.find({ module: module._id }).select('_id');
        const lessonIds = lessons.map((lesson) => lesson._id);
        await LessonProgress.deleteMany({ lesson: { $in: lessonIds } });
        await Enrollment.updateMany({ lastAccessedLesson: { $in: lessonIds } }, { $unset: { lastAccessedLesson: 1, lastAccessedAt: 1 } });
        await module.deleteOne();
        const totalLessons = await Lesson.countDocuments({ course: module.course._id });
        await Course.updateOne({ _id: module.course._id }, { $set: { totalLessons } });
        await recalculateCourseEnrollments(module.course._id);
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete module' });
    }
};

exports.getModulesByCourse = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.courseId).select('instructor status');
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        const isOwner = req.user?.role === 'instructor' && String(course.instructor) === String(req.user.id);
        const isAdmin = req.user?.role === 'admin';
        const isLearner = req.user?.role === 'student' && await Enrollment.exists({
            student: req.user.id,
            course: course._id,
            status: { $in: ['active', 'completed'] }
        });
        if (course.status !== 'published' && !isAdmin && !isOwner && !isLearner) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!isAdmin && !isOwner && !isLearner) return res.status(403).json({ success: false, error: 'Enroll in this course to view its curriculum' });
        const modules = await Module.find({ course: course._id }).select('-notesStorageFilename').sort({ order: 1, _id: 1 });
        res.json({ success: true, data: modules });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load modules' });
    }
};

exports.uploadModuleNotes = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId) || !mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!req.file) return res.status(400).json({ success: false, error: 'Choose a PDF, text, or Markdown notes file' });
        const module = await Module.findOne({ _id: req.params.id, course: req.params.courseId }).populate('course');
        if (!module || !module.course) { await fs.unlink(req.file.path).catch(() => {}); return res.status(404).json({ success: false, error: 'Module not found' }); }
        if (!canManage(module.course, req.user)) { await fs.unlink(req.file.path).catch(() => {}); return res.status(403).json({ success: false, error: 'Not authorized to manage this module' }); }
        const oldFilename = module.notesStorageFilename;
        module.notesStorageFilename = req.file.filename;
        module.notesOriginalFilename = path.basename(req.file.originalname).replace(/[\u0000-\u001f\u007f"\\/]/g, '').slice(0, 180) || 'module-notes';
        module.notesMimeType = req.file.mimetype;
        await module.save();
        await removeNotesFile(oldFilename);
        res.json({ success: true, data: { notesOriginalFilename: module.notesOriginalFilename, notesMimeType: module.notesMimeType } });
    } catch (error) {
        if (req.file) await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ success: false, error: 'Unable to save module notes' });
    }
};

exports.deleteModuleNotes = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId) || !mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Module not found' });
        const module = await Module.findOne({ _id: req.params.id, course: req.params.courseId }).populate('course');
        if (!module || !module.course) return res.status(404).json({ success: false, error: 'Module not found' });
        if (!canManage(module.course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this module' });
        const oldFilename = module.notesStorageFilename;
        module.notesStorageFilename = undefined; module.notesOriginalFilename = undefined; module.notesMimeType = undefined;
        await module.save(); await removeNotesFile(oldFilename);
        res.json({ success: true, data: {} });
    } catch (error) { res.status(500).json({ success: false, error: 'Unable to remove module notes' }); }
};

exports.getModuleNotes = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.courseId) || !mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Module notes not found' });
        const module = await Module.findOne({ _id: req.params.id, course: req.params.courseId }).populate('course', 'instructor status');
        if (!module || !module.course || !module.notesStorageFilename) return res.status(404).json({ success: false, error: 'Module notes not found' });
        const isAdmin = req.user.role === 'admin';
        const isOwner = req.user.role === 'instructor' && String(module.course.instructor) === String(req.user.id);
        const Enrollment = require('../models/Enrollment');
        const isLearner = req.user.role === 'student' && await Enrollment.exists({ student: req.user.id, course: module.course._id, status: { $in: ['active', 'completed'] } });
        if (!isAdmin && !isOwner && !isLearner) return res.status(403).json({ success: false, error: 'Enroll in this course to view module notes' });
        const filename = module.notesStorageFilename;
        if (path.basename(filename) !== filename || !/^module-notes-[a-f0-9-]+\.(pdf|txt|md)$/i.test(filename)) return res.status(404).json({ success: false, error: 'Module notes not found' });
        const target = path.resolve(notesRoot, filename);
        const relative = path.relative(notesRoot, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(404).json({ success: false, error: 'Module notes not found' });
        const downloadName = (module.notesOriginalFilename || 'module-notes').replace(/[\r\n"\\]/g, '_');
        res.type(module.notesMimeType || 'application/octet-stream').set('Content-Disposition', `inline; filename="${downloadName}"`).sendFile(target, (error) => {
            if (error && !res.headersSent) res.status(404).json({ success: false, error: 'Module notes not found' });
        });
    } catch (error) { res.status(500).json({ success: false, error: 'Unable to open module notes' }); }
};
