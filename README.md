# WhatsApp Admin Bot

بوت إدارة جروبات يعمل بحساب واتساب ويب. يقبل الأوامر من رقم المالك فقط.

## تشغيل سريع

1. ثبّت Node.js 18 أو أحدث.
2. انسخ `.env.example` إلى `.env`.
3. ثبّت الحزم:

```bash
npm install
```

4. شغّل البوت:

```bash
npm start
```

5. سيظهر QR في الطرفية. افتح واتساب على **رقم البوت** ثم الأجهزة المرتبطة ثم اربط جهازًا جديدًا.
6. اجعل رقم البوت Admin في الجروبات التي سيقفلها أو يفحصها أو يطرد منها.
7. أرسل الأوامر من رقم المالك المحدد في `.env`.

## الوضع الآمن

يبدأ المشروع بـ `DRY_RUN=true`. في هذا الوضع سيكتشف المحظورين وطلبات الانضمام ويسجل الإجراء بدون طرد أو قبول أو رفض فعلي.

بعد التأكد من الإعدادات، غيّرها إلى:

```env
DRY_RUN=false
```

ثم أعد التشغيل.

## الأوامر

```text
!help
!ping
!status
!groups
!logs
!group-info
!dry-run on|off
!lock
!unlock
!lock-duration 5
!rate-limit 25 60
!rate-limit off
!set-blocked-group
!add-target
!remove-target
!sync-blocked
!auto-sync on|off
!check-number 201234567890
!exception-add 201234567890
!exception-remove 201234567890
!set-approval-group
!set-allow-group
!approval-on
!approval-off
!approval-mode blacklist|allowlist
!approve-pending
!reject-blocked
!scan-group
!member-check 201234567890
!remove 201234567890
!promote 201234567890
!demote 201234567890
```

أوامر `!set-blocked-group` و`!add-target` و`!set-approval-group` و`!set-allow-group` يجب إرسالها داخل الجروب المقصود.

## ملاحظات

- رقم المالك يتحكم في الأوامر، لكن رقم البوت نفسه يجب أن يكون Admin لتنفيذ إجراءات الإدارة.
- لا تستخدم رقمك الأساسي في التجربة الأولى.
- لا تشارك مجلد `.wwebjs_auth` لأنه يحتوي على جلسة تسجيل الدخول.
