require('dotenv').config();
const { Pool } = require('pg');

let pool;

if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    pool.query('SELECT 1')
        .then(() => console.log('✓ Connected to Neon Serverless PostgreSQL'))
        .catch(async (err) => {
            // If local DNS failed to resolve new Neon domain, fallback with public DNS
            if (err.code === 'ENOTFOUND') {
                try {
                    const dns = require('dns').promises;
                    dns.setServers(['8.8.8.8', '1.1.1.1']);
                    const ips = await dns.resolve4(url.hostname);
                    
                    // Re-instantiate pool with resolved IP
                    const fallbackPool = new Pool({
                        user: url.username,
                        password: url.password,
                        host: ips[0],
                        port: url.port || 5432,
                        database: url.pathname.slice(1),
                        ssl: {
                            rejectUnauthorized: false,
                            servername: url.hostname
                        }
                    });
                    await fallbackPool.query('SELECT 1');
                    console.log('✓ Connected to Neon Serverless PostgreSQL (via DNS resolver)');
                    // Swap pool instance
                    Object.assign(pool, fallbackPool);
                } catch (fallbackErr) {
                    console.error('❌ Neon PostgreSQL Connection Error:', fallbackErr.message);
                }
            } else {
                console.error('❌ PostgreSQL Connection Error:', err.message);
            }
        });
} else {
    pool = new Pool({
        host:     process.env.DB_HOST || 'localhost',
        port:     parseInt(process.env.DB_PORT, 10) || 5433,
        database: process.env.DB_NAME || 'skillswap_db',
        user:     process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
    });

    pool.query('SELECT 1')
        .then(() => console.log(`✓ Connected to Local PostgreSQL (${process.env.DB_NAME})`))
        .catch(err => {
            console.error('\n❌ PostgreSQL Connection Error:', err.message);
        });
}

module.exports = pool;
