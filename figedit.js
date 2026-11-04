// Rasmlarni qo‘lda tuzatish: sahifa ustida qutilarni sudrash, o‘lchamini o‘zgartirish, yangi maydon belgilash, o‘chirish.
// Qutilar sahifaga nisbatan 0..1 ulushda saqlanadi (fig.box).

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const MIN = 0.015;

// Yangi rasm belgisini matnda mos joyga qo‘yadi: rasmdan yuqoridagi eng yaqin savolning matnidan keyin,
// variantlardan oldin (savol tagiga). Savol topilmasa — shu ustundagi yuqoridagi oxirgi qatordan keyin.
const isQ = (t) => /^\d{1,3}\s*[.,)](\s|$)/.test(t);
const isOpt = (t) => /^[*+]?\s*[A-Ea-e]\s*[).]/.test(t);

function endOfLine(page, ln) {
  const key = ln.text.trim();
  let at = page.text.indexOf(key);
  if (at < 0 && key.length > 12) at = page.text.indexOf(key.slice(0, 12));
  return at < 0 ? -1 : at + key.length;
}

export function insertMarker(page, n, box) {
  const marker = `[Rasm ${n}]`;
  const cx = (box.x0 + box.x1) / 2;
  const lines = (page.layout || []).filter((l) => cx >= l.cx0 && cx <= l.cx1).sort((p, q) => p.y0 - q.y0);
  let pos = -1, before = false;
  let qi = -1;
  lines.forEach((l, i) => { if (l.y0 < box.y0 && isQ(l.text.trim())) qi = i; });
  if (qi >= 0) {
    let last = qi;
    for (let i = qi + 1; i < lines.length; i++) {
      const t = lines[i].text.trim();
      if (isQ(t) || isOpt(t)) break;
      last = i;
    }
    pos = endOfLine(page, lines[last]);
  }
  if (pos < 0) {
    const above = lines.filter((l) => l.y0 < box.y0);
    if (above.length) pos = endOfLine(page, above[above.length - 1]);
    else if (lines.length) {
      const at = page.text.indexOf(lines[0].text.trim());
      if (at >= 0) { pos = at; before = true; }
    }
  }
  if (pos < 0) { page.text = (page.text.trim() + `\n\n${marker}`).trim(); return false; }
  const head = page.text.slice(0, pos).replace(/\s+$/, ''), tail = page.text.slice(pos).replace(/^\s+/, '');
  page.text = before ? `${head}${head ? '\n\n' : ''}${marker}\n\n${tail}` : `${head}\n\n${marker}\n\n${tail}`;
  return true;
}

export async function openFigEditor(ctx, page) {
  const { el } = ctx;
  const dlg = $('feDlg'), stage = $('feStage'), overlay = $('feOverlay'), canvas = $('feCanvas');
  $('feInfo').textContent = `— ${page.n}-sahifa`;
  let boxes = (page.figs || []).filter((f) => f.box).map((f) => ({ fig: f, n: f.n, ...f.box, changed: false }));
  let sel = null;
  const orig = new Set(boxes);
  let removed = [];

  // sahifa rasmi (ko‘rish uchun)
  try {
    const c = await ctx.render(page, 1400);
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
    c.width = 0;
  } catch (e) { alert('Sahifani ko‘rsatib bo‘lmadi: ' + (e.message || e)); return; }

  const draw = () => {
    overlay.replaceChildren(...boxes.map((b) => {
      const d = el('div', { class: 'fbox' + (b === sel ? ' sel' : '') + (b.draft ? ' draft' : '') }, [
        el('b', { text: b.n ? `Rasm ${b.n}` : 'yangi' }),
        ...['nw', 'ne', 'sw', 'se'].map((h) => el('i', { 'data-h': h })),
      ]);
      d.style.left = b.x0 * 100 + '%'; d.style.top = b.y0 * 100 + '%';
      d.style.width = (b.x1 - b.x0) * 100 + '%'; d.style.height = (b.y1 - b.y0) * 100 + '%';
      d._b = b;
      return d;
    }));
    $('feDel').disabled = !sel;
  };

  const pt = (e) => {
    const r = overlay.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };

  let drag = null;
  overlay.onpointerdown = (e) => {
    const p = pt(e);
    const boxEl = e.target.closest('.fbox');
    try { overlay.setPointerCapture(e.pointerId); } catch { /* sintetik hodisa */ }
    if (boxEl) {
      sel = boxEl._b;
      const h = e.target.dataset?.h;
      drag = { mode: h ? 'resize' : 'move', h, b: sel, start: p, init: { x0: sel.x0, y0: sel.y0, x1: sel.x1, y1: sel.y1 } };
    } else {
      const b = { fig: null, n: 0, x0: p.x, y0: p.y, x1: p.x, y1: p.y, draft: true, changed: true };
      boxes.push(b); sel = b;
      drag = { mode: 'new', b, start: p };
    }
    draw();
    e.preventDefault();
  };
  overlay.onpointermove = (e) => {
    if (!drag) return;
    const p = pt(e), b = drag.b, i = drag.init;
    if (drag.mode === 'new') {
      b.x0 = Math.min(drag.start.x, p.x); b.x1 = Math.max(drag.start.x, p.x);
      b.y0 = Math.min(drag.start.y, p.y); b.y1 = Math.max(drag.start.y, p.y);
    } else if (drag.mode === 'move') {
      const dx = clamp(p.x - drag.start.x, -i.x0, 1 - i.x1), dy = clamp(p.y - drag.start.y, -i.y0, 1 - i.y1);
      b.x0 = i.x0 + dx; b.x1 = i.x1 + dx; b.y0 = i.y0 + dy; b.y1 = i.y1 + dy;
    } else {
      const h = drag.h;
      if (h.includes('w')) b.x0 = Math.min(p.x, i.x1 - MIN);
      if (h.includes('e')) b.x1 = Math.max(p.x, i.x0 + MIN);
      if (h.includes('n')) b.y0 = Math.min(p.y, i.y1 - MIN);
      if (h.includes('s')) b.y1 = Math.max(p.y, i.y0 + MIN);
    }
    b.changed = true;
    draw();
  };
  overlay.onpointerup = () => {
    if (drag && drag.mode === 'new') {
      const b = drag.b;
      if (b.x1 - b.x0 < MIN || b.y1 - b.y0 < MIN) { boxes = boxes.filter((x) => x !== b); sel = null; }
      else b.draft = false;
    }
    drag = null;
    draw();
  };

  const del = () => {
    if (!sel) return;
    if (sel.fig) removed.push(sel);
    boxes = boxes.filter((b) => b !== sel); sel = null; draw();
  };
  $('feDel').onclick = del;
  const key = (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && dlg.open && document.activeElement?.tagName !== 'INPUT') { del(); e.preventDefault(); } };
  document.addEventListener('keydown', key);
  dlg.addEventListener('close', () => document.removeEventListener('keydown', key), { once: true });
  $('feClose').onclick = () => dlg.close();

  $('feSave').onclick = async () => {
    $('feSave').disabled = true; $('feSave').textContent = 'Saqlanmoqda…';
    try {
      const full = await ctx.render(page, 3000);
      const W = full.width, H = full.height;
      let nextN = Math.max(0, ...(page.figs || []).map((f) => f.n)) + 1;
      const out = [];
      for (const b of boxes) {
        const x0 = Math.round(b.x0 * W), y0 = Math.round(b.y0 * H), x1 = Math.round(b.x1 * W), y1 = Math.round(b.y1 * H);
        if (b.fig && !b.changed) { out.push(b.fig); continue; }
        const fc = document.createElement('canvas');
        fc.width = x1 - x0; fc.height = y1 - y0;
        fc.getContext('2d', { alpha: false }).drawImage(full, x0, y0, fc.width, fc.height, 0, 0, fc.width, fc.height);
        const blob = await ctx.toBlob(fc);
        fc.width = 0;
        const box = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
        if (b.fig) {                                    // mavjud rasm: chegarasi o‘zgardi
          URL.revokeObjectURL(b.fig.url);
          Object.assign(b.fig, { blob, url: URL.createObjectURL(blob), w: x1 - x0, h: y1 - y0, box });
          out.push(b.fig);
        } else {                                        // yangi rasm: belgisi matnga qo‘yiladi
          const n = nextN++;
          const f = { n, blob, url: URL.createObjectURL(blob), w: x1 - x0, h: y1 - y0, box };
          insertMarker(page, n, box);
          out.push(f);
        }
      }
      for (const b of removed) {                        // o‘chirilganlar: belgi va rasm
        URL.revokeObjectURL(b.fig.url);
        page.text = page.text.replace(new RegExp(`\\n*\\[Rasm ${b.fig.n}\\]\\n*`), '\n\n').trim();
      }
      full.width = 0;
      page.figs = out.sort((a, b) => a.n - b.n);
      ctx.changed(page);
      dlg.close();
    } catch (e) {
      alert('Saqlab bo‘lmadi: ' + (e.message || e));
    } finally {
      $('feSave').disabled = false; $('feSave').textContent = 'Saqlash';
    }
  };

  draw();
  dlg.showModal();
}
