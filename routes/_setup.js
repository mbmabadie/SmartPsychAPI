// routes/_setup.js
// ⚠️ TEMPORARY - احذف هذا الملف بعد ما يشتغل كل شي
// Endpoint مؤقت لتشغيل schema.sql و seed على الـ DB

const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('../config/database');

const router = express.Router();

function checkKey(req, res, next) {
  const key = req.query.key || req.headers['x-setup-key'];
  const expected = process.env.SETUP_KEY;

  if (!expected) {
    return res.status(500).json({
      success: false,
      message: 'SETUP_KEY غير محدد في .env'
    });
  }
  if (key !== expected) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════════
// GET /api/_setup/status
// ═══════════════════════════════════════════════════════════════
router.get('/status', checkKey, async (req, res) => {
  try {
    const [tables] = await db.query('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);

    let userCount = 0;
    let adminCount = 0;
    let assessmentCount = 0;

    if (tableNames.includes('users')) {
      const [u] = await db.query('SELECT COUNT(*) AS c FROM users');
      const [a] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'");
      userCount = u[0].c;
      adminCount = a[0].c;
    }
    if (tableNames.includes('assessments')) {
      const [as] = await db.query('SELECT COUNT(*) AS c FROM assessments');
      assessmentCount = as[0].c;
    }

    res.json({
      success: true,
      tables: tableNames,
      counts: { users: userCount, admins: adminCount, assessments: assessmentCount },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
      code: err.code,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/_setup/init
// ═══════════════════════════════════════════════════════════════
router.post('/init', checkKey, async (req, res) => {
  const log = [];
  const push = (msg) => { console.log(msg); log.push(msg); };

  try {
    push('📋 قراءة migrations/schema.sql...');
    const schemaPath = path.join(__dirname, '..', 'migrations', 'schema.sql');

    if (!fs.existsSync(schemaPath)) {
      return res.status(500).json({
        success: false,
        log,
        error: `الملف غير موجود: ${schemaPath}`
      });
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // تنظيف وتقسيم
    const statements = schemaSql
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .filter(line => !line.trim().startsWith('#'))
      .join('\n')
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      // 🔧 تجاهل CREATE DATABASE و USE و SET (الـ container متصل بالفعل بالـ DB الصح)
      .filter(s => {
        const upper = s.toUpperCase();
        if (upper.startsWith('CREATE DATABASE')) return false;
        if (upper.startsWith('CREATE SCHEMA')) return false;
        if (upper.startsWith('USE ')) return false;
        if (upper.startsWith('DROP DATABASE')) return false;
        return true;
      });

    push(`📋 عدد الـ statements بعد التصفية: ${statements.length}`);

    let executed = 0;
    let skipped = 0;
    const errors = [];

    for (const stmt of statements) {
      try {
        await db.query(stmt);
        executed++;
      } catch (err) {
        // تجاهل أخطاء "موجود مسبقاً"
        if (
          err.code === 'ER_TABLE_EXISTS_ERROR' ||
          err.code === 'ER_DUP_KEYNAME' ||
          err.code === 'ER_DUP_FIELDNAME' ||
          err.code === 'ER_DUP_ENTRY'
        ) {
          skipped++;
          continue;
        }
        // باقي الأخطاء نسجلها بس نكمل
        const firstLine = stmt.split('\n')[0].substring(0, 80);
        errors.push({ statement: firstLine, error: err.message, code: err.code });
      }
    }

    push(`✅ تم تنفيذ ${executed} statement، تم تخطي ${skipped} موجود مسبقاً`);
    if (errors.length > 0) {
      push(`⚠️ ${errors.length} أخطاء`);
    }

    // عدد الجداول
    const [tables] = await db.query('SHOW TABLES');
    push(`📊 عدد الجداول: ${tables.length}`);

    if (tables.length === 0) {
      return res.status(500).json({
        success: false,
        log,
        errors,
        message: 'لم يتم إنشاء أي جدول - تحقق من الأخطاء'
      });
    }

    // إنشاء الأدمن
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@smartpsych.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    const [existingAdmin] = await db.query(
      'SELECT id FROM users WHERE email = ? AND role = ?',
      [adminEmail, 'admin']
    );

    if (existingAdmin.length === 0) {
      const adminHash = await bcrypt.hash(adminPassword, 10);
      await db.query(
        'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)',
        [adminEmail, adminHash, 'Admin', 'admin']
      );
      push(`✅ تم إنشاء أدمن: ${adminEmail}`);
    } else {
      push(`⊙ الأدمن موجود: ${adminEmail}`);
    }

    // seed.js - فقط إذا ما في assessments
    const [assessmentsExisting] = await db.query('SELECT COUNT(*) AS c FROM assessments');

    if (assessmentsExisting[0].c === 0) {
      push('🌱 تشغيل seed.js...');
      const seedPath = path.join(__dirname, '..', 'seed.js');
      if (fs.existsSync(seedPath)) {
        try {
          const { execSync } = require('child_process');
          const output = execSync(`node ${seedPath}`, {
            cwd: path.join(__dirname, '..'),
            encoding: 'utf8',
            timeout: 60000,
          });
          push(`✅ seed.js نجح`);
        } catch (err) {
          push(`⚠️ seed.js: ${err.message.substring(0, 200)}`);
        }
      }
    } else {
      push(`⊙ في ${assessmentsExisting[0].c} assessment موجودة`);
    }

    // ملخص نهائي
    const [users] = await db.query('SELECT COUNT(*) AS c FROM users');
    const [admins] = await db.query("SELECT COUNT(*) AS c FROM users WHERE role='admin'");
    const [finalAssessments] = await db.query('SELECT COUNT(*) AS c FROM assessments');

    res.json({
      success: true,
      message: 'Setup completed',
      log,
      errors: errors.length > 0 ? errors : undefined,
      summary: {
        tables: tables.length,
        users: users[0].c,
        admins: admins[0].c,
        assessments: finalAssessments[0].c,
        admin_email: adminEmail,
        admin_password: adminPassword,
      },
      next_step: '⚠️ احذف routes/_setup.js والسطر من server.js ثم redeploy',
    });
  } catch (err) {
    push(`❌ خطأ: ${err.message}`);
    res.status(500).json({
      success: false,
      log,
      error: {
        message: err.message,
        code: err.code,
        sqlMessage: err.sqlMessage,
      },
    });
  }
});

module.exports = router;
