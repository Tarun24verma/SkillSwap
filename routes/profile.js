const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const profileController = require('../controllers/profileController');

// All profile routes require authentication
router.use(auth);

// GET & PUT profile
router.get('/', profileController.getProfile);
router.put(
    '/',
    [
        body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
        body('role').optional().isIn(['student', 'tutor', 'both']).withMessage('Role must be student, tutor, or both'),
    ],
    profileController.updateProfile
);

// Skills management
router.get('/skills', profileController.getSkills);
router.post(
    '/skills',
    [
        body('subject_id').isInt().withMessage('Valid subject_id is required'),
        body('skill_level').isIn(['beginner', 'intermediate', 'advanced']).withMessage('Invalid skill level'),
        body('can_teach').optional().isBoolean().withMessage('can_teach must be boolean'),
        body('type').optional().isIn(['teach', 'learn']).withMessage('Type must be teach or learn'),
    ],
    profileController.addSkill
);
router.delete(
    '/skills/:subject_id',
    [param('subject_id').isInt().withMessage('Valid subject_id is required')],
    profileController.removeSkill
);

module.exports = router;
