// routes/admin.js
const express = require('express');
const db = require('../config/database');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

const router = express.Router();
router.use(auth, admin);

// ═══════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW
// ═══════════════════════════════════════════════════════════

// GET /api/admin/dashboard - إحصائيات عامة
router.get('/dashboard', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'user') as total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND last_login_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) as active_users_7d,
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND last_login_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as active_users_today,
        (SELECT COUNT(*) FROM daily_activities) as total_activity_records,
        (SELECT COUNT(*) FROM sleep_sessions) as total_sleep_records,
        (SELECT COUNT(*) FROM phone_usage_entries) as total_phone_records,
        (SELECT COUNT(*) FROM user_assessment_sessions WHERE is_completed = 1) as total_assessments_completed,
        (SELECT COUNT(*) FROM assessments WHERE is_active = 1) as active_assessments,
        (SELECT COUNT(*) FROM sync_log WHERE synced_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)) as syncs_today
    `);

    // آخر المستخدمين المسجلين
    const [recentUsers] = await db.query(
      'SELECT id, full_name, email, created_at, last_login_at FROM users WHERE role = "user" ORDER BY created_at DESC LIMIT 5'
    );

    // آخر عمليات المزامنة
    const [recentSyncs] = await db.query(`
      SELECT sl.*, u.full_name
      FROM sync_log sl JOIN users u ON sl.user_id = u.id
      ORDER BY sl.synced_at DESC LIMIT 10
    `);

    res.json({
      success: true,
      data: { stats: stats[0], recent_users: recentUsers, recent_syncs: recentSyncs },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ success: false, message: 'Error fetching statistics' });
  }
});

// ═══════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════

// GET /api/admin/users - كل المستخدمين
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.id, u.email, u.full_name, u.age, u.gender, u.role, u.is_active, u.created_at, u.last_login_at,
        (SELECT COUNT(*) FROM daily_activities WHERE user_id = u.id) as activity_records,
        (SELECT COUNT(*) FROM sleep_sessions WHERE user_id = u.id) as sleep_records,
        (SELECT COUNT(*) FROM user_assessment_sessions WHERE user_id = u.id AND is_completed = 1) as assessments_completed
      FROM users u WHERE u.role = 'user'
    `;
    const params = [];

    if (search) {
      query += ' AND (u.full_name LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await db.query(query, params);

    const [countResult] = await db.query(
      'SELECT COUNT(*) as total FROM users WHERE role = "user"' + (search ? ' AND (full_name LIKE ? OR email LIKE ?)' : ''),
      search ? [`%${search}%`, `%${search}%`] : []
    );

    res.json({
      success: true,
      data: users,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: countResult[0].total },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching users' });
  }
});

// GET /api/admin/users/:id - تفاصيل مستخدم واحد
router.get('/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;

    const [users] = await db.query(
      'SELECT id, email, full_name, age, gender, role, is_active, created_at, last_login_at FROM users WHERE id = ?',
      [userId]
    );
    if (!users.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // إحصائيات شاملة
    const [stats] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM daily_activities WHERE user_id = ?) as total_activities,
        (SELECT COALESCE(AVG(total_steps), 0) FROM daily_activities WHERE user_id = ?) as avg_steps,
        (SELECT COALESCE(MAX(total_steps), 0) FROM daily_activities WHERE user_id = ?) as max_steps,
        (SELECT COUNT(*) FROM sleep_sessions WHERE user_id = ? AND is_completed = 1) as total_sleep_sessions,
        (SELECT COALESCE(AVG(duration_minutes), 0) FROM sleep_sessions WHERE user_id = ? AND is_completed = 1) as avg_sleep_minutes,
        (SELECT COUNT(*) FROM phone_usage_entries WHERE user_id = ?) as total_phone_entries,
        (SELECT COALESCE(SUM(total_usage_minutes), 0) FROM phone_usage_entries WHERE user_id = ? AND date = CURDATE()) as today_phone_minutes,
        (SELECT COUNT(*) FROM location_visits WHERE user_id = ?) as total_locations,
        (SELECT COUNT(*) FROM user_assessment_sessions WHERE user_id = ? AND is_completed = 1) as assessments_completed,
        (SELECT COALESCE(AVG(score_percentage), 0) FROM user_assessment_sessions WHERE user_id = ? AND is_completed = 1) as avg_assessment_score
    `, [userId, userId, userId, userId, userId, userId, userId, userId, userId, userId]);

    res.json({ success: true, data: { user: users[0], stats: stats[0] } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching details' });
  }
});

// PUT /api/admin/users/:id/toggle - تفعيل/تعطيل مستخدم
router.put('/users/:id/toggle', async (req, res) => {
  try {
    const [user] = await db.query('SELECT is_active FROM users WHERE id = ?', [req.params.id]);
    if (!user.length) return res.status(404).json({ success: false, message: 'Not found' });

    const newStatus = user[0].is_active ? 0 : 1;
    await db.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);

    res.json({ success: true, message: newStatus ? 'Account activated' : 'Account deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error updating' });
  }
});

// ═══════════════════════════════════════════════════════════
// USER DATA - بيانات مستخدم محدد
// ═══════════════════════════════════════════════════════════

// GET /api/admin/users/:id/activities - بيانات نشاط مستخدم
router.get('/users/:id/activities', async (req, res) => {
  try {
    const { from, to, limit = 30 } = req.query;
    let query = 'SELECT * FROM daily_activities WHERE user_id = ?';
    const params = [req.params.id];

    if (from) { query += ' AND date >= ?'; params.push(from); }
    if (to) { query += ' AND date <= ?'; params.push(to); }

    query += ' ORDER BY date DESC LIMIT ?';
    params.push(parseInt(limit));

    const [data] = await db.query(query, params);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching activity data' });
  }
});

// GET /api/admin/users/:id/sleep - بيانات نوم مستخدم
router.get('/users/:id/sleep', async (req, res) => {
  try {
    const { from, to, limit = 30 } = req.query;
    let query = 'SELECT * FROM sleep_sessions WHERE user_id = ? AND is_completed = 1';
    const params = [req.params.id];

    if (from) { query += ' AND start_time >= ?'; params.push(new Date(from).getTime()); }
    if (to) { query += ' AND start_time <= ?'; params.push(new Date(to).getTime()); }

    query += ' ORDER BY start_time DESC LIMIT ?';
    params.push(parseInt(limit));

    const [data] = await db.query(query, params);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching sleep data' });
  }
});

// GET /api/admin/users/:id/phone-usage - بيانات استخدام الهاتف
router.get('/users/:id/phone-usage', async (req, res) => {
  try {
    const { date, limit = 50 } = req.query;
    let query = 'SELECT * FROM phone_usage_entries WHERE user_id = ?';
    const params = [req.params.id];

    if (date) { query += ' AND date = ?'; params.push(date); }

    query += ' ORDER BY total_usage_minutes DESC LIMIT ?';
    params.push(parseInt(limit));

    const [data] = await db.query(query, params);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching phone data' });
  }
});

// GET /api/admin/users/:id/locations - بيانات المواقع
router.get('/users/:id/locations', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const [data] = await db.query(
      'SELECT * FROM location_visits WHERE user_id = ? ORDER BY arrival_time DESC LIMIT ?',
      [req.params.id, parseInt(limit)]
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching location data' });
  }
});

// GET /api/admin/users/:id/assessments - نتائج اختبارات مستخدم
router.get('/users/:id/assessments', async (req, res) => {
  try {
    const [sessions] = await db.query(`
      SELECT s.*, a.title, a.title_ar, a.category, r.start_date, r.end_date
      FROM user_assessment_sessions s
      JOIN assessment_rotations r ON s.rotation_id = r.id
      JOIN assessments a ON r.assessment_id = a.id
      WHERE s.user_id = ? AND s.is_completed = 1
      ORDER BY s.completed_at DESC
    `, [req.params.id]);

    // جلب التفاصيل لكل جلسة
    for (const session of sessions) {
      const [responses] = await db.query(`
        SELECT r.*, q.question_text, q.question_text_ar, o.option_text, o.option_text_ar
        FROM user_assessment_responses r
        JOIN assessment_questions q ON r.question_id = q.id
        JOIN question_options o ON r.selected_option_id = o.id
        WHERE r.session_id = ?
      `, [session.id]);
      session.responses = responses;
    }

    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching assessment results' });
  }
});

// ═══════════════════════════════════════════════════════════
// STATISTICS - إحصائيات متقدمة
// ═══════════════════════════════════════════════════════════

// GET /api/admin/stats/activity-overview - إحصائيات النشاط العامة
router.get('/stats/activity-overview', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [daily] = await db.query(`
      SELECT date, 
        COUNT(DISTINCT user_id) as users_count,
        AVG(total_steps) as avg_steps,
        MAX(total_steps) as max_steps,
        AVG(calories_burned) as avg_calories,
        AVG(distance_km) as avg_distance
      FROM daily_activities
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      GROUP BY date ORDER BY date DESC
    `, [parseInt(days)]);

    res.json({ success: true, data: daily });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching stats' });
  }
});

// GET /api/admin/stats/sleep-overview - إحصائيات النوم العامة
router.get('/stats/sleep-overview', async (req, res) => {
  try {
    const { days = 30 } = req.query;

    const [data] = await db.query(`
      SELECT 
        DATE(FROM_UNIXTIME(start_time/1000)) as date,
        COUNT(*) as sessions_count,
        AVG(duration_minutes) as avg_duration,
        AVG(overall_sleep_quality) as avg_quality,
        AVG(sleep_efficiency) as avg_efficiency
      FROM sleep_sessions
      WHERE is_completed = 1 AND start_time >= ?
      GROUP BY date ORDER BY date DESC
    `, [Date.now() - parseInt(days) * 86400000]);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching sleep stats' });
  }
});

// GET /api/admin/stats/assessment-overview - إحصائيات الاختبارات
router.get('/stats/assessment-overview', async (req, res) => {
  try {
    const [data] = await db.query(`
      SELECT a.id, a.title, a.title_ar, a.category,
        COUNT(DISTINCT s.user_id) as unique_users,
        COUNT(s.id) as total_sessions,
        AVG(s.score_percentage) as avg_score,
        MIN(s.score_percentage) as min_score,
        MAX(s.score_percentage) as max_score
      FROM assessments a
      LEFT JOIN assessment_rotations r ON r.assessment_id = a.id
      LEFT JOIN user_assessment_sessions s ON s.rotation_id = r.id AND s.is_completed = 1
      GROUP BY a.id ORDER BY total_sessions DESC
    `);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching assessment stats' });
  }
});

module.exports = router;
