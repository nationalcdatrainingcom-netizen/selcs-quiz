const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ─────────────────────────────────────────────────────────────
// LEAP Quiz — Mentor Success Academy
// Leadership Expression Assessment Profile
// © Mentor Success Academy. All rights reserved.
// Co-Founders: Mary Wardlaw & Rebecca Munlyn
// The LEAP instrument is the exclusive intellectual property
// of Mentor Success Academy. Unauthorized reproduction or
// distribution is strictly prohibited.
// ─────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'results.json');
// Use new env var name with fallback to legacy name so nothing breaks during the transition
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.SELCS_ADMIN_PASSWORD || 'leap2026';

// ── Middleware ──────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ────────────────────────────────
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({ results: [], orgs: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading data:', e);
    return { results: [], orgs: [] };
  }
}

function writeData(data) {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Error writing data:', e);
    return false;
  }
}

// ── Routes ──────────────────────────────────────

// Submit a quiz result
app.post('/api/results', (req, res) => {
  const { name, email, org, role, scores, ranked, pcts, primary, profileKey, profileLabel, isBlend } = req.body;
  if (!name || !email || !scores || !ranked) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const data = readData();
  const existing = data.results.findIndex(r => r.email.toLowerCase() === email.toLowerCase());

  const record = {
    id: existing >= 0 ? data.results[existing].id : uuidv4(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    org: org ? org.trim() : '',
    role: role || '',
    date: new Date().toISOString(),
    scores,
    ranked,
    pcts: pcts || null,
    primary: primary || (ranked && ranked[0]) || null,
    profileKey: profileKey || null,
    profileLabel: profileLabel || null,
    isBlend: typeof isBlend === 'boolean' ? isBlend : null
  };

  if (existing >= 0) {
    record.history = data.results[existing].history || [];
    // Preserve previous record as history entry (most recent first, max 10 kept)
    const prev = { ...data.results[existing] };
    delete prev.history;
    record.history = [prev, ...record.history].slice(0, 10);
    data.results[existing] = record;
  } else {
    record.history = [];
    data.results.push(record);
    // Track orgs
    if (org && !data.orgs.includes(org.trim())) {
      data.orgs.push(org.trim());
    }
  }

  writeData(data);
  res.json({ success: true, record });
});

// Get results by email (self-lookup)
app.get('/api/results/:email', (req, res) => {
  const data = readData();
  const record = data.results.find(
    r => r.email.toLowerCase() === req.params.email.toLowerCase()
  );
  if (!record) return res.status(404).json({ error: 'No results found for that email.' });
  res.json(record);
});

// Admin — get all results (password protected)
app.post('/api/admin/results', (req, res) => {
  const { password, org } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const data = readData();
  let results = data.results;
  if (org) results = results.filter(r => r.org === org);
  // Sort newest first
  results = [...results].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ results, orgs: data.orgs, total: results.length });
});

// Admin — delete a single record
app.delete('/api/admin/results/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const data = readData();
  data.results = data.results.filter(r => r.id !== req.params.id);
  writeData(data);
  res.json({ success: true });
});

// Admin — clear ALL records (with confirmation in the request body)
app.post('/api/admin/clear', (req, res) => {
  const { password, confirm } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  if (confirm !== 'CLEAR_ALL_RECORDS') {
    return res.status(400).json({ error: 'Confirmation phrase missing.' });
  }
  writeData({ results: [], orgs: [] });
  res.json({ success: true });
});

// Admin — export CSV
app.post('/api/admin/export', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const data = readData();
  const rows = [
    ['Name', 'Email', 'Organization', 'Role', 'Date', 'Profile', 'Type',
     'Primary', 'Secondary', 'Third', 'Fourth',
     'Driver %', 'Inspirer %', 'Sustainer %', 'Cultivator %',
     'Driver Score', 'Inspirer Score', 'Sustainer Score', 'Cultivator Score'],
    ...data.results.map(r => [
      r.name, r.email, r.org, r.role,
      new Date(r.date).toLocaleDateString(),
      r.profileLabel || '',
      r.isBlend === true ? 'Blend' : (r.isBlend === false ? 'Pure' : ''),
      r.ranked[0], r.ranked[1], r.ranked[2], r.ranked[3],
      r.pcts ? r.pcts.D : '', r.pcts ? r.pcts.I : '', r.pcts ? r.pcts.S : '', r.pcts ? r.pcts.C : '',
      r.scores.D, r.scores.I, r.scores.S, r.scores.C
    ])
  ];
  const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="LEAP_Results.csv"');
  res.send(csv);
});

// Health check
app.get('/api/health', (req, res) => res.json({
  status: 'ok',
  app: 'LEAP Quiz',
  version: '2.0.0'
}));

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ LEAP Quiz running on http://localhost:${PORT}`);
  console.log(`   Leadership Expression Assessment Profile`);
  console.log(`   Mentor Success Academy`);
});
