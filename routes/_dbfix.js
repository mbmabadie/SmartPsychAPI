// routes/_dbfix.js
// ⚠️ TEMPORARY - مؤقت لإصلاح charset والإيموجي
// بعد ما يخلص، احذف هذا الملف والـ require منه

const express = require('express');
const db = require('../config/database');

const router = express.Router();

function checkKey(req, res, next) {
  const key = req.query.key || req.headers['x-setup-key'];
  if (key !== process.env.SETUP_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

router.post('/charset', checkKey, async (req, res) => {
  const log = [];
  const push = (msg) => { console.log(msg); log.push(msg); };

  try {
    // اسم الـ DB من الـ env (نفس اللي بستخدمه التطبيق)
    const dbName = process.env.DB_NAME;
    push(`🔧 إصلاح charset للـ DB: ${dbName}`);

    // تحويل الـ database
    await db.query(`ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    push(`✅ Database charset → utf8mb4`);

    // كل الجداول
    const [tables] = await db.query('SHOW TABLES');
    for (const row of tables) {
      const tableName = Object.values(row)[0];
      try {
        await db.query(`ALTER TABLE \`${tableName}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        push(`  ✅ ${tableName}`);
      } catch (err) {
        push(`  ⚠️ ${tableName}: ${err.message}`);
      }
    }

    // التحقق من الإيموجي بالبيانات الحالية
    push('🔍 فحص الإيموجي في question_options...');
    const [emojiRows] = await db.query(
      "SELECT id, option_text_ar, emoji FROM question_options WHERE emoji IS NOT NULL AND emoji != ''"
    );
    push(`📊 وجدت ${emojiRows.length} خيار فيه إيموجي`);

    // البيانات اللي خُزّنت غلط (مع `?`) ما تنقذ - لازم إعادة كتابتها يدوياً
    const corrupted = emojiRows.filter(r => r.emoji === '?' || r.emoji.includes('?'));
    if (corrupted.length > 0) {
      push(`⚠️ ${corrupted.length} خيار محفوظ كـ '?' - لازم إعادة كتابة الإيموجي من الـ Dashboard`);
      corrupted.forEach(c => push(`     - id ${c.id}: ${c.option_text_ar}`));
    }

    res.json({ success: true, log, corrupted_emojis: corrupted });
  } catch (err) {
    push(`❌ ${err.message}`);
    res.status(500).json({ success: false, log, error: err.message });
  }
});

module.exports = router;
