const mongoose = require('mongoose');
const path = require('path');

const CourseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    shortDescription: String,
    description: String,
    thumbnail: String,
    thumbnailFilename: String,
    thumbnailContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'] },
    instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    instructorProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'Instructor', default: null },
    category: String,
    level: String,
    language: String,
    price: { type: Number, default: 0 },
    isFree: { type: Boolean, default: false },
    duration: { type: Number, default: 0 },
    objectives: [String],
    prerequisites: [String],
    tags: [String],
    demoVideo: { type: mongoose.Schema.Types.ObjectId, ref: 'Media' },
    status: { type: String, enum: ['draft', 'published', 'unpublished', 'archived'], default: 'draft' },
    totalStudents: { type: Number, default: 0 },
    totalLessons: { type: Number, default: 0 },
    totalDuration: { type: Number, default: 0 },
    averageRating: { type: Number, default: 0 },
    publishedAt: Date
}, { timestamps: true });


CourseSchema.pre('deleteOne', { document: true, query: false }, async function() {
    const Module = require('./Module');
    const Lesson = require('./Lesson');
    const Enrollment = require('./Enrollment');
    const DiscussionPost = require('./DiscussionPost');
    const LessonProgress = require('./LessonProgress');
    
    // Find all lessons for this course
    const lessons = await Lesson.find({ course: this._id });
    const mediaIds = lessons.map((lesson) => lesson.media?.toString()).filter(Boolean);
    if (this.demoVideo) mediaIds.push(this.demoVideo.toString());
    this.$locals.mediaIds = [...new Set(mediaIds)];
    await LessonProgress.deleteMany({ course: this._id });
    await Enrollment.deleteMany({ course: this._id });
    await DiscussionPost.deleteMany({ course: this._id });
    await Lesson.deleteMany({ course: this._id });
    
    // Delete modules
    await Module.deleteMany({ course: this._id });
});

CourseSchema.post('deleteOne', { document: true, query: false }, async function() {
    const Media = require('./Media');
    const { cleanupMedia } = require('../utils/mediaCleanup');
    for (const mediaId of this.$locals.mediaIds || []) {
        const media = await Media.findById(mediaId);
        if (media) await cleanupMedia(media);
    }
    const filename = this.thumbnailFilename;
    if (filename && path.basename(filename) === filename && /^course-thumbnail-[a-f0-9-]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
        const fs = require('fs/promises');
        const thumbnailRoot = path.resolve(__dirname, '../../storage/course-thumbnails');
        const imagePath = path.resolve(thumbnailRoot, filename);
        const relative = path.relative(thumbnailRoot, imagePath);
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.unlink(imagePath).catch(() => {});
    }
});

module.exports = mongoose.model('Course', CourseSchema);
