const express = require('express');
const Enrollment = require('../models/Enrollment');

const router = express.Router();

router.get('/verify/:certificateId', async (req, res) => {
    try {
        const certificateId = typeof req.params.certificateId === 'string' ? req.params.certificateId.toUpperCase() : '';
        if (!/^NYC-[0-9A-F-]{36}$/.test(certificateId)) {
            return res.status(404).json({ success: false, error: 'Certificate not found' });
        }

        const enrollment = await Enrollment.findOne({ certificateId })
            .populate('student', 'name')
            .populate('course', 'title')
            .lean();
        if (!enrollment || !enrollment.certificateIssuedAt) {
            return res.status(404).json({ success: false, error: 'Certificate not found' });
        }

        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: {
                valid: true,
                certificateId: enrollment.certificateId,
                studentName: enrollment.certificateStudentName || enrollment.student?.name || 'Learner',
                courseTitle: enrollment.certificateCourseTitle || enrollment.course?.title || 'Course',
                completedAt: enrollment.completedAt || enrollment.certificateIssuedAt,
                issuedAt: enrollment.certificateIssuedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Unable to verify this certificate' });
    }
});

module.exports = router;
