// routes/assessments.js
const express = require('express');
const db = require('../config/database');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

const router = express.Router();
router.use(auth);

// ═══════════════════════════════════════════════════════════
// USER ENDPOINTS
// ═══════════════════════════════════════════════════════════

router.get('/active', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [rotations] = await db.query(`
      SELECT r.*, a.title, a.title_ar, a.description, a.description_ar, a.category, a.scoring_type, a.max_score
      FROM assessment_rotations r
      JOIN assessments a ON r.assessment_id = a.id
      WHERE r.is_active = 1 AND a.is_active = 1
        AND r.start_date <= ? AND r.end_date >= ?
      ORDER BY r.created_at DESC LIMIT 1
    `, [today, today]);

    if (!rotations.length) {
      return res.json({ success: true, data: null, message: 'No active assessment currently' });
    }

    const rotation = rotations[0];

    const [existingSession] = await db.query(
      'SELECT id, is_completed, completed_at FROM user_assessment_sessions WHERE user_id = ? AND rotation_id = ? AND is_completed = 1',
      [req.user.id, rotation.id]
    );

    const [questions] = await db.query(`
      SELECT rq.display_type, rq.display_order, q.id as question_id, q.question_text, q.question_text_ar, q.is_required
      FROM rotation_questions rq
      JOIN assessment_questions q ON rq.question_id = q.id
      WHERE rq.rotation_id = ? AND q.is_active = 1
      ORDER BY rq.display_order ASC
    `, [rotation.id]);

    for (const q of questions) {
      const [options] = await db.query(
        'SELECT id, option_text, option_text_ar, option_value, option_order, emoji, icon_name, color_hex FROM question_options WHERE question_id = ? ORDER BY option_order ASC',
        [q.question_id]
      );
      q.options = options;
    }

    res.json({
      success: true,
      data: {
        rotation_id: rotation.id,
        assessment_id: rotation.assessment_id,
        title: rotation.title || rotation.title_ar,
        title_ar: rotation.title_ar,
        description: rotation.description,
        description_ar: rotation.description_ar,
        category: rotation.category,
        scoring_type: rotation.scoring_type,
        max_score: rotation.max_score,
        start_date: rotation.start_date,
        end_date: rotation.end_date,
        already_completed: existingSession.length > 0,
        completed_at: existingSession[0]?.completed_at || null,
        questions,
      },
    });
  } catch (err) {
    console.error('Get active assessment error:', err);
    res.status(500).json({ success: false, message: 'Error fetching assessment' });
  }
});

router.post('/respond', async (req, res) => {
  try {
    const { rotation_id, responses, client_session_id } = req.body;
    const userId = req.user.id;

    if (!rotation_id || !responses?.length) {
      return res.status(400).json({ success: false, message: 'rotation_id and responses are required' });
    }

    const [session] = await db.query(
      'INSERT INTO user_assessment_sessions (user_id, rotation_id, client_session_id) VALUES (?, ?, ?)',
      [userId, rotation_id, client_session_id]
    );
    const sessionId = session.insertId;

    let totalScore = 0;
    let maxPossible = 0;

    for (const r of responses) {
      await db.query(
        'INSERT INTO user_assessment_responses (session_id, question_id, selected_option_id, response_value, response_time_seconds) VALUES (?, ?, ?, ?, ?)',
        [sessionId, r.question_id, r.selected_option_id, r.response_value, r.response_time_seconds || null]
      );
      totalScore += r.response_value;

      const [maxOpt] = await db.query(
        'SELECT MAX(option_value) as max_val FROM question_options WHERE question_id = ?',
        [r.question_id]
      );
      maxPossible += maxOpt[0]?.max_val || 0;
    }

    const percentage = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0;
    await db.query(
      'UPDATE user_assessment_sessions SET is_completed = 1, completed_at = NOW(), total_score = ?, max_possible_score = ?, score_percentage = ? WHERE id = ?',
      [totalScore, maxPossible, percentage, sessionId]
    );

    res.json({
      success: true,
      data: {
        session_id: sessionId,
        total_score: totalScore,
        max_possible_score: maxPossible,
        score_percentage: Math.round(percentage * 100) / 100,
      },
    });
  } catch (err) {
    console.error('Submit response error:', err);
    res.status(500).json({ success: false, message: 'Error saving responses' });
  }
});

router.get('/my-results', async (req, res) => {
  try {
    const [sessions] = await db.query(`
      SELECT s.*, a.title, a.title_ar, a.category
      FROM user_assessment_sessions s
      JOIN assessment_rotations r ON s.rotation_id = r.id
      JOIN assessments a ON r.assessment_id = a.id
      WHERE s.user_id = ? AND s.is_completed = 1
      ORDER BY s.completed_at DESC
    `, [req.user.id]);

    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching results' });
  }
});

router.post('/sync-responses', async (req, res) => {
  try {
    const { sessions } = req.body;
    if (!sessions?.length) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const results = [];
    for (const s of sessions) {
      const [existing] = await db.query(
        'SELECT id FROM user_assessment_sessions WHERE user_id = ? AND client_session_id = ?',
        [req.user.id, s.client_session_id]
      );

      if (existing.length) {
        results.push({ client_id: s.client_session_id, status: 'already_synced' });
        continue;
      }

      const [session] = await db.query(
        'INSERT INTO user_assessment_sessions (user_id, rotation_id, client_session_id, total_score, max_possible_score, score_percentage, is_completed, completed_at, synced_from_client) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1)',
        [req.user.id, s.rotation_id, s.client_session_id, s.total_score, s.max_possible_score, s.score_percentage, s.completed_at]
      );

      if (s.responses?.length) {
        for (const r of s.responses) {
          await db.query(
            'INSERT INTO user_assessment_responses (session_id, question_id, selected_option_id, response_value, response_time_seconds) VALUES (?, ?, ?, ?, ?)',
            [session.insertId, r.question_id, r.selected_option_id, r.response_value, r.response_time_seconds]
          );
        }
      }

      results.push({ client_id: s.client_session_id, server_id: session.insertId, status: 'synced' });
    }

    res.json({ success: true, data: results, count: results.filter(r => r.status === 'synced').length });
  } catch (err) {
    console.error('Sync responses error:', err);
    res.status(500).json({ success: false, message: 'Error syncing responses' });
  }
});

// ═══════════════════════════════════════════════════════════
// ADMIN: ASSESSMENTS CRUD
// ═══════════════════════════════════════════════════════════

router.get('/all', admin, async (req, res) => {
  try {
    const [assessments] = await db.query(`
      SELECT a.*, 
        (SELECT COUNT(*) FROM assessment_questions WHERE assessment_id = a.id AND is_active = 1) as questions_count,
        (SELECT COUNT(*) FROM assessment_rotations WHERE assessment_id = a.id) as rotations_count,
        (SELECT COUNT(*) FROM assessment_rotations WHERE assessment_id = a.id AND is_active = 1 AND start_date <= CURDATE() AND end_date >= CURDATE()) as active_rotations_count
      FROM assessments a ORDER BY a.created_at DESC
    `);
    res.json({ success: true, data: assessments });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching assessments' });
  }
});

router.post('/create', admin, async (req, res) => {
  try {
    const { title, title_ar, description, description_ar, category, scoring_type, questions } = req.body;

    if (!title_ar?.trim() && !title?.trim()) {
      return res.status(400).json({ success: false, message: 'العنوان مطلوب' });
    }

    const finalTitle = title?.trim() || title_ar?.trim();
    const finalTitleAr = title_ar?.trim() || title?.trim();

    const [assessment] = await db.query(
      'INSERT INTO assessments (title, title_ar, description, description_ar, category, scoring_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [finalTitle, finalTitleAr, description || null, description_ar || null, category || 'general', scoring_type || 'sum', req.user.id]
    );
    const assessmentId = assessment.insertId;

    let maxScore = 0;

    if (questions?.length) {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qText = q.question_text?.trim() || q.question_text_ar?.trim() || `Question ${i + 1}`;
        const qTextAr = q.question_text_ar?.trim() || q.question_text?.trim() || `سؤال ${i + 1}`;

        const [question] = await db.query(
          'INSERT INTO assessment_questions (assessment_id, question_text, question_text_ar, question_order, is_required) VALUES (?, ?, ?, ?, ?)',
          [assessmentId, qText, qTextAr, i, q.is_required !== false ? 1 : 0]
        );

        let questionMax = 0;
        if (q.options?.length) {
          for (let j = 0; j < q.options.length; j++) {
            const o = q.options[j];
            const optText = o.option_text?.trim() || o.option_text_ar?.trim() || `Option ${j + 1}`;
            const optTextAr = o.option_text_ar?.trim() || o.option_text?.trim() || `خيار ${j + 1}`;

            await db.query(
              'INSERT INTO question_options (question_id, option_text, option_text_ar, option_value, option_order, emoji, icon_name, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [question.insertId, optText, optTextAr, o.option_value || 0, j, o.emoji || null, o.icon_name || null, o.color_hex || null]
            );
            if ((o.option_value || 0) > questionMax) questionMax = o.option_value || 0;
          }
        }
        maxScore += questionMax;
      }
    }

    await db.query('UPDATE assessments SET max_score = ? WHERE id = ?', [maxScore, assessmentId]);

    res.status(201).json({
      success: true,
      data: { id: assessmentId, max_score: maxScore, questions_count: questions?.length || 0 },
    });
  } catch (err) {
    console.error('Create assessment error:', err);
    res.status(500).json({ success: false, message: err.message || 'Error creating assessment' });
  }
});

router.get('/:id', admin, async (req, res) => {
  try {
    const [assessments] = await db.query('SELECT * FROM assessments WHERE id = ?', [req.params.id]);
    if (!assessments.length) {
      return res.status(404).json({ success: false, message: 'Assessment not found' });
    }

    const [questions] = await db.query(
      'SELECT * FROM assessment_questions WHERE assessment_id = ? ORDER BY question_order',
      [req.params.id]
    );

    for (const q of questions) {
      const [options] = await db.query(
        'SELECT * FROM question_options WHERE question_id = ? ORDER BY option_order',
        [q.id]
      );
      q.options = options;
    }

    res.json({ success: true, data: { ...assessments[0], questions } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching details' });
  }
});

router.put('/:id', admin, async (req, res) => {
  try {
    const { title, title_ar, description, description_ar, category, is_active } = req.body;

    await db.query(
      'UPDATE assessments SET title = COALESCE(?, title), title_ar = COALESCE(?, title_ar), description = COALESCE(?, description), description_ar = COALESCE(?, description_ar), category = COALESCE(?, category), is_active = COALESCE(?, is_active) WHERE id = ?',
      [title, title_ar, description, description_ar, category, is_active, req.params.id]
    );

    res.json({ success: true, message: 'Assessment updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating' });
  }
});

router.delete('/:id', admin, async (req, res) => {
  try {
    await db.query('DELETE FROM assessments WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Assessment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error deleting' });
  }
});

// ═══════════════════════════════════════════════════════════
// 🆕 ADMIN: QUESTIONS CRUD (إدارة الأسئلة منفردة)
// ═══════════════════════════════════════════════════════════

// إضافة سؤال جديد لاختبار موجود
router.post('/:id/questions', admin, async (req, res) => {
  try {
    const { question_text, question_text_ar, is_required, options } = req.body;

    if (!question_text_ar?.trim() && !question_text?.trim()) {
      return res.status(400).json({ success: false, message: 'نص السؤال مطلوب' });
    }

    // الترتيب التالي
    const [maxOrder] = await db.query(
      'SELECT COALESCE(MAX(question_order), -1) + 1 as next_order FROM assessment_questions WHERE assessment_id = ?',
      [req.params.id]
    );

    const qText = question_text?.trim() || question_text_ar.trim();
    const qTextAr = question_text_ar?.trim() || question_text.trim();

    const [question] = await db.query(
      'INSERT INTO assessment_questions (assessment_id, question_text, question_text_ar, question_order, is_required) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, qText, qTextAr, maxOrder[0].next_order, is_required !== false ? 1 : 0]
    );

    if (options?.length) {
      for (let j = 0; j < options.length; j++) {
        const o = options[j];
        const optText = o.option_text?.trim() || o.option_text_ar?.trim() || `Option ${j + 1}`;
        const optTextAr = o.option_text_ar?.trim() || o.option_text?.trim() || `خيار ${j + 1}`;

        await db.query(
          'INSERT INTO question_options (question_id, option_text, option_text_ar, option_value, option_order, emoji, icon_name, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [question.insertId, optText, optTextAr, o.option_value || 0, j, o.emoji || null, o.icon_name || null, o.color_hex || null]
        );
      }
    }

    // إعادة حساب max_score
    await recalculateMaxScore(req.params.id);

    res.status(201).json({ success: true, data: { id: question.insertId } });
  } catch (err) {
    console.error('Add question error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// تعديل سؤال
router.put('/questions/:questionId', admin, async (req, res) => {
  try {
    const { question_text, question_text_ar, is_required, is_active, options } = req.body;

    // تحديث السؤال
    await db.query(
      'UPDATE assessment_questions SET question_text = COALESCE(?, question_text), question_text_ar = COALESCE(?, question_text_ar), is_required = COALESCE(?, is_required), is_active = COALESCE(?, is_active) WHERE id = ?',
      [question_text, question_text_ar, is_required, is_active, req.params.questionId]
    );

    // تحديث الخيارات (حذف وإعادة إنشاء — أبسط طريقة)
    if (Array.isArray(options)) {
      await db.query('DELETE FROM question_options WHERE question_id = ?', [req.params.questionId]);
      for (let j = 0; j < options.length; j++) {
        const o = options[j];
        const optText = o.option_text?.trim() || o.option_text_ar?.trim() || `Option ${j + 1}`;
        const optTextAr = o.option_text_ar?.trim() || o.option_text?.trim() || `خيار ${j + 1}`;

        await db.query(
          'INSERT INTO question_options (question_id, option_text, option_text_ar, option_value, option_order, emoji, icon_name, color_hex) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [req.params.questionId, optText, optTextAr, o.option_value || 0, j, o.emoji || null, o.icon_name || null, o.color_hex || null]
        );
      }
    }

    // إعادة حساب max_score
    const [q] = await db.query('SELECT assessment_id FROM assessment_questions WHERE id = ?', [req.params.questionId]);
    if (q.length) await recalculateMaxScore(q[0].assessment_id);

    res.json({ success: true, message: 'Question updated' });
  } catch (err) {
    console.error('Update question error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// حذف سؤال
router.delete('/questions/:questionId', admin, async (req, res) => {
  try {
    const [q] = await db.query('SELECT assessment_id FROM assessment_questions WHERE id = ?', [req.params.questionId]);

    await db.query('DELETE FROM assessment_questions WHERE id = ?', [req.params.questionId]);

    if (q.length) await recalculateMaxScore(q[0].assessment_id);

    res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ترتيب الأسئلة
router.put('/:id/reorder-questions', admin, async (req, res) => {
  try {
    const { order } = req.body; // array of question IDs in new order
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order array required' });
    }

    for (let i = 0; i < order.length; i++) {
      await db.query(
        'UPDATE assessment_questions SET question_order = ? WHERE id = ? AND assessment_id = ?',
        [i, order[i], req.params.id]
      );
    }

    res.json({ success: true, message: 'Questions reordered' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 🆕 ADMIN: ROTATIONS CRUD (إدارة الدورات)
// ═══════════════════════════════════════════════════════════

router.post('/rotations/create', admin, async (req, res) => {
  try {
    const { assessment_id, title, start_date, end_date, questions } = req.body;

    if (!assessment_id || !start_date || !end_date || !questions?.length) {
      return res.status(400).json({ success: false, message: 'بيانات ناقصة' });
    }

    // إلغاء تفعيل الدورات السابقة المتداخلة بالتاريخ
    await db.query(
      'UPDATE assessment_rotations SET is_active = 0 WHERE assessment_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?',
      [assessment_id, end_date, start_date]
    );

    const [rotation] = await db.query(
      'INSERT INTO assessment_rotations (assessment_id, title, start_date, end_date, is_active, created_by) VALUES (?, ?, ?, ?, 1, ?)',
      [assessment_id, title, start_date, end_date, req.user.id]
    );

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await db.query(
        'INSERT INTO rotation_questions (rotation_id, question_id, display_type, display_order) VALUES (?, ?, ?, ?)',
        [rotation.insertId, q.question_id, q.display_type || 'radio_list', i]
      );
    }

    res.status(201).json({
      success: true,
      data: { rotation_id: rotation.insertId, questions_count: questions.length },
    });
  } catch (err) {
    console.error('Create rotation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/rotations/list/:assessmentId', admin, async (req, res) => {
  try {
    const [rotations] = await db.query(`
      SELECT r.*,
        (SELECT COUNT(*) FROM rotation_questions WHERE rotation_id = r.id) as questions_count,
        (SELECT COUNT(*) FROM user_assessment_sessions WHERE rotation_id = r.id) as responses_count,
        (CASE 
          WHEN r.is_active = 0 THEN 'disabled'
          WHEN r.end_date < CURDATE() THEN 'expired'
          WHEN r.start_date > CURDATE() THEN 'upcoming'
          ELSE 'active'
        END) as status_label
      FROM assessment_rotations r
      WHERE r.assessment_id = ?
      ORDER BY r.start_date DESC
    `, [req.params.assessmentId]);

    res.json({ success: true, data: rotations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تفاصيل دورة (بأسئلتها)
router.get('/rotations/:rotationId', admin, async (req, res) => {
  try {
    const [rotations] = await db.query('SELECT * FROM assessment_rotations WHERE id = ?', [req.params.rotationId]);
    if (!rotations.length) return res.status(404).json({ success: false, message: 'Not found' });

    const [questions] = await db.query(`
      SELECT rq.*, q.question_text, q.question_text_ar
      FROM rotation_questions rq
      JOIN assessment_questions q ON rq.question_id = q.id
      WHERE rq.rotation_id = ?
      ORDER BY rq.display_order
    `, [req.params.rotationId]);

    res.json({ success: true, data: { ...rotations[0], questions } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// تعديل دورة
router.put('/rotations/:rotationId', admin, async (req, res) => {
  try {
    const { title, start_date, end_date, is_active, questions } = req.body;

    await db.query(
      'UPDATE assessment_rotations SET title = COALESCE(?, title), start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), is_active = COALESCE(?, is_active) WHERE id = ?',
      [title, start_date, end_date, is_active, req.params.rotationId]
    );

    if (Array.isArray(questions)) {
      await db.query('DELETE FROM rotation_questions WHERE rotation_id = ?', [req.params.rotationId]);
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        await db.query(
          'INSERT INTO rotation_questions (rotation_id, question_id, display_type, display_order) VALUES (?, ?, ?, ?)',
          [req.params.rotationId, q.question_id, q.display_type || 'radio_list', i]
        );
      }
    }

    res.json({ success: true, message: 'Rotation updated' });
  } catch (err) {
    console.error('Update rotation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// تفعيل/إلغاء دورة
router.patch('/rotations/:rotationId/toggle', admin, async (req, res) => {
  try {
    const [r] = await db.query('SELECT is_active FROM assessment_rotations WHERE id = ?', [req.params.rotationId]);
    if (!r.length) return res.status(404).json({ success: false, message: 'Not found' });

    const newState = r[0].is_active ? 0 : 1;
    await db.query('UPDATE assessment_rotations SET is_active = ? WHERE id = ?', [newState, req.params.rotationId]);

    res.json({ success: true, data: { is_active: newState } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// حذف دورة
router.delete('/rotations/:rotationId', admin, async (req, res) => {
  try {
    await db.query('DELETE FROM assessment_rotations WHERE id = ?', [req.params.rotationId]);
    res.json({ success: true, message: 'Rotation deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// HELPER: حساب max_score للاختبار
// ═══════════════════════════════════════════════════════════
async function recalculateMaxScore(assessmentId) {
  const [rows] = await db.query(`
    SELECT COALESCE(SUM(max_per_q), 0) AS total FROM (
      SELECT MAX(o.option_value) AS max_per_q
      FROM assessment_questions q
      LEFT JOIN question_options o ON o.question_id = q.id
      WHERE q.assessment_id = ? AND q.is_active = 1
      GROUP BY q.id
    ) AS sub
  `, [assessmentId]);

  await db.query('UPDATE assessments SET max_score = ? WHERE id = ?', [rows[0].total || 0, assessmentId]);
}

module.exports = router;
