const express = require('express');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Enrollment = require('../models/Enrollment');
const Quiz = require('../models/Quiz');
const QuizResult = require('../models/QuizResult');
const { getLearningState } = require('../utils/learningAccess');
const { recalculateEnrollment, recalculateCourseEnrollments } = require('../utils/courseProgress');
const { notify, notifyCourse, bestEffort } = require('../utils/notifications');
const router = express.Router();
router.use(protect);
router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

async function resolve(req, res, next) {
    try {
        const { kind, targetId } = req.params;
        if (!['lesson', 'module'].includes(kind) || !mongoose.isValidObjectId(targetId)) return res.status(404).json({ success: false, error: 'Quiz location not found' });
        const target = await (kind === 'lesson' ? Lesson : Module).findById(targetId);
        const course = target && await Course.findById(target.course).select('instructor title');
        if (!course) return res.status(404).json({ success: false, error: 'Course not found' });
        const manager = req.user.role === 'admin' || (req.user.role === 'instructor' && String(course.instructor) === String(req.user.id));
        const enrollment = !manager && req.user.role === 'student' && await Enrollment.findOne({ course: course._id, student: req.user.id, status: { $in: ['active', 'completed'] } });
        if (!manager && !enrollment) return res.status(403).json({ success: false, error: 'Enroll in this course to access quizzes' });
        req.quizContext = { target, course, manager, enrollment, module: kind === 'lesson' ? target.module : target._id };
        next();
    } catch (error) { next(error); }
}

function validate(input) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 160) throw new Error('Enter a quiz title of 1–160 characters.');
    if (!Number.isInteger(input.passingScore) || input.passingScore < 1 || input.passingScore > 100) throw new Error('Passing score must be a whole number from 1 to 100.');
    if (typeof input.enabled !== 'boolean') throw new Error('Choose draft or published status.');
    if (!Array.isArray(input.questions) || input.questions.length > 30 || (input.enabled && !input.questions.length)) throw new Error('A published quiz needs 1–30 questions.');
    if (Buffer.byteLength(JSON.stringify(input)) > 90000) throw new Error('Quiz content must be smaller than 90 KB.');
    const questions = input.questions.map((question, index) => {
        const fail = message => { throw new Error(`Question ${index + 1}: ${message}`); };
        if (!question || typeof question.prompt !== 'string' || !question.prompt.trim() || question.prompt.length > 2000) fail('enter a question of up to 2000 characters.');
        if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6 || question.options.some(option => typeof option !== 'string' || !option.trim() || option.length > 500)) fail('provide 2–6 nonempty options, up to 500 characters each.');
        if (new Set(question.options.map(option => option.trim())).size !== question.options.length) fail('options must be different.');
        if (!Number.isInteger(question.correctAnswer) || question.correctAnswer < 0 || question.correctAnswer >= question.options.length) fail('select the correct answer.');
        if (question.explanation != null && (typeof question.explanation !== 'string' || question.explanation.length > 3000)) fail('explanation must be text of up to 3000 characters.');
        return { prompt: question.prompt.trim(), options: question.options.map(option => option.trim()), correctAnswer: question.correctAnswer, explanation: question.explanation || '' };
    });
    return { title, passingScore: input.passingScore, enabled: input.enabled, questions };
}

router.get('/:kind/:targetId', resolve, async (req, res, next) => {
    try {
        const context = req.quizContext;
        const quiz = await Quiz.findOne({ kind: req.params.kind, target: context.target._id });
        if (context.manager) return res.json({ success: true, data: quiz, canManage: true });
        const state = await getLearningState(context.course._id, req.user.id);
        const module = state.modules.find(item => item.id === String(context.module));
        if (!module || module.locked) return res.status(403).json({ success: false, error: module?.lockReason || 'Module unavailable' });
        if (!quiz?.enabled) return res.json({ success: true, data: null, canManage: false });
        const result = await QuizResult.findOne({ student: req.user.id, quiz: quiz._id, version: quiz.version }).select('passed bestScore lastScore attempts passedAt').lean();
        const canAttempt = quiz.kind === 'lesson' || module.testAvailable;
        res.json({ success: true, canManage: false, data: {
            _id: quiz._id, kind: quiz.kind, title: quiz.title, version: quiz.version, passingScore: quiz.passingScore,
            canAttempt, reason: canAttempt ? '' : 'Complete the required lessons and pass their quizzes before taking the module test.',
            result, questions: canAttempt ? quiz.questions.map(question => ({ _id: question._id, prompt: question.prompt, options: question.options })) : []
        } });
    } catch (error) { next(error); }
});

router.put('/:kind/:targetId', resolve, async (req, res, next) => {
    try {
        const context = req.quizContext;
        if (!context.manager) return res.status(403).json({ success: false, error: 'Only course managers can edit quizzes' });
        let data;
        try { data = validate(req.body); } catch (error) { return res.status(400).json({ success: false, error: error.message }); }
        const old = await Quiz.findOne({ kind: req.params.kind, target: context.target._id });
        if (!Number.isInteger(req.body?.expectedVersion) || req.body?.expectedVersion !== (old?.version || 0)) return res.status(409).json({ success: false, error: 'This quiz changed in another window. Reload it before saving.' });
        let quiz;
        if (old) {
            quiz = await Quiz.findOneAndUpdate({ _id: old._id, version: req.body?.expectedVersion }, { $set: data, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true });
            if (!quiz) return res.status(409).json({ success: false, error: 'This quiz changed. Reload it before saving.' });
        } else {
            quiz = await Quiz.create({ ...data, course: context.course._id, module: context.module, kind: req.params.kind, target: context.target._id });
        }
        await recalculateCourseEnrollments(context.course._id);
        if (quiz.enabled || old?.enabled) await bestEffort(() => notifyCourse(context.course._id, {
            title: 'Course quiz updated', message: `${quiz.title} in ${context.course.title} was updated. Open the course to see the current requirements.`,
            href: `/course.html?course=${context.course._id}&view=curriculum`, eventKey: `quiz-update:${quiz._id}:${quiz.version}`
        }));
        res.json({ success: true, data: quiz });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, error: 'A quiz was created in another window. Reload before saving.' });
        next(error);
    }
});

router.delete('/:kind/:targetId', resolve, async (req, res, next) => {
    try {
        const context = req.quizContext;
        if (!context.manager) return res.status(403).json({ success: false, error: 'Only course managers can remove quizzes' });
        if (!Number.isInteger(req.body?.expectedVersion) || req.body?.expectedVersion < 1) return res.status(400).json({ success: false, error: 'A valid quiz version is required' });
        const quiz = await Quiz.findOneAndDelete({ kind: req.params.kind, target: context.target._id, version: req.body?.expectedVersion });
        if (!quiz) return res.status(409).json({ success: false, error: 'Quiz not found or changed. Reload before deleting.' });
        await QuizResult.deleteMany({ quiz: quiz._id });
        await recalculateCourseEnrollments(context.course._id);
        res.json({ success: true });
    } catch (error) { next(error); }
});

router.post('/:kind/:targetId/attempts', resolve, async (req, res, next) => {
    try {
        const context = req.quizContext;
        if (context.manager || req.user.role !== 'student') return res.status(403).json({ success: false, error: 'Only enrolled students can submit quiz attempts' });
        const state = await getLearningState(context.course._id, req.user.id);
        const module = state.modules.find(item => item.id === String(context.module));
        if (!module || module.locked) return res.status(403).json({ success: false, error: module?.lockReason || 'Module unavailable' });
        if (req.params.kind === 'module' && !module.testAvailable) return res.status(403).json({ success: false, error: 'Complete the required lessons and pass their quizzes before taking the module test.' });
        const quiz = await Quiz.findOne({ kind: req.params.kind, target: context.target._id, enabled: true });
        if (!quiz?.questions.length) return res.status(404).json({ success: false, error: 'Quiz unavailable' });
        if (req.body?.version !== quiz.version) return res.status(409).json({ success: false, error: 'This quiz was updated. Reload it and try again.' });
        const answers = req.body?.answers;
        if (!answers || Array.isArray(answers) || typeof answers !== 'object' || Object.keys(answers).length !== quiz.questions.length || quiz.questions.some(q => !Number.isInteger(answers[String(q._id)]) || answers[String(q._id)] < 0 || answers[String(q._id)] >= q.options.length)) return res.status(400).json({ success: false, error: 'Answer every question before submitting.' });
        const correct = quiz.questions.filter(question => answers[String(question._id)] === question.correctAnswer).length;
        // Compare the exact fraction; rounding must not turn 2/3 into a 67% pass.
        const score = Math.round(correct / quiz.questions.length * 10000) / 100;
        const attemptPassed = correct * 100 >= quiz.passingScore * quiz.questions.length;
        const filter = { student: req.user.id, quiz: quiz._id, version: quiz.version };
        const update = { $set: { course: context.course._id, module: context.module, lastScore: score, ...(attemptPassed ? { passed: true, passedAt: new Date() } : {}) }, $max: { bestScore: score }, $inc: { attempts: 1 } };
        let result;
        try { result = await QuizResult.findOneAndUpdate(filter, update, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }); }
        catch (error) { if (error.code !== 11000) throw error; result = await QuizResult.findOneAndUpdate(filter, update, { returnDocument: 'after' }); }
        await recalculateEnrollment(context.enrollment);
        await bestEffort(() => notify({ recipient: req.user.id, course: context.course._id,
            title: attemptPassed ? 'Quiz passed' : 'Quiz result', message: `${quiz.title}: ${score}%. ${attemptPassed ? 'Passed.' : `You need ${quiz.passingScore}% to pass. You can retry.`}`,
            href: `/learn.html?course=${context.course._id}&${quiz.kind === 'lesson' ? 'lesson' : 'module'}=${context.target._id}`,
            eventKey: `quiz-result:${result._id}:${result.attempts}` }));
        res.json({ success: true, data: {
            score, correct, total: quiz.questions.length, attemptPassed, passed: result.passed, bestScore: result.bestScore, attempts: result.attempts,
            feedback: quiz.questions.map(q => ({ question: String(q._id), correct: answers[String(q._id)] === q.correctAnswer, explanation: q.explanation })),
            courseCompleted: context.enrollment.status === 'completed'
        } });
    } catch (error) { next(error); }
});
module.exports = router;
