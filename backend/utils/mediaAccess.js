const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const Lesson = require('../models/Lesson');

const isAdmin = (user) => user?.role === 'admin';

const getPlacements = async (media) => {
    const lessons = await Lesson.find({ media: media._id }).select('course module');
    const courseIds = [...new Set(lessons.map((lesson) => lesson.course).filter(Boolean).map(String))];
    const courses = await Course.find({
        $or: [{ _id: { $in: courseIds } }, { demoVideo: media._id }]
    }).select('_id instructor status demoVideo');
    return { courses, lessons, lessonCourseIds: new Set(courseIds) };
};

const canManageMedia = async (media, user) => {
    if (!media || !user) return false;
    if (isAdmin(user)) return true;
    if (media.uploadedBy && media.uploadedBy.toString() === user.id) return true;

    if (user.role !== 'instructor') return false;
    const { courses } = await getPlacements(media);
    return courses.some((course) => String(course.instructor) === String(user.id));
};

const canStreamMedia = async (media, user) => {
    if (!media) return false;
    if (isAdmin(user)) return true;

    const { courses, lessons, lessonCourseIds } = await getPlacements(media);
    if (user?.role === 'instructor') {
        return courses.some((course) => String(course.instructor) === String(user.id));
    }
    if (user && user.role !== 'student') return false;
    if (courses.some((course) => course.status === 'published' && String(course.demoVideo) === String(media._id))) return true;
    if (!user) return false;
    const enrolledCourseIds = courses.filter((course) => lessonCourseIds.has(String(course._id))).map((course) => course._id);
    if (!enrolledCourseIds.length) return false;
    const enrollments = await Enrollment.find({
        student: user.id,
        course: { $in: enrolledCourseIds },
        status: { $in: ['active', 'completed'] }
    }).select('course').lean();
    const enrolled = new Set(enrollments.map(item => String(item.course)));
    for (const lesson of lessons) {
        if (!enrolled.has(String(lesson.course))) continue;
        const access = await require('./learningAccess').getModuleLock(lesson.course, lesson.module, user.id);
        if (access && !access.locked) return true;
    }
    return false;
};

module.exports = { canManageMedia, canStreamMedia };
