// 运行：node --test scripts/tests/maintain.test.mjs
// 只在 mkdtemp 的临时目录里造库：先用 init.mjs 搭骨架，再按需要加文件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync, lstatSync, appendFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { maintainKnowledgeBase, renderReport, summaryText, CATEGORIES } from "../maintain.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const DAY = "2026-10-27";
const tmp = () => mkdtempSync(join(tmpdir(), "boss-kb-maintain-"));
const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const readText = (root, path) => readFileSync(join(root, path), "utf8");
const note = (fields, text = "正文。") => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${text}\n`;
const base = (extra = {}) => ({ 更新: "2026-10-20", 确认: "待确认", 隐私: "内部", 来源: "99-原始材料/采访记录/2026-10-20-建库采访.md", ...extra });
const customer = (name, extra = {}, text) => note(base({ 类型: "客户", 名称: name, 分组: "企业客户", 阶段: "报价中", 联系人: "行政", 上次联系: "2026-10-18", 下次跟进: "未定", ...extra }), text);
const run = (...args) => spawnSync(process.execPath, [join(SCRIPTS, "maintain.mjs"), ...args], { encoding: "utf8" });
const SUMMARY_LINE = /维护体检：冗余 \d+ · 问题 \d+ · 过期 \d+ · 积压 \d+ · 体量 \d+ · 结构建议 \d+/;

/** 用 init.mjs 搭一个骨架（extra 是 init 的参数，比如就地建图的 --map） */
function newKb(extra = [], prepare = () => {}) {
  const root = tmp();
  prepare(root);
  const r = spawnSync(process.execPath, [join(SCRIPTS, "init.mjs"), root, "--name", "王总", "--shop", "小店", "--date", "2026-10-20", ...extra], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return root;
}

/** 全库每个文件（含隐藏文件）的哈希 */
function snapshot(root) {
  const out = new Map();
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (lstatSync(p).isDirectory()) visit(p);
      else out.set(relative(root, p).split(sep).join("/"), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  visit(root);
  return out;
}

const scan = (root, opts = {}) => maintainKnowledgeBase(root, { date: DAY, ...opts });
const itemsOf = (res, key, kind) => res.categories[key].items.filter((i) => !kind || i.kind === kind);
const allPaths = (items) => items.flatMap((i) => i.paths);

test("命令行：--help、不认识的参数、没给路径、文件夹不存在、不像知识库、日期和天数写错", () => {
  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /用法：node maintain\.mjs/);
  assert.match(help.stdout, /--stale-days/);
  assert.equal(run("--nope").status, 1);
  const none = run();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /没给知识库/);
  assert.equal(run(join(tmp(), "没有这个文件夹")).status, 2);
  const empty = run(tmp());
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /不像老板知识库/);
  const root = newKb();
  for (const args of [["--date", "2026-13-01"], ["--date", "明天"], ["--stale-days", "abc"], ["--inbox-days", "0"], ["--write=1"]]) {
    const r = run(root, ...args);
    assert.equal(r.status, 1, `${args.join(" ")} 应该报参数错误`);
  }
  // 被 import 时不执行：本文件顶部已经 import 过，进程还活着、导出都在
  assert.equal(typeof maintainKnowledgeBase, "function");
  assert.deepEqual(CATEGORIES.map((c) => c.label), ["冗余", "问题", "过期", "积压", "体量", "结构建议"]);
});

test("不带 --write：只读，跑前跑后全库哈希一致；stdout 是 JSON，stderr 一行结论", () => {
  const root = newKb();
  write(root, "04-客户/老客甲.md", customer("老客甲", {}, "坏链接 [[没有这份]]。"));
  write(root, "04-客户/企业客户/老客甲.md", customer("老客甲"));
  write(root, "00-收件箱/2026-09-01-老客甲-微信.md", "老客甲：下周来拿货。\n");
  write(root, "杂物/随手.md", "随手记。\n");
  const before = snapshot(root);
  const r = run(root, "--date", DAY);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(snapshot(root), before);
  const out = JSON.parse(r.stdout);
  assert.match(r.stderr, SUMMARY_LINE);
  assert.equal(r.stderr.trim().split("\n").length, 1);
  assert.equal(out.date, DAY);
  assert.equal(out.report, null);
  for (const c of CATEGORIES) {
    assert.ok(Array.isArray(out.categories[c.key].items), c.key);
    assert.equal(out.counts[c.key], out.categories[c.key].count, c.key);
  }
  assert.equal(out.summary, summaryText(out));
  for (const item of CATEGORIES.flatMap((c) => out.categories[c.key].items)) {
    for (const k of ["kind", "where", "paths", "why", "suggest", "confirm"]) assert.ok(k in item, `缺 ${k}`);
    assert.equal(typeof item.confirm, "boolean");
  }
});

test("冗余：同类型同名或别名的档案；不同类型、README、99、模板不算", () => {
  const root = newKb();
  write(root, "04-客户/王总.md", customer("王总"));
  write(root, "04-客户/企业客户/王总.md", customer("王总"));
  write(root, "04-客户/老王.md", customer("老王", { 别名: "王老板、王 总" }));
  write(root, "04-客户/李姐.md", customer("李姐"));
  write(root, "06-项目/王总.md", note(base({ 类型: "项目", 名称: "王总", 状态: "进行中", 截止: "未定", 负责人: "王总" })));
  write(root, "99-原始材料/聊天与通话/王总.md", note({ 类型: "客户", 名称: "王总" }));
  write(root, "01-AI协作/模板/客户.md", customer("王总"));
  const res = scan(root);
  const dup = itemsOf(res, "redundancy", "同名档案");
  assert.equal(dup.length, 1);
  assert.deepEqual([...dup[0].paths].sort(), ["04-客户/企业客户/王总.md", "04-客户/王总.md", "04-客户/老王.md"]);
  assert.equal(dup[0].confirm, true);
  assert.match(dup[0].why, /客户/);
});

test("冗余：同一份客户档案被两个分组都收了；同组里嵌套的子文件夹不算", () => {
  const root = newKb();
  write(root, "04-客户/渠道客户/李总.md", customer("李总", { 分组: "渠道客户" }));
  write(root, "04-客户/企业客户/赵总.md", customer("赵总"));
  write(root, "04-客户/企业客户/华东/钱总.md", customer("钱总"));
  write(root, "04-客户/企业客户/README.md", `# 企业客户｜这一组的说明\n\n## 索引\n| 客户 | 一句话 | 文件 |\n|---|---|---|\n| 赵总 | 老客 | [赵总.md](赵总.md) |\n| 钱总 | 华东 | [华东/钱总.md](华东/钱总.md) |\n| 李总 | 也买茶礼 | [李总](../渠道客户/李总.md) |\n`);
  write(root, "04-客户/企业客户/华东/README.md", `# 华东\n\n## 索引\n| 客户 | 文件 |\n|---|---|\n| 钱总 | [钱总.md](钱总.md) |\n`);
  write(root, "04-客户/渠道客户/README.md", `# 渠道客户\n\n## 索引\n| 客户 | 文件 |\n|---|---|\n| 李总 | [李总.md](李总.md) |\n`);
  // 拆成文件夹的客户：孙总/ 是他自己的文件夹，不是分组；客户层 README 写他在“企业客户”组，只算一个组
  write(root, "04-客户/孙总/档案.md", customer("孙总"));
  write(root, "04-客户/孙总/README.md", `# 孙总\n\n## 索引\n| 文件 |\n|---|\n| [档案.md](档案.md) |\n`);
  write(root, "04-客户/README.md", `${readText(root, "04-客户/README.md")}\n| 名称 | 分组 | 文件 |\n|---|---|---|\n| 孙总 | 企业客户 | [孙总/档案.md](孙总/档案.md) |\n`);
  const res = scan(root);
  const twice = itemsOf(res, "redundancy", "两个分组都收了");
  assert.equal(twice.length, 1);
  assert.deepEqual(twice[0].paths, ["04-客户/渠道客户/李总.md"]);
  assert.match(twice[0].why, /企业客户/);
  assert.match(twice[0].why, /渠道客户/);
});

test("冗余：整理稿之间一模一样的大段文字（去掉空白后 40 字以上）；短的、README、99 里的不算", () => {
  const root = newKb();
  const para = "这家客户每年春节和中秋都会订员工礼，预算要等行政那边审批，一般提前一个月来问，喜欢岩茶配白瓷盖碗的组合。";
  const short = "每年春节都订员工礼，喜欢岩茶。";
  write(root, "03-生意/产品与服务/岩茶礼盒.md", note(base({ 类型: "产品", 名称: "岩茶礼盒" }), `## 卖给谁\n${para}\n\n${short}`));
  write(root, "06-项目/春节.md", note(base({ 类型: "项目", 名称: "春节", 状态: "进行中", 截止: "未定", 负责人: "王总" }), `前言。\n\n${para.replace("，", " ， ")}\n\n${short}`));
  write(root, "99-原始材料/聊天与通话/2026-10-01-甲-微信.md", para);
  write(root, "05-方法与判断/README.md", `${readText(root, "05-方法与判断/README.md")}\n${para}\n`);
  const res = scan(root);
  const dup = itemsOf(res, "redundancy", "重复段落");
  assert.equal(dup.length, 1);
  assert.deepEqual([...dup[0].paths].sort(), ["03-生意/产品与服务/岩茶礼盒.md", "06-项目/春节.md"]);
  assert.match(dup[0].why, /1 段/);
  assert.match(dup[0].why, /第 \d+ 行/);
  // 干净的骨架：init 生成的文件之间不报重复
  assert.equal(itemsOf(scan(newKb()), "redundancy").length, 0);
});

test("冗余：文件开头的引用说明、“来源”小节、只靠链接凑够字数的指路句不算重复", () => {
  const root = newKb();
  const quote = "> 示例数据，全部虚构。阶段、上次联系、下次跟进是 2026-10-25 的建库快照；装了工作台以后以工作台为准。";
  const pointer = "商品和价格见 [零售商品清单](../03-生意/产品与服务/零售商品清单.md)，这里不重抄。";
  const cite = "- 数据：小红书专业号后台“笔记数据”导出，截至 2026-10-25，见作品索引；原话见建库采访 10/25 补访。";
  for (const name of ["甲", "乙"]) {
    write(root, `04-客户/${name}.md`, customer(name, {}, `${quote}\n\n${pointer}\n\n## 来源\n${cite}`));
  }
  assert.equal(itemsOf(scan(root), "redundancy", "重复段落").length, 0);
});

test("问题：两种链接都认，断的报出来；代码里的、能找到的不报；可公开的文件来源是私密的", () => {
  const root = newKb();
  write(root, "04-客户/王总.md", customer("王总"));
  write(root, "04-客户/README.md", `${readText(root, "04-客户/README.md")}\n| 王总 | [[04-客户/王总\\|王总]] |\n`);
  const links = [
    "能找到：[[04-客户/王总]]、[[王总]]、[[王总|老王]]、[[04-客户/王总.md#往来记录]]、[王总](../04-客户/王总.md)",
    "断了：[[04-客户/没有这份]]、[[没有这个人|别名]]、[报价](../03-生意/没有.md)",
    "`[[代码里的不算]]`",
    "```",
    "[[代码块里的也不算]]",
    "```",
  ].join("\n");
  write(root, "06-项目/春节.md", note(base({ 类型: "项目", 名称: "春节", 状态: "进行中", 截止: "未定", 负责人: "王总" }), links));
  write(root, "03-生意/公开介绍.md", note(base({ 类型: "生意", 隐私: "可公开" })));
  // 收件箱里贴来的笔记：双链多半来自别的软件，不报
  write(root, "00-收件箱/2026-10-25-我-备忘录.md", "从别的笔记软件贴来的：[[外部笔记]]\n");
  const res = scan(root);
  const broken = itemsOf(res, "problems", "断链");
  assert.deepEqual(broken.map((i) => i.link).sort(), ["../03-生意/没有.md", "04-客户/没有这份", "没有这个人"].sort());
  assert.ok(broken.every((i) => i.paths[0] === "06-项目/春节.md" && /第 \d+ 行/.test(i.where)));
  const privacy = itemsOf(res, "problems", "隐私对不上");
  assert.equal(privacy.length, 1);
  assert.deepEqual(privacy[0].paths, ["03-生意/公开介绍.md", "99-原始材料/采访记录/2026-10-20-建库采访.md"]);
  assert.equal(privacy[0].confirm, true);
  const check = res.categories.problems.check;
  assert.equal(check.ran, true);
  assert.equal(typeof check.errors, "number");
  assert.equal(typeof check.warnings, "number");
  assert.ok(check.errors > 0, "骨架还没填，体检应该有错误");
  assert.ok(check.top_errors.length > 0 && check.top_errors.length <= 5);
  assert.equal(res.counts.problems, check.counted + broken.length + privacy.length);
});

test("过期：更新太久、已过期、复核日期过了；复核写事件的单独列；任务手册不算", () => {
  const root = newKb();
  write(root, "03-生意/产品与服务/老礼盒.md", note(base({ 类型: "产品", 名称: "老礼盒", 更新: "2026-06-01" })));
  write(root, "03-生意/产品与服务/新礼盒.md", note(base({ 类型: "产品", 名称: "新礼盒", 更新: "2026-10-01" })));
  write(root, "03-生意/产品与服务/旧价目.md", note(base({ 类型: "产品", 名称: "旧价目", 确认: "已过期" })));
  write(root, "03-生意/产品与服务/月饼礼盒.md", note(base({ 类型: "产品", 名称: "月饼礼盒", 复核: "2026-10-01" })));
  write(root, "03-生意/产品与服务/春节礼盒.md", note(base({ 类型: "产品", 名称: "春节礼盒", 复核: "春节后" })));
  write(root, "01-AI协作/任务手册/旧手册.md", note(base({ 类型: "任务手册", 更新: "2025-01-01", 确认: "已确认" })));
  const res = scan(root);
  assert.deepEqual(allPaths(itemsOf(res, "stale", "很久没更新")), ["03-生意/产品与服务/老礼盒.md"]);
  assert.match(itemsOf(res, "stale", "很久没更新")[0].why, /148 天/);
  assert.deepEqual(allPaths(itemsOf(res, "stale", "已过期")), ["03-生意/产品与服务/旧价目.md"]);
  assert.deepEqual(allPaths(itemsOf(res, "stale", "到了复核时间")), ["03-生意/产品与服务/月饼礼盒.md"]);
  assert.deepEqual(res.categories.stale.review_events.map((e) => e.path), ["03-生意/产品与服务/春节礼盒.md"]);
  assert.equal(res.counts.stale, 3);
  // --stale-days 放宽到 200 天，老礼盒就不算了
  assert.equal(itemsOf(scan(root, { staleDays: 200 }), "stale", "很久没更新").length, 0);
});

test("积压：收件箱数量和最老天数（更新 → 文件名日期 → 修改时间）、待确认的文件、没处理的发现", () => {
  const root = newKb();
  write(root, "00-收件箱/2026-10-01-老客甲-微信.md", "老客甲：下周来拿货。\n");
  write(root, "00-收件箱/随手记.md", note({ 类型: "原始材料", 更新: "2026-10-25" }, "想做一个会员日。"));
  write(root, "04-客户/老客甲.md", customer("老客甲", { 更新: "2026-09-01" }));
  write(root, "04-客户/老客乙.md", customer("老客乙", { 确认: "已确认" }));
  write(root, "90-持续生长/待确认的发现.md", note(base({ 类型: "发现清单" }), [
    "# 待确认的发现", "",
    "## 发现 1｜老客户转介绍多", "- 看到的：3 家", "- 采纳后写到：05-方法与判断（不采纳：卡留着）", "- 状态：待确认", "",
    "## 发现 2｜易碎品要加护角", "- 状态：已采纳 → 写到了 05-方法与判断/售后与补偿.md", "",
    "## 发现 3｜开头直接说事", "- 看到的：改稿 1 次", "",
  ].join("\n")));
  const res = scan(root, { inboxDays: 14 });
  const backlog = res.categories.backlog;
  assert.equal(backlog.inbox.count, 2);
  assert.equal(backlog.inbox.oldest_days, 26);
  assert.deepEqual(backlog.inbox.overdue.map((x) => [x.path, x.days, x.basis]), [["00-收件箱/2026-10-01-老客甲-微信.md", 26, "文件名"]]);
  assert.equal(backlog.pending.count, 2); // 老客甲 + 待确认的发现.md（init 的骨架没有待确认的整理稿）
  assert.equal(backlog.pending.oldest[0].path, "04-客户/老客甲.md");
  assert.equal(backlog.findings.total, 3);
  assert.equal(backlog.findings.unprocessed, 2);
  assert.deepEqual(itemsOf(res, "backlog").map((i) => i.kind), ["收件箱没整理", "待确认的文件", "没回的发现"]);
  assert.ok(itemsOf(res, "backlog").every((i) => i.confirm));
});

test("体量：超过 300 行、往来超过 20 条、一个文件夹 30 份以上、AGENTS.md 超过 10 KB", () => {
  const root = newKb();
  const long = Array.from({ length: 320 }, (_, i) => `第 ${i + 1} 行`).join("\n");
  write(root, "05-方法与判断/长文件.md", note(base({ 类型: "做法", 工作: "报价" }), long));
  const trail = (n) => Array.from({ length: n }, (_, i) => `- 2026-09-${String((i % 28) + 1).padStart(2, "0")}｜微信｜聊了第 ${i + 1} 次；答应：无；来源：我口述`).join("\n");
  write(root, "04-客户/老客甲.md", customer("老客甲", {}, `## 往来记录\n${trail(21)}`));
  write(root, "04-客户/老客乙.md", customer("老客乙", {}, `## 往来记录\n${trail(20)}`));
  for (let i = 1; i <= 30; i += 1) write(root, `05-方法与判断/样本库/样本${i}.md`, note(base({ 类型: "判断样本", 工作: "报价" })));
  for (let i = 1; i <= 29; i += 1) write(root, `05-方法与判断/话术库/话术${i}.md`, note(base({ 类型: "话术", 工作: "报价" })));
  appendFileSync(join(root, "AGENTS.md"), `\n## 我加的规矩\n${"- 多写的规矩，凑够字节数。\n".repeat(400)}`);
  const res = scan(root);
  assert.deepEqual(allPaths(itemsOf(res, "size", "文件太长")), ["05-方法与判断/长文件.md"]);
  assert.deepEqual(allPaths(itemsOf(res, "size", "往来太多")), ["04-客户/老客甲.md"]);
  assert.match(itemsOf(res, "size", "往来太多")[0].why, /21 条/);
  assert.deepEqual(allPaths(itemsOf(res, "size", "文件夹太满")), ["05-方法与判断/样本库"]);
  assert.deepEqual(allPaths(itemsOf(res, "size", "AGENTS.md 偏大")), ["AGENTS.md"]);
});

test("结构信号：固定层只有 README、生长模块只有 README、计划超过 30 天、根目录有地图里没写的文件夹", () => {
  const root = newKb();
  write(root, "02-关于我/基本情况.md", note(base({ 类型: "关于我" })));
  write(root, "10-作品库/README.md", "# 10-作品库｜这一层的说明\n");
  write(root, "杂物/随手.md", "随手记。\n");
  const profile = readText(root, "01-AI协作/建库档案.md").replace("|---|---|---|---|\n", [
    "|---|---|---|---|",
    "| 作品库 | 10-作品库/ | 一周发三篇 | 第 9 题 |",
    "| 案例库 | （计划） | 要拿案例说服新客户 | 2026-08-01 访谈 |",
    "| 门店与会员 | （计划） | 想开门店 | 2026-10-20 访谈 |",
    "",
  ].join("\n"));
  write(root, "01-AI协作/建库档案.md", profile);
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("| 99-原始材料 |", "| 10-作品库 | 我的作品 | 写内容时 |\n| 99-原始材料 |"));
  const res = scan(root);
  const empty = itemsOf(res, "structure", "层是空的").map((i) => i.paths[0]).sort();
  assert.deepEqual(empty, ["03-生意", "04-客户", "05-方法与判断", "06-项目", "90-持续生长"]);
  assert.equal(itemsOf(res, "structure", "层是空的").find((i) => i.paths[0] === "90-持续生长").confirm, false);
  assert.deepEqual(allPaths(itemsOf(res, "structure", "模块只有 README")), ["10-作品库"]);
  const planned = itemsOf(res, "structure", "计划太久");
  assert.equal(planned.length, 1);
  assert.match(planned[0].why, /案例库/);
  assert.match(planned[0].why, /87 天/);
  assert.deepEqual(allPaths(itemsOf(res, "structure", "地图里没写")), ["杂物"]);
});

test("--write：只多出一份报告；同名加 -2、-3；开头固定；报告不算进下一次的信号", () => {
  const root = newKb();
  write(root, "04-客户/老客甲.md", customer("老客甲"));
  write(root, "00-收件箱/2026-10-01-老客甲-微信.md", "老客甲：下周来拿货。\n");
  const before = snapshot(root);
  const first = run(root, "--write", "--date", DAY);
  assert.equal(first.status, 0, first.stderr);
  const out = JSON.parse(first.stdout);
  const name = `90-持续生长/体检/${DAY}-维护报告.md`;
  assert.equal(out.report, name);
  assert.match(first.stderr, SUMMARY_LINE);
  assert.match(first.stderr, new RegExp(`报告写在 ${name}`));
  const after = snapshot(root);
  assert.deepEqual([...after.keys()].filter((k) => !before.has(k)), [name]);
  for (const [k, h] of before) assert.equal(after.get(k), h, `${k} 被改了`);

  const text = readText(root, name);
  assert.ok(text.startsWith(`---\n类型: 体检报告\n更新: ${DAY}\n确认: 待确认\n隐私: 内部\n来源: 01-AI协作/建库档案.md\n---\n`));
  for (const c of CATEGORIES) assert.match(text, new RegExp(`^## .*${c.label}`, "m"));
  assert.match(text, /我可以直接改的/);
  assert.match(text, /要你确认的/);
  assert.match(text, /^## 本月结构建议$/m);
  assert.match(text, /^## 下次访谈可以问$/m);
  assert.equal(text, renderReport(out));

  const second = run(root, "--write", "--date", DAY);
  const third = run(root, "--write", "--date", DAY);
  assert.equal(JSON.parse(second.stdout).report, `90-持续生长/体检/${DAY}-维护报告-2.md`);
  assert.equal(JSON.parse(third.stdout).report, `90-持续生长/体检/${DAY}-维护报告-3.md`);
  assert.equal(readText(root, name), text, "第一份不能被覆盖");
  // 报告自己不算进待确认、重复段落
  const again = scan(root);
  assert.equal(again.categories.backlog.pending.count, out.categories.backlog.pending.count);
  assert.equal(itemsOf(again, "redundancy").length, 0);
});

test("示例库：拒绝 --write（退出码 1，什么都不写）；不带 --write 照常输出", () => {
  const root = newKb();
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md").replace("格式: 老板知识库/2\n", "格式: 老板知识库/2\n示例: 是\n演示日期: 2026-10-27\n"));
  const before = snapshot(root);
  const refused = run(root, "--write");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /这是示例库，只读体检，不写报告/);
  assert.deepEqual(snapshot(root), before);
  const ok = run(root);
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.equal(out.sample_kb, true);
  assert.equal(out.date, "2026-10-27");
  assert.equal(out.date_source, "演示日期");
  assert.deepEqual(snapshot(root), before);
});

test("就地建图：按目录对应换算位置；不进“不读”的文件夹；“只读”的只计数", () => {
  const root = newKb(["--map", "04-客户=客户资料,90-持续生长=成长记录", "--readonly", "报价", "--exclude", "日记"], (r) => {
    write(r, "客户资料/张总.md", "# 张总\n老朋友，做外贸。[[没有的笔记]]\n");
    write(r, "成长记录/想法.md", "# 想法\n以后开个门店。\n");
    write(r, "报价/2026报价单.md", "# 报价单\n[[没有的报价]]\n");
    write(r, "日记/2026-10-01.md", `${customer("张总", {}, "[[日记里的坏链接]]")}${"一行\n".repeat(400)}`);
    write(r, "日记/私事.md", customer("张总"));
  });
  write(root, "客户资料/张总档案.md", customer("张总"));
  write(root, "客户资料/外贸/张总.md", customer("张总"));
  const res = scan(root);
  const text = JSON.stringify(res);
  assert.ok(!text.includes("日记/2026-10-01") && !text.includes("日记/私事") && !text.includes("日记里的坏链接"), "不读的文件夹里的东西不能出现");
  assert.ok(!text.includes("没有的报价"), "只读文件夹不查内容");
  assert.ok(!text.includes("没有的笔记"), "老板原有的文件不查链接");
  assert.deepEqual(res.scope.readonly, [{ folder: "报价", files: 1 }]);
  assert.deepEqual(res.scope.noread, ["日记"]);
  assert.deepEqual([...itemsOf(res, "redundancy", "同名档案")[0].paths].sort(), ["客户资料/外贸/张总.md", "客户资料/张总档案.md"]);
  assert.equal(res.layout["90-持续生长"], "成长记录");
  // 成长记录 里有老板原有的文件，不算空层；地图里都写了，没有“地图里没写”
  assert.ok(!itemsOf(res, "structure", "层是空的").some((i) => i.paths[0] === "成长记录"));
  assert.equal(itemsOf(res, "structure", "地图里没写").length, 0);
  const before = snapshot(root);
  const w = run(root, "--write", "--date", DAY);
  assert.equal(w.status, 0, w.stderr);
  const name = `成长记录/体检/${DAY}-维护报告.md`;
  assert.equal(JSON.parse(w.stdout).report, name);
  assert.deepEqual([...snapshot(root).keys()].filter((k) => !before.has(k)), [name]);
  const report = readText(root, name);
  assert.ok(!report.includes("日记/2026-10-01") && !report.includes("私事"), "报告里也不列不读文件夹里的东西");
});

// ───────────── 10/11 复核：体检结果按条分“直接改 / 要你确认”，不在两节里说两遍；Obsidian 只看建库档案 ─────────────

/** 报告里某一类的“我可以直接改的”和“要你确认的”两段文字 */
function reportParts(res, label) {
  const report = renderReport(res);
  const part = report.split(new RegExp(`^## .、${label}$`, "m"))[1].split(/^## /m)[0];
  const [direct, confirm] = part.split("### 要你确认的");
  return { report, direct, confirm };
}

test("问题：体检结果一条一条列；纯格式的（字段、日期、表格、索引、来源写法、能找到新位置）进“我可以直接改的”，敏感信息、缺内容、隐私、找不到新位置的进“要你确认的”", () => {
  const root = newKb();
  write(root, "03-生意/丁.md", "---\n类型：产品\n名称: 丁\n更新: 2026-10-20\n确认: 待确认\n隐私: 内部\n来源: 采访\n---\n\n正文。\n");
  write(root, "03-生意/戊.md", note(base({ 类型: "产品", 名称: "戊", 更新: "上周" })));
  write(root, "03-生意/己.md", note(base({ 类型: "产品", 名称: "己" }), "| 档 | 价格 |\n|---|---|\n| 小份 | 38 | 多一格 |"));
  write(root, "03-生意/庚.md", note(base({ 类型: "产品", 名称: "庚", 来源: "[[99-原始材料/采访记录/2026-10-20-建库采访]]" })));
  write(root, "99-原始材料/聊天与通话/2026-10-01-老客甲-微信.md", "老客甲：下周来拿货。\n");
  write(root, "03-生意/辛.md", note(base({ 类型: "产品", 名称: "辛", 来源: "99-原始材料/2026-10-01-老客甲-微信.md" })));
  write(root, "03-生意/壬.md", note(base({ 类型: "产品", 名称: "壬", 来源: "99-原始材料/没有这份.md" })));
  write(root, "03-生意/癸.md", note(base({ 类型: "产品", 名称: "癸", 隐私: "公开" })));
  write(root, "04-客户/老客甲.md", customer("老客甲", {}, "手机 13812345678"));
  const res = scan(root);
  const problems = itemsOf(res, "problems");
  const shown = () => problems.map((i) => `${i.confirm ? "问" : "改"}｜${i.why}`).join("\n");
  const one = (re) => {
    const hit = problems.filter((i) => re.test(i.why));
    assert.equal(hit.length, 1, `${re} 应该正好一条：\n${shown()}`);
    return hit[0];
  };
  assert.ok(!problems.some((i) => i.kind === "体检结果"), `不再把体检结果整包算一条：\n${shown()}`);
  for (const re of [/开头元信息要用英文冒号：03-生意\/丁\.md/, /“更新”要写成 2026-10-25 这样的日期：03-生意\/戊\.md/, /03-生意\/己\.md 第 \d+ 行的表格有 3 格/,
    /来源写从知识库根目录起的 \.md 路径，不写双链：03-生意\/庚\.md/, /04-客户\/README\.md 的索引里没有 老客甲\.md/]) {
    assert.equal(one(re).confirm, false, `${re} 是纯格式问题，我可以直接改：\n${shown()}`);
  }
  const moved = one(/来源文件不存在：03-生意\/辛\.md/);
  assert.equal(moved.confirm, false, "来源能找到新位置的，直接改");
  assert.match(moved.suggest, /99-原始材料\/聊天与通话\/2026-10-01-老客甲-微信\.md/);
  assert.equal(one(/来源文件不存在：03-生意\/壬\.md/).confirm, true, "找不到新位置的要问");
  for (const re of [/有手机号，这份没标私密：04-客户\/老客甲\.md/, /“隐私”只能是/, /快速版建议至少 3 个/, /还没有判断样本/, /建库档案的“类型画像”还是空的/, /AGENTS\.md 还有 \d+ 处没填的占位/]) {
    assert.equal(one(re).confirm, true, `${re} 要你确认：\n${shown()}`);
  }
  assert.deepEqual(one(/这份没标私密/).paths, ["04-客户/老客甲.md"]);
  assert.equal(one(/这份没标私密/).kind, "敏感信息");
  const check = res.categories.problems.check;
  assert.equal(check.counted, problems.filter((i) => !["断链", "隐私对不上"].includes(i.kind)).length);
  assert.equal(res.counts.problems, problems.length);
  // 报告：手机号、缺内容在“要你确认的”，冒号在“我可以直接改的”
  const { direct, confirm } = reportParts(res, "问题");
  assert.match(direct, /开头元信息要用英文冒号/);
  assert.doesNotMatch(direct, /这份没标私密|快速版建议至少 3 个|还没有判断样本/);
  assert.match(confirm, /这份没标私密/);
  assert.match(confirm, /快速版建议至少 3 个/);
  assert.doesNotMatch(confirm, /开头元信息要用英文冒号/);
});

test("问题和结构建议不说两遍：地图里没写的文件夹、只有说明的层、只有 README 的模块、AGENTS.md 太大，只在别的那一节出现；没定装什么的文件夹里的文件先问", () => {
  const root = newKb();
  write(root, "杂物/随手.md", "随手记。\n");
  write(root, "10-作品库/README.md", "# 10-作品库｜这一层的说明\n");
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md").replace("|---|---|---|---|\n", "|---|---|---|---|\n| 作品库 | 10-作品库/ | 一周发三篇 | 第 9 题 |\n"));
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("| 99-原始材料 |", "| 10-作品库 | 我的作品 | 写内容时 |\n| 99-原始材料 |"));
  appendFileSync(join(root, "AGENTS.md"), `\n${"- 多写的规矩，凑够字节数。\n".repeat(400)}`);
  const res = scan(root);
  const problems = itemsOf(res, "problems");
  const whys = problems.map((i) => i.why).join("\n");
  assert.deepEqual(allPaths(itemsOf(res, "structure", "地图里没写")), ["杂物"]);
  assert.ok(!/杂物\/ 不在地图里/.test(whys), `“杂物/ 不在地图里”只留在结构建议：\n${whys}`);
  const empty = itemsOf(res, "structure", "层是空的").map((i) => i.paths[0]);
  assert.ok(empty.includes("05-方法与判断"), empty.join("、"));
  assert.ok(!/还只有说明/.test(whys), `只有说明的层只留在结构建议：\n${whys}`);
  assert.deepEqual(allPaths(itemsOf(res, "structure", "模块只有 README")), ["10-作品库"]);
  assert.ok(!/生长模块 10-作品库\/ 已经启用，但里面除了 README 还没有文件/.test(whys), whys);
  assert.deepEqual(allPaths(itemsOf(res, "size", "AGENTS.md 偏大")), ["AGENTS.md"]);
  assert.ok(!/字节，超过/.test(whys), `AGENTS.md 太大只留在体量：\n${whys}`);
  const bare = problems.find((i) => /缺少文件开头的元信息：杂物\/随手\.md/.test(i.why));
  assert.ok(bare, whys);
  assert.equal(bare.confirm, true, "杂物/ 还没定装什么，里面的文件先不补开头");
  const { report } = reportParts(res, "问题");
  assert.equal(report.split("根目录有 杂物/").length - 1, 1, "报告里“杂物/ 不在地图里”只说一次");
  assert.doesNotMatch(report, /顶层文件夹 杂物\/ 不在地图里/);
});

test("Obsidian 写法只看建库档案的“编辑器”：有 .obsidian/ 没写的，从库根写的普通链接照样算断；写“Obsidian（桌面版）”的认", () => {
  const root = newKb();
  write(root, ".obsidian/app.json", "{}");
  write(root, "06-项目/春节.md", note(base({ 类型: "项目", 名称: "春节", 状态: "进行中", 截止: "未定", 负责人: "王总" }), "见 [生意](03-生意/README.md)"));
  const broken = (r) => itemsOf(r, "problems", "断链").map((i) => i.link);
  assert.deepEqual(broken(scan(root)), ["03-生意/README.md"], "只有 .obsidian/ 不算 Obsidian 写法");
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md").replace("结构: 标准\n", "结构: 标准\n编辑器: Obsidian（桌面版）\n"));
  assert.deepEqual(broken(scan(root)), [], "建库档案写了 Obsidian（带括号说明）：从库根找得到");
});
