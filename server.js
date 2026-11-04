const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app=express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ message: 'SkillSwap API is running!'});
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost: ${PORT}`);
});

const helmet = require('helmet');
app.use(helmet());

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const profileRoutes = require('./routes/profile');
app.use('/api/profile', profileRoutes);

const profileController = require('./controllers/profileController');
console.log(profileController);