// Skaner OCR — pdf.js (sahifa → rasm) + Tesseract.js (OCR) + tarjima + kamera.
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { detectColumns, findFigures, assembleColumn, fixPhysics, enhance } from './layout.js';
import { askAI, aiToPage } from './ai.js';
import { initTestPrep } from './testprep.js';
import { openFigEditor } from './figedit.js';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', location.href).href;

const $ = (id) => document.getElementById(id);
const S = {
  pages: [],          // {id, n, file, label, kind:'pdf'|'img', doc, index, blob, selected, status, text, trans, conf, err}
  nextN: 1, nextId: 1,
  running: false, cancel: false, workers: [],
  cameraShots: 0,
  onlineOk: false,
};

function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) if (c) e.append(c);
  return e;
}
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => { const s = Math.round(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };
const pageById = (id) => S.pages.find((p) => p.id === id);

// ---------------------------------------------------------------- fayllar
async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  $('fileInfo').textContent = 'Fayllar o‘qilmoqda…';
  let added = 0;
  for (const f of list) {
    try {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const doc = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        for (let i = 1; i <= doc.numPages; i++) {
          S.pages.push({ id: S.nextId++, n: S.nextN++, file: f.name, label: `${i}-bet`, kind: 'pdf', doc, index: i, selected: true, status: 'idle', text: '', trans: '' });
          added++;
        }
      } else if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(f.name)) {
        addImageBlob(f, f.name);
        added++;
      } else {
        $('fileInfo').textContent = `“${f.name}” qo‘llab-quvvatlanmaydi (faqat PDF va rasm).`;
      }
    } catch (e) {
      console.error(e);
      alert(`“${f.name}” ochilmadi: ${e.message || e}`);
    }
  }
  $('fileInfo').textContent = `Jami ${S.pages.length} sahifa.`;
  renderPages();
}

function addImageBlob(blob, name) {
  S.pages.push({ id: S.nextId++, n: S.nextN++, file: name, label: name, kind: 'img', blob, selected: true, status: 'idle', text: '', trans: '' });
}

// ---------------------------------------------------------------- sahifani rasmga aylantirish
async function renderToCanvas(page, longSide, thumb = false) {
  if (page.kind === 'pdf') {
    const p = await page.doc.getPage(page.index);
    const vp1 = p.getViewport({ scale: 1 });
    let scale = longSide / Math.max(vp1.width, vp1.height);
    if (!thumb) scale = Math.min(scale, 5);
    const vp = p.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise; // 'print' — requestAnimationFrame ishlatmaydi: boshqa oynada ham qotmaydi
    p.cleanup();
    return c;
  }
  const bmp = await createImageBitmap(page.blob, { imageOrientation: 'from-image' });
  const long = Math.max(bmp.width, bmp.height);
  // Kichik rasmni kattalashtiramiz (OCR uchun yaxshi), juda kattasini kichraytiramiz
  const target = Math.min(Math.max(long, longSide * 0.7), longSide);
  const scale = (thumb ? longSide : target) / long;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}
const freeCanvas = (c) => { if (c) { c.width = 0; c.height = 0; } };

// ---------------------------------------------------------------- sahifalar ro‘yxati
const io = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    io.unobserve(en.target);
    const page = pageById(Number(en.target.dataset.id));
    if (!page) continue;
    renderToCanvas(page, 150, true).then((c) => {
      const th = en.target.querySelector('.th');
      th.replaceChildren(c);
    }).catch(() => {});
  }
}, { root: $('pages'), rootMargin: '300px' });

function renderPages() {
  const box = $('pages');
  io.disconnect();
  box.replaceChildren(...S.pages.map((p) => {
    const cb = el('input', { type: 'checkbox', 'aria-label': `${p.n}-sahifani tanlash` });
    cb.checked = p.selected;
    cb.addEventListener('change', () => { p.selected = cb.checked; card.classList.toggle('on', p.selected); updateSel(); });
    const card = el('div', { class: `pg ${p.selected ? 'on' : ''} ${p.status}`, 'data-id': p.id }, [
      el('span', { class: 'dot' }),
      el('div', { class: 'th', title: 'Katta ko‘rish', onclick: () => openView(p) }, el('small', { class: 'muted', text: '…' })),
      el('div', { class: 'cap' }, [cb, el('b', { text: String(p.n) }), el('small', { text: p.kind === 'pdf' ? `${p.file} · ${p.label}` : p.file }),
        el('button', { class: 'del', title: 'Olib tashlash', onclick: () => removePage(p.id), text: '×' })]),
    ]);
    io.observe(card);
    return card;
  }));
  updateSel();
}

function markCard(p) {
  const c = $('pages').querySelector(`[data-id="${p.id}"]`);
  if (c) c.className = `pg ${p.selected ? 'on' : ''} ${p.status}`;
}

function removePage(id) {
  if (S.running) return;
  S.pages = S.pages.filter((p) => p.id !== id);
  renderPages(); renderResults();
}

function updateSel() {
  const n = S.pages.filter((p) => p.selected).length;
  $('selCount').textContent = S.pages.length ? `(${n} / ${S.pages.length} tanlangan)` : '';
  $('btnRun').disabled = S.running || n === 0;
}

function setSelection(fn) {
  S.pages.forEach((p) => (p.selected = fn(p)));
  document.querySelectorAll('#pages .pg').forEach((c) => {
    const p = pageById(Number(c.dataset.id));
    c.querySelector('input').checked = p.selected;
    markCard(p);
  });
  updateSel();
}

function parseRange(s) {
  const set = new Set();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`“${part}” tushunarsiz`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  }
  return set;
}

async function openView(p) {
  const dlg = $('viewDlg');
  $('viewBox').replaceChildren(el('div', { class: 'hint', text: 'Yuklanmoqda…' }));
  dlg.showModal();
  try {
    const c = await renderToCanvas(p, 1600);
    $('viewBox').replaceChildren(c);
  } catch (e) { $('viewBox').textContent = 'Ko‘rsatib bo‘lmadi: ' + e.message; }
}

// ---------------------------------------------------------------- OCR
function getAiKeys() {
  return [...document.querySelectorAll('#aiKeys input')].map((i) => i.value.trim()).filter(Boolean);
}
function addAiRow(value) {
  const box = $('aiKeys');
  const inp = el('input', { type: 'password', placeholder: 'API kalit (AIza… yoki sk-ant-…)', autocomplete: 'off', 'aria-label': 'API kalit' });
  inp.value = value || '';
  const row = el('div', { class: 'airow' }, [el('b', { class: 'ainame' }), inp, el('button', { type: 'button', class: 'small', text: '×', title: 'Bu AI ni olib tashlash', onclick: () => { row.remove(); renumberAi(); } })]);
  box.append(row);
  renumberAi();
}
function renumberAi() {
  const rows = [...document.querySelectorAll('#aiKeys .airow')];
  rows.forEach((r, i) => { r.querySelector('.ainame').textContent = `AI ${i + 1}`; r.querySelector('button').hidden = rows.length === 1; });
}

function selectedLangs() {
  return [...document.querySelectorAll('#langs input:checked')].map((i) => i.value);
}

async function makeWorker(langs, psm, onLog) {
  const abs = (p) => new URL(p, location.href).href;
  const w = await Tesseract.createWorker(langs, 1, {
    workerPath: abs('vendor/tesseract/worker.min.js'),
    corePath: abs('vendor/tesseract/core'),
    langPath: abs('vendor/tesseract/lang'),
    gzip: true,
    workerBlobURL: false,
    logger: onLog,
  });
  await w.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1', user_defined_dpi: '300' });
  return w;
}

// o` g` kabi belgilarni to‘g‘ri o‘zbek tutuq belgisiga (ʻ) almashtiradi (faqat o‘zbek lotin tanlanganda)
const fixUz = (t) => t.replace(/([oOgG])[`´’‘'](?=\p{L}|\s|$)/gu, '$1ʻ');
const cleanText = (t, langs = []) => {
  t = t.replace(/\r/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return langs.includes('uzb') ? fixUz(t) : t;
};

const toBlob = (c, type = 'image/png', q) => new Promise((ok) => c.toBlob(ok, type, q));

// Bir sahifani o‘qiydi: ustunlarga bo‘ladi, har ustunni alohida o‘qiydi, chizmalarni ajratadi.
// AI rejimi: sahifa rasmi AI ga yuboriladi, javobdan matn va chizma qutilari olinadi.
async function aiPage(canvas, o) {
  const long = Math.max(canvas.width, canvas.height), k = Math.min(1, 2400 / long);
  const sc = document.createElement('canvas');
  sc.width = Math.round(canvas.width * k); sc.height = Math.round(canvas.height * k);
  sc.getContext('2d', { alpha: false }).drawImage(canvas, 0, 0, sc.width, sc.height);
  const blob = await toBlob(sc, 'image/jpeg', 0.9);
  freeCanvas(sc);
  const b64 = btoa([...new Uint8Array(await blob.arrayBuffer())].reduce((s, b, i, a) => (i % 8192 === 0 ? s + String.fromCharCode(...a.slice(i, i + 8192)) : s), ''));
  const res = await askAI(o.aiKey, b64);
  const page = aiToPage(res);
  const figs = [];
  const W = canvas.width, H = canvas.height;
  for (const b of page.boxes) {
    const padX = 0.006 * W, padY = 0.006 * H;
    const x0 = Math.max(0, Math.round(b.x0 * W - padX)), y0 = Math.max(0, Math.round(b.y0 * H - padY));
    const x1 = Math.min(W, Math.round(b.x1 * W + padX)), y1 = Math.min(H, Math.round(b.y1 * H + padY));
    const fc = document.createElement('canvas');
    fc.width = x1 - x0; fc.height = y1 - y0;
    fc.getContext('2d', { alpha: false }).drawImage(canvas, x0, y0, fc.width, fc.height, 0, 0, fc.width, fc.height);
    const fb = await toBlob(fc);
    figs.push({ n: b.n, blob: fb, url: URL.createObjectURL(fb), w: fc.width, h: fc.height, box: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } });
    freeCanvas(fc);
  }
  return { text: page.text, conf: null, figs, ai: true };
}

async function ocrPage(w, origCanvas, langs, o) {
  if (o.ai) return aiPage(origCanvas, o);
  const canvas = o.enhance ? enhance(origCanvas) : origCanvas;
  try { return await ocrPageInner(w, canvas, origCanvas, langs, o); } finally { if (canvas !== origCanvas) freeCanvas(canvas); }
}

async function ocrPageInner(w, canvas, origCanvas, langs, o) {
  const finish = (text) => (o.physics ? fixPhysics(cleanText(text, langs), langs) : cleanText(text, langs));
  if (!o.figures && o.cols === 1 && o.cut === 0) {
    const r = await w.recognize(canvas);
    return { text: finish(r.data.text), conf: Math.round(r.data.confidence), figs: [] };
  }
  const H = canvas.height;
  const top = Math.round(H * o.cut), ch = Math.round(H * (1 - 2 * o.cut));
  const cols = detectColumns(origCanvas, { forced: o.cols, topCut: o.cut, botCut: o.cut });   // ustun va chizma qidirish — asl rasmda
  const parts = [], figs = [], layoutLines = [];
  let confSum = 0, wSum = 0, marker = 1;
  for (const col of cols) {
    if (S.cancel) throw new Error('to‘xtatildi');
    const cw = col.x1 - col.x0;
    const cc = document.createElement('canvas');
    cc.width = cw; cc.height = ch;
    const ctx = cc.getContext('2d', { alpha: false });
    ctx.drawImage(canvas, col.x0, top, cw, ch, 0, 0, cw, ch);
    const oc = document.createElement('canvas');
    oc.width = cw; oc.height = ch;
    oc.getContext('2d', { alpha: false }).drawImage(origCanvas, col.x0, top, cw, ch, 0, 0, cw, ch);
    try {
      const r = await w.recognize(cc);
      const ws = (r.data.lines || []).flatMap((l) => (l.words || []).map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox, lineConf: l.confidence })));
      const fb = o.figures ? findFigures(oc, ws) : [];
      const asm = assembleColumn(r.data, fb, marker);
      for (let i = 0; i < fb.length; i++) {
        const f = fb[i], fw = Math.round(f.x1 - f.x0), fh = Math.round(f.y1 - f.y0);
        const fc = document.createElement('canvas');
        fc.width = fw; fc.height = fh;
        fc.getContext('2d', { alpha: false }).drawImage(oc, f.x0, f.y0, fw, fh, 0, 0, fw, fh);
        const blob = await toBlob(fc);
        freeCanvas(fc);
        figs.push({ n: marker + i, blob, url: URL.createObjectURL(blob), w: fw, h: fh, box: { x0: (col.x0 + f.x0) / origCanvas.width, y0: (top + f.y0) / H, x1: (col.x0 + f.x1) / origCanvas.width, y1: (top + f.y1) / H } });
      }
      marker += fb.length;
      for (const ln of asm.lines) layoutLines.push({ text: ln.text, y0: (top + ln.y0) / H, y1: (top + ln.y1) / H, cx0: col.x0 / origCanvas.width, cx1: col.x1 / origCanvas.width });
      if (asm.text.trim()) parts.push(asm.text);
      confSum += asm.confSum; wSum += asm.wSum;
    } finally { freeCanvas(cc); freeCanvas(oc); }
  }
  return { text: finish(parts.join('\n\n')), conf: wSum ? Math.round(confSum / wSum) : 0, figs, layout: layoutLines };
}

async function runOcr(list) {
  if (S.running || !list.length) return;
  const langs = selectedLangs();
  if (!langs.length) { alert('Kamida bitta til tanlang.'); return; }
  const side = Number($('quality').value), psm = $('psm').value;
  const laneN = Math.min($('engine').value === 'ai' ? Math.max(1, getAiKeys().length) : Number($('lanes').value), list.length);
  const opts = {
    figures: $('optFigs').checked, physics: $('optPhys').checked,
    cols: Number($('cols').value), cut: Number($('cut').value) / 100,
    enhance: $('optEnh').checked,
    ai: $('engine').value === 'ai', aiKeys: getAiKeys(),
  };
  if (opts.ai) {
    if (!opts.aiKeys.length) { alert('AI rejimi uchun API kalit kiriting (Google AI Studio yoki Anthropic).'); return; }
    localStorage.setItem('skaner_ai_keys', JSON.stringify(opts.aiKeys));
    if (!S.aiOk && !confirm('AI rejimida sahifa rasmlari Google (Gemini) yoki Anthropic (Claude) serveriga yuboriladi. Davom etamizmi?')) return;
    S.aiOk = true;
  }

  S.running = true; S.cancel = false; S.workers = [];
  setBusy(true);
  list.forEach((p) => { p.status = 'wait'; p.err = ''; markCard(p); });
  renderResults();

  const queue = [...list];
  // AI rejimi: sahifalar AI lar orasida navbat bilan bo‘linadi (1-AI: 1, 3, 5…; 2-AI: 2, 4, 6…)
  const laneQ = opts.ai ? Array.from({ length: laneN }, () => []) : null;
  if (laneQ) list.forEach((p, i) => laneQ[i % laneN].push(p));
  const dead = new Set();
  let busy = 0;
  let done = 0;
  const t0 = Date.now();
  let firstDone = false;
  const progress = () => {
    const frac = done / list.length;
    $('bar').style.width = `${Math.round(frac * 100)}%`;
    let txt = `${done} / ${list.length} sahifa · ${fmtTime(Date.now() - t0)}`;
    if (done > 0 && done < list.length) txt += ` · taxminan ${fmtTime(((Date.now() - t0) / done) * (list.length - done))} qoldi`;
    $('progText').textContent = txt;
  };
  $('progText').textContent = opts.ai ? 'AI ga yuborilmoqda…' : 'Til ma‘lumotlari yuklanmoqda…'; $('bar').style.width = '0%';

  const lane = async (li) => {
    let cur = null;
    const w = opts.ai ? null : await makeWorker(langs, psm, (m) => {
      if (m.status === 'recognizing text' && cur) {
        const s = document.querySelector(`#results [data-id="${cur.id}"] .st`);
        if (s) s.textContent = `o‘qilmoqda ${Math.round(m.progress * 100)}%`;
      }
    });
    if (w) S.workers.push(w);
    while (!S.cancel) {
      const p = (laneQ ? laneQ[li] : queue).shift();
      if (!p) {
        if (laneQ && busy > 0 && !S.cancel) { await new Promise((r) => setTimeout(r, 300)); continue; }   // boshqa AI sahifani qaytarishi mumkin
        break;
      }
      busy++;
      cur = p; p.status = 'busy'; markCard(p); updateCardHead(p);
      let canvas;
      try {
        canvas = await renderToCanvas(p, side);
        const res = await ocrPage(w, canvas, langs, laneQ ? { ...opts, aiKey: opts.aiKeys[li] } : opts);
        (p.figs || []).forEach((f) => URL.revokeObjectURL(f.url));
        p.text = res.text; p.conf = res.conf; p.figs = res.figs; p.ai = !!res.ai; p.aiName = res.ai ? `AI ${li + 1}` : ''; p.layout = res.layout || null; p.status = 'done';
      } catch (e) {
        if (S.cancel) { p.status = 'idle'; }
        else if (laneQ && [401, 403, 429].includes(e.status) && laneN - dead.size > 1) {
          // bu AI ishlamayapti (limit yoki kalit xato): sahifalari boshqa AI larga o‘tadi
          dead.add(li);
          const others = laneQ.map((_, i) => i).filter((i) => !dead.has(i));
          [p, ...laneQ[li].splice(0)].forEach((x, k) => { x.status = 'wait'; laneQ[others[k % others.length]].push(x); markCard(x); updateCardHead(x); });
          $('progText').textContent = `AI ${li + 1} ishlamadi (${e.status}) — sahifalari boshqa AI ga berildi`;
          p.status = 'wait';
        } else { p.status = 'error'; p.err = String(e.message || e); console.error(e); }
      } finally { freeCanvas(canvas); busy--; }
      if (dead.has(li)) { cur = null; break; }
      cur = null;
      if (p.status === 'done' || p.status === 'error') done++;
      firstDone = true;
      markCard(p); fillCard(p); progress();
      await new Promise((r) => setTimeout(r, 0)); // interfeys qotmasligi uchun
    }
  };

  try {
    await Promise.all(Array.from({ length: laneN }, (_, i) => lane(i)));
  } catch (e) {
    console.error(e);
    if (!S.cancel) alert('OCR boshlanmadi: ' + (e.message || e));
  } finally {
    await Promise.allSettled(S.workers.map((w) => w.terminate()));
    S.workers = [];
    list.forEach((p) => { if (p.status === 'wait' || p.status === 'busy') { p.status = 'idle'; markCard(p); updateCardHead(p); } });
    S.running = false;
    setBusy(false);
    $('progText').textContent = (S.cancel ? 'To‘xtatildi. ' : 'Tayyor. ') + `${done} / ${list.length} sahifa · ${fmtTime(Date.now() - t0)}`;
    $('bar').style.width = `${Math.round((done / list.length) * 100)}%`;
    updateExportButtons();
  }
}

function setBusy(b) {
  $('btnRun').hidden = b; $('btnStop').hidden = !b; $('progWrap').hidden = false;
  $('btnFiles').disabled = $('btnCam').disabled = b;
  updateSel();
  updateExportButtons();
}

// ---------------------------------------------------------------- natija kartalari
function statusText(p) {
  if (p.status === 'wait') return 'navbatda';
  if (p.status === 'busy') return 'o‘qilmoqda…';
  if (p.status === 'error') return 'xato: ' + p.err;
  if (p.status === 'done') return p.text ? (p.ai ? `${p.aiName || 'AI'} o‘qidi — tekshirib chiqing` : `ishonch ${p.conf}%`) : 'matn topilmadi';
  return '';
}

function updateCardHead(p) {
  const c = document.querySelector(`#results [data-id="${p.id}"]`);
  if (!c) return;
  const st = c.querySelector('.st');
  st.textContent = statusText(p);
  const low = p.status === 'done' && !p.ai && p.conf < 70;
  st.className = 'st' + (p.status === 'error' ? ' err' : low ? ' low' : '');
  c.classList.toggle('low', low);
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(Math.max(ta.scrollHeight + 4, 60), 700) + 'px'; }

function fillCard(p) {
  const c = document.querySelector(`#results [data-id="${p.id}"]`);
  if (!c) return;
  updateCardHead(p);
  const ta = c.querySelector('textarea.orig');
  if (document.activeElement !== ta) { ta.value = p.text; autosize(ta); }
  showFigs(p);
  showTrans(p);
}

function showTrans(p) {
  const c = document.querySelector(`#results [data-id="${p.id}"]`);
  if (!c) return;
  const ta = c.querySelector('textarea.tr'), lbl = c.querySelector('.lbl');
  ta.hidden = lbl.hidden = !p.trans;
  if (p.trans && document.activeElement !== ta) { ta.value = p.trans; autosize(ta); }
}

const MARKER = /^\[Rasm (\d+)\]$/;
const figCtx = { el: null, render: (p, side) => renderToCanvas(p, side), toBlob: (c) => toBlob(c), changed: (p) => { fillCard(p); updateExportButtons(); } };

// Ajratilgan rasmlar (chizmalar): kichik ko‘rinish, saqlash va olib tashlash
function showFigs(p) {
  const box = document.querySelector(`#results [data-id="${p.id}"] .figs`);
  if (!box) return;
  const figs = p.figs || [];
  box.hidden = !figs.length;
  box.replaceChildren(...figs.map((f) => el('figure', { class: 'fig' }, [
    el('img', { src: f.url, alt: `Rasm ${f.n}`, title: 'Katta ko‘rish', onclick: () => window.open(f.url, '_blank') }),
    el('figcaption', {}, [
      el('span', { text: `Rasm ${f.n}` }),
      el('button', { class: 'small', text: 'Saqlash', onclick: () => download(f.blob, figName(p, f)) }),
      el('button', { class: 'small', text: '×', title: 'Bu rasm chizma emas — olib tashlash', onclick: () => removeFig(p, f) }),
    ]),
  ])));
}
const figName = (p, f) => `${baseName()}-sahifa${String(p.n).padStart(3, '0')}-rasm${f.n}.png`;

function removeFig(p, f) {
  p.figs = p.figs.filter((x) => x !== f);
  URL.revokeObjectURL(f.url);
  p.text = p.text.replace(new RegExp(`\\n*\\[Rasm ${f.n}\\]\\n*`), '\n\n').trim();
  fillCard(p); updateExportButtons();
}

function makeCard(p) {
  const orig = el('textarea', { class: 'orig', spellcheck: 'false', 'aria-label': `${p.n}-sahifa matni` });
  const tr = el('textarea', { class: 'tr', spellcheck: 'false', hidden: true, 'aria-label': `${p.n}-sahifa tarjimasi` });
  orig.addEventListener('input', () => { p.text = orig.value; autosize(orig); updateExportButtons(); });
  tr.addEventListener('input', () => { p.trans = tr.value; autosize(tr); });
  const card = el('div', { class: 'card', 'data-id': p.id }, [
    el('div', { class: 'head' }, [
      el('b', { text: `Sahifa ${p.n}` }), el('span', { class: 'st' }), el('span', { class: 'sp' }),
      el('button', { class: 'small', text: 'Rasmlarni tuzatish', title: 'Rasm chegarasini o‘zgartirish, yangi rasm maydonini belgilash', onclick: () => openFigEditor(figCtx, p) }),
      el('button', { class: 'small', text: 'Qayta o‘qish', onclick: () => runOcr([p]) }),
      el('button', { class: 'small', text: 'Nusxa', onclick: (e) => copyText(p.text, e.target) }),
    ]),
    orig,
    el('div', { class: 'figs', hidden: true }),
    el('div', { class: 'lbl', hidden: true, text: 'Tarjima' }),
    tr,
  ]);
  return card;
}

function renderResults() {
  const shown = S.pages.filter((p) => p.status !== 'idle' || p.text);
  const box = $('results');
  if (!shown.length) {
    box.replaceChildren(el('div', { class: 'empty', text: 'Natija shu yerda chiqadi. Chapdan fayl tanlang yoki kamera bilan suratga oling.' }));
    return;
  }
  box.replaceChildren(...shown.map((p) => { const c = makeCard(p); return c; }));
  shown.forEach((p) => fillCard(p));
}

// ---------------------------------------------------------------- matnni tayyorlash va saqlash
function joinLines(text) {
  return text.split(/\n\s*\n/).map((par) => {
    const lines = par.split('\n').map((l) => l.trim()).filter(Boolean);
    let out = '';
    for (const l of lines) {
      if (!out) out = l;
      else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(l)) out = out.slice(0, -1) + l;
      else out += ' ' + l;
    }
    return out;
  }).filter(Boolean).join('\n\n');
}

// Saqlash uchun bo‘laklar: [{head, paras:[...]}]
function buildExport() {
  const what = $('optWhat').value, join = $('optJoin').checked;
  const fix = (t) => (join ? joinLines(t) : t);
  const multiFile = new Set(S.pages.map((p) => p.file)).size > 1;
  const out = [];
  for (const p of S.pages) {
    const parts = [];
    if ((what === 'orig' || what === 'both') && p.text.trim()) parts.push(fix(p.text));
    if ((what === 'trans' || what === 'both') && p.trans.trim()) parts.push(what === 'both' ? '[Tarjima]\n' + p.trans.replace(/^\[Rasm \d+\]\s*$/gm, '').trim() : p.trans);
    if (!parts.length) continue;
    out.push({ page: p, head: `Sahifa ${p.n}` + (multiFile ? ` (${p.file}${p.kind === 'pdf' ? ', ' + p.label : ''})` : ''), body: parts.join('\n\n') });
  }
  return out;
}

function exportAsText() {
  const heads = $('optHeads').checked;
  return buildExport().map((b) => (heads ? `--- ${b.head} ---\n\n` : '') + b.body).join('\n\n');
}

function updateExportButtons() {
  const any = S.pages.some((p) => p.text.trim() || p.trans.trim());
  ['btnCopy', 'btnTxt', 'btnDocx'].forEach((id) => ($(id).disabled = !any));
  $('btnImgs').disabled = !S.pages.some((p) => (p.figs || []).length);
  $('btnTest').disabled = S.running || !S.pages.some((p) => p.text.trim());
  $('btnTr').disabled = S.running || !S.pages.some((p) => p.text.trim());
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = 'Nusxalandi'; setTimeout(() => (btn.textContent = old), 1200); }
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function baseName() {
  const f = S.pages[0]?.file || 'matn';
  return f.replace(/\.[^.]+$/, '') || 'matn';
}

// Oddiy ZIP (siqmasdan) — rasmlarni bitta faylga yig‘ish uchun
function makeZip(files) {
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), c = crc(f.data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, c, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
    parts.push(h.buffer, name, f.data);
    const g = new DataView(new ArrayBuffer(46));
    g.setUint32(0, 0x02014b50, true); g.setUint16(4, 20, true); g.setUint16(6, 20, true); g.setUint16(8, 0x0800, true);
    g.setUint32(16, c, true); g.setUint32(20, f.data.length, true); g.setUint32(24, f.data.length, true); g.setUint16(28, name.length, true); g.setUint32(42, off, true);
    central.push(g.buffer, name);
    off += 30 + name.length + f.data.length;
  }
  const csize = central.reduce((s, b) => s + (b.byteLength ?? b.length), 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}

async function saveDocx() {
  const { Document, Packer, Paragraph, TextRun, ImageRun } = window.docx;
  const heads = $('optHeads').checked, join = $('optJoin').checked;
  const children = [];
  const run = (t, o = {}) => new TextRun({ text: t, font: 'Times New Roman', size: 24, ...o });
  const entries = buildExport();
  for (let i = 0; i < entries.length; i++) {
    const b = entries[i];
    if (heads) children.push(new Paragraph({ pageBreakBefore: i > 0, spacing: { after: 160 }, children: [run(b.head, { bold: true })] }));
    else if (i > 0) children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    const paras = join ? b.body.split(/\n\s*\n/) : b.body.split('\n');
    for (const t of paras) {
      const m = t.trim().match(MARKER);
      const fig = m && (b.page.figs || []).find((f) => f.n === Number(m[1]));
      if (fig) {
        const k = Math.min(1, 480 / fig.w, 360 / fig.h);   // sahifaga sig‘adigan o‘lcham (piksel)
        children.push(new Paragraph({ spacing: { before: 80, after: 120 }, children: [new ImageRun({
          data: new Uint8Array(await fig.blob.arrayBuffer()), type: 'png',
          transformation: { width: Math.round(fig.w * k), height: Math.round(fig.h * k) },
        })] }));
      } else children.push(new Paragraph({ spacing: { after: join ? 120 : 0 }, children: [run(t)] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  download(await Packer.toBlob(doc), baseName() + '.docx');
}

// ---------------------------------------------------------------- tarjima
const SRC = { uzb: 'uz', uzb_cyrl: 'uz', rus: 'ru', eng: 'en' };

async function localTranslator(sl, tl) {
  if (!('Translator' in self)) return null;
  try {
    const a = await self.Translator.availability({ sourceLanguage: sl, targetLanguage: tl });
    if (a === 'unavailable') return null;
    return await self.Translator.create({ sourceLanguage: sl, targetLanguage: tl });
  } catch { return null; }
}

async function onlineTranslate(text, sl, tl) {
  const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sl, tl, q: text }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Tarjima xatosi (internet bormi?)');
  return j.text;
}

function chunks(par, max = 1500) {
  if (par.length <= max) return [par];
  const out = []; let cur = '';
  for (const s of par.split(/(?<=[.!?…])\s+/)) {
    if ((cur + ' ' + s).length > max && cur) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (c.length > max ? c.match(new RegExp(`[\\s\\S]{1,${max}}`, 'g')) : [c]));
}

async function translateAll() {
  const tl = $('trTo').value, mode = $('trMode').value;
  const targets = S.pages.filter((p) => p.text.trim());
  if (!targets.length) return;
  const main = selectedLangs()[0] || 'uzb';
  const sl = SRC[main] || 'auto';
  if (sl === tl) { $('trStatus').textContent = 'Asl til va tarjima tili bir xil.'; return; }

  let local = null, online = false;
  if (mode !== 'online') local = await localTranslator(sl, tl);
  if (!local) {
    if (mode === 'local') { $('trStatus').textContent = 'Bu brauzer bu til juftligini oflayn tarjima qila olmaydi. “Onlayn” ni tanlang.'; return; }
    if (!S.onlineOk && !confirm('Bu juftlik uchun oflayn tarjima yo‘q.\n\nOnlayn tarjimada matn Google serveriga yuboriladi (rasmlar yuborilmaydi). Davom etamizmi?')) return;
    S.onlineOk = true; online = true;
  }

  $('btnTr').disabled = true;
  let n = 0;
  try {
    for (const p of targets) {
      $('trStatus').textContent = `Tarjima: ${++n} / ${targets.length} (${online ? 'onlayn' : 'oflayn'})`;
      const pars = joinLines(p.text).split(/\n\n/);
      const res = [];
      for (const par of pars) {
        if (MARKER.test(par.trim())) { res.push(par.trim()); continue; }   // [Rasm N] belgisi tarjima qilinmaydi
        const pieces = [];
        for (const ch of chunks(par)) pieces.push(local ? await local.translate(ch) : await onlineTranslate(ch, sl === 'uz' && main === 'uzb_cyrl' ? 'auto' : sl, tl));
        res.push(pieces.join(' '));
      }
      p.trans = res.join('\n\n');
      showTrans(p);
    }
    $('trStatus').textContent = `Tayyor: ${targets.length} sahifa (${online ? 'onlayn' : 'oflayn'}).`;
    if ($('optWhat').value === 'orig') $('optWhat').value = 'both';
  } catch (e) {
    console.error(e);
    $('trStatus').textContent = 'Xato: ' + (e.message || e);
  } finally { local?.destroy?.(); updateExportButtons(); }
}

// ---------------------------------------------------------------- kamera
let camStream = null;
async function startCam(deviceId) {
  stopCam();
  camStream = await navigator.mediaDevices.getUserMedia({
    video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  });
  $('camVideo').srcObject = camStream;
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const cur = camStream.getVideoTracks()[0].getSettings().deviceId;
  $('camSel').replaceChildren(...devs.map((d, i) => { const o = el('option', { value: d.deviceId, text: d.label || `Kamera ${i + 1}` }); o.selected = d.deviceId === cur; return o; }));
}
function stopCam() { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; }

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { $('camFallback').click(); return; }
  S.cameraShots = 0;
  try {
    await startCam();
    $('camDlg').showModal();
    $('camInfo').textContent = 'Kitob sahifasini tekis, yorug‘likda va ramkaga to‘liq sig‘diring.';
  } catch (e) {
    stopCam();
    alert('Kameraga ulanib bo‘lmadi: ' + (e.message || e) + '\nRuxsat berilganini tekshiring yoki “Fayl tanlash” orqali suratni yuklang.');
  }
}

function shoot() {
  const v = $('camVideo');
  if (!v.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob((blob) => {
    S.cameraShots++;
    addImageBlob(blob, `Kamera ${new Date().toLocaleTimeString('uz')} #${S.cameraShots}`);
    renderPages();
    $('camInfo').textContent = `Olingan: ${S.cameraShots}. Yana suratga oling yoki “Tayyor” ni bosing.`;
  }, 'image/jpeg', 0.93);
}

// ---------------------------------------------------------------- ulash
function init() {
  const cores = navigator.hardwareConcurrency || 2;
  const maxLanes = Math.max(1, Math.min(4, cores - 1));
  $('lanes').replaceChildren(...Array.from({ length: maxLanes }, (_, i) => {
    const o = el('option', { value: i + 1, text: i === 0 ? '1 (sekin, kam xotira)' : String(i + 1) });
    if (i + 1 === Math.min(2, maxLanes)) o.selected = true;
    return o;
  }));

  figCtx.el = el;
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('skaner_ai_keys') || '[]'); } catch { saved = []; }
  if (!saved.length) saved = [localStorage.getItem('skaner_ai_key') || ''];
  saved.forEach(addAiRow);
  $('aiAdd').onclick = () => addAiRow('');
  const syncEngine = () => { document.querySelectorAll('.offline-only').forEach((e) => (e.hidden = $('engine').value === 'ai')); $('aiBox').hidden = $('engine').value !== 'ai'; };
  $('engine').onchange = () => { document.querySelectorAll('#engineSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === $('engine').value)); syncEngine(); if ($('engine').value === 'ai') document.querySelector('#aiKeys input')?.focus(); };
  document.querySelectorAll('#engineSeg button').forEach((b) => (b.onclick = () => { $('engine').value = b.dataset.v; $('engine').dispatchEvent(new Event('change')); }));
  syncEngine();
  $('btnFiles').onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('camFallback').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  $('btnCam').onclick = openCamera;
  $('camShot').onclick = shoot;
  $('camClose').onclick = () => $('camDlg').close();
  $('camDlg').addEventListener('close', stopCam);
  $('camSel').onchange = (e) => startCam(e.target.value).catch((er) => alert(er.message));
  $('viewClose').onclick = () => $('viewDlg').close();

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files || []));
  drop.onclick = () => $('fileInput').click();

  $('selAll').onclick = () => setSelection(() => true);
  $('selNone').onclick = () => setSelection(() => false);
  $('selRange').onclick = () => {
    try { const r = parseRange($('rangeInp').value); setSelection((p) => r.has(p.n)); }
    catch (e) { alert('Oraliq noto‘g‘ri: ' + e.message + '\nMisol: 1-5, 8, 10-12'); }
  };

  $('btnRun').onclick = () => runOcr(S.pages.filter((p) => p.selected));
  $('btnStop').onclick = () => { S.cancel = true; $('progText').textContent = 'To‘xtatilmoqda…'; S.workers.forEach((w) => w.terminate().catch(() => {})); };

  $('btnCopy').onclick = (e) => copyText(exportAsText(), e.target);
  $('btnTxt').onclick = () => download(new Blob(['﻿' + exportAsText()], { type: 'text/plain;charset=utf-8' }), baseName() + '.txt');
  $('btnImgs').onclick = async () => {
    const files = [];
    for (const p of S.pages) for (const f of p.figs || []) files.push({ name: figName(p, f), data: new Uint8Array(await f.blob.arrayBuffer()) });
    download(makeZip(files), baseName() + '-rasmlar.zip');
  };
  $('btnDocx').onclick = () => saveDocx().catch((e) => alert('.docx yaratilmadi: ' + e.message));
  $('btnTr').onclick = translateAll;

  window.addEventListener('beforeunload', (e) => { if (S.running || S.pages.some((p) => p.text.trim())) { e.preventDefault(); e.returnValue = ''; } });
  window.__tp = initTestPrep({ el, pages: () => S.pages, baseName, download });
  window.__app = S; // sinov uchun
}
init();
