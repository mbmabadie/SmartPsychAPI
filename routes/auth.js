// routes/auth.js
// 🔍 نسخة تشخيصية - ترجع تفاصيل الأخطاء في الـ response
// ⚠️ بعد ما نلاقي المشكلة، رجّع النسخة الأصلية للأمان
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// 🔍 helper مؤقت يطبع تفاصيل الـ error بالـ response
function debugError(err, label) {
  console.error(`❌ [${label}]:`, err);
  return {
    success: false,
    message: 'Server error',
    debug: {
      label,
      name: err.name,
      message: err.message,
      code: err.code,           // مفيد لـ MySQL errors (ER_BAD_DB_ERROR, ECONNREFUSED, ER_NO_SUCH_TABLE...)
      sqlMessage: err.sqlMessage,
      errno: err.errno,
    },
  };
}

// ═══════════════════════════════════════════
// 🔍 GET /api/auth/health-check - فحص الاتصال بالـ DB
// ═══════════════════════════════════════════
router.get('/health-check', async (req, res) => {
  const checks = {
    db_connection: 'unknown',
    users_table_exists: 'unknown',
    users_columns: [],
    user_count: null,
    jwt_secret_set: !!process.env.JWT_SECRET,
    jwt_expires_in_set: !!process.env.JWT_EXPIRES_IN,
    node_env: process.env.NODE_ENV,
    db_config: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password_set: !!process.env.DB_PASSWORD && process.env.DB_PASSWORD.length > 0,
      database: process.env.DB_NAME,
    },
  };

  try {
    // 1. اتصال بالـ DB
    await db.query('SELECT 1');
    checks.db_connection = 'ok';

    // 2. هل جدول users موجود
    const [tables] = await db.query("SHOW TABLES LIKE 'users'");
    checks.users_table_exists = tables.length > 0 ? 'ok' : 'missing';

    if (tables.length > 0) {
      // 3. أعمدة الجدول
      const [cols] = await db.query('SHOW COLUMNS FROM users');
      checks.users_columns = cols.map(c => c.Field);

      // 4. عدد المستخدمين
      const [count] = await db.query('SELECT COUNT(*) AS c FROM users');
      checks.user_count = count[0].c;
    }

    return res.json({ success: true, checks });
  } catch (err) {
    return res.status(500).json({
      success: false,
      checks,
      error: {
        name: err.name,
        message: err.message,
        code: err.code,
        sqlMessage: err.sqlMessage,
      },
    });
  }
});

// ═══════════════════════════════════════════
// POST /api/auth/register
// ═══════════════════════════════════════════
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, age, gender } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Email, password and name are required' });
    }

    const [existing] = await db.query(
      'SELECT id, is_active FROM users WHERE email = ?',
      [email]
    );

    if (existing.length) {
      if (existing[0].is_active) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }

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
    res.status(500).json(debugError(err, 'register'));
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
    res.status(500).json(debugError(err, 'login'));
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
    res.status(500).json(debugError(err, 'profile-get'));
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
    res.status(500).json(debugError(err, 'profile-put'));
  }
});

// ═══════════════════════════════════════════
// DELETE /api/auth/account - حذف منطقي
// ═══════════════════════════════════════════
router.delete('/account', auth, async (req, res) => {
  try {
    await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.user.id]);
    res.json({ success: true, message: 'Account deleted' });
  } catch (err) {
    res.status(500).json(debugError(err, 'delete-account'));
  }
});

module.exports = router;
