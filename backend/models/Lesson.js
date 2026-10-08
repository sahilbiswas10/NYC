const mongoose = require('mongoose');

const LessonSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    title: { type: String, required: true },
    description: String,
    type: { type: String, enum: ['video', 'audio', 'text', 'document'], required: true },
    media: { type: mongoose.Schema.Types.ObjectId, ref: 'Media' },
    content: String,
    duration: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    isPreview: { type: Boolean, default: false },
    isRequired: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Lesson', LessonSchema);
