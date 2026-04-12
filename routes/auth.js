// routes/auth.js
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, age, gender } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Email, password and name are required' });
    }

    // فحص إذا الإيميل موجود
    const [existing] = await db.query(
      'SELECT id, is_active FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      // إذا الحساب نشط → رفض
      if (existing[0].is_active) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }

      // إذا الحساب معطّل (محذوف سابقاً) → إعادة تفعيل بياناته الجديدة
      // المستخدم يحس إنه أنشأ حساب جديد، لكنه فعلياً نفس الحساب
      const hash = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET password_hash = ?, full_name = ?, age = ?, gender = ?, is_active = 1, last_login_at = NOW() WHERE id = ?',
        [hash, full_name, age || null, gender || null, existing[0].id]
      );

      const token = jwt.sign({ userId: existing[0].id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

      return res.status(201).json({
        success: true,
        data: {
          token,
          user: { id: existing[0].id, email, full_name, role: 'user' },
        },
      });
    }

    // حساب جديد
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (email, password_hash, full_name, age, gender) VALUES (?, ?, ?, ?, ?)',
      [email, hash, full_name, age || null, gender || null]
    );

    const token = jwt.sign({ userId: result.insertId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.status(201).json({
      success: true,
      data: {
        token,
        user: { id: result.insertId, email, full_name, role: 'user' },
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ═══════════════════════════════════════════
// POST /api/auth/login
// ═══════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is disabled' });
    }

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ═══════════════════════════════════════════
// GET /api/auth/profile
// ═══════════════════════════════════════════
router.get('/profile', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, email, full_name, age, gender, role, created_at, last_login_at FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ═══════════════════════════════════════════
// PUT /api/auth/profile
// ═══════════════════════════════════════════
router.put('/profile', auth, async (req, res) => {
  try {
    const { full_name, age, gender } = req.body;
    await db.query(
      'UPDATE users SET full_name = COALESCE(?, full_name), age = COALESCE(?, age), gender = COALESCE(?, gender) WHERE id = ?',
      [full_name, age, gender, req.user.id]
    );
    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ═══════════════════════════════════════════
// DELETE /api/auth/account - حذف الحساب (soft delete)
// ═══════════════════════════════════════════
// ملاحظة: هذا حذف منطقي فقط - يعطّل الحساب ويحتفظ بالبيانات
// إذا المستخدم سجل بنفس الإيميل لاحقاً، الحساب يُعاد تفعيله بالبيانات الجديدة
router.delete('/account', auth, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ success: false, message: 'Error deleting account' });
  }
});

module.exports = router;
