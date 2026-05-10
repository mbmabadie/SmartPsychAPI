// server.js - Smart Psych API Server
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { success: false, message: 'Too many requests - try again later' },
}));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/admin', require('./routes/admin'));

// ⚠️ TEMPORARY - احذف السطر التالي بعد ما يخلص الـ setup
app.use('/api/_setup', require('./routes/_setup'));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Smart Psych API is running', timestamp: new Date() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.url}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Smart Psych API running on port ${PORT}`);
  console.log(`📋 API: http://localhost:${PORT}/api`);
  console.log(`💚 Health: http://localhost:${PORT}/api/health\n`);
});
