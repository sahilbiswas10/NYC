const express = require('express');
const { createModule, updateModule, deleteModule, getModulesByCourse, uploadModuleNotes, deleteModuleNotes, getModuleNotes } = require('../controllers/moduleController');
const { protect, optionalProtect, authorize } = require('../middleware/auth');
const notesUpload = require('../middleware/moduleNotesUpload');

const router = express.Router({ mergeParams: true });

const handleNotesUpload = (req, res, next) => {
    notesUpload.single('notes')(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ success: false, error: status === 413 ? 'Module notes must be 20 MB or smaller' : 'Choose a PDF, text, or Markdown file' });
    });
};

router.route('/')
    .get(optionalProtect, getModulesByCourse)
    .post(protect, authorize('instructor', 'admin'), createModule);

router.post('/:id/notes', protect, authorize('instructor', 'admin'), handleNotesUpload, uploadModuleNotes);
router.get('/:id/notes', protect, getModuleNotes);
router.delete('/:id/notes', protect, authorize('instructor', 'admin'), deleteModuleNotes);

router.route('/:id')
    .put(protect, authorize('instructor', 'admin'), updateModule)
    .delete(protect, authorize('instructor', 'admin'), deleteModule);

module.exports = router;
