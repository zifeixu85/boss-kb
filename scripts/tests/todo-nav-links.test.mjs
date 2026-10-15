import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTodos } from "../check-rules.mjs";

const todoWarnings = (text) => {
  const warnings = [];
  checkTodos(text, "06-项目/近期要事.md", warnings);
  return warnings;
};

test("导航：普通 Markdown 链接不变为待办，也不检查链接文字里的截止", () => {
  assert.deepEqual(todoWarnings([
    "- [生意总览](../03-生意/生意总览.md)",
    "- [协作偏好](../01-AI协作/协作偏好.md)",
    "- [外部说明](https://example.test/guide) · 截止 下周三",
  ].join("\n")), []);
});

test("导航：引用式链接保留为链接", () => {
  assert.deepEqual(todoWarnings("- [生意总览][overview]\n- [协作偏好][]\n[overview]: ../03-生意/生意总览.md"), []);
});

test("导航：Obsidian 双链及别名不变为待办", () => {
  assert.deepEqual(todoWarnings("- [[03-生意/生意总览]]\n- [[01-AI协作/协作偏好|协作偏好]]"), []);
});

test("导航：显示文字带转义右括号的链接不变为待办", () => {
  assert.deepEqual(todoWarnings("- [业务\\]说明](../03-生意/生意总览.md)"), []);
});

test("待办：四种已支持状态仍接受", () => {
  assert.deepEqual(todoWarnings([
    "- [ ] 未开始 · 截止 2026-10-30",
    "- [/] 进行中 · 截止 未定",
    "- [x] 已完成 · 截止 未知",
    "- [-] 已取消",
  ].join("\n")), []);
});

test("待办：相对截止日期仍提醒", () => {
  const warnings = todoWarnings("- [ ] 定包装 · 截止 下周三");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^待办的截止要写成/);
});

test("待办：错误状态和缺少空格仍提醒", () => {
  const warnings = todoWarnings("- [y] 错误状态\n- [] 空状态\n- [ ]没有空格");
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every((w) => w.startsWith("待办格式不对：")));
});

test("待办：事项正文以链接开头，仍检查截止日期", () => {
  const warnings = todoWarnings("- [ ] [复核方案](../方案.md) · 截止 下周三");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^待办的截止要写成/);
});
