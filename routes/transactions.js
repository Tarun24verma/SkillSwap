const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const transactionController = require('../controllers/transactionController');

router.use(auth);
router.get('/', transactionController.getUserTransactions);

module.exports = router;
