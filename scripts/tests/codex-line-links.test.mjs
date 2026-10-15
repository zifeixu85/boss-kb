import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit } from '../init.mjs';
import { checkKnowledgeBase } from '../check.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'r2-line-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  runInit(root, { date: '2026-10-15' });
  const target = join(root, '99-原始材料', '规则.md');
  writeFileSync(target, '# 规则\n');
  return { root, target, check(href) {
    writeFileSync(join(root, '99-原始材料', '访谈.md'), `# 原话\n[出处](<${href}>)\n`);
    return checkKnowledgeBase(root).errors.filter(e => e.startsWith('链接指向不存在的文件：'));
  } };
}
test('Codex 绝对本地文件链接的正整数行号后缀不属于文件名', t => {
  const f = fixture(t);
  assert.deepEqual(f.check(`${f.target}:60`), []);
});
test('空格和中文路径经角括号或百分号编码仍识别行号', t => {
  const f = fixture(t), path = join(f.root, '99-原始材料', '甲 规则.md');
  writeFileSync(path, '# 原文');
  assert.deepEqual(f.check(`${path}:2`), []);
  assert.deepEqual(f.check(`${encodeURI(path)}:2`), []);
});
test('已有普通相对和绝对链接照旧检查', t => {
  const f = fixture(t);
  assert.deepEqual(f.check(f.target), []);
  assert.deepEqual(f.check('规则.md'), []);
});
test('绝对链接真实缺文件，即使带行号仍报错', t => {
  const f = fixture(t), href = join(f.root, '不存在.md') + ':60';
  assert.equal(f.check(href).length, 1);
  assert.ok(f.check(href)[0].endsWith(href));
});
test('字面冒号文件优先，冒号后非行号不截断', t => {
  const f = fixture(t), path = join(f.root, '99-原始材料', '原件.md:60');
  writeFileSync(path, '# 字面文件名');
  assert.deepEqual(f.check(path), []);
  assert.equal(f.check(`${f.target}:评审`).length, 1);
});
test('字面冒号文件可以存在而去后缀路径不存在', t => {
  const f = fixture(t), path = join(f.root, '99-原始材料', '没有基础文件.md:2');
  writeFileSync(path, '# 冒号文件');
  assert.deepEqual(f.check(path), []);
});
test('零、负数、非数字、列号不扩展为行号语法', t => {
  const f = fixture(t);
  for (const suffix of [':0', ':-1', ':abc', ':01', ':60:2']) assert.equal(f.check(f.target + suffix).length, 1, suffix);
});
test('行号后缀必须指向文件，不把目录当文件', t => {
  const f = fixture(t), dir = join(f.root, '99-原始材料', '一个目录');
  mkdirSync(dir);
  assert.equal(f.check(`${dir}:2`).length, 1);
});
test('相对带冒号名保持字面语义，缺文件仍报错', t => {
  const f = fixture(t);
  assert.equal(f.check('./规则.md:60').length, 1);
  writeFileSync(join(f.root, '99-原始材料', '规则.md:60'), '# 字面文件');
  assert.deepEqual(f.check('./规则.md:60'), []);
});
test('存在的绝对文件加锚点仍照旧通过', t => {
  const f = fixture(t);
  assert.deepEqual(f.check(`${f.target}#规则`), []);
});
