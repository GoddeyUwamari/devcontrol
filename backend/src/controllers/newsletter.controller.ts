import { Request, Response } from 'express';
import { pool } from '../config/database';
import { safeErrorFields } from '../utils/safe-error-log';

// Every successful signup gets this exact answer -- new, reactivated or
// already subscribed -- so the endpoint cannot be used to learn whether an
// email address is on the list.
const SUBSCRIBED = { success: true, message: 'Subscribed successfully' };

export const subscribe = async (req: Request, res: Response): Promise<void> => {
  const { email, source = 'blog' } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@') || !email.includes('.')) {
    res.status(400).json({ success: false, error: 'Valid email address is required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const validSources = ['blog', 'changelog'];
  const normalizedSource = validSources.includes(source) ? source : 'blog';

  try {
    const existing = await pool.query(
      'SELECT id, is_active FROM newsletter_subscribers WHERE email = $1',
      [normalizedEmail]
    );

    if (existing.rows.length > 0) {
      // Reactivate if they had previously unsubscribed
      if (!existing.rows[0].is_active) {
        await pool.query(
          'UPDATE newsletter_subscribers SET is_active = true, subscribed_at = NOW() WHERE email = $1',
          [normalizedEmail]
        );
        res.status(201).json(SUBSCRIBED);
        return;
      }
      res.status(201).json(SUBSCRIBED);
      return;
    }

    await pool.query(
      'INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2)',
      [normalizedEmail, normalizedSource]
    );

    res.status(201).json(SUBSCRIBED);
  } catch (err) {
    // Not the error object: a database error's detail can quote the email.
    console.error('Newsletter subscribe error:', safeErrorFields(err));
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
