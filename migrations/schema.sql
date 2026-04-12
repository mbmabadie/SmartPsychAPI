-- ═══════════════════════════════════════════════════════════
-- Smart Psych - Database Schema (MySQL)
-- ═══════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS smart_psych CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smart_psych;

-- ═══════════════════════════════════════════════════════════
-- 1. المستخدمين والمصادقة
-- ═══════════════════════════════════════════════════════════

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  age INT,
  gender ENUM('male','female','other'),
  role ENUM('user','admin') DEFAULT 'user',
  is_active TINYINT(1) DEFAULT 1,
  device_info JSON,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role (role)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 2. بيانات النشاط اليومي
-- ═══════════════════════════════════════════════════════════

CREATE TABLE daily_activities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  total_steps INT DEFAULT 0,
  distance_km DOUBLE DEFAULT 0,
  calories_burned DOUBLE DEFAULT 0,
  active_minutes INT DEFAULT 0,
  activity_type VARCHAR(50) DEFAULT 'general',
  intensity_score DOUBLE DEFAULT 0,
  goal_steps INT DEFAULT 10000,
  goal_distance DOUBLE DEFAULT 8.0,
  goal_calories DOUBLE DEFAULT 500.0,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  client_created_at BIGINT,
  client_updated_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_date (user_id, date),
  INDEX idx_user_date (user_id, date),
  INDEX idx_date (date)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 3. بيانات النوم
-- ═══════════════════════════════════════════════════════════

CREATE TABLE sleep_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  client_session_id INT,
  start_time BIGINT NOT NULL,
  end_time BIGINT,
  duration_minutes INT,
  quality_score DOUBLE,
  sleep_type ENUM('manual','automatic') DEFAULT 'automatic',
  confidence ENUM('confirmed','probable','phone_left','uncertain') DEFAULT 'uncertain',
  overall_sleep_quality DOUBLE DEFAULT 0,
  sleep_efficiency DOUBLE DEFAULT 0,
  detection_confidence DOUBLE DEFAULT 0.8,
  total_interruptions INT DEFAULT 0,
  phone_activations INT DEFAULT 0,
  user_confirmation VARCHAR(20) DEFAULT 'pending',
  user_rating INT,
  notes TEXT,
  is_completed TINYINT(1) DEFAULT 0,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  client_created_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_sleep (user_id, start_time),
  INDEX idx_confidence (confidence)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 4. بيانات استخدام الهاتف
-- ═══════════════════════════════════════════════════════════

CREATE TABLE phone_usage_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  app_name VARCHAR(255),
  package_name VARCHAR(255) NOT NULL,
  total_usage_minutes INT DEFAULT 0,
  open_count INT DEFAULT 0,
  category VARCHAR(100),
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  client_created_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_app_date (user_id, package_name, date),
  INDEX idx_user_date (user_id, date)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 5. بيانات الموقع
-- ═══════════════════════════════════════════════════════════

CREATE TABLE location_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  latitude DOUBLE NOT NULL,
  longitude DOUBLE NOT NULL,
  accuracy DOUBLE,
  place_name VARCHAR(255),
  place_type VARCHAR(100),
  mood_impact ENUM('positive','neutral','negative'),
  arrival_time BIGINT NOT NULL,
  departure_time BIGINT,
  duration_minutes INT,
  is_home TINYINT(1) DEFAULT 0,
  is_work TINYINT(1) DEFAULT 0,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  client_created_at BIGINT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_time (user_id, arrival_time)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 6. البيانات البيئية
-- ═══════════════════════════════════════════════════════════

CREATE TABLE environmental_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  sleep_session_id INT,
  timestamp BIGINT NOT NULL,
  light_level DOUBLE,
  noise_level DOUBLE,
  movement_intensity DOUBLE,
  temperature DOUBLE,
  humidity DOUBLE,
  overall_score DOUBLE,
  is_optimal_for_sleep TINYINT(1) DEFAULT 0,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_time (user_id, timestamp)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 7. نظام الاختبارات النفسية
-- ═══════════════════════════════════════════════════════════

-- الاختبارات (الحاويات)
CREATE TABLE assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_ar VARCHAR(255),
  description TEXT,
  description_ar TEXT,
  category VARCHAR(100) DEFAULT 'general',
  scoring_type ENUM('sum','average','weighted','custom') DEFAULT 'sum',
  max_score DOUBLE,
  is_active TINYINT(1) DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_active (is_active),
  INDEX idx_category (category)
) ENGINE=InnoDB;

-- الأسئلة
CREATE TABLE assessment_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  question_text VARCHAR(500) NOT NULL,
  question_text_ar VARCHAR(500),
  question_order INT DEFAULT 0,
  is_required TINYINT(1) DEFAULT 1,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  INDEX idx_assessment (assessment_id),
  INDEX idx_order (assessment_id, question_order)
) ENGINE=InnoDB;

-- خيارات الإجابة
CREATE TABLE question_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_id INT NOT NULL,
  option_text VARCHAR(255) NOT NULL,
  option_text_ar VARCHAR(255),
  option_value INT NOT NULL,
  option_order INT DEFAULT 0,
  emoji VARCHAR(10),
  icon_name VARCHAR(50),
  color_hex VARCHAR(10),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  INDEX idx_question (question_id)
) ENGINE=InnoDB;

-- الدورات (كل أسبوع/شهر الأدمن يحدد شكل العرض)
CREATE TABLE assessment_rotations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  title VARCHAR(255),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_active_dates (is_active, start_date, end_date),
  INDEX idx_assessment (assessment_id)
) ENGINE=InnoDB;

-- أسئلة الدورة (أي أسئلة تظهر وبأي شكل)
-- display_type: radio_list, card_select, emoji_scale, slider_select, image_cards
CREATE TABLE rotation_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  rotation_id INT NOT NULL,
  question_id INT NOT NULL,
  display_type ENUM('radio_list','card_select','emoji_scale','slider_select','image_cards') DEFAULT 'radio_list',
  display_order INT DEFAULT 0,
  FOREIGN KEY (rotation_id) REFERENCES assessment_rotations(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rotation_question (rotation_id, question_id),
  INDEX idx_rotation (rotation_id)
) ENGINE=InnoDB;

-- جلسات إجابة المستخدم
CREATE TABLE user_assessment_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  rotation_id INT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  total_score DOUBLE,
  max_possible_score DOUBLE,
  score_percentage DOUBLE,
  is_completed TINYINT(1) DEFAULT 0,
  synced_from_client TINYINT(1) DEFAULT 0,
  client_session_id INT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (rotation_id) REFERENCES assessment_rotations(id) ON DELETE CASCADE,
  INDEX idx_user (user_id),
  INDEX idx_user_rotation (user_id, rotation_id)
) ENGINE=InnoDB;

-- إجابات المستخدم الفردية
CREATE TABLE user_assessment_responses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  question_id INT NOT NULL,
  selected_option_id INT NOT NULL,
  response_value INT NOT NULL,
  response_time_seconds INT,
  answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES user_assessment_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
  FOREIGN KEY (selected_option_id) REFERENCES question_options(id) ON DELETE CASCADE,
  UNIQUE KEY uq_session_question (session_id, question_id),
  INDEX idx_session (session_id)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 8. سجل المزامنة
-- ═══════════════════════════════════════════════════════════

CREATE TABLE sync_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  sync_type VARCHAR(50) NOT NULL,
  records_synced INT DEFAULT 0,
  status ENUM('success','partial','failed') DEFAULT 'success',
  error_message TEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_type (user_id, sync_type)
) ENGINE=InnoDB;

-- ═══════════════════════════════════════════════════════════
-- 9. ملاحظة: لإنشاء الأدمن الافتراضي، استخدم: npm run seed
-- ═══════════════════════════════════════════════════════════
