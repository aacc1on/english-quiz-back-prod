const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const session = require('express-session');
const { generateQuizFromText } = require('./services/aiService');

dotenv.config();

const app = express();

// Detailed logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
  console.log(`[${timestamp}] Headers:`, JSON.stringify(req.headers, null, 2));
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`[${timestamp}] Body:`, JSON.stringify(req.body, null, 2));
  }
  next();
});

// CORS configuration for production
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://english-quiz-front.onrender.com',
      process.env.ALLOWED_ORIGIN
    ].filter(Boolean); // Remove any undefined values
    
    console.log(`[CORS] Request origin: ${origin}`);
    console.log(`[CORS] Allowed origins: ${allowedOrigins.join(', ')}`);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log(`[CORS] Origin ${origin} allowed`);
      callback(null, true);
    } else {
      console.log(`[CORS] Origin ${origin} blocked`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session configuration for production
app.use(session({
  secret: process.env.SESSION_SECRET || 'development-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true
  },
  name: 'quiz.session.id'
}));

let currentQuiz = null;
let quizResults = [];

// Environment check and logging
console.log('=== SERVER STARTUP ===');
console.log(`NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`PORT: ${process.env.PORT || 5000}`);
console.log(`ADMIN_USERNAME: ${process.env.ADMIN_USERNAME ? '***SET***' : '❌ NOT SET'}`);
console.log(`ADMIN_PASSWORD: ${process.env.ADMIN_PASSWORD ? '***SET***' : '❌ NOT SET'}`);
console.log(`OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '***SET***' : '❌ NOT SET'}`);
console.log(`SESSION_SECRET: ${process.env.SESSION_SECRET ? '***SET***' : '❌ NOT SET (using default)'}`);
console.log(`ALLOWED_ORIGIN: ${process.env.ALLOWED_ORIGIN || 'NOT SET'}`);
console.log('======================');

// Health check endpoint
app.get('/', (req, res) => {
  console.log('[ROOT] Root endpoint accessed');
  res.json({ 
    message: 'English Quiz Backend API',
    status: 'Running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    endpoints: {
      health: '/api/health',
      admin_login: '/api/admin/login',
      admin_quiz: '/api/admin/quiz',
      admin_results: '/api/admin/results',
      quiz: '/api/quiz',
      quiz_submit: '/api/quiz/submit'
    }
  });
});

app.get('/api/health', (req, res) => {
  console.log('[HEALTH] Health check requested');
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    quiz_available: currentQuiz ? true : false,
    quiz_count: currentQuiz ? currentQuiz.length : 0,
    results_count: quizResults.length
  });
});

// Admin login
app.post('/api/admin/login', (req, res) => {
  console.log('[LOGIN] Login attempt started');
  
  const { username, password } = req.body;
  
  console.log(`[LOGIN] Username provided: ${username ? 'YES' : 'NO'}`);
  console.log(`[LOGIN] Password provided: ${password ? 'YES' : 'NO'}`);
  console.log(`[LOGIN] Expected username: ${process.env.ADMIN_USERNAME || 'NOT SET'}`);
  console.log(`[LOGIN] Expected password: ${process.env.ADMIN_PASSWORD ? 'SET' : 'NOT SET'}`);
  
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    console.log('[LOGIN] ❌ Admin credentials not configured in environment');
    return res.status(500).json({ error: 'Server configuration error: Admin credentials not set' });
  }
  
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    console.log('[LOGIN] ✅ Login successful');
    console.log(`[LOGIN] Session ID: ${req.sessionID}`);
    return res.json({ success: true });
  }
  
  console.log('[LOGIN] ❌ Invalid credentials');
  res.status(401).json({ error: 'Invalid credentials' });
});

// Middleware for admin routes
function requireAdmin(req, res, next) {
  console.log(`[AUTH] Admin check - Session ID: ${req.sessionID}`);
  console.log(`[AUTH] Is admin: ${req.session.isAdmin || false}`);
  console.log(`[AUTH] Session data:`, JSON.stringify(req.session, null, 2));
  
  if (req.session.isAdmin) {
    console.log('[AUTH] ✅ Admin access granted');
    return next();
  }
  
  console.log('[AUTH] ❌ Admin access denied');
  res.status(403).json({ error: 'Forbidden - Admin access required' });
}

// Admin creates quiz
app.post('/api/admin/quiz', requireAdmin, async (req, res) => {
  console.log('[QUIZ_GENERATION] Starting quiz generation');
  
  try {
    const { text } = req.body;
    
    if (!text) {
      console.log('[QUIZ_GENERATION] ❌ No text provided');
      return res.status(400).json({ error: 'Text is required' });
    }
    
    console.log(`[QUIZ_GENERATION] Text length: ${text.length} characters`);
    console.log(`[QUIZ_GENERATION] Text preview: ${text.substring(0, 100)}...`);
    
    const quiz = await generateQuizFromText(text);
    
    currentQuiz = quiz;
    quizResults = []; // Clear previous results when new quiz is created
    
    console.log(`[QUIZ_GENERATION] ✅ Quiz generated successfully with ${quiz.length} questions`);
    console.log('[QUIZ_GENERATION] Quiz preview:', JSON.stringify(quiz[0], null, 2));
    
    res.json({ 
      quizUrl: '/quiz',
      message: 'Quiz generated successfully',
      questionsCount: quiz.length 
    });
  } catch (error) {
    console.error('[QUIZ_GENERATION] ❌ Error generating quiz:', error.message);
    console.error('[QUIZ_GENERATION] Full error:', error);
    res.status(500).json({ error: error.message });
  }
});

// User gets latest quiz
app.get('/api/quiz', (req, res) => {
  console.log(`[QUIZ_FETCH] Quiz requested - Available: ${currentQuiz ? 'YES' : 'NO'}`);
  console.log(`[QUIZ_FETCH] Quiz length: ${currentQuiz ? currentQuiz.length : 0}`);
  
  res.json({ 
    quiz: currentQuiz || [],
    available: currentQuiz ? true : false,
    count: currentQuiz ? currentQuiz.length : 0
  });
});

// User submits quiz
app.post('/api/quiz/submit', (req, res) => {
  console.log('[QUIZ_SUBMIT] Quiz submission started');
  
  const { name, surname, answers } = req.body;
  
  console.log(`[QUIZ_SUBMIT] Name: ${name || 'NOT PROVIDED'}`);
  console.log(`[QUIZ_SUBMIT] Surname: ${surname || 'NOT PROVIDED'}`);
  console.log(`[QUIZ_SUBMIT] Answers count: ${answers ? answers.length : 0}`);
  console.log(`[QUIZ_SUBMIT] Current quiz available: ${currentQuiz ? 'YES' : 'NO'}`);
  
  if (!name || !surname || !answers) {
    console.log('[QUIZ_SUBMIT] ❌ Missing required fields');
    return res.status(400).json({ error: 'Name, surname, and answers required' });
  }
  
  if (!currentQuiz) {
    console.log('[QUIZ_SUBMIT] ❌ No quiz available');
    return res.status(400).json({ error: 'No quiz available' });
  }
  
  if (answers.length !== currentQuiz.length) {
    console.log('[QUIZ_SUBMIT] ❌ Answer count mismatch');
    return res.status(400).json({ error: 'Answer count does not match question count' });
  }
  
  let score = 0;
  let wrongAnswers = [];
  let detailedResults = [];
  
  currentQuiz.forEach((q, i) => {
    const isCorrect = answers[i] === q.correct;
    if (isCorrect) {
      score++;
      console.log(`[QUIZ_SUBMIT] Question ${i + 1}: CORRECT`);
    } else {
      console.log(`[QUIZ_SUBMIT] Question ${i + 1}: WRONG (answered: ${answers[i]}, correct: ${q.correct})`);
      wrongAnswers.push({
        questionNumber: i + 1,
        question: q.question,
        word: q.word,
        correctAnswer: q.correct,
        userAnswer: answers[i] || 'No answer',
        options: q.options
      });
    }
    
    // Detailed results for admin
    detailedResults.push({
      questionNumber: i + 1,
      question: q.question,
      word: q.word,
      correctAnswer: q.correct,
      userAnswer: answers[i] || 'No answer',
      isCorrect: isCorrect,
      options: q.options
    });
  });
  
  const percentage = Math.round((score / currentQuiz.length) * 100);
  
  const result = { 
    name, 
    surname, 
    score, 
    total: currentQuiz.length,
    percentage: percentage,
    date: new Date().toISOString(),
    detailedResults: detailedResults
  };
  
  quizResults.push(result);
  
  console.log(`[QUIZ_SUBMIT] ✅ Final score: ${score}/${currentQuiz.length} (${percentage}%)`);
  console.log(`[QUIZ_SUBMIT] Wrong answers count: ${wrongAnswers.length}`);
  console.log(`[QUIZ_SUBMIT] Total results stored: ${quizResults.length}`);
  
  res.json({ 
    score, 
    total: currentQuiz.length,
    percentage: percentage,
    wrongAnswers: wrongAnswers,
    message: 'Quiz submitted successfully'
  });
});

// Admin gets results
app.get('/api/admin/results', requireAdmin, (req, res) => {
  console.log(`[RESULTS] Results requested - Count: ${quizResults.length}`);
  res.json({ 
    results: quizResults,
    count: quizResults.length,
    quiz_available: currentQuiz ? true : false
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('[ERROR] Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  console.log(`[404] Route not found: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.path,
    method: req.method 
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`👤 Admin panel: https://english-quiz-front.onrender.com/admin`);
  console.log(`📝 Quiz page: https://english-quiz-front.onrender.com/quiz`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});