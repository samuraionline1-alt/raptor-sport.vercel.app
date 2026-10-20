# RAPTOR — ผลตรวจซ้ำวันที่ 20 ตุลาคม 2026

## ขอบเขตและสถานะจริง

GitHub `main` ตรวจยืนยันด้วย `git ls-remote`: `3d3e7777944425c6430ae5ab98d797fbc8659739` ยังเป็นโค้ดเดิม ชุดแก้ไขอยู่ใน branch `fix/checkout-security-and-reliability` และยังไม่ deploy รายงานนี้แยกปัญหาของ main/production ออกจากสิ่งที่แก้และทดสอบใน branch ไม่ถือว่า production ปลอดภัยแล้ว

ตรวจ API ทุกตัว, checkout, promotion, wholesale, receipt/analytics, reviews, notifications, SQL permissions/migrations, deployment config, dependency advisories และ inline scripts สินค้า 84 scripts ไม่มีการส่งออเดอร์ แจ้งเตือน หรือชำระเงินจริง

## ลำดับแก้ไขและหลักฐาน

| ระดับ | ปัญหาใน main | ผลกระทบ | สถานะใน branch |
|---|---|---|---|
| P1 | orders/create-checkout-session เชื่อ product/total/subtotal จาก caller ไม่คำนวณ catalog | เปลี่ยนยอด COD หรือยอด Stripe ได้; ราคาส่งไม่มีการตรวจ SKU/ขั้นต่ำ/VAT/ขนส่งบน server | คำนวณจาก catalog, integer satang, reject ยอดไม่ตรง; ทดสอบทุก SKU/tier/coupon และราคาส่ง |
| P1 | success/cancel ยอมรับ `.vercel.app` ทุกโครงการ; URL ใส่ PII และ session ID | ผู้ซื้อที่ใช้ session ของผู้โจมตีอาจถูกส่งไปเว็บอื่น; session ที่รั่วใช้ดึงที่อยู่จาก confirm-payment ได้ | ปลายทางตายตัว/exact configured preview; metadata/URL ไม่มี PII; receipt ต้องมี token และคืนข้อมูลน้อยที่สุด |
| P1 | wholesale ส่งชื่อรวม แต่ไม่ส่ง items; API ตัด product 200 ตัวอักษร | เก็บรายละเอียดต่อ SKU ไม่ครบ แม้เก็บเงินแล้ว; เสี่ยงจัดส่งผิด | มี immutable order items; 10 SKU ผ่าน browser → API → stored order → paid receipt |
| P1 | sync-reviews-seo ฝังข้อความรีวิวใน JSON-LD โดยไม่ escape `<` | รีวิวอันตรายที่ผ่านอนุมัติและถูก sync/deploy อาจปิดแท็ก script แล้วรัน JavaScript | escape JSON สำหรับ HTML; ทดสอบ generator จริงด้วยข้อความปิดแท็ก script |
| P1 | ไม่มี scheduled retry; retry-email วน 50 แถวแรกโดยไม่กรอง sent | COD บันทึกสำเร็จแต่ร้านอาจไม่ทราบ; งานหลังแถว 50 ไม่ถูกส่ง | worker แยกช่องทางพร้อม lease/backoff, cron secret, manual_review; ทดสอบ backlog 65 งาน; ต้องเปิด scheduler จริง |
| P2 | fbq ก่อน checkout try/catch | tracking throw แล้วปุ่มค้าง ไม่ส่ง API | analytics แยก best effort, button recovery และ timeout; ทดสอบ Chromium โดยทำ fbq throw |
| P2 | หน้าขายส่งเชื่อ paid=1; purchase tracking เชื่อ URL/ใช้ Date.now เป็น COD transaction ID | แสดงสถานะสำเร็จโดยไม่ยืนยัน; นับรายได้ซ้ำเมื่อ reload | receipt ต้องตรวจ server; purchase ใช้ order_ref; browser fake-paid/reload tests ผ่าน |
| P2 | ไม่มี application rate limit | สร้างออเดอร์ขยะ/ใช้โควตา LINE/email และทรัพยากร | atomic limit ร่วมกันใน DB ต่อ IP/phone และ origin check; production WAF ยังต้องตรวจ config จริง |
| P2 | Stripe fetch ไม่มี timeout | upstream ค้างจนหมดเวลา function; ลูกค้ารอและส่งซ้ำ | bounded Stripe requests, persisted session binding, retry ใช้ออเดอร์เดิม; lost-acknowledgement test |
| P2 | รีวิวส่ง is_verified=true จาก browser และแสดง badge ทุกใบ | ผู้ไม่ซื้ออาจถูกแสดงเป็นผู้ซื้อจริง; ไม่ทราบ review RLS เดิมทั้งหมด | server เป็นผู้กำหนด approved/verified; ผูก proof กับ paid order+SKU; revoke direct writes/read เฉพาะ approved columns |
| P3 | ไม่มี CSP/frame protection ใน vercel config | ไม่มี defense-in-depth บางส่วน | เพิ่ม enforced frame/base/object/form protections, Permissions-Policy และ script CSP Report-Only |

การทดสอบจำลองรอบแรกยืนยัน COD 100 ชิ้นยอด 1 บาทได้จริงใน handler โดยไม่ส่ง request production หลักฐานนี้ยังใช้กับ main เดิม; ชุดแก้ไขปฏิเสธยอดดังกล่าวแล้ว

## สิ่งที่พบเพิ่มจากรอบตรวจซ้ำ

- Stored XSS ใน `scripts/sync-reviews-seo.mjs`: `JSON.stringify` อย่างเดียวไม่ปลอดภัยเมื่อฝังใน HTML script block เพิ่ม escape `<` และ integration test ที่รัน generator จริงในโฟลเดอร์ชั่วคราว โดยไม่เขียนเว็บจริง
- SDK Resend เดิม log error body เมื่อ `NODE_ENV` ไม่ใช่ production อาจมีข้อมูลส่วนตัวใน preview/local logs; ไม่ใช่หลักฐานว่ามีข้อมูลลูกค้ารั่วจาก production ที่ตั้ง `NODE_ENV=production` เปลี่ยน delivery transport ให้ไม่อ่าน/log error body และเพิ่ม regression assertion
- หน้า wholesale เดิมพึ่ง Tailwind CDN ขณะ runtime ต่างจากหน้าปลีก; เปลี่ยนใช้ compiled CSS/fonts ที่มีในโครงการ ลดการพึ่งบริการภายนอกระหว่างสั่งซื้อ
- พิจารณากรณีสร้าง Stripe session ไม่สำเร็จ: ไม่ควรส่งข้อความว่าลูกค้ากำลังสแกน QR จึง enqueue checkout notification หลังผูก session แล้วเท่านั้น
- บังคับ apex → www เพื่อให้ receipt proof ในแท็บยังอยู่ origin เดียวกันหลังกลับจาก Stripe; preview ใช้เฉพาะ hostname จาก deployment configuration
- งานเก่าที่ไม่แน่ใจว่าส่งแล้ว และอาจพ้น provider deduplication window ถูกจัดเป็น manual_review แทนส่งซ้ำอัตโนมัติ

## หลักฐานจากเว็บจริงแบบอ่านอย่างเดียว

วันที่ตรวจ `https://www.raptorthailand.com/`, `/wholesale/`, `/thank-you/` ตอบ HTTP 200 และยังไม่มี `Content-Security-Policy`/`X-Frame-Options`; `Referrer-Policy` เป็น `strict-origin-when-cross-origin` จึงยืนยันได้ว่า headers ใหม่ยังไม่ขึ้น production

GET `/api/orders` ตอบ 405; `/api/confirm-payment?session_id=invalid` ตอบ 400

Supabase public-key probe ใช้ `limit=0` เท่านั้น ไม่ดึงข้อมูลลูกค้า: `raptor_orders` และ `raptor_line_events` ตอบ 401, `product_reviews` ตอบ 200 การอ่านตารางรีวิวได้ไม่ใช่ช่องโหว่ด้วยตัวเอง และไม่ได้พิสูจน์ว่า anonymous caller เขียน/อนุมัติหรืออ่านแถวที่ซ่อนได้ ไม่ได้ลองเขียนรีวิวจริง

## ผลทดสอบ

- รันชุดเดิมทั้ง 9 ชุดจาก commit main ใน checkout ชั่วคราวหลังติดตั้ง dependency: ผ่านทั้งหมด ยืนยันว่าช่องโหว่เชิง business logic ไม่ได้ถูกครอบคลุมโดย assertions เดิม
- ชุดแก้ไข: `npm test` มี 12 suites รวม PGlite ที่รัน SQL migrations/RPC/RLS จริงใน embedded PostgreSQL, pricing/coupon/tier, webhook signature/replay/amount/session, email/LINE, reviews และ retry เกิน 50 งาน
- `npm run test:browser`: mobile Chromium ใช้หน้า HTML/JS และ route handlers จริงต่อกับ database/service mocks; retail COD/Stripe และ wholesale 10 SKU, tracking throw, lost acknowledgement + retry, fake-paid URL, receipt proof, PII storage และ reload deduplication
- `npm run build` ผ่านสำหรับ local build; production checks จะต้องมี schema/credentials จริง
- `npm audit` ไม่พบ known dependency advisories ณ เวลาตรวจ ไม่ใช่คำรับรองว่า dependency ไม่มีช่องโหว่ทุกชนิด

## สิ่งที่ต้องทำก่อนถือว่าปิดงาน production

1. P1 — Apply migration ใหม่ทั้งสองไฟล์ ตรวจสิทธิ์ target Supabase แล้ว deploy backend/client ชุดเดียวกัน หาก deploy โค้ดใหม่ก่อน migration การสั่งซื้อจะล้มเหลวเพราะขาด RPC
2. P1 — ตั้ง CRON_SECRET และเปิด worker ทุก 5 นาทีด้วย Vercel plan ที่รองรับ หรือ external scheduler ที่ส่ง bearer secret; ตั้ง log alerts และตรวจ queue ค้าง
3. P1 — ทดสอบ Stripe sandbox และ webhook กับบริการจริง รวม PromptPay delayed payment, browser ไม่กลับ receipt และ multi-SKU order; ไม่มี live keys/service role ใน environment นี้ จึงยังรับรองการเชื่อมต่อ production ไม่ได้
4. P2 — ทดสอบการส่ง LINE/email กับปลายทางทดสอบ ตรวจ quota/สิทธิ์ผู้รับ และซ้อม manual_review โดยไม่ replay ออเดอร์เก่า
5. P3 — ย้าย legacy inline scripts ไป nonce/hash ก่อน enforce script CSP; ปัจจุบัน script policy เป็น Report-Only โดยตั้งใจ ส่วน frame/base/object/form protections enforce แล้วใน branch

ดูขั้นตอนเปิดใช้งาน/rollback และข้อจำกัด receipt ใน README โค้ดนี้ยังไม่มี inventory reservation เพราะโครงการไม่มีแหล่ง stock ที่ยืนยันได้ และยังไม่ใช่การทดสอบชำระเงินจริงหรือ full penetration test
