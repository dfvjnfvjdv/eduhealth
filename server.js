// ============================================================
//  MedAI Backend — Node.js + Express
//  File: server.js
// ============================================================

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');
const path        = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));           // security headers
app.use(cors());             // allow cross-origin requests
app.use(express.json());     // parse JSON bodies
app.use(express.static(path.join(__dirname, 'public'))); // serve frontend from /public

// Rate limiter — max 100 requests per 15 min per IP
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

// ── In-memory "database" (replace with MongoDB/PostgreSQL) ──
let patients = [
  { id: 1, name: 'Ananya Sharma', age: 42, department: 'Cardiology', room: '204', vitals: { hr: 74, spo2: 98, bp: '118/76' }, status: 'stable' },
  { id: 2, name: 'Rajan Mehta',   age: 58, department: 'Endocrinology', room: '108', vitals: { hr: 88, spo2: 97, bp: '130/82' }, status: 'alert' },
  { id: 3, name: 'Meena Iyer',    age: 65, department: 'Pulmonology', room: '312', vitals: { hr: 92, spo2: 94, bp: '125/80' }, status: 'monitoring' },
  { id: 4, name: 'Karan Verma',   age: 35, department: 'ICU', room: '002', vitals: { hr: 110, spo2: 91, bp: '90/60' }, status: 'critical' },
];

// ── Symptom → Diagnosis Map (simplified NLP) ───────────────
const symptomMap = {
  headache:  { conditions: ['Tension Headache (68%)', 'Migraine (22%)', 'Sinusitis (7%)', 'Hypertension (3%)'], recommendation: 'Rest, hydration. Consider ibuprofen. Refer to neurology if recurring.' },
  fever:     { conditions: ['Viral Infection (55%)', 'Bacterial Infection (25%)', 'COVID-19 (12%)', 'Malaria (8%)'], recommendation: 'Monitor temperature every 4h. Paracetamol for comfort. Blood panel recommended.' },
  chest:     { conditions: ['GERD/Acid Reflux (40%)', 'Musculoskeletal (25%)', 'Angina (20%)', 'Pulmonary Embolism (15%)'], recommendation: '⚠ URGENT: ECG required. Rule out cardiac cause immediately. Refer to cardiology.' },
  cough:     { conditions: ['URTI (50%)', 'Asthma (20%)', 'Allergic Rhinitis (18%)', 'GERD (12%)'], recommendation: 'Chest X-ray if persistent >3 weeks. Spirometry if wheeze present. Antihistamine trial.' },
  fatigue:   { conditions: ['Iron Deficiency Anaemia (35%)', 'Hypothyroidism (28%)', 'Depression (20%)', 'Diabetes (17%)'], recommendation: 'CBC, TFT, blood glucose, Vitamin D. Sleep hygiene assessment. Mental health screen (PHQ-9).' },
  default:   { conditions: ['Further assessment required'], recommendation: 'Please provide more detail. A full history and physical exam is recommended.' },
};

function analyzeSymptoms(symptomText) {
  const s = symptomText.toLowerCase();
  if (s.includes('headache') || s.includes('head pain')) return symptomMap.headache;
  if (s.includes('fever') || s.includes('temperature') || s.includes('chills')) return symptomMap.fever;
  if (s.includes('chest') || s.includes('heart')) return symptomMap.chest;
  if (s.includes('cough') || s.includes('cold')) return symptomMap.cough;
  if (s.includes('tired') || s.includes('fatigue') || s.includes('weak')) return symptomMap.fatigue;
  return symptomMap.default;
}

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date() });
});

// ── GET all patients ─────────────────────────────────────────
app.get('/api/patients', (req, res) => {
  res.json({ success: true, count: patients.length, data: patients });
});

// ── GET single patient ────────────────────────────────────────
app.get('/api/patients/:id', (req, res) => {
  const patient = patients.find(p => p.id === parseInt(req.params.id));
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
  res.json({ success: true, data: patient });
});

// ── POST add new patient ──────────────────────────────────────
app.post('/api/patients', (req, res) => {
  const { name, age, department, room } = req.body;
  if (!name || !age || !department) {
    return res.status(400).json({ success: false, message: 'name, age and department are required' });
  }
  const newPatient = {
    id: patients.length + 1,
    name, age, department,
    room: room || 'TBD',
    vitals: { hr: null, spo2: null, bp: null },
    status: 'new',
    createdAt: new Date(),
  };
  patients.push(newPatient);
  res.status(201).json({ success: true, data: newPatient });
});

// ── PUT update vitals ─────────────────────────────────────────
app.put('/api/patients/:id/vitals', (req, res) => {
  const patient = patients.find(p => p.id === parseInt(req.params.id));
  if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

  const { hr, spo2, bp } = req.body;
  patient.vitals = { hr, spo2, bp };

  // Simple rule-based AI alert logic
  let alerts = [];
  if (hr  && (hr < 50 || hr > 120))  alerts.push('Abnormal heart rate');
  if (spo2 && spo2 < 94)             alerts.push('Low oxygen saturation');
  patient.status = alerts.length > 0 ? 'alert' : 'stable';

  res.json({ success: true, data: patient, alerts });
});

// ── DELETE patient ────────────────────────────────────────────
app.delete('/api/patients/:id', (req, res) => {
  const idx = patients.findIndex(p => p.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Patient not found' });
  patients.splice(idx, 1);
  res.json({ success: true, message: 'Patient removed' });
});

// ── POST AI Symptom Analysis ──────────────────────────────────
app.post('/api/ai/analyze', (req, res) => {
  const { symptoms } = req.body;
  if (!symptoms || symptoms.trim() === '') {
    return res.status(400).json({ success: false, message: 'symptoms field is required' });
  }

  const result = analyzeSymptoms(symptoms);

  res.json({
    success: true,
    input: symptoms,
    analysis: {
      differentialDiagnosis: result.conditions,
      recommendation: result.recommendation,
      urgency: result.conditions[0]?.includes('URGENT') ? 'high' : 'normal',
      disclaimer: 'This is an AI-generated preliminary assessment. Not a substitute for clinical evaluation.',
      analyzedAt: new Date(),
    }
  });
});

// ── POST Newsletter subscribe ─────────────────────────────────
app.post('/api/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Valid email required' });
  }
  // In production: save to DB or send to email service (Mailchimp, SendGrid etc.)
  console.log(`New subscriber: ${email}`);
  res.json({ success: true, message: 'Subscribed successfully!' });
});

// ── GET Dashboard stats ───────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const statusCounts = patients.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    success: true,
    data: {
      totalPatients:    patients.length,
      diagnosticAccuracy: 97.4,
      timeSavedPerDay: '2 hours',
      alertCount:       patients.filter(p => p.status === 'alert' || p.status === 'critical').length,
      statusBreakdown:  statusCounts,
    }
  });
});

// ── Serve frontend for any unmatched route (SPA fallback) ────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏥 MedAI Backend running on http://localhost:${PORT}`);
  console.log(`📋 API endpoints:`);
  console.log(`   GET  /api/health`);
  console.log(`   GET  /api/patients`);
  console.log(`   POST /api/patients`);
  console.log(`   PUT  /api/patients/:id/vitals`);
  console.log(`   POST /api/ai/analyze`);
  console.log(`   GET  /api/stats\n`);
});
