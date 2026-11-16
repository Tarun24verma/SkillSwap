const pool = require('../models/db');

// GET /api/transactions - View user's credit ledger history
exports.getUserTransactions = async (req, res) => {
    const userId = req.user.id;

    try {
        const result = await pool.query(
            `SELECT 
                t.id, t.amount, t.transaction_type, t.session_id, t.created_at,
                t.sender_id, t.receiver_id,
                sender.name AS sender_name,
                receiver.name AS receiver_name,
                CASE 
                    WHEN t.receiver_id = $1 THEN 'credit'
                    WHEN t.sender_id = $1 THEN 'debit'
                    ELSE 'neutral'
                END AS direction
             FROM transactions t
             JOIN users sender ON sender.id = t.sender_id
             JOIN users receiver ON receiver.id = t.receiver_id
             WHERE t.sender_id = $1 OR t.receiver_id = $1
             ORDER BY t.created_at DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching transactions:', err);
        res.status(500).json({ error: 'Server error fetching transaction history' });
    }
};
