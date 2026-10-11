const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
    prompt: { type: String, required: true },
    options: { type: [String], required: true },
    correctAnswer: { type: Number, required: true },
    explanation: { type: String, default: '' }
});
const QuizSchema = new mongoose.Schema({
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    module: { type: mongoose.Schema.Types.ObjectId, ref: 'Module', required: true },
    kind: { type: String, enum: ['lesson', 'module'], required: true },
    target: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true },
    passingScore: { type: Number, default: 70, min: 1, max: 100 },
    enabled: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    questions: [QuestionSchema]
}, { timestamps: true });
QuizSchema.index({ kind: 1, target: 1 }, { unique: true });
QuizSchema.index({ course: 1, enabled: 1 });
module.exports = mongoose.model('Quiz', QuizSchema);
