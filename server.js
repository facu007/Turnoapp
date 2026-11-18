const http = require('http');
const fs = require('fs');
const path = require('path');
const { INITIAL_DATA } = require('./data.js');

const PORT = process.env.PORT || 3456;
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db.json');

function readDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Error reading db.json, re-initializing:', e.message);
  }
  const initial = JSON.parse(JSON.stringify(INITIAL_DATA));
  writeDb(initial);
  return initial;
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing db.json:', e.message);
  }
}

// Initialize db.json on startup
readDb();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // REST API Endpoints
  if (pathname === '/api/state' && req.method === 'GET') {
    const db = readDb();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(db));
    return;
  }

  if (pathname === '/api/state' && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      const nextState = await parseBody(req);
      if (nextState && nextState.business && Array.isArray(nextState.appointments)) {
        writeDb(nextState);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid state payload' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    const fresh = JSON.parse(JSON.stringify(INITIAL_DATA));
    writeDb(fresh);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, state: fresh }));
    return;
  }

  if (pathname === '/api/export/csv' && req.method === 'GET') {
    const db = readDb();
    const rows = [
      ['ID Turno', 'Fecha', 'Hora', 'Cliente', 'Servicio', 'Especialista', 'Duracion (min)', 'Precio (ARS)', 'Estado']
    ];
    for (const apt of db.appointments || []) {
      rows.push([
        apt.id,
        apt.date,
        apt.time,
        `"${(apt.clientName || '').replace(/"/g, '""')}"`,
        `"${(apt.serviceName || '').replace(/"/g, '""')}"`,
        `"${(apt.specialistName || '').replace(/"/g, '""')}"`,
        apt.duration,
        apt.price,
        apt.status
      ]);
    }
    const csvContent = '\uFEFF' + rows.map((r) => r.join(',')).join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="StudioBellas_Turnos_Nov2026.csv"'
    });
    res.end(csvContent);
    return;
  }

  // Static files & SPA fallback (supports /studiobellas for public booking)
  let filePath = path.join(ROOT, pathname === '/' || pathname === '/studiobellas' ? 'index.html' : pathname);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(ROOT, 'index.html');
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`TurnosApp SaaS Full-Stack corriendo en http://localhost:${PORT}`);
});
