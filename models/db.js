require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host:     process.env.DB_HOST || 'localhost',
    port:     parseInt(process.env.DB_PORT, 10) || 5433,
    database: process.env.DB_NAME || 'skillswap_db',
    user:     process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
});

pool.query('SELECT 1')
    .then(() => console.log(`✓ Connected to PostgreSQL (${process.env.DB_NAME} on port ${process.env.DB_PORT})`))
    .catch(err => {
        console.error('\n❌ PostgreSQL Connection Error:');
        console.error(`Could not connect to PostgreSQL at ${process.env.DB_HOST}:${process.env.DB_PORT}`);
        console.error('Please ensure the PostgreSQL server is running. (Run "npm run db:start" to start it)\n');
    });

module.exports = pool;
