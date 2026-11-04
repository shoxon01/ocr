# Skaner OCR

Skaner kitoblardan (PDF yoki JPG/PNG rasm, yoki kamera) matn ajratadi. Oflayn rejimda hamma narsa shu kompyuterda — fayllar tashqariga chiqmaydi.

**Ochish:** `start.bat` ni ikki marta bosing (yoki `node server.mjs`, so‘ng brauzerda http://localhost:8765). Node.js kerak; internet — faqat onlayn tarjima va AI rejimi uchun.

**Ishlatish:** fayl tanlang (yoki Kamera) → "O‘qish usuli" va tilni belgilang → kerakli sahifalarni tanlang (masalan `5-20, 31`) → "Matnni o‘qish". Natijani ekranda tahrirlang, "Nusxa olish", ".txt", ".docx" yoki "Rasmlar (.zip)" saqlang.

## Sahifa tuzilishi (ustun va rasmlar)
- **Ustunlar:** sahifa avtomatik ustunlarga bo‘linadi va har ustun alohida o‘qiladi (savollar tartibi buzilmaydi). Noto‘g‘ri bo‘lsa, "Ustunlar" ni qo‘lda tanlang.
- **Rasmlarni ajratish:** chizma/jadvallar topilib alohida rasm bo‘ladi va **o‘z savoli matni tagiga** (variantlardan oldin) `[Rasm N]` belgisi bo‘lib tushadi; .docx da rasm shu joyga qo‘yiladi; .txt da belgi qoladi, rasmlar "Rasmlar (.zip)" da.
- **Rasmlarni qo‘lda tuzatish:** natija kartasidagi **Rasmlarni tuzatish** tugmasi sahifani ochadi — qutini sudrab ko‘chirish, burchaklaridan o‘lchamini o‘zgartirish, bo‘sh joyni sudrab yangi rasm maydoni belgilash, Delete bilan o‘chirish. Yangi rasmning belgisi matnda o‘z ustunidagi mos qatordan keyin qo‘yiladi (AI rejimida sahifa oxiriga — kerakli joyga ko‘chiring). Kartadagi **×** — rasmni tez olib tashlash.
- **Tepa va past chekkani kesish:** sarlavha va "javoblar kaliti" polosasi matnga aralashmasin desangiz yoqing.
- **Tasvirni yaxshilash** (kulrang, kontrast, o‘tkirlik) va **Fizika tuzatishlari** (`« »` → `< >`, `1O5` → `105`, `BN` → `8N`, `o`` → `oʻ`).

## Testga tayyorlash
"Testga tayyorlash" tugmasi OCR matnini savollarga bo‘ladi (1., 2., … raqamlari bo‘yicha), A–E variantlarni ajratadi va har rasmni o‘z savoliga biriktiradi. Oynada: matn va variantlarni tahrirlash, to‘g‘ri javobni belgilash, "Javoblar kaliti" (`11-A 12-B …`) ni birdan qo‘yish, rasmni savol/variantga ko‘chirish yoki boshqa savolga o‘tkazish, "Kursordan bo‘lish" / "Oldingisiga qo‘shish". Natija — "Test yechish" ilovasi o‘qiydigan .docx (rasmlar bilan) yoki .txt (rasmsiz). Eslatma: ilova hozir faqat A–D (4 variant) ni qabul qiladi; 5 variantli (A–E) kitoblar uchun ilovani o‘zgartirish kerak.

## AI rejimi (aniqroq)
"O‘qish usuli" → **AI**. Sahifa rasmi Gemini yoki Claude ga yuboriladi; u savol matnini, formulalarni (LaTeX, `$...$` ichida), A–E variantlarni, chizma joyini va sahifa pastidagi javoblar kalitini (o‘qiy olsa) qaytaradi. Chizmalar AI bergan koordinata bo‘yicha qirqiladi. Kalit: Gemini uchun aistudio.google.com → Get API key (bepul), yoki Claude (`sk-ant-…`). **Bir nechta AI:** "+ AI qo‘shish" bilan istalgancha kalit qo‘shing (masalan, bir nechta Gemini hisobi). Sahifalar ular orasida navbat bilan bo‘linadi: AI 1 — 1, 3, 5…, AI 2 — 2, 4, 6… (tanlangan sahifalar tartibida), hammasi bir vaqtda ishlaydi. Biri limitga yetsa (429) yoki kalit xato bo‘lsa, uning sahifalari qolgan AI larga o‘tadi. Kalit faqat shu brauzerda saqlanadi. **Rasmlar tashqi serverga ketadi** — oflayn rejimda hech qayerga ketmaydi. AI natijasini baribir tekshirib chiqing.

## Boshqa
- Tillar: o‘zbek (lotin/kirill), rus, ingliz (Tesseract, `vendor/tesseract/lang` — oflayn).
- Tarjima: "Tarjima" paneli. Avto — avval brauzer ichidagi oflayn tarjimon (Chrome), bo‘lmasa onlayn (Google): matn serverga ketadi, oldin so‘raladi.
- Kamera: faqat `localhost` da ishlaydi (brauzer ruxsat so‘raydi). Telefonda "Kamera" tugmasi tizim kamerasini ochadi.
- Cheklov: Tesseract formulalarni (kasr, daraja, yunon harflari, vektor strelkasi) ishonchli o‘qimaydi; "ishonch" 70% dan past sahifalar sariq. Past sifatli skan (<150 dpi) aniqlikni keskin tushiradi.
"# ocr" 
