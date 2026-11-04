// Sahifa tuzilishi: ustunlarni topish, chizma (rasm) ajratish, matnni tartiblash, fizika tuzatishlari.

// ---- yordamchi: canvas ning bir bo‘lagini kichraytirib, kulrang xaritaga aylantiradi
function grayMap(src, sx, sy, sw, sh, tw) {
  const w = Math.max(1, Math.min(tw, Math.round(sw)));
  const s = w / sw;
  const h = Math.max(1, Math.round(sh * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  c.width = 0;
  return { w, h, g, s };
}

function otsu(g) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
// siyoh = to‘q piksel. Och rangli fon (rangli sahifa) siyoh hisoblanmasin
const inkThreshold = (g) => Math.min(otsu(g), 185);

// ---- ustunlarni topish. Natija: [{x0, x1}] (canvas pikselida)
export function detectColumns(canvas, { forced = 0, topCut = 0, botCut = 0 } = {}) {
  const W = canvas.width, H = canvas.height;
  if (forced === 1) return [{ x0: 0, x1: W }];
  const y0 = Math.round(H * (0.06 + topCut)), y1 = Math.round(H * (0.92 - botCut));
  const m = grayMap(canvas, 0, y0, W, y1 - y0, 600);
  const thr = inkThreshold(m.g);
  const col = new Float32Array(m.w);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.g[y * m.w + x] < thr) col[x]++;
  const runs = [];
  let st = -1;
  const lo = Math.round(m.w * 0.04), hi = Math.round(m.w * 0.96);
  for (let x = lo; x <= hi; x++) {
    const empty = x < hi && col[x] / m.h < 0.006;
    if (empty && st < 0) st = x;
    if (!empty && st >= 0) { if (x - st >= Math.max(4, m.w * 0.012)) runs.push({ a: st, b: x - 1 }); st = -1; }
  }
  let cuts = runs;
  if (forced > 1) cuts = [...runs].sort((p, q) => (q.b - q.a) - (p.b - p.a)).slice(0, forced - 1);
  cuts = cuts.sort((p, q) => p.a - q.a).map((r) => ((r.a + r.b) / 2) / m.w * W);
  const edges = [0, ...cuts, W];
  let segs = [];
  for (let i = 0; i < edges.length - 1; i++) segs.push({ x0: Math.round(edges[i]), x1: Math.round(edges[i + 1]) });
  // juda tor bo‘laklarni qo‘shnisiga qo‘shamiz (ustun emas, bo‘sh chekka)
  if (!forced) {
    let changed = true;
    while (changed && segs.length > 1) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        if (segs[i].x1 - segs[i].x0 < W * 0.1) {
          const j = i === 0 ? 1 : i - 1;
          segs[j] = { x0: Math.min(segs[j].x0, segs[i].x0), x1: Math.max(segs[j].x1, segs[i].x1) };
          segs.splice(i, 1); changed = true; break;
        }
      }
    }
  }
  return segs;
}

// ---- maksimum filtri (kengaytirish): separable, prefiks yig‘indi bilan
function dilate(map, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const cum = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    cum[0] = 0;
    for (let x = 0; x < w; x++) cum[x + 1] = cum[x] + map[y * w + x];
    for (let x = 0; x < w; x++) tmp[y * w + x] = cum[Math.min(x + r, w - 1) + 1] - cum[Math.max(x - r, 0)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    cum[0] = 0;
    for (let y = 0; y < h; y++) cum[y + 1] = cum[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) out[y * w + x] = cum[Math.min(y + r, h - 1) + 1] - cum[Math.max(y - r, 0)] > 0 ? 1 : 0;
  }
  return out;
}

// Quti ichidagi eng katta (8 qo‘shni) bog‘liq siyoh to‘dasining jami siyohga nisbati
function largestShare(ink, w, x0, y0, x1, y1, seen, stack) {
  let total = 0, best = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (!ink[i] || seen[i]) continue;
    let sp = 0, size = 0; stack[sp++] = i; seen[i] = 1;
    while (sp) {
      const p = stack[--sp]; size++;
      const px = p % w, py = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx, ny = py + dy;
        if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
        const q = ny * w + nx;
        if (ink[q] && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
      }
    }
    total += size; if (size > best) best = size;
  }
  return total ? best / total : 0;
}

// Haqiqiy matn so‘zi: ishonchli qatordagi so‘z yoki juda ishonchli so‘z (chizma ustidagi "axlat" so‘zlar emas)
const isText = (wd) => (wd.text || '').trim().length >= 2 && ((wd.lineConf ?? 0) >= 55 || wd.confidence >= 75);

// ---- chizmalarni topish: matn so‘zlarini "o‘chirib", qolgan siyoh to‘dalarini olamiz
// words: [{text, confidence, bbox:{x0,y0,x1,y1}}] (canvas pikselida). Natija: [{x0,y0,x1,y1}]
export function findFigures(canvas, words, { pageTop = 0, pageH = canvas.height } = {}) {
  const W = canvas.width, H = canvas.height;
  const m = grayMap(canvas, 0, 0, W, H, 700);
  const { w, h, s } = m;
  const thr = inkThreshold(m.g);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = m.g[i] < thr ? 1 : 0;
  // ishonchli matn so‘zlarini o‘chiramiz
  for (const wd of words) {
    if (!isText(wd)) continue;
    const x0 = Math.max(0, Math.floor(wd.bbox.x0 * s) - 1), x1 = Math.min(w - 1, Math.ceil(wd.bbox.x1 * s) + 1);
    const y0 = Math.max(0, Math.floor(wd.bbox.y0 * s) - 1), y1 = Math.min(h - 1, Math.ceil(wd.bbox.y1 * s) + 1);
    for (let y = y0; y <= y1; y++) ink.fill(0, y * w + x0, y * w + x1 + 1);
  }
  const dil = dilate(ink, w, h, Math.max(3, Math.round(w * 0.03)));
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const seen2 = new Uint8Array(w * h), stack2 = new Int32Array(w * h);
  const boxes = [];
  for (let start = 0; start < dil.length; start++) {
    if (!dil[start] || seen[start]) continue;
    let sp = 0; stack[sp++] = start; seen[start] = 1;
    let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p / w) | 0;
      if (ink[p]) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (x > 0 && dil[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && dil[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && dil[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && dil[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (maxX < 0) continue;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    if (bw < w * 0.16 || bh < Math.max(h * 0.03, 12) || count < 120) continue;
    if (bw / bh > 9 || bh / bw > 9 || bh > h * 0.55) continue;                 // chiziq, chegara
    if (count / (bw * bh) > 0.5) continue;                    // yaxlit to‘rtburchak (sarlavha/past polosa)
    // Chizmada chiziqlar bir-biriga ulangan (katta bog‘liq to‘da); matnda esa mayda harflar ko‘p
    if (largestShare(ink, w, minX, minY, maxX, maxY, seen2, stack2) < 0.08) continue;
    // sahifa chetidagi keng polosalar (sarlavha, pastki jadval) — chizma emas
    const cy = (minY + maxY) / 2 / h;
    if ((cy < 0.08 || cy > 0.93) && bw / bh > 3.5) continue;
    boxes.push({ x0: minX / s, y0: minY / s, x1: (maxX + 1) / s, y1: (maxY + 1) / s });
  }
  // matn bilan qoplangan to‘rtburchaklar (formula qatorlari, jadval) chizma emas
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const good = boxes.filter((b) => {
    let cov = 0;
    for (const wd of words) {
      const ix = Math.min(b.x1, wd.bbox.x1) - Math.max(b.x0, wd.bbox.x0), iy = Math.min(b.y1, wd.bbox.y1) - Math.max(b.y0, wd.bbox.y0);
      if (ix > 0 && iy > 0 && isText(wd)) cov += ix * iy;
    }
    let real = 0;
    for (const wd of words) {
      const cx = (wd.bbox.x0 + wd.bbox.x1) / 2, cy = (wd.bbox.y0 + wd.bbox.y1) / 2;
      if (cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1 && wd.confidence >= 50 && /\p{L}{4,}/u.test(wd.text)) real++;
    }
    return cov / area(b) < 0.3 && real <= 5;
  });
  // yorliqlarni (F, α, "Rasm-I") ham qo‘shish uchun chegarani biroz kengaytiramiz
  const pad = W * 0.02;
  return good.map((b) => {
    let { x0, y0, x1, y1 } = b;
    for (const wd of words) {
      const cx = (wd.bbox.x0 + wd.bbox.x1) / 2, cy2 = (wd.bbox.y0 + wd.bbox.y1) / 2;
      const short = (wd.text || '').trim().length <= 8;
      if (short && cx > b.x0 - pad && cx < b.x1 + pad && cy2 > b.y0 - pad && cy2 < b.y1 + pad) {
        x0 = Math.min(x0, wd.bbox.x0); y0 = Math.min(y0, wd.bbox.y0); x1 = Math.max(x1, wd.bbox.x1); y1 = Math.max(y1, wd.bbox.y1);
      }
    }
    return { x0: Math.max(0, x0 - 6), y0: Math.max(0, y0 - 6), x1: Math.min(W, x1 + 6), y1: Math.min(H, y1 + 6) };
  });
}

// ---- bir ustun natijasidan tartiblangan elementlar: qatorlar + rasm belgilari
// data: Tesseract natijasi (lines[].words[]), figs: findFigures natijasi. Qaytaradi {text, conf, weight}
export function assembleColumn(data, figs, markerStart) {
  const inFig = (wd) => {
    const cx = (wd.bbox.x0 + wd.bbox.x1) / 2, cy = (wd.bbox.y0 + wd.bbox.y1) / 2;
    return figs.some((f) => cx >= f.x0 && cx <= f.x1 && cy >= f.y0 && cy <= f.y1);
  };
  const items = [];
  for (const ln of data.lines || []) {
    const words = ln.words || [];
    let text, y0 = ln.bbox.y0, y1 = ln.bbox.y1;
    if (words.length && figs.length) {
      const keep = words.filter((wd) => !inFig(wd));
      if (!keep.length) continue;
      text = keep.length === words.length ? ln.text : keep.map((wd) => wd.text).join(' ');
    } else text = ln.text;
    text = text.replace(/\s+$/, '').replace(/^\s+/, '').replace(/ {4,}/g, '   ');
    if (!text.trim()) continue;
    items.push({ y0, y1, text, conf: ln.confidence, len: text.length });
  }
  figs.forEach((f, i) => items.push({ y0: f.y0, y1: f.y1, text: `[Rasm ${markerStart + i}]`, fig: true }));
  items.sort((a, b) => a.y0 - b.y0 || (a.fig ? 1 : 0) - (b.fig ? 1 : 0));
  const hs = items.filter((i) => !i.fig).map((i) => i.y1 - i.y0).sort((a, b) => a - b);
  const med = hs.length ? hs[hs.length >> 1] : 30;
  // Rasm o‘z savoli matnidan keyin, variantlardan oldin turadi (savol tagiga)
  const isQ = (t) => /^\d{1,3}\s*[.,)](\s|$)/.test(t);
  const isOpt = (t) => /^[*+]?\s*[A-Ea-e]\s*[).]/.test(t);
  const flow = [];
  let grp = null;
  for (const it of items) {
    if (!it.fig && isQ(it.text)) { grp = { before: [it], figs: [], after: [], opt: false }; flow.push(grp); continue; }
    if (!grp) { flow.push({ plain: it }); continue; }
    if (it.fig) grp.figs.push(it);
    else if (grp.opt || isOpt(it.text)) { grp.opt = true; grp.after.push(it); }
    else grp.before.push(it);
  }
  const ordered = flow.flatMap((g) => (g.plain ? [g.plain] : [...g.before, ...g.figs, ...g.after]));
  let out = '', prev = null, confSum = 0, wSum = 0;
  for (const it of ordered) {
    if (!it.fig) { confSum += it.conf * it.len; wSum += it.len; }
    if (prev) {
      const gap = it.y0 - prev.y1;
      const para = it.fig || prev.fig || gap > med * 0.55 || /^\d{1,3}\.(\s|$)/.test(it.text);
      out += para ? '\n\n' : '\n';
    }
    out += it.text;
    prev = it;
  }
  return { text: out, confSum, wSum, lines: items.filter((i) => !i.fig).map((i) => ({ text: i.text, y0: i.y0, y1: i.y1 })) };
}

// ---- fizika matni uchun ehtiyotkor tuzatishlar
export function fixPhysics(text, langs) {
  const cyr = langs.includes('rus') || langs.includes('uzb_cyrl');
  let t = text;
  if (!cyr) t = t.replace(/«/g, '<').replace(/»/g, '>');           // < > belgilari « » bo‘lib o‘qiladi
  t = t.replace(/(?<=\d)[Oo](?=\d)/g, '0')                          // 1O5 → 105
    .replace(/(?<=\d)[Il](?=\d)/g, '1')                             // 2l5 → 215
    .replace(/(?<=\d)O(?=\s?(?:N|m|s|kg|J|W|V|A)\b)/g, '0')        // 1ON → 10N
    .replace(/(?<![\p{L}\d])B(?=N\b)/gu, '8');                      // BN → 8N
  if (langs.includes('uzb')) t = t.replace(/([oOgG])[`´’‘'](?=\p{L}|\s|$)/gu, '$1ʻ');
  return t;
}

// ---- OCR uchun tasvirni yaxshilash: kulrang + kontrastni cho‘zish + (xira rasmda) o‘tkirlash.
// Asl canvas o‘zgarmaydi (chizmalar rangli qirqilishi uchun), yangi canvas qaytariladi.
export function enhance(src, { sharpen = true } = {}) {
  const W = src.width, H = src.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { alpha: false });   // willReadFrequently + alpha:false ba’zi brauzerlarda qora rasm beradi
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, W, H), d = img.data;
  const g = new Uint8Array(W * H), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) { const v = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000 | 0; g[i] = v; hist[v]++; }
  const total = g.length;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.25) { hi = v; break; } }   // fon (oq) darajasi
  if (hi - lo < 40) { hi = Math.min(255, lo + 40); }
  const k = 255 / (hi - lo);
  let out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) { const v = (g[i] - lo) * k; out[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
  if (sharpen) {                                   // unsharp mask: 3×3 yengil
    const s = new Uint8Array(out.length), a = 0.7;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const blur = (out[i - W - 1] + out[i - W] + out[i - W + 1] + out[i - 1] + out[i] + out[i + 1] + out[i + W - 1] + out[i + W] + out[i + W + 1]) / 9;
        const v = out[i] + a * (out[i] - blur);
        s[i] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    out = s;
  }
  for (let i = 0, j = 0; i < out.length; i++, j += 4) { d[j] = d[j + 1] = d[j + 2] = out[i]; d[j + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}
