const express = require('express');
const { register, login, logout, getMe, updateProfile, updatePassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', protect, getMe);


router.put('/update', protect, updateProfile);
router.put('/password', protect, updatePassword);
module.exports = router;
