const express = require('express');
const { createLesson, updateLesson, deleteLesson, getLessonsByModule } = require('../controllers/lessonController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

router.route('/')
    .get(optionalProtect, getLessonsByModule)
    .post(protect, authorize('instructor', 'admin'), createLesson);

router.route('/:id')
    .put(protect, authorize('instructor', 'admin'), updateLesson)
    .delete(protect, authorize('instructor', 'admin'), deleteLesson);

module.exports = router;
