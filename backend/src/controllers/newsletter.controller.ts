import { Request, Response } from 'express';
import { pool } from '../config/database';

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
        res.status(201).json({ success: true, message: 'Subscribed successfully' });
        return;
      }
      res.status(200).json({ success: true, message: 'Already subscribed' });
      return;
    }

    await pool.query(
      'INSERT INTO newsletter_subscribers (email, source) VALUES ($1, $2)',
      [normalizedEmail, normalizedSource]
    );

    res.status(201).json({ success: true, message: 'Subscribed successfully' });
  } catch (err) {
    console.error('Newsletter subscribe error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
