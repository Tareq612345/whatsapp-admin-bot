const assert = require('node:assert/strict');
const test = require('node:test');
const { matchRules, normalizeText, parseStudentCard } = require('../lib/ocr-service');

test('normalizes common Arabic variations', () => {
  assert.equal(normalizeText('  كلية الآداب  '), 'كليه الاداب');
});

test('matches keywords despite whitespace differences', () => {
  const matches = matchRules('كلية التجارة', [
    { id: 'commerce', groupId: 'group@g.us', enabled: true, keywords: ['كليةالتجارة'] }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rule.id, 'commerce');
});

test('extracts labelled student-card fields', () => {
  const fields = parseStudentCard(`
الاسم: أحمد محمد علي
الرقم القومي
30101011234567
الكود: 12345678
البرنامج: نظم معلومات
المستوي: الثالث
العام الجامعي 2025/2026
`);
  assert.equal(fields.studentName, 'أحمد محمد علي');
  assert.equal(fields.nationalId, '30101011234567');
  assert.equal(fields.studentCode, '12345678');
  assert.equal(fields.program, 'نظم معلومات');
  assert.equal(fields.level, 'الثالث');
  assert.equal(fields.academicYear, '2025/2026');
});