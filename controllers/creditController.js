const pool = require('../models/db');
const { validationResult } = require('express-validator');

const PRICE_PER_CREDIT_INR = 50.00;

// GET /api/credits/eligibility - Check if user is eligible to buy credits and how many
exports.getEligibility = async (req, res) => {
    try {
        const result = await pool.query('SELECT credits FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

        const currentCredits = result.rows[0].credits;
        const canBuy = currentCredits < 5;
        const maxBuyable = canBuy ? (10 - currentCredits) : 0;

        res.json({
            current_credits: currentCredits,
            can_buy: canBuy,
            max_buyable: maxBuyable,
            price_per_credit: PRICE_PER_CREDIT_INR,
            policy: 'Users can only purchase credits when balance < 5. Purchases are capped at 10 minus current balance. Credits earned via tutoring are uncapped.'
        });
    } catch (err) {
        console.error('Error checking credit eligibility:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

// POST /api/credits/buy-mock - Complete a credit purchase (Mock / Test mode gateway)
exports.buyCreditsMock = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ 
            error: errors.array()[0].msg, 
            errors: errors.array() 
        });
    }

    const credits_to_buy = parseInt(req.body.credits, 10);
    if (isNaN(credits_to_buy) || credits_to_buy <= 0) {
        return res.status(400).json({ error: 'Please specify a positive integer of credits to buy' });
    }

    const userId = req.user.id;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Lock user row to evaluate buy-gate rules atomically
        const userResult = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User not found' });
        }
        const currentCredits = userResult.rows[0].credits;

        // Rule 1: User's balance must be < 5 to buy credits
        if (currentCredits >= 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `Credit purchase is not allowed. You currently have ${currentCredits} credits. Purchases are only permitted when your balance drops below 5 credits.`
            });
        }

        // Rule 2: Purchase cannot push total balance beyond 10
        const maxBuyable = 10 - currentCredits;
        if (credits_to_buy > maxBuyable) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: `Cannot purchase ${credits_to_buy} credits. With your current balance of ${currentCredits}, you can buy at most ${maxBuyable} credit(s) (cap is 10 credits).`
            });
        }

        const amountPaid = credits_to_buy * PRICE_PER_CREDIT_INR;
        const paymentRef = `MOCK_TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        // 2. Record purchase in credit_purchases table
        const purchaseResult = await client.query(
            `INSERT INTO credit_purchases (user_id, credits_bought, amount_paid, payment_ref, payment_status)
             VALUES ($1, $2, $3, $4, 'success')
             RETURNING *`,
            [userId, credits_to_buy, amountPaid, paymentRef]
        );
        const purchase = purchaseResult.rows[0];

        // 3. Increment user credit balance
        const updatedUser = await client.query(
            `UPDATE users SET credits = credits + $1 WHERE id = $2 RETURNING id, name, credits`,
            [credits_to_buy, userId]
        );

        // 4. Record 'purchase' in audit ledger
        await client.query(
            `INSERT INTO transactions (sender_id, receiver_id, amount, transaction_type)
             VALUES (0, $1, $2, 'purchase')`,
            [userId, credits_to_buy]
        );

        await client.query('COMMIT');

        res.status(201).json({
            message: `Successfully purchased ${credits_to_buy} credit(s) for ₹${amountPaid.toFixed(2)}`,
            purchase,
            new_balance: updatedUser.rows[0].credits
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing credit purchase:', err);
        res.status(500).json({ error: 'Server error processing credit purchase' });
    } finally {
        client.release();
    }
};
