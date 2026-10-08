const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs/promises');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Media = require('../models/Media');
const Instructor = require('../models/Instructor');
const Enrollment = require('../models/Enrollment');
const CourseReview = require('../models/CourseReview');
const { canManageMedia } = require('../utils/mediaAccess');
const { cleanupMedia } = require('../utils/mediaCleanup');

const courseFields = [
    'title', 'slug', 'shortDescription', 'description', 'thumbnail', 'category', 'level',
    'language', 'price', 'isFree', 'duration', 'objectives', 'prerequisites', 'tags', 'demoVideo', 'instructorProfile'
];

const canManageCourse = (course, user) => {
    if (!course || !user) return false;
    if (user.role === 'admin') return true;
    const instructorId = course.instructor?._id || course.instructor;
    return user.role === 'instructor' && String(instructorId) === String(user.id);
};

const thumbnailRoot = path.resolve(__dirname, '../../storage/course-thumbnails');
const thumbnailUrl = (courseId, version = '') => `/api/courses/${courseId}/thumbnail${version ? `?v=${encodeURIComponent(version)}` : ''}`;
const removeThumbnail = async (filename) => {
    if (!filename || path.basename(filename) !== filename || !/^course-thumbnail-[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) return;
    const target = path.resolve(thumbnailRoot, filename);
    const relative = path.relative(thumbnailRoot, target);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.unlink(target).catch(() => {});
};
const getCourseCatalogStats = async (courseIds) => {
    if (!courseIds.length) return new Map();
    const [reviews, enrollments, durations] = await Promise.all([
        CourseReview.aggregate([
            { $match: { course: { $in: courseIds } } },
            { $group: { _id: '$course', averageRating: { $avg: '$rating' }, reviewCount: { $sum: 1 } } }
        ]),
        Enrollment.aggregate([
            { $match: { course: { $in: courseIds }, status: { $in: ['active', 'completed'] } } },
            { $group: { _id: '$course', enrollmentCount: { $sum: 1 } } }
        ]),
        Lesson.aggregate([
            { $match: { course: { $in: courseIds } } },
            { $group: { _id: '$course', durationSeconds: { $sum: '$duration' } } }
        ])
    ]);
    const stats = new Map();
    for (const item of reviews) stats.set(String(item._id), {
        ...stats.get(String(item._id)),
        averageRating: Math.round(item.averageRating * 10) / 10,
        reviewCount: item.reviewCount
    });
    for (const item of enrollments) stats.set(String(item._id), {
        ...stats.get(String(item._id)), enrollmentCount: item.enrollmentCount
    });
    for (const item of durations) stats.set(String(item._id), {
        ...stats.get(String(item._id)), durationSeconds: item.durationSeconds
    });
    return stats;
};

const withThumbnailUrl = (course, stats = {}) => {
    const data = course.toObject ? course.toObject() : course;
    const enrollmentCount = stats.enrollmentCount ?? 0;
    return {
        ...data,
        averageRating: stats.averageRating ?? 0,
        reviewCount: stats.reviewCount ?? 0,
        enrollmentCount,
        totalStudents: enrollmentCount,
        durationSeconds: stats.durationSeconds || Number(data.totalDuration) || 0,
        thumbnailUrl: data.thumbnailFilename ? thumbnailUrl(data._id, data.thumbnailFilename) : null
    };
};

exports.getCourses = async (_req, res) => {
    try {
        const courses = await Course.find({ status: 'published' }).populate('instructor', 'name').populate('instructorProfile', 'name title active').sort('-publishedAt -createdAt');
        const stats = await getCourseCatalogStats(courses.map((course) => course._id));
        res.json({ success: true, data: courses.map((course) => withThumbnailUrl(course, stats.get(String(course._id)))) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load courses' });
    }
};

exports.getCourseById = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.id).populate('instructor', 'name').populate('instructorProfile', 'name title bio active');
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        const canSeeDraft = canManageCourse(course, req.user);
        const enrolled = req.user?.role === 'student' && await Enrollment.exists({
            student: req.user.id, course: course._id, status: { $in: ['active', 'completed'] }
        });
        if (course.status !== 'published' && !canSeeDraft && !enrolled) return res.status(404).json({ success: false, error: 'Course not found' });
        const stats = await getCourseCatalogStats([course._id]);
        res.json({ success: true, data: withThumbnailUrl(course, stats.get(String(course._id))) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to load course' });
    }
};

exports.createCourse = async (req, res) => {
    try {
        const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
        if (!title || title.length > 160) return res.status(400).json({ success: false, error: 'Course title must be between 1 and 160 characters' });
        const slugInput = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
        const slugBase = (slugInput || title.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slugBase) return res.status(400).json({ success: false, error: 'Provide a course title using letters or numbers' });
        const slug = `${slugBase}${slugInput ? '' : `-${Date.now()}`}`;
        const data = Object.fromEntries(courseFields.filter((field) => Object.hasOwn(req.body, field)).map((field) => [field, req.body[field]]));
        if (Object.hasOwn(data, 'price')) {
            const price = Number(data.price);
            if (!Number.isFinite(price) || price < 0) return res.status(400).json({ success: false, error: 'price must be a non-negative number' });
            data.price = price;
        }
        if (data.instructorProfile === '') data.instructorProfile = null;
        if (req.user.role !== 'admin') data.instructorProfile = null;
        if (data.instructorProfile) {
            if (!mongoose.isValidObjectId(data.instructorProfile) || !(await Instructor.exists({ _id: data.instructorProfile, active: true }))) {
                return res.status(400).json({ success: false, error: 'Choose an active instructor profile' });
            }
        }
        data.title = title;
        data.slug = slug;
        data.instructor = req.user.id;
        data.status = 'draft';
        if (req.user.role !== 'admin' && req.body.status === 'published') delete data.status;
        const course = await Course.create(data);
        res.status(201).json({ success: true, data: course });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'A course with that slug already exists' });
        res.status(400).json({ success: false, error: 'Unable to create course. Check the required fields.' });
    }
};

exports.updateCourse = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!canManageCourse(course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this course' });
        if (Object.hasOwn(req.body, 'instructorProfile') && req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Only an administrator can assign a public instructor profile' });

        const oldDemoId = course.demoVideo ? String(course.demoVideo) : null;
        for (const field of courseFields) {
            if (!Object.hasOwn(req.body, field)) continue;
            if (field === 'instructorProfile') {
                if (req.body[field] === null || req.body[field] === '') course.instructorProfile = null;
                else if (!mongoose.isValidObjectId(req.body[field]) || !(await Instructor.exists({ _id: req.body[field], active: true }))) return res.status(400).json({ success: false, error: 'Choose an active instructor profile' });
                else course.instructorProfile = req.body[field];
            } else if (field === 'title' || field === 'slug') {
                if (typeof req.body[field] !== 'string' || !req.body[field].trim()) return res.status(400).json({ success: false, error: `${field} is required` });
                const value = req.body[field].trim();
                if ((field === 'title' && value.length > 160) || (field === 'slug' && value.length > 180)) return res.status(400).json({ success: false, error: `${field} is too long` });
                course[field] = field === 'slug' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : value;
            } else if (['objectives', 'prerequisites', 'tags'].includes(field)) {
                if (!Array.isArray(req.body[field]) || req.body[field].some((value) => typeof value !== 'string')) return res.status(400).json({ success: false, error: `${field} must be a list of text values` });
                course[field] = req.body[field].map((value) => value.trim()).filter(Boolean);
            } else if (['price', 'duration'].includes(field)) {
                const value = Number(req.body[field]);
                if (!Number.isFinite(value) || value < 0) return res.status(400).json({ success: false, error: `${field} must be a non-negative number` });
                course[field] = value;
            } else if (field === 'isFree') {
                if (typeof req.body[field] !== 'boolean') return res.status(400).json({ success: false, error: 'isFree must be a boolean' });
                course[field] = req.body[field];
            } else if (['shortDescription', 'description', 'thumbnail', 'category', 'level', 'language'].includes(field)) {
                if (req.body[field] !== null && typeof req.body[field] !== 'string') return res.status(400).json({ success: false, error: `${field} must be text` });
                course[field] = req.body[field];
            } else {
                course[field] = req.body[field];
            }
        }

        if (Object.hasOwn(req.body, 'demoVideo') && req.body.demoVideo) {
            if (!mongoose.isValidObjectId(req.body.demoVideo)) return res.status(400).json({ success: false, error: 'Invalid demo media id' });
            const demo = await Media.findById(req.body.demoVideo);
            if (!demo || demo.mediaType !== 'video' || !(await canManageMedia(demo, req.user))) {
                return res.status(400).json({ success: false, error: 'Choose a video uploaded to this course by an authorized user' });
            }
        }

        if (Object.hasOwn(req.body, 'status')) {
            if (!['draft', 'published', 'unpublished', 'archived'].includes(req.body.status)) return res.status(400).json({ success: false, error: 'Invalid course status' });
            if (req.body.status === 'published') {
                const [moduleCount, lessons] = await Promise.all([
                    Module.countDocuments({ course: course._id }),
                    Lesson.find({ course: course._id }).select('type media isRequired')
                ]);
                if (!course.description?.trim() || moduleCount === 0 || lessons.length === 0 || !lessons.some((lesson) => lesson.isRequired)) {
                    return res.status(400).json({ success: false, error: 'Add a course description, a module, and at least one required lesson before publishing' });
                }
                if (lessons.some((lesson) => ['video', 'audio'].includes(lesson.type) && !lesson.media) || lessons.some((lesson) => lesson.media && !['video', 'audio'].includes(lesson.type))) {
                    return res.status(400).json({ success: false, error: 'Attach compatible media to each video or audio lesson before publishing' });
                }
                const mediaIds = lessons.map((lesson) => lesson.media).filter(Boolean);
                if (mediaIds.length && await Media.exists({ _id: { $in: mediaIds }, processingStatus: { $ne: 'ready' } })) {
                    return res.status(409).json({ success: false, error: 'Wait for all course media to finish processing before publishing' });
                }
                if (course.demoVideo && await Media.exists({ _id: course.demoVideo, processingStatus: { $ne: 'ready' } })) {
                    return res.status(409).json({ success: false, error: 'Wait for the demo video to finish processing before publishing' });
                }
                course.publishedAt = new Date();
            }
            course.status = req.body.status;
        }

        await course.save();
        if (oldDemoId && oldDemoId !== String(course.demoVideo || '')) {
            const oldMedia = await Media.findById(oldDemoId);
            if (oldMedia) await cleanupMedia(oldMedia);
        }
        res.json({ success: true, data: course });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'A course with that slug already exists' });
        res.status(400).json({ success: false, error: 'Unable to update course. Check the supplied details.' });
    }
};

exports.uploadCourseThumbnail = async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'Choose a JPG, PNG, or WebP course image' });
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        const course = await Course.findById(req.params.id);
        if (!course) {
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(404).json({ success: false, error: 'Course not found' });
        }
        if (!canManageCourse(course, req.user)) {
            await fs.unlink(req.file.path).catch(() => {});
            return res.status(403).json({ success: false, error: 'Not authorized to manage this course' });
        }
        const previousFilename = course.thumbnailFilename;
        course.thumbnailFilename = req.file.filename;
        course.thumbnailContentType = req.file.mimetype;
        await course.save();
        await removeThumbnail(previousFilename);
        res.json({ success: true, data: { thumbnailUrl: thumbnailUrl(course._id, course.thumbnailFilename) } });
    } catch (error) {
        await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ success: false, error: 'Unable to save course image' });
    }
};

exports.getCourseThumbnail = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
        const course = await Course.findById(req.params.id).select('thumbnailFilename thumbnailContentType').lean();
        const filename = course?.thumbnailFilename;
        if (!filename || path.basename(filename) !== filename || !/^course-thumbnail-[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) return res.status(404).end();
        const target = path.resolve(thumbnailRoot, filename);
        const relative = path.relative(thumbnailRoot, target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return res.status(404).end();
        res.type(course.thumbnailContentType || 'application/octet-stream').set('Cache-Control', 'public, max-age=3600').sendFile(target, (error) => {
            if (error && !res.headersSent) res.status(404).end();
        });
    } catch (error) {
        res.status(404).end();
    }
};

exports.deleteCourse = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, error: 'Course not found' });
        const course = await Course.findById(req.params.id);
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        if (!canManageCourse(course, req.user)) return res.status(403).json({ success: false, error: 'Not authorized to manage this course' });
        await course.deleteOne();
        res.json({ success: true, data: {} });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to delete course' });
    }
};
