// routes/sync.js
const express = require('express');
const db = require('../config/database');
const auth = require('../middleware/auth');

const router = express.Router();

// كل الروابط تحتاج مصادقة
router.use(auth);

// ═══════════════════════════════════════════
// POST /api/sync/all - مزامنة شاملة
// ═══════════════════════════════════════════
router.post('/all', async (req, res) => {
  try {
    const { activities, sleep_sessions, phone_usage, locations, environmental } = req.body;
    const userId = req.user.id;
    const results = {};

    if (activities?.length) {
      results.activities = await syncActivities(userId, activities);
    }
    if (sleep_sessions?.length) {
      results.sleep = await syncSleep(userId, sleep_sessions);
    }
    if (phone_usage?.length) {
      results.phone_usage = await syncPhoneUsage(userId, phone_usage);
    }
    if (locations?.length) {
      results.locations = await syncLocations(userId, locations);
    }
    if (environmental?.length) {
      results.environmental = await syncEnvironmental(userId, environmental);
    }

    // تسجيل المزامنة
    const totalSynced = Object.values(results).reduce((sum, r) => sum + (r.count || 0), 0);
    await db.query(
      'INSERT INTO sync_log (user_id, sync_type, records_synced, status) VALUES (?, ?, ?, ?)',
      [userId, 'full_sync', totalSynced, 'success']
    );

    res.json({ success: true, data: results, total_synced: totalSynced });
  } catch (err) {
    console.error('Sync all error:', err);
    res.status(500).json({ success: false, message: 'Sync error' });
  }
});

// ═══════════════════════════════════════════
// POST /api/sync/activity - مزامنة النشاط
// ═══════════════════════════════════════════
router.post('/activity', async (req, res) => {
  try {
    const { activities } = req.body;
    if (!activities?.length) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await syncActivities(req.user.id, activities);
    res.json({ success: true, data: result.ids, count: result.count });
  } catch (err) {
    console.error('Sync activity error:', err);
    res.status(500).json({ success: false, message: 'Activity sync error' });
  }
});

// ═══════════════════════════════════════════
// POST /api/sync/sleep - مزامنة النوم
// ═══════════════════════════════════════════
router.post('/sleep', async (req, res) => {
  try {
    const { sessions } = req.body;
    if (!sessions?.length) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await syncSleep(req.user.id, sessions);
    res.json({ success: true, data: result.ids, count: result.count });
  } catch (err) {
    console.error('Sync sleep error:', err);
    res.status(500).json({ success: false, message: 'Sleep sync error' });
  }
});

// ═══════════════════════════════════════════
// POST /api/sync/phone-usage - مزامنة استخدام الهاتف
// ═══════════════════════════════════════════
router.post('/phone-usage', async (req, res) => {
  try {
    const { usage_data } = req.body;
    if (!usage_data?.length) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await syncPhoneUsage(req.user.id, usage_data);
    res.json({ success: true, data: result.ids, count: result.count });
  } catch (err) {
    console.error('Sync phone error:', err);
    res.status(500).json({ success: false, message: 'Phone sync error' });
  }
});

// ═══════════════════════════════════════════
// POST /api/sync/location - مزامنة الموقع
// ═══════════════════════════════════════════
router.post('/location', async (req, res) => {
  try {
    const { locations } = req.body;
    if (!locations?.length) {
      return res.json({ success: true, data: [], count: 0 });
    }

    const result = await syncLocations(req.user.id, locations);
    res.json({ success: true, data: result.ids, count: result.count });
  } catch (err) {
    console.error('Sync location error:', err);
    res.status(500).json({ success: false, message: 'Location sync error' });
  }
});

// ═══════════════════════════════════════════
// GET /api/sync/status - حالة المزامنة
// ═══════════════════════════════════════════
router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;

    const [lastSync] = await db.query(
      'SELECT * FROM sync_log WHERE user_id = ? ORDER BY synced_at DESC LIMIT 1',
      [userId]
    );

    const [counts] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM daily_activities WHERE user_id = ?) as activities,
        (SELECT COUNT(*) FROM sleep_sessions WHERE user_id = ?) as sleep,
        (SELECT COUNT(*) FROM phone_usage_entries WHERE user_id = ?) as phone,
        (SELECT COUNT(*) FROM location_visits WHERE user_id = ?) as locations
    `, [userId, userId, userId, userId]);

    res.json({
      success: true,
      data: {
        last_sync: lastSync[0] || null,
        totals: counts[0],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error fetching status' });
  }
});

// ═══════════════════════════════════════════════════════
// Sync Helper Functions
// ═══════════════════════════════════════════════════════

async function syncActivities(userId, activities) {
  const ids = [];
  for (const a of activities) {
    const [result] = await db.query(`
      INSERT INTO daily_activities (user_id, date, total_steps, distance_km, calories_burned, active_minutes, activity_type, intensity_score, goal_steps, goal_distance, goal_calories, client_created_at, client_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_steps = VALUES(total_steps),
        distance_km = VALUES(distance_km),
        calories_burned = VALUES(calories_burned),
        active_minutes = VALUES(active_minutes),
        activity_type = VALUES(activity_type),
        intensity_score = VALUES(intensity_score),
        goal_steps = VALUES(goal_steps),
        goal_distance = VALUES(goal_distance),
        goal_calories = VALUES(goal_calories),
        client_updated_at = VALUES(client_updated_at),
        synced_at = NOW()
    `, [
      userId, a.date, a.total_steps || 0, a.distance || 0, a.calories_burned || 0,
      a.active_minutes || 0, a.activity_type || 'general', a.intensity_score || 0,
      a.goal_steps || 10000, a.goal_distance || 8.0, a.goal_calories || 500.0,
      a.created_at, a.updated_at
    ]);
    ids.push(result.insertId || result.affectedRows);
  }
  return { count: activities.length, ids };
}

async function syncSleep(userId, sessions) {
  const ids = [];
  for (const s of sessions) {
    const [result] = await db.query(`
      INSERT INTO sleep_sessions (user_id, client_session_id, start_time, end_time, duration_minutes, quality_score, sleep_type, confidence, overall_sleep_quality, sleep_efficiency, detection_confidence, total_interruptions, phone_activations, user_confirmation, user_rating, notes, is_completed, client_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId, s.client_id, s.start_time, s.end_time, s.duration_minutes || s.duration,
      s.quality_score, s.sleep_type || 'automatic', s.confidence || 'uncertain',
      s.overall_sleep_quality || 0, s.sleep_efficiency || 0, s.detection_confidence || 0.8,
      s.total_interruptions || 0, s.phone_activations || 0,
      s.user_confirmation || 'pending', s.user_rating, s.notes,
      s.is_completed ? 1 : 0, s.created_at
    ]);
    ids.push(result.insertId);
  }
  return { count: sessions.length, ids };
}

async function syncPhoneUsage(userId, entries) {
  const ids = [];
  for (const e of entries) {
    const [result] = await db.query(`
      INSERT INTO phone_usage_entries (user_id, date, app_name, package_name, total_usage_minutes, open_count, category, client_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_usage_minutes = VALUES(total_usage_minutes),
        open_count = VALUES(open_count),
        synced_at = NOW()
    `, [
      userId, e.date, e.app_name, e.package_name,
      e.total_usage_time || e.total_usage_minutes || 0, e.open_count || 0,
      e.category, e.created_at
    ]);
    ids.push(result.insertId || result.affectedRows);
  }
  return { count: entries.length, ids };
}

async function syncLocations(userId, locations) {
  const ids = [];
  for (const l of locations) {
    const [result] = await db.query(`
      INSERT INTO location_visits (user_id, latitude, longitude, accuracy, place_name, place_type, mood_impact, arrival_time, departure_time, duration_minutes, is_home, is_work, client_created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId, l.latitude, l.longitude, l.accuracy, l.place_name, l.place_type,
      l.mood_impact, l.arrival_time, l.departure_time, l.duration_minutes,
      l.is_home ? 1 : 0, l.is_work ? 1 : 0, l.created_at
    ]);
    ids.push(result.insertId);
  }
  return { count: locations.length, ids };
}

async function syncEnvironmental(userId, entries) {
  const ids = [];
  for (const e of entries) {
    const [result] = await db.query(`
      INSERT INTO environmental_data (user_id, sleep_session_id, timestamp, light_level, noise_level, movement_intensity, temperature, humidity, overall_score, is_optimal_for_sleep)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId, e.sleep_session_id, e.timestamp, e.light_level, e.noise_level,
      e.movement_intensity, e.temperature, e.humidity, e.overall_score,
      e.is_optimal_for_sleep ? 1 : 0
    ]);
    ids.push(result.insertId);
  }
  return { count: entries.length, ids };
}

module.exports = router;
