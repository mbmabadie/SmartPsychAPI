// seed.js - بذر البيانات الافتراضية
require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('./config/database');

async function seed() {
  try {
    console.log('\n🌱 Starting seed process...\n');

    // ═══════════════════════════════════════
    // 1. الأدمن الافتراضي
    // ═══════════════════════════════════════
    const adminEmail = 'mbmabadie@gmail.com';
    const adminPassword = '123456';
    const adminName = 'System Admin';

    console.log('🔐 Generating bcrypt hash for admin...');
    const adminHash = await bcrypt.hash(adminPassword, 10);

    const [existingAdmin] = await db.query(
      'SELECT id FROM users WHERE email = ?',
      [adminEmail]
    );

    if (existingAdmin.length) {
      await db.query(
        'UPDATE users SET password_hash = ?, full_name = ?, role = ?, is_active = 1 WHERE email = ?',
        [adminHash, adminName, 'admin', adminEmail]
      );
      console.log(`✅ Admin updated: ${adminEmail}`);
    } else {
      await db.query(
        'INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)',
        [adminEmail, adminHash, adminName, 'admin']
      );
      console.log(`✅ Admin created: ${adminEmail}`);
    }

    console.log(`🔑 Password: ${adminPassword}`);

    // ═══════════════════════════════════════
    // 2. اختبار افتراضي (PHQ-2 المختصر)
    // ═══════════════════════════════════════
    console.log('\n📝 Creating default assessment...');

    const [adminUser] = await db.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
    const adminId = adminUser[0].id;

    // فحص إذا الاختبار موجود
    const [existingAssessment] = await db.query(
      'SELECT id FROM assessments WHERE title_ar = ? LIMIT 1',
      ['التقييم اليومي السريع']
    );

    let assessmentId;
    if (existingAssessment.length) {
      assessmentId = existingAssessment[0].id;
      console.log(`  ↻ Assessment already exists (ID: ${assessmentId})`);
    } else {
      const [result] = await db.query(
        'INSERT INTO assessments (title, title_ar, description, description_ar, category, scoring_type, max_score, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          'Daily Quick Check',
          'التقييم اليومي السريع',
          'A 3-question daily wellness check',
          'تقييم يومي سريع من 3 أسئلة لمتابعة الحالة النفسية',
          'mental_health',
          'sum',
          9,
          1,
          adminId,
        ]
      );
      assessmentId = result.insertId;
      console.log(`  ✅ Assessment created (ID: ${assessmentId})`);

      // الأسئلة والخيارات
      const questions = [
        {
          text: 'How are you feeling today?',
          textAr: 'كيف تشعر اليوم؟',
          options: [
            { text: 'Very bad', textAr: 'سيء جداً', value: 0, emoji: '😢' },
            { text: 'Bad', textAr: 'سيء', value: 1, emoji: '😔' },
            { text: 'Okay', textAr: 'مقبول', value: 2, emoji: '😐' },
            { text: 'Great', textAr: 'ممتاز', value: 3, emoji: '😊' },
          ],
        },
        {
          text: 'How was your sleep quality?',
          textAr: 'كيف كانت جودة نومك؟',
          options: [
            { text: 'Very poor', textAr: 'سيئة جداً', value: 0, emoji: '😴' },
            { text: 'Poor', textAr: 'سيئة', value: 1, emoji: '😪' },
            { text: 'Good', textAr: 'جيدة', value: 2, emoji: '😌' },
            { text: 'Excellent', textAr: 'ممتازة', value: 3, emoji: '🛌' },
          ],
        },
        {
          text: 'How is your energy level?',
          textAr: 'كيف مستوى طاقتك؟',
          options: [
            { text: 'Exhausted', textAr: 'منهك', value: 0, emoji: '🪫' },
            { text: 'Low', textAr: 'منخفضة', value: 1, emoji: '🔋' },
            { text: 'Normal', textAr: 'عادية', value: 2, emoji: '⚡' },
            { text: 'High', textAr: 'عالية', value: 3, emoji: '💪' },
          ],
        },
      ];

      const questionIds = [];
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const [qResult] = await db.query(
          'INSERT INTO assessment_questions (assessment_id, question_text, question_text_ar, question_order, is_required, is_active) VALUES (?, ?, ?, ?, 1, 1)',
          [assessmentId, q.text, q.textAr, qi]
        );
        const questionId = qResult.insertId;
        questionIds.push(questionId);

        for (let oi = 0; oi < q.options.length; oi++) {
          const o = q.options[oi];
          await db.query(
            'INSERT INTO question_options (question_id, option_text, option_text_ar, option_value, option_order, emoji) VALUES (?, ?, ?, ?, ?, ?)',
            [questionId, o.text, o.textAr, o.value, oi, o.emoji]
          );
        }
      }
      console.log(`  ✅ questions with options created`);

      // ═══════════════════════════════════════
      // 3. دورة افتراضية تشمل كل الأسئلة بأشكال مختلفة
      // ═══════════════════════════════════════
      const today = new Date();
      const monthLater = new Date();
      monthLater.setDate(today.getDate() + 30);

      const startDate = today.toISOString().split('T')[0];
      const endDate = monthLater.toISOString().split('T')[0];

      const [rotResult] = await db.query(
        'INSERT INTO assessment_rotations (assessment_id, title, start_date, end_date, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)',
        [assessmentId, 'الدورة الأولى - تجريبية', startDate, endDate, adminId]
      );

      // شكل عرض مختلف لكل سؤال (لعرض كل الأشكال)
      const displayTypes = ['emoji_scale', 'card_select', 'image_cards'];
      for (let i = 0; i < questionIds.length; i++) {
        await db.query(
          'INSERT INTO rotation_questions (rotation_id, question_id, display_type, display_order) VALUES (?, ?, ?, ?)',
          [rotResult.insertId, questionIds[i], displayTypes[i] || 'radio_list', i]
        );
      }
      console.log(`  ✅ Active rotation created (من ${startDate} إلى ${endDate})`);
    }

    console.log('\n✨ Seed completed successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('🔑 Admin credentials:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Seed error:', err);
    process.exit(1);
  }
}

seed();
