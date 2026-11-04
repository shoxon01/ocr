// Kichik mahalliy server (qo‘shimcha paketlarsiz). Faqat shu kompyuterdan ochiladi (127.0.0.1).
// Vazifasi: fayllarni berish va (faqat foydalanuvchi so‘rasa) tarjima so‘rovini Google'ga uzatish.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 8765);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Onlayn tarjima: matn Google tarjima serveriga yuboriladi (ilova buni oldindan so‘raydi).
async function translate(body) {
  const { sl = 'auto', tl, q } = JSON.parse(body);
  if (!tl || typeof q !== 'string' || !q.trim()) throw new Error('Noto‘g‘ri so‘rov');
  if (q.length > 6000) throw new Error('Matn juda uzun');
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(q),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('Tarjima serveri javobi: ' + r.status);
  const data = await r.json();
  return (data[0] || []).map((s) => s[0] || '').join('');
}

function readBody(req, limit = 40000) {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > limit) { fail(new Error('Juda katta')); req.destroy(); }
    });
    req.on('end', () => ok(s));
    req.on('error', fail);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/api/translate') {
      try {
        const text = await translate(await readBody(req));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT) || file.includes(`${ROOT}\\_tmp`) || /[\\/](server\.mjs|README\.md)$/i.test(file)) {
      res.writeHead(404); res.end('Topilmadi'); return;
    }
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': file.includes('vendor') ? 'public, max-age=86400' : 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('Topilmadi');
  }
});

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE'
    ? `Port ${PORT} band. Ilova allaqachon ochiq bo‘lishi mumkin: http://localhost:${PORT}`
    : e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Skaner OCR ishlayapti: http://localhost:${PORT}  (to‘xtatish: Ctrl+C)`);
});
