const mongoose = require('mongoose');
const QuizResultSchema = new mongoose.Schema({
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    version: { type: Number, required: true },
    attempts: { type: Number, default: 0 },
    bestScore: { type: Number, default: 0 },
    lastScore: Number,
    passed: { type: Boolean, default: false },
    passedAt: Date
}, { timestamps: true });
QuizResultSchema.index({ student: 1, quiz: 1, version: 1 }, { unique: true });
QuizResultSchema.index({ student: 1, course: 1 });
module.exports = mongoose.model('QuizResult', QuizResultSchema);
