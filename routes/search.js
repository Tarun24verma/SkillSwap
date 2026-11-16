const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const optionalAuth = require('../middleware/optionalAuth');

router.get('/subjects', searchController.getSubjects);
router.get('/tutors', optionalAuth, searchController.searchTutors);
router.get('/tutors/:id', searchController.getTutorProfile);

module.exports = router;
