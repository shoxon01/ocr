// "Testga tayyorlash": OCR matnini savollarga bo‘ladi, variantlarni ajratadi, rasmlarni
// o‘z savoliga biriktiradi va "Test yechish" ilovasi o‘qiy oladigan .docx / .txt yozadi.

const QNUM = /^\s*(\d{1,3})\s*([.,)])\s*(.*)$/;
const OPT = /^\s*[*+]?\s*([A-Ea-e])\s*[).]\s*(.*)$/;
const MARK = /^\s*\[Rasm (\d+)\]\s*$/;
const ANS = /^\s*(?:javob|to.g.ri\s+javob|answer)\s*[:\-]\s*([A-Ea-e])\b/i;
const EXPL = /^\s*yechim\s*:\s*(.*)$/i;
const LETTERS = 'ABCDE';

// "A) 3  B) 4  C) 5" kabi bir qatordagi variantlarni ajratadi. Qaytaradi [[indeks, matn], ...] yoki null
export function splitOptions(line) {
  const m = line.match(OPT);
  if (!m) return null;
  const first = m[1].toUpperCase();
  const cut = [{ i: LETTERS.indexOf(first), from: line.search(/[A-Ea-e]/), textFrom: line.length - m[2].length }];
  let pos = cut[0].textFrom;
  for (let k = cut[0].i + 1; k < 5; k++) {
    const re = new RegExp(`\\s+${LETTERS[k]}\\s*[).]\\s*`, 'g');
    re.lastIndex = pos;
    const f = re.exec(line);
    if (!f) break;
    cut.push({ i: k, from: f.index, textFrom: f.index + f[0].length });
    pos = f.index + f[0].length;
  }
  return cut.map((c, n) => [c.i, line.slice(c.textFrom, n + 1 < cut.length ? cut[n + 1].from : line.length).trim()]);
}

// pages: [{id, n, text, figs:[{n, ...}]}] (tartib bo‘yicha). Qaytaradi: [{num, text, opts[5], figs:[{fig, where}], ans, expl}]
export function parseTest(pages) {
  const qs = [];
  // Birinchi savol raqami o‘qilmagan bo‘lishi mumkin (katta rangli raqam): shu uchun "old savol" ham yig‘iladi
  const pre = { num: 0, text: '', opts: ['', '', '', '', ''], figs: [], ans: null, expl: '' };
  let cur = pre, lastNum = 0, lastOpt = -1;
  const pending = [];
  const place = (q, fig) => q.figs.push({ fig, where: lastOpt >= 0 && !q.opts[lastOpt].trim() ? lastOpt : 'q' });
  const filled = (q) => q.opts.filter((o) => o.trim()).length;

  for (const p of pages) {
    for (const raw of (p.text || '').split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const mk = line.match(MARK);
      if (mk) {
        const fig = (p.figs || []).find((f) => f.n === Number(mk[1]));
        if (!fig) continue;
        place(cur, fig);
        continue;
      }
      const qm = line.match(QNUM);
      if (p.ai && cur === pre && !qm && !mk) continue;   // AI sahifada birinchi savoldan oldingi matn — sarlavha/boshqa matn
      if (qm) {
        const n = Number(qm[1]);
        const seq = n === lastNum + 1;
        if (qm[2] === ',' ? seq && cur !== pre : cur === pre || filled(cur) >= 2 || seq) {
          cur = { num: n, text: qm[3], opts: ['', '', '', '', ''], figs: [], ans: null, expl: '' };
          qs.push(cur); lastNum = n; lastOpt = -1;
          continue;
        }
      }
      const am = line.match(ANS);
      if (am) { cur.ans = LETTERS.indexOf(am[1].toUpperCase()); continue; }
      const em = line.match(EXPL);
      if (em) { cur.expl = em[1]; continue; }
      const opts = splitOptions(line);
      if (opts) {
        for (const [i, t] of opts) { cur.opts[i] = t; lastOpt = i; }
        continue;
      }
      if (lastOpt >= 0) cur.opts[lastOpt] = (cur.opts[lastOpt] + ' ' + line).trim();
      else cur.text += (cur.text ? '\n' : '') + line;
    }
  }
  // Birinchi savol raqamisiz bo‘lsa (variantlari yoki rasmi bor, yetarli matn) — uni ham olamiz
  const words = pre.text.split(/\s+/).filter(Boolean).length;
  if (qs.length && (filled(pre) >= 2 || pre.figs.length || words >= 8)) { pre.num = qs[0].num - 1; qs.unshift(pre); }
  return qs;
}

// "1-A 2-B 3.C 4:D" yoki "1A 2B" kabi kalitni o‘qiydi: {1:0, 2:1, ...}
export function parseKey(s) {
  const out = {};
  for (const m of s.matchAll(/(\d{1,3})\s*[-–.:)=]?\s*([A-Ea-e])(?![A-Za-z])/g)) out[Number(m[1])] = LETTERS.indexOf(m[2].toUpperCase());
  return out;
}

// Test ilovasi uchun matn qatorlari: [{text} | {fig}] ketma-ketligi
export function buildLines(t) {
  const lines = [];
  if (t.title.trim()) lines.push({ text: `Test nomi: ${t.title.trim()}` });
  if (t.section.trim()) lines.push({ text: `Bo‘lim: ${t.section.trim()}` });
  const figsOf = (q, w) => q.figs.filter((f) => f.where === w).map((f) => ({ fig: f.fig }));
  t.qs.forEach((q, qi) => {
    const tl = q.text.split('\n').filter((l) => l.trim());
    lines.push({ text: `${qi + 1}. ${tl[0] || ''}` });
    tl.slice(1).forEach((l) => lines.push({ text: l.trim() }));
    lines.push(...figsOf(q, 'q'));
    const used = q.opts.map((o, i) => (o.trim() || q.figs.some((f) => f.where === i) ? i : -1)).filter((i) => i >= 0);
    for (const i of used) {
      lines.push({ text: `${LETTERS[i]}) ${q.opts[i].trim()}`.trimEnd() });
      lines.push(...figsOf(q, i));
    }
    if (q.ans !== null && q.ans >= 0) lines.push({ text: `Javob: ${LETTERS[q.ans]}` });
    if (q.expl.trim()) lines.push({ text: `Yechim: ${q.expl.trim().replace(/\n+/g, ' ')}` });
    lines.push({ text: '' });
  });
  return lines;
}

export const textOf = (t) => buildLines(t).filter((l) => l.text !== undefined).map((l) => l.text).join('\n');

export function problems(t) {
  const out = [];
  t.qs.forEach((q, i) => {
    const n = q.opts.filter((o, k) => o.trim() || q.figs.some((f) => f.where === k)).length;
    const p = [];
    if (!q.text.trim() && !q.figs.some((f) => f.where === 'q')) p.push('savol matni yo‘q');
    if (n < 4) p.push(`${n} ta variant`);
    if (q.ans === null || q.ans < 0) p.push('javob belgilanmagan');
    else if (!q.opts[q.ans].trim() && !q.figs.some((f) => f.where === q.ans)) p.push('javob bo‘sh variantga qo‘yilgan');
    if (q.opts[4].trim()) p.push('5 ta variant (ilova hozir A–D ni o‘qiydi)');
    out.push(p);
  });
  return out;
}

// ------------------------------------------------------------------ oyna (UI)
// ctx: { el, pages(), baseName(), download(blob, name), figName(page, fig) }
export function initTestPrep(ctx) {
  const { el } = ctx;
  const $ = (id) => document.getElementById(id);
  let T = { title: '', section: '', qs: [] };

  const figSrc = (f) => f.fig.url;

  function render() {
    const probs = problems(T);
    $('tpCount').textContent = `${T.qs.length} ta savol · muammoli: ${probs.filter((p) => p.length).length}`;
    $('tpList').replaceChildren(...T.qs.map((q, qi) => card(q, qi, probs[qi])));
  }

  function card(q, qi, probs) {
    const ta = el('textarea', { class: 'tq', spellcheck: 'false', rows: 3 });
    ta.value = q.text;
    ta.addEventListener('input', () => { q.text = ta.value; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; });
    const opts = q.opts.map((o, i) => {
      const radio = el('input', { type: 'radio', name: `ans${qi}`, title: 'To‘g‘ri javob' });
      radio.checked = q.ans === i;
      radio.addEventListener('change', () => { q.ans = i; refreshBadges(); });
      const inp = el('input', { type: 'text', class: 'to', 'aria-label': `${LETTERS[i]} variant` });
      inp.value = o;
      inp.addEventListener('input', () => { q.opts[i] = inp.value; refreshBadges(); });
      return el('div', { class: 'orow' }, [radio, el('b', { text: LETTERS[i] + ')' }), inp]);
    });
    const figs = q.figs.map((f) => {
      const sel = el('select', { 'aria-label': 'Rasm qayerga' }, [
        el('option', { value: 'q', text: 'Savolga' }),
        ...[0, 1, 2, 3, 4].map((i) => el('option', { value: String(i), text: `${LETTERS[i]} variantga` })),
        el('option', { value: 'x', text: 'Olib tashlash' }),
      ]);
      sel.value = String(f.where);
      sel.addEventListener('change', () => {
        if (sel.value === 'x') q.figs = q.figs.filter((x) => x !== f);
        else f.where = sel.value === 'q' ? 'q' : Number(sel.value);
        render();
      });
      const to = el('input', { type: 'number', min: 1, max: T.qs.length, placeholder: '№', title: 'Boshqa savolga ko‘chirish (tartib raqami)', class: 'tn' });
      to.addEventListener('change', () => {
        const k = Number(to.value) - 1;
        if (k >= 0 && k < T.qs.length && k !== qi) { q.figs = q.figs.filter((x) => x !== f); f.where = 'q'; T.qs[k].figs.push(f); render(); }
      });
      return el('figure', { class: 'fig' }, [el('img', { src: figSrc(f), alt: 'rasm' }), el('figcaption', {}, [sel, to])]);
    });
    const ex = el('input', { type: 'text', class: 'to', placeholder: 'Yechim (ixtiyoriy)' });
    ex.value = q.expl;
    ex.addEventListener('input', () => { q.expl = ex.value; });
    const badge = el('span', { class: 'bad' });
    const root = el('div', { class: 'qcard' }, [
      el('div', { class: 'head' }, [
        el('b', { text: `${qi + 1}-savol` }), el('span', { class: 'muted', text: `(kitobda ${q.num})` }), badge, el('span', { class: 'sp' }),
        el('button', { class: 'small', text: 'Kursordan bo‘lish', title: 'Savol matnida kursorni qo‘ying: undan keyingi qism (variantlari bilan) yangi savol bo‘ladi', onclick: () => split(qi, ta.selectionStart) }),
        el('button', { class: 'small', text: 'Oldingisiga qo‘shish', disabled: qi === 0, onclick: () => merge(qi) }),
        el('button', { class: 'small', text: 'O‘chirish', onclick: () => { T.qs.splice(qi, 1); render(); } }),
      ]),
      ta, el('div', { class: 'figs' }, figs), el('div', { class: 'opts' }, opts), ex,
    ]);
    root._badge = () => { const p = problems({ qs: [q] })[0]; badge.textContent = p.join(' · '); badge.hidden = !p.length; };
    root._badge();
    setTimeout(() => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 4 + 'px'; });
    return root;
  }
  const refreshBadges = () => {
    document.querySelectorAll('#tpList .qcard').forEach((c) => c._badge());
    const probs = problems(T);
    $('tpCount').textContent = `${T.qs.length} ta savol · muammoli: ${probs.filter((p) => p.length).length}`;
  };

  function split(qi, pos) {
    const q = T.qs[qi];
    const nq = { num: q.num + 1, text: q.text.slice(pos).trim(), opts: q.opts, figs: q.figs.filter((f) => f.where !== 'q'), ans: null, expl: '' };
    q.text = q.text.slice(0, pos).trim(); q.opts = ['', '', '', '', '']; q.figs = q.figs.filter((f) => f.where === 'q'); q.ans = null;
    T.qs.splice(qi + 1, 0, nq); render();
  }

  function merge(qi) {
    const a = T.qs[qi - 1], b = T.qs[qi];
    a.text = (a.text + '\n' + b.text).trim();
    b.opts.forEach((o, i) => { if (o.trim() && !a.opts[i].trim()) a.opts[i] = o; });
    a.figs.push(...b.figs);
    T.qs.splice(qi, 1); render();
  }

  function open() {
    const pages = ctx.pages().filter((p) => p.text.trim());
    if (!pages.length) return;
    T.qs = parseTest(pages);
    if (!T.title) T.title = ctx.baseName();
    $('tpTitle').value = T.title; $('tpSection').value = T.section;
    $('tpDlg').showModal();
    render();
  }

  async function saveDocx(w) {
    const lines = buildLines(T);
    const { Document, Packer, Paragraph, TextRun, ImageRun } = window.docx;
    const children = [];
    for (const l of lines) {
      if (l.fig) {
        const f = l.fig, k = Math.min(1, 480 / f.w, 360 / f.h);
        children.push(new Paragraph({ children: [new ImageRun({ data: new Uint8Array(await f.blob.arrayBuffer()), type: 'png', transformation: { width: Math.round(f.w * k), height: Math.round(f.h * k) } })] }));
      } else children.push(new Paragraph({ children: [new TextRun({ text: l.text, font: 'Times New Roman', size: 24 })] }));
    }
    ctx.download(await Packer.toBlob(new Document({ sections: [{ children }] })), `${ctx.baseName()}-test.docx`);
  }

  function check() {
    const bad = problems(T).filter((p) => p.some((x) => x !== '5 ta variant (ilova hozir A–D ni o‘qiydi)')).length;
    return !bad || confirm(`${bad} ta savolda muammo bor (javob yoki variant yetishmaydi). Test ilovasi bunday savollarni rad etadi. Baribir saqlansinmi?`);
  }

  $('btnTest').onclick = open;
  $('tpTitle').addEventListener('input', (e) => { T.title = e.target.value; });
  $('tpSection').addEventListener('input', (e) => { T.section = e.target.value; });
  $('tpKeyApply').onclick = () => {
    const key = parseKey($('tpKey').value); let n = 0;
    T.qs.forEach((q, i) => { const a = key[q.num] ?? key[i + 1]; if (a !== undefined) { q.ans = a; n++; } });
    $('tpKeyInfo').textContent = `${n} ta savolga javob qo‘yildi.`;
    render();
  };
  $('tpDocx').onclick = () => { if (check()) saveDocx().catch((e) => alert('.docx yaratilmadi: ' + e.message)); };
  $('tpTxt').onclick = () => { if (check()) ctx.download(new Blob(['﻿' + textOf(T)], { type: 'text/plain;charset=utf-8' }), `${ctx.baseName()}-test.txt`); };
  $('tpClose').onclick = () => $('tpDlg').close();
  return { open, state: () => T };
}
