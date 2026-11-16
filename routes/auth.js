const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');

// Step 1: Initiate registration & send email verification OTP
router.post(
    '/register-initiate',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').optional().isIn(['student', 'tutor', 'both']).withMessage('Role must be student, tutor, or both'),
    ],
    authController.initiateRegister
);

// Step 2: Verify OTP and create user account
router.post(
    '/verify-otp',
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be a 6-digit number'),
    ],
    authController.verifyOtp
);

// Step 3: Resend OTP
router.post(
    '/resend-otp',
    [body('email').isEmail().normalizeEmail().withMessage('Valid email required')],
    authController.resendOtp
);

// Direct registration route (maintained for testing / direct API calls)
router.post(
    '/register',
    [
        body('name').trim().notEmpty().withMessage('Name is required'),
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').optional().isIn(['student', 'tutor', 'both']).withMessage('Role must be student, tutor, or both'),
    ],
    authController.register
);

router.post(
    '/login',
    [
        body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
        body('password').notEmpty().withMessage('Password is required'),
    ],
    authController.login
);

module.exports = router;
