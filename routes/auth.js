const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');

router.post(
    '/firebase-session',
    [
        body('name').optional().isString().trim().isLength({ max: 100 })
            .withMessage('Name must be 100 characters or fewer'),
        body('role').optional().isIn(['student', 'tutor', 'both'])
            .withMessage('Role must be student, tutor, or both')
    ],
    authController.createFirebaseSession
);

module.exports = router;
