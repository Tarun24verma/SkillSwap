const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const creditController = require('../controllers/creditController');

router.use(auth);

router.get('/eligibility', creditController.getEligibility);
router.post(
    '/buy-mock',
    [
        body('credits').isInt({ min: 1, max: 10 }).withMessage('Credits to buy must be between 1 and 10'),
    ],
    creditController.buyCreditsMock
);

module.exports = router;
