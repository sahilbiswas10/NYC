const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const LessonProgress = require('../models/LessonProgress');
const Quiz = require('../models/Quiz');
const QuizResult = require('../models/QuizResult');

// Quiz definitions are never included in curriculum responses. A saved pass is
// valid only for that quiz revision, so changing the answers cannot reuse a pass.
async function getLearningState(course, student) {
    const [modules, lessons, quizzes, results, progress] = await Promise.all([
        Module.find({ course }).sort({ order: 1, _id: 1 }).select('_id title').lean(),
        Lesson.find({ course }).select('_id module isRequired').lean(),
        Quiz.find({ course, enabled: true }).select('_id module kind target title passingScore version').lean(),
        QuizResult.find({ course, student }).select('quiz version passed bestScore attempts').lean(),
        LessonProgress.find({ course, student, completed: true }).select('lesson').lean()
    ]);
    const lessonIds = new Set(lessons.map(item => String(item._id)));
    const moduleIds = new Set(modules.map(item => String(item._id)));
    const activeQuizzes = quizzes.filter(quiz => moduleIds.has(String(quiz.module)) && (quiz.kind === 'module' || lessonIds.has(String(quiz.target))));
    const resultMap = new Map(results.map(result => [`${result.quiz}:${result.version}`, result]));
    const passed = quiz => resultMap.get(`${quiz._id}:${quiz.version}`)?.passed === true;
    const lessonQuizzes = new Map(activeQuizzes.filter(q => q.kind === 'lesson').map(q => [String(q.target), q]));
    const moduleQuizzes = new Map(activeQuizzes.filter(q => q.kind === 'module').map(q => [String(q.module), q]));
    const contentCompleted = new Set(progress.map(item => String(item.lesson)));
    const completedLessonIds = lessons.filter(lesson => contentCompleted.has(String(lesson._id)) && (!lessonQuizzes.has(String(lesson._id)) || passed(lessonQuizzes.get(String(lesson._id))))).map(lesson => String(lesson._id));
    const completed = new Set(completedLessonIds);
    const requiredLessons = lessons.filter(lesson => lesson.isRequired !== false || lessonQuizzes.has(String(lesson._id)));
    let blocker = null;
    const moduleStates = modules.map((module, index) => {
        const quiz = moduleQuizzes.get(String(module._id));
        const required = requiredLessons.filter(lesson => String(lesson.module) === String(module._id));
        const lessonsComplete = required.every(lesson => completed.has(String(lesson._id)));
        const state = {
            id: String(module._id), locked: Boolean(blocker),
            lockReason: blocker ? `Pass the test for Module ${blocker.number}: ${blocker.title} to unlock this module.` : '',
            moduleQuiz: quiz ? { id: String(quiz._id), title: quiz.title, passed: passed(quiz), passingScore: quiz.passingScore } : null,
            testAvailable: !blocker && lessonsComplete,
            completed: required.length > 0 && lessonsComplete && (!quiz || passed(quiz))
        };
        // Lesson quizzes never block navigation to another lesson. Only module
        // tests gate later modules; lesson passes are checked before that test.
        if (!blocker && quiz && !passed(quiz)) blocker = { number: index + 1, title: module.title };
        return state;
    });
    const moduleTests = [...moduleQuizzes.values()];
    const total = requiredLessons.length + moduleTests.length;
    const done = requiredLessons.filter(lesson => completed.has(String(lesson._id))).length + moduleTests.filter(passed).length;
    return {
        modules: moduleStates, completedLessonIds, contentCompletedLessonIds: [...contentCompleted],
        quizLessonIds: [...lessonQuizzes.keys()],
        progress: total ? Math.round(done / total * 100) : 0,
        courseCompleted: requiredLessons.length > 0 && done === total
    };
}

async function getModuleLock(course, module, student) {
    const modules = await Module.find({ course }).sort({ order: 1, _id: 1 }).select('_id title').lean();
    const index = modules.findIndex(item => String(item._id) === String(module));
    if (index < 0) return null;
    if (index === 0) return { locked: false };
    const quizzes = await Quiz.find({ course, kind: 'module', enabled: true, module: { $in: modules.slice(0, index).map(item => item._id) } }).select('_id module version').lean();
    if (!quizzes.length) return { locked: false };
    const results = await QuizResult.find({ student, quiz: { $in: quizzes.map(item => item._id) }, passed: true }).select('quiz version').lean();
    for (let i = 0; i < index; i++) {
        const quiz = quizzes.find(item => String(item.module) === String(modules[i]._id));
        if (quiz && !results.some(result => String(result.quiz) === String(quiz._id) && result.version === quiz.version)) {
            return { locked: true, lockReason: `Pass the test for Module ${i + 1}: ${modules[i].title} to unlock this module.` };
        }
    }
    return { locked: false };
}
module.exports = { getLearningState, getModuleLock };
