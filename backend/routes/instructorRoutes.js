const express = require('express');
const { listPublicInstructors, getPublicInstructor, getInstructorPhoto } = require('../controllers/instructorController');

const router = express.Router();
router.get('/', listPublicInstructors);
router.get('/:id/photo', getInstructorPhoto);
router.get('/:id', getPublicInstructor);

module.exports = router;
