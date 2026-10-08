const mongoose = require('mongoose');

const LessonProgressSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
    currentTime: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    lastWatchedAt: Date
}, { timestamps: true });

LessonProgressSchema.index({ student: 1, lesson: 1 }, { unique: true });

module.exports = mongoose.model('LessonProgress', LessonProgressSchema);
