const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const sessionController = require('../controllers/sessionController');

router.use(auth);

// Booking
router.post(
    '/',
    [
        body('tutor_id').isInt().withMessage('Valid tutor_id is required'),
        body('subject_id').isInt().withMessage('Valid subject_id is required'),
        body('scheduled_at').notEmpty().withMessage('scheduled_at is required'),
        body('duration_mins').optional().isInt({ min: 15, max: 240 }).withMessage('Duration must be between 15 and 240 mins'),
    ],
    sessionController.bookSession
);

// List sessions for logged-in user
router.get('/', sessionController.getSessions);

// Lifecycle transitions
router.patch('/:id/accept', [param('id').isInt()], sessionController.acceptSession);
router.patch('/:id/decline', [param('id').isInt()], sessionController.declineSession);
router.patch('/:id/cancel', [param('id').isInt()], sessionController.cancelSession);

// Core 5/4/1 credit completion
router.post('/:id/complete', [param('id').isInt()], sessionController.completeSession);

// Rating & Feedback
router.post(
    '/:id/rate',
    [
        param('id').isInt(),
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('feedback').optional().isString(),
    ],
    sessionController.rateSession
);

module.exports = router;
