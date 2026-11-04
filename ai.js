// AI rejimi: sahifa rasmini Gemini (yoki Claude) ga yuborib, savollar, formulalar va chizma koordinatalarini oladi.
// Diqqat: bu rejimda sahifa rasmi Google/Anthropic serveriga ketadi. Kalit faqat shu brauzerda (localStorage) saqlanadi.

const PROMPT = `Sen fizika savollar banki sahifalarini aniq ko‘chiradigan OCR dasturisan. Rasmda skaner qilingan sahifa (o‘zbek lotin; ba’zan rus/ingliz). Ustunlar bo‘lishi mumkin: chapdan o‘ngga, har ustunni tepadan pastga o‘qi.

QOIDALAR:
- Matnni AYNAN ko‘chir. Savolni YECHMA, o‘zingdan hech narsa qo‘shma, imlosini o‘zgartirma. o‘zbekcha tutuq belgisi: oʻ, gʻ.
- Formula, vektor, daraja, kasr, ildiz, yunon harflari va kattaliklarni oddiy LaTeX bilan $...$ ichida yoz: $\\vec{F}_1$, $\\frac{a}{b}$, $\\sqrt{3}$, $\\alpha$, $R_{min}$, $10^9$, $\\sin 37^\\circ$. Tengsizlik: $2 < R < 14$.
- Har savol: num (kitobdagi raqam), text (savol matni), options (A, B, C, D, E harfi bilan va matni). Variantlar jadval bo‘lsa, har qator uchun bitta variant matnini yoz (masalan "x = 1, y = -1").
- Chizma/rasm/grafik/sxema (matn emas) uchun figures: box — [ymin, xmin, ymax, xmax], 0 dan 1000 gacha me’yorlangan koordinatalar (butun sahifaga nisbatan), belongs_to — "question" yoki variant harfi (A–E). Faqat haqiqiy rasmni ol; savol matni, variantlar yoki bezak chiziqlarini rasm deb olma. Chizma ichidagi yozuvlarni (F1, α) matnga qo‘shma.
- Sahifa tepa/pastidagi sarlavha, bet raqami, logotip — o‘tkazib yubor. Savol bo‘lmagan boshqa matn bo‘lsa — other_text ga yoz.
- Sahifa pastida javoblar kaliti polosasi bo‘lsa (masalan "1.A 2.B ..."), uni answer_key ga yoz: [{num, letter}]. O‘qib bo‘lmasa — bo‘sh qoldir, taxmin qilma.
Faqat JSON qaytar.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          num: { type: 'INTEGER' },
          text: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'OBJECT', properties: { letter: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['letter', 'text'] } },
          figures: { type: 'ARRAY', items: { type: 'OBJECT', properties: { box: { type: 'ARRAY', items: { type: 'INTEGER' } }, belongs_to: { type: 'STRING' } }, required: ['box'] } },
        },
        required: ['num', 'text', 'options'],
      },
    },
    answer_key: { type: 'ARRAY', items: { type: 'OBJECT', properties: { num: { type: 'INTEGER' }, letter: { type: 'STRING' } } } },
    other_text: { type: 'STRING' },
  },
  required: ['questions'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GEMINI_BASE = () => localStorage.getItem('skaner_ai_base') || 'https://generativelanguage.googleapis.com';

export const isClaudeKey = (k) => k.trim().startsWith('sk-ant-');

async function post(url, headers, body, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
    catch (e) { last = new Error('Internet yoki server bilan aloqa yo‘q'); await sleep(1500 * (i + 1)); continue; }
    if (r.ok) return r.json();
    const t = await r.text().catch(() => '');
    last = new Error(`AI xatosi ${r.status}: ${t.slice(0, 160)}`);
    last.status = r.status;
    if (![429, 500, 502, 503, 529].includes(r.status)) throw last;       // kalit xato, so‘rov xato — qayta urinish befoyda
    const ra = Number(r.headers.get('retry-after'));
    await sleep((ra > 0 ? ra * 1000 : 2500 * 2 ** i));
  }
  throw last;
}

function parseJson(text) {
  const t = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); }
  catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); return JSON.parse(t.slice(a, b + 1)); }
}

// jpegB64 — sahifa rasmi. Qaytaradi: xom JSON obyekt
export async function askAI(key, jpegB64) {
  key = key.trim();
  if (isClaudeKey(key)) {
    const j = await post('https://api.anthropic.com/v1/messages', {
      'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true',
    }, {
      model: 'claude-sonnet-5-5', max_tokens: 8192, temperature: 0.1,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegB64 } },
        { type: 'text', text: PROMPT + '\nJSON shakli: {"questions":[{"num":1,"text":"","options":[{"letter":"A","text":""}],"figures":[{"box":[ymin,xmin,ymax,xmax],"belongs_to":"question"}]}],"answer_key":[{"num":1,"letter":"A"}],"other_text":""}' },
      ] }],
    });
    return parseJson((j.content || []).map((c) => c.text || '').join(''));
  }
  const body = (maxTok) => ({
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: jpegB64 } }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: maxTok },
  });
  let err;
  for (const model of ['gemini-flash-latest', 'gemini-flash-lite-latest']) {
    try {
      const j = await post(`${GEMINI_BASE()}/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': key }, body(8192), 3);
      const txt = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!txt) throw new Error('AI bo‘sh javob qaytardi' + (j.promptFeedback?.blockReason ? ` (${j.promptFeedback.blockReason})` : ''));
      return parseJson(txt);
    } catch (e) {
      err = e;
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        const ne = new Error(e.status === 400 ? 'AI so‘rovi rad etildi: ' + e.message : 'API kalit noto‘g‘ri yoki ruxsat yo‘q (' + e.status + ')');
        ne.status = e.status;
        throw ne;
      }
    }
  }
  throw err;
}

// AI javobini sahifa matniga (tahrir va "Testga tayyorlash" o‘qiy oladigan shaklga) va rasm qutilariga aylantiradi.
// Qaytaradi: {text, boxes:[{n, x0,y0,x1,y1}] (0..1 ulushda)}
export function aiToPage(res) {
  const lines = [];
  const boxes = [];
  const qs = Array.isArray(res.questions) ? res.questions : [];
  const key = new Map((res.answer_key || []).filter((k) => k && k.letter).map((k) => [Number(k.num), String(k.letter).trim().toUpperCase().slice(0, 1)]));
  if ((res.other_text || '').trim()) lines.push(res.other_text.trim(), '');
  const addFig = (f, where) => {
    const b = Array.isArray(f.box) && f.box.length === 4 ? f.box.map(Number) : null;
    if (!b || b.some((x) => !Number.isFinite(x))) return;
    let [y0, x0, y1, x1] = b.map((v) => Math.max(0, Math.min(1000, v)) / 1000);
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (x1 - x0 < 0.02 || y1 - y0 < 0.015) return;
    const n = boxes.length + 1;
    boxes.push({ n, x0, y0, x1, y1 });
    lines.push(`[Rasm ${n}]`);
  };
  for (const q of qs) {
    lines.push(`${q.num}. ${String(q.text || '').trim()}`);
    const figs = Array.isArray(q.figures) ? q.figures : [];
    for (const f of figs) if (!f.belongs_to || /^q/i.test(f.belongs_to) || !/^[A-Ea-e]/.test(f.belongs_to)) addFig(f);
    for (const o of Array.isArray(q.options) ? q.options : []) {
      const L = String(o.letter || '').trim().toUpperCase().slice(0, 1);
      if (!/[A-E]/.test(L)) continue;
      lines.push(`${L}) ${String(o.text || '').trim()}`.trimEnd());
      for (const f of figs) if (/^[A-Ea-e]/.test(f.belongs_to || '') && !/^q/i.test(f.belongs_to) && f.belongs_to.trim().toUpperCase()[0] === L) addFig(f);
    }
    if (key.has(Number(q.num))) lines.push(`Javob: ${key.get(Number(q.num))}`);
    lines.push('');
  }
  return { text: lines.join('\n').trim(), boxes, count: qs.length };
}
