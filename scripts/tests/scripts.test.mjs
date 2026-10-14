// 运行：node --test scripts/tests/scripts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, renameSync, cpSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFrontmatter, LAYER_IDS, LAYERS, TYPES, TYPE_FIELDS, OPTIONAL_FIELDS, MARK_START_TEXT, linksIn, mentionedIn,
  SKILL_VERSION, CUSTOMER_STAGES, cloudStatus, AGENTS_MAX_BYTES, pendingLines, parentRuleFiles, parentRulesWarning,
  splitRow, tableRows, wikiLinksIn, resolveWikiLink, wikiNameIndex, resolveLayout, usesObsidian } from "../lib.mjs";
import { runInit, refreshOriginals, fieldTableRows, RAW_HEAD_RULE } from "../init.mjs";
import { checkKnowledgeBase, summaryLine } from "../check.mjs";
import { interviewHasContent } from "../check-stage.mjs";
import { buildIndex, writeIndex } from "../index.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => mkdtempSync(join(tmpdir(), "boss-kb-"));
const write = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const readText = (root, path) => readFileSync(join(root, path), "utf8");
const note = (fields, text = "正文。") => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n${text}\n`;
const base = (extra = {}) => ({ 更新: "2026-10-20", 确认: "待确认", 隐私: "内部", 来源: "采访", ...extra });
const customer = (name, extra = {}) => note(base({ 类型: "客户", 名称: name, 分组: "企业客户", 阶段: "报价中", 联系人: "行政", 上次联系: "2026-10-18", 下次跟进: "未定", ...extra }));
const fillAgents = (root) => write(root, "AGENTS.md", readText(root, "AGENTS.md").replace(/<(?!!--)[^<>\n]{1,30}>/g, "已填"));
const has = (list, re) => list.some((x) => re.test(x));
const cli = (script, ...args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** 工作台每次必读的四份；layout 给就地建图时的实际位置 */
function fillMustRead(root, layout = {}) {
  const at = (id) => layout[id] || id;
  write(root, `${at("02-关于我")}/基本情况.md`, note(base({ 类型: "关于我" }), "开了一家小餐馆。"));
  write(root, "01-AI协作/协作偏好.md", note(base({ 类型: "协作偏好" }), "说话直接，先给结论。"));
  write(root, `${at("03-生意")}/生意总览.md`, note(base({ 类型: "生意" }), "卖家常菜，堂食为主。"));
  write(root, `${at("06-项目")}/近期要事.md`, note(base({ 类型: "待办" }), "- [ ] 给老客发新菜单 · 截止 2026-10-30"));
}

const FILLED_PROFILE = (extra = "") => `---
类型: 建库档案
格式: 老板知识库/2
建库方式: 快速版完成
结构: 标准
更新: 2026-10-20
确认: 已确认
隐私: 内部
来源: 99-原始材料/采访记录/2026-10-20-建库采访.md
---

# 建库档案

## 类型画像
本地服务型：一家小餐馆，外卖为辅。

## 老板最关心（工作台首页按这个排）
1. 今天该回访哪几位老客。

## 启用的模块
| 模块 | 路径 | 为什么启用 | 证据 |
|---|---|---|---|
| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |
${extra}
## 已完成
- 2026-10-20 快速建库，答了 11 题
- 2026-10-20 真实任务：替老板写了一条老客回访草稿，老板改了一句就发了

## 还缺什么
- 判断样本只有 1 条

## 冲突
- 暂无

## 下次补访
补一条判断样本
`;

const INTERVIEW = `---
类型: 采访记录
日期: 2026-10-20
说话人: 王总
记录人: AI
隐私: 私密
---

# 王总｜建库采访 2026-10-20

## 采访进度
- 已完成：第 1—11 题
- 下一题：完整版
- 派生文件：03-生意/招牌套餐.md

### 第 1 题｜怎么称呼你
王总：叫我王总就行，开了一家小餐馆。
`;

/** 在只跑过 init 的标准库上补齐快速版要的东西 */
function fillQuickKb(root, { customers = 3 } = {}) {
  fillAgents(root);
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE());
  write(root, "99-原始材料/采访记录/2026-10-20-建库采访.md", INTERVIEW);
  write(root, "03-生意/招牌套餐.md", note(base({ 类型: "产品", 名称: "招牌套餐", 一句话: "两荤一素" })));
  for (let i = 1; i <= customers; i += 1) write(root, `04-客户/老客${i}.md`, customer(`老客${i}`));
  write(root, "05-方法与判断/报价与接单/判断样本.md", note(base({ 类型: "判断样本", 工作: "报价与接单" }), "## 样本 1｜包场\n- 场景：周末包场\n- 判断：收定金"));
  fillMustRead(root);
}

test("元信息：普通字段、列表来源、没有元信息", () => {
  const fm = parseFrontmatter("---\n类型: 客户\n来源:\n  - a.md\n  - b.md\n确认: 待确认 # 注释\n---\n正文");
  assert.equal(fm["类型"], "客户");
  assert.deepEqual(fm["来源"], ["a.md", "b.md"]);
  assert.equal(fm["确认"], "待确认");
  assert.equal(parseFrontmatter("# 没有元信息"), null);
});

test("类型清单：按层分组，客户分组和往来记录只要求名称", () => {
  assert.deepEqual(TYPES["04-客户"], ["客户", "客户分组", "客户原话", "往来记录"]);
  assert.ok(TYPES["原件"].includes("采访记录"));
  assert.ok(TYPES["生长模块"].includes("代表作"));
  assert.deepEqual(TYPE_FIELDS["客户分组"], ["名称"]);
  assert.deepEqual(TYPE_FIELDS["往来记录"], ["名称"]);
  for (const l of LAYERS) assert.ok(l.mapHolds && l.mapWhen, `${l.id} 要有 mapHolds、mapWhen`);
});

test("链接：认得 <带空格的路径>", () => {
  assert.deepEqual(linksIn("见 [甲](<客户/甲 公司.md>) 和 [乙](乙.md)"), ["客户/甲 公司.md", "乙.md"]);
});

test("搭骨架：建好 9 层、入口和建库档案，体检没有错误", () => {
  const root = tmp();
  const out = runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  for (const id of LAYER_IDS) assert.ok(existsSync(join(root, id, "README.md")), `${id} 应有 README`);
  assert.ok(existsSync(join(root, "AGENTS.md")));
  assert.equal(readText(root, "CLAUDE.md").trim(), "@AGENTS.md");
  assert.ok(out.created.includes("01-AI协作/建库档案.md"));
  const result = checkKnowledgeBase(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.format, "老板知识库/2");
  assert.ok(result.warnings.some((w) => w.includes("没填的占位")), "AGENTS.md 里的占位应该提醒");
  rmSync(root, { recursive: true });
});

test("AGENTS.md：第 1 行就是标记，标题在段里，地图用第一人称，最后是“我加的规矩”", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  const text = readText(root, "AGENTS.md");
  const lines = text.split("\n");
  assert.equal(lines[0], MARK_START_TEXT);
  assert.equal(lines[1], "# 王总的知识库（示例小店）");
  assert.ok(text.indexOf("<!-- 本段结束 -->") < text.indexOf("## 我加的规矩"));
  assert.match(text, /\| 02-关于我 \| [^|]+ \| 替我起草、替我判断时 \|/);
  assert.match(text, /我说“整理一下”时/);
  assert.match(text, /\| 01-AI协作 \| 建库档案、协作偏好、任务手册 \|/);
  assert.doesNotMatch(text.split("<!-- 本段结束 -->")[0].split("\n").slice(1).join("\n"), /老板/, "地图和规矩用第一人称，不写“老板”");
  rmSync(root, { recursive: true });
});

test("体检：报出所有占位，不止第一个；建库档案的“（第 N 题后填）”“（还没有）”也算", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  assert.equal(readText(root, "AGENTS.md").split("\n")[1], "# <称呼>的知识库（<店名或品牌>）");
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.deepEqual(errors, []);
  const agents = warnings.find((w) => w.startsWith("AGENTS.md") && w.includes("占位"));
  assert.ok(agents, "AGENTS.md 的占位要报");
  for (const ph of ["<称呼>", "<店名或品牌>", "<主类型 + 叠加>", "<最常被纠正的 1—2 条。>"]) assert.ok(agents.includes(ph), `应报出 ${ph}`);
  const profile = warnings.find((w) => w.startsWith("建库档案") && w.includes("占位"));
  assert.ok(profile, "建库档案的占位要报");
  assert.ok(profile.includes("（第 2 题后填") && profile.includes("（第 10 题后填）"));
  // 第五轮起 init 不再写“（还没有）”那一行；旧版 init 留下的照样算占位
  const path = join(root, "01-AI协作/建库档案.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("|---|---|---|---|\n\n暂时没有生长模块。", "|---|---|---|---|\n| （还没有） | | | |"));
  assert.ok(checkKnowledgeBase(root).warnings.find((w) => w.startsWith("建库档案") && w.includes("占位")).includes("（还没有）"));
  rmSync(root, { recursive: true });
});

test("搭骨架：再跑一次什么都不建，也不覆盖老板改过的文件", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  writeFileSync(join(root, "02-关于我", "README.md"), "老板自己改过");
  const again = runInit(root, { date: "2026-10-21" });
  assert.deepEqual(again.created, []);
  assert.equal(readText(root, "02-关于我/README.md"), "老板自己改过");
  assert.ok(!existsSync(join(root, "99-原始材料/采访记录/2026-10-21-建库采访.md")), "已经有采访记录就不再建骨架");
  rmSync(root, { recursive: true });
});

test("搭骨架：--dry-run 不写任何东西", () => {
  const root = tmp();
  const out = runInit(root, { dryRun: true });
  assert.ok(out.created.length > 10);
  assert.ok(!existsSync(join(root, "AGENTS.md")));
  rmSync(root, { recursive: true });
});

test("搭骨架：建采访记录骨架（原件），建库档案和任务手册是已确认", () => {
  const root = tmp();
  const out = runInit(root, { name: "王总", date: "2026-10-20" });
  const path = "99-原始材料/采访记录/2026-10-20-建库采访.md";
  assert.ok(out.created.includes(path));
  const text = readText(root, path);
  const fm = parseFrontmatter(text);
  assert.equal(fm["类型"], "采访记录");
  assert.equal(fm["说话人"], "王总");
  assert.equal(fm["隐私"], "私密");
  assert.match(text, /# 王总｜建库采访 2026-10-20/);
  assert.match(text, /## 采访进度\n- 已完成：\n- 下一题：第 0 题（开场：哪些东西不放进来）\n- 派生文件：/);
  assert.equal(parseFrontmatter(readText(root, "01-AI协作/建库档案.md"))["确认"], "已确认");
  assert.equal(parseFrontmatter(readText(root, "01-AI协作/任务手册/整理新材料.md"))["确认"], "已确认");
  const other = tmp();
  runInit(other, { date: "2026-10-20" });
  const blank = readText(other, path);
  assert.match(blank, /说话人: （第 1 题后填）/, "没给称呼时说话人留到第 1 题后填");
  assert.match(blank, /\n# 建库采访 2026-10-20\n/);
  assert.doesNotMatch(blank, /老板｜/);
  assert.match(blank, /# 建库采访 2026-10-20\n\n(?:> [^\n]+\n)+\n## 采访进度\n/, "采访进度在正文开头");
  rmSync(root, { recursive: true });
  rmSync(other, { recursive: true });
});

test("搭骨架：05 层 README 有方法选择表和状态表，04 层写了客户分组和往来记录的规矩", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const methods = readText(root, "05-方法与判断/README.md");
  assert.match(methods, /## 方法选择表/);
  assert.match(methods, /## 状态\n\| 工作 \| 做法 \| 判断样本 \| 已确认规则 \| 下次补什么 \|\n\|---\|---\|---\|---\|---\|\n\| （暂时没有） \|/);
  assert.match(methods, /一类工作一个文件夹（如 `报价与接单\/`），放 判断样本\.md 和 判断规则\.md/);
  const customers = readText(root, "04-客户/README.md");
  assert.match(customers, /客户分组/);
  assert.match(customers, /<客户名>-往来记录\.md/);
  assert.doesNotMatch(customers, /## 建库快照/, "标准结构不需要建库快照");
  rmSync(root, { recursive: true });
});

test("已有 AGENTS.md：默认不动，--update-agents 只在末尾追加标记段和“我加的规矩”", () => {
  const root = tmp();
  writeFileSync(join(root, "AGENTS.md"), "# 我原来的规矩\n- 不许改这行\n");
  const first = runInit(root, { date: "2026-10-20" });
  assert.ok(first.notes.some((n) => n.includes("没动它")));
  assert.equal(readText(root, "AGENTS.md"), "# 我原来的规矩\n- 不许改这行\n");
  runInit(root, { date: "2026-10-20", updateAgents: true });
  const text = readText(root, "AGENTS.md");
  assert.ok(text.startsWith("# 我原来的规矩\n- 不许改这行\n"));
  assert.match(text, /<!-- 老板知识库 v2/);
  assert.match(text, /<!-- 本段结束 -->\n\n## 我加的规矩\n/);
  assert.equal(text.match(/## 我加的规矩/g).length, 1);
  rmSync(root, { recursive: true });
});

test("--update-agents：原文件已有“## 我加的规矩”就不再加", () => {
  const root = tmp();
  writeFileSync(join(root, "AGENTS.md"), "# 我原来的规矩\n\n## 我加的规矩\n- 早上不打扰\n");
  runInit(root, { date: "2026-10-20", updateAgents: true });
  const text = readText(root, "AGENTS.md");
  assert.equal(text.match(/## 我加的规矩/g).length, 1);
  assert.ok(text.trimEnd().endsWith("<!-- 本段结束 -->"));
  rmSync(root, { recursive: true });
});

test("--dry-run：追加类动作带 preview 全文，文件不动", () => {
  const root = tmp();
  writeFileSync(join(root, "AGENTS.md"), "# 我原来的规矩\n");
  writeFileSync(join(root, "CLAUDE.md"), "# 我的 Claude 设置\n");
  const out = runInit(root, { date: "2026-10-20", updateAgents: true, dryRun: true });
  assert.deepEqual(out.appended.sort(), ["AGENTS.md", "CLAUDE.md"]);
  const agents = out.preview.find((p) => p.path === "AGENTS.md");
  assert.ok(agents.content.includes(MARK_START_TEXT));
  assert.ok(agents.content.includes("## 我加的规矩"));
  assert.ok(out.preview.find((p) => p.path === "CLAUDE.md").content.includes("@AGENTS.md"));
  assert.equal(readText(root, "AGENTS.md"), "# 我原来的规矩\n");
  rmSync(root, { recursive: true });
});

test("就地建图：固定层对应老板原有文件夹，不新建同名层，体检按对应表找", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总的情况，没有元信息");
  const out = runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.ok(!existsSync(join(root, "04-客户")), "不该再建 04-客户");
  assert.ok(out.created.includes("客户资料/README.md"));
  assert.equal(readText(root, "客户资料/张总.md"), "张总的情况，没有元信息");
  const result = checkKnowledgeBase(root);
  assert.equal(result.structure, "就地建图");
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes("客户资料/ 下有 1 份老板原有的文件没有开头元信息")));
  rmSync(root, { recursive: true });
});

test("就地建图：建库档案写就地建图和接入清单，建接入采访骨架，04 README 有建库快照，地图标签按名字定", () => {
  const root = tmp();
  mkdirSync(join(root, "客户资料"));
  mkdirSync(join(root, "关于我"));
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料", "02-关于我": "关于我" } });
  const profile = readText(root, "01-AI协作/建库档案.md");
  const fm = parseFrontmatter(profile);
  assert.equal(fm["建库方式"], "就地建图");
  assert.equal(fm["结构"], "就地建图");
  assert.match(profile, /## 接入清单\n### 已知\n（待填）\n+### 待确认\n（待填）\n+### 冲突\n（待填）\n+### 缺失\n（待填）/);
  assert.match(profile, /## 下次补访\n先做接入清单：已知 \/ 待确认 \/ 冲突 \/ 缺失/);
  assert.ok(existsSync(join(root, "99-原始材料/采访记录/2026-10-20-接入采访.md")));
  assert.match(readText(root, "客户资料/README.md"), /## 建库快照\n\| 名称 \| 类型 \| 分组 \| 阶段 \| 联系人 \| 上次联系 \| 下次跟进 \| 文件 \|\n\|---\|---\|---\|---\|---\|---\|---\|---\|\n\| （待填） \|/);
  const agents = readText(root, "AGENTS.md");
  assert.match(agents, /\| 客户资料（客户） \|/);
  assert.match(agents, /\| 关于我 \|/);
  assert.doesNotMatch(agents, /关于我（关于我）/);
  rmSync(root, { recursive: true });
});

test("就地建图：对应的文件夹不存在时报错，不乱建", () => {
  const root = tmp();
  assert.throws(() => runInit(root, { map: { "04-客户": "没有这个" } }), /不存在/);
  assert.throws(() => runInit(root, { map: { "01-AI协作": "x" } }), /不和原有文件夹对应/);
  rmSync(root, { recursive: true });
});

test("就地建图：新建的标准层缺元信息是错误，老板原有文件夹里只提醒", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总的情况");
  write(root, "客户资料/李总.md", "---\ntags: [客户]\n---\n李总的情况");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  write(root, "02-关于我/基本情况.md", "没有元信息的整理稿");
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.ok(errors.some((e) => e.includes("缺少文件开头的元信息：02-关于我/基本情况.md")));
  assert.ok(!errors.some((e) => e.includes("客户资料/")), "老板原有文件夹里的文件不报错");
  assert.ok(warnings.some((w) => w.includes("客户资料/ 下有 2 份老板原有的文件没有开头元信息")));
  rmSync(root, { recursive: true });
});

test("就地建图：老板原有文件里的手机号不查；AI 写的新文件没标私密时提醒标私密，不报错", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总 13812345678");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  const first = checkKnowledgeBase(root);
  assert.ok(!first.errors.some((e) => e.includes("张总.md")), first.errors.join("\n"));
  assert.ok(!first.warnings.some((w) => w.includes("手机号")), first.warnings.join("\n"));
  write(root, "客户资料/张总-往来记录.md", note(base({ 类型: "往来记录", 名称: "张总" }), "张总新号码 13912345678"));
  const second = checkKnowledgeBase(root);
  assert.ok(!second.errors.some((e) => e.includes("张总-往来记录.md")), second.errors.join("\n"));
  assert.ok(second.warnings.includes("有手机号，这份没标私密：客户资料/张总-往来记录.md"), second.warnings.join("\n"));
  rmSync(root, { recursive: true });
});

test("--stage：占位升成错误后，不再在提醒里重复", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const { errors, warnings } = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(errors.some((e) => e.startsWith("AGENTS.md 还有")));
  assert.ok(!warnings.some((w) => w.startsWith("AGENTS.md 还有") || w.startsWith("建库档案.md 还有")), warnings.join("\n"));
  rmSync(root, { recursive: true });
});

test("只读文件夹：--readonly 登记进建库档案和地图，不放 README；不存在就报错", () => {
  const root = tmp();
  write(root, "报价/2025报价单.md", "老报价单");
  write(root, "笔记/随手.md", "随手记");
  const out = runInit(root, { date: "2026-10-20", readonly: ["报价", "笔记"] });
  assert.ok(!existsSync(join(root, "报价", "README.md")));
  assert.ok(!out.created.some((p) => p.startsWith("报价/")));
  const profile = readText(root, "01-AI协作/建库档案.md");
  assert.match(profile, /\| 原有·只读 \| 报价\/ \| 只读，不放 README，整理时不移动 \|/);
  assert.match(profile, /\| 原有·只读 \| 笔记\/ \|/);
  const agents = readText(root, "AGENTS.md");
  assert.match(agents, /\| 报价（只读） \| 我原有的资料，AI 只读不改 \| 需要时 \|/);
  const result = checkKnowledgeBase(root);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes("报价/ 下有 1 份老板原有的文件没有开头元信息")));
  assert.ok(!result.warnings.some((w) => w.includes("报价/ 不在地图里")));
  write(root, "AGENTS.md", agents.replace(/\| 报价（只读） .*\n/, ""));
  assert.ok(checkKnowledgeBase(root).errors.some((e) => e.includes("报价/") && e.includes("地图")));
  assert.throws(() => runInit(tmp(), { readonly: ["没有这个"] }), /不存在/);
  rmSync(root, { recursive: true });
});

test("老板文件夹里已有自己的 README.md：不覆盖，改写 README-知识库.md，体检认它", () => {
  const root = tmp();
  write(root, "客户资料/README.md", "# 我的客户\n这是我自己的说明。\n");
  write(root, "客户资料/张总.md", "张总");
  const out = runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.equal(readText(root, "客户资料/README.md"), "# 我的客户\n这是我自己的说明。\n");
  assert.ok(out.created.includes("客户资料/README-知识库.md"));
  assert.match(readText(root, "客户资料/README-知识库.md"), /这一层的说明/);
  assert.match(readText(root, "AGENTS.md"), /客户资料\/README-知识库\.md/);
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.deepEqual(errors, []);
  assert.ok(!warnings.some((w) => w.includes("客户资料/README.md 缺少")), "应该检查 README-知识库.md，而不是老板的 README.md");
  rmSync(root, { recursive: true });
});

test("体检：日期字段只认 2026-10-25、未知、未定；“更新”只认日期", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "06-项目/春节预售.md", note(base({ 类型: "项目", 名称: "春节预售", 状态: "进行中", 截止: "2026-12（春节前）", 负责人: "我" })));
  write(root, "06-项目/门店改造.md", note(base({ 类型: "项目", 名称: "门店改造", 状态: "等待", 截止: "未定", 负责人: "我" })));
  write(root, "04-客户/甲公司.md", customer("甲公司", { 上次联系: "未知", 下次跟进: "下周" }));
  write(root, "02-关于我/基本情况.md", note(base({ 类型: "关于我", 更新: "未知" })));
  const { errors } = checkKnowledgeBase(root);
  assert.ok(errors.some((e) => e.includes("“截止”要写成 2026-10-25，不知道写未知或未定") && e.includes("春节预售.md")));
  assert.ok(!errors.some((e) => e.includes("门店改造.md")));
  assert.ok(errors.some((e) => e.includes("“下次跟进”要写成 2026-10-25") && e.includes("甲公司.md")));
  assert.ok(!errors.some((e) => e.includes("“上次联系”")));
  assert.ok(errors.some((e) => e.includes("“更新”要写成 2026-10-25") && e.includes("基本情况.md")));
  rmSync(root, { recursive: true });
});

test("体检：待办行的截止后面要是日期", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "06-项目/近期要事.md", note(base({ 类型: "待办" }), "- [ ] 给甲公司报价 · 截止 2026-10-30\n- [ ] 定包装 · 截止 下周三\n- [ ] 整理模板 · 截止 未定\n- [ ] 没有截止的事"));
  const { warnings } = checkKnowledgeBase(root);
  const todo = warnings.filter((w) => w.includes("待办") && w.includes("截止"));
  assert.equal(todo.length, 1);
  assert.ok(todo[0].includes("下周三"));
  rmSync(root, { recursive: true });
});

test("体检：类型不在清单里只提醒；stats 按类型计数", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  write(root, "04-客户/乙公司.md", customer("乙公司"));
  write(root, "04-客户/门店会员.md", note(base({ 类型: "客户分组", 名称: "门店会员" })));
  write(root, "03-生意/杂项.md", note(base({ 类型: "客户档案" })));
  const { errors, warnings, stats } = checkKnowledgeBase(root);
  assert.ok(!errors.some((e) => e.includes("门店会员.md")), "客户分组不要求联系人、上次联系");
  assert.ok(warnings.some((w) => w.includes("客户档案") && w.includes("杂项.md") && w.includes("生意")));
  assert.ok(!errors.some((e) => e.includes("客户档案")));
  assert.equal(stats.types["客户"], 2);
  assert.equal(stats.types["客户分组"], 1);
  assert.equal(stats.types["建库档案"], 1);
  assert.equal(stats.types["采访记录"], undefined, "原件不算整理过的文件");
  rmSync(root, { recursive: true });
});

test("体检：原件层的手机号、身份证号不查；整理稿里照实记，没标私密只提醒；密码报错，密钥的否定说法不报", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "00-收件箱/2026-10-21-张总-微信.md", "张总：我电话 13812345678");
  write(root, "99-原始材料/聊天与通话/2026-10-01-李总.md", "身份证 110101199001011234");
  write(root, "01-AI协作/工具与账号.md", note(base({ 类型: "工具与账号" }), "公众号后台密码：不存在这里\n抖店密码: 不放在知识库"));
  const first = checkKnowledgeBase(root);
  assert.deepEqual(first.errors, []);
  assert.ok(!first.warnings.some((w) => /手机号|身份证号/.test(w)), first.warnings.join("\n"));
  write(root, "04-客户/甲公司.md", customer("甲公司", { 名称: "甲公司" }).replace("正文。", "电话 13812345678"));
  write(root, "01-AI协作/协作偏好.md", note(base({ 类型: "协作偏好" }), "后台密码: abc12345"));
  const second = checkKnowledgeBase(root);
  assert.ok(!second.errors.some((e) => e.includes("04-客户")), second.errors.join("\n"));
  assert.ok(second.warnings.includes("有手机号，这份没标私密：04-客户/甲公司.md"), second.warnings.join("\n"));
  write(root, "04-客户/乙公司.md", customer("乙公司", { 名称: "乙公司", 隐私: "私密" }).replace("正文。", "电话 13812345678，身份证 110101199001011234"));
  const third = checkKnowledgeBase(root).warnings;
  assert.ok(!third.some((w) => /手机号|身份证号/.test(w) && w.includes("乙公司")), `标了私密的照实记，不提醒：\n${third.join("\n")}`);
  assert.ok(second.errors.some((e) => e.includes("疑似密码或密钥") && e.includes("协作偏好.md")));
  assert.ok(!second.errors.some((e) => e.includes("工具与账号.md")));
  rmSync(root, { recursive: true });
});

test("体检：启用的模块写“（计划）”的行不查路径，也不算启用", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const extra = "| 门店与会员 | `12-门店与会员/`（计划） | 下个月开第二家店 | 第 2 题 |\n| 案例库 | 13-案例库/ | 计划启用 | 第 9 题 |";
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", extra));
  const { errors } = checkKnowledgeBase(root);
  assert.ok(!errors.some((e) => e.includes("12-门店与会员") || e.includes("13-案例库")), errors.join("\n"));
  rmSync(root, { recursive: true });
});

test("体检：认出旧格式（老板知识库/1）", () => {
  const root = tmp();
  writeFileSync(join(root, "知识库说明.md"), "---\n格式: 老板知识库/1\n---\n| 类别 | 位置 | 状态 | 一句话 |\n");
  writeFileSync(join(root, "AGENTS.md"), "<!-- 知识库规则 开始 -->\n");
  const result = checkKnowledgeBase(root);
  assert.equal(result.format, "老板知识库/1");
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /升级旧库/);
  rmSync(root, { recursive: true });
});

test("体检：抓出缺字段、取值越界、坏链接、来源不存在、手机号、生长模块没登记", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/甲公司.md", note({ 类型: "客户", 名称: "甲公司", 更新: "2026-10-20", 确认: "差不多", 隐私: "内部", 来源: "99-原始材料/不存在.md" }, "电话 13812345678，见 [乙](乙公司.md)"));
  mkdirSync(join(root, "10-作品库"));
  const result = checkKnowledgeBase(root);
  const all = result.errors.join("\n");
  assert.match(all, /“确认”只能是/);
  assert.match(all, /缺少字段 分组/);
  assert.match(all, /来源文件不存在/);
  assert.match(all, /链接指向不存在的文件/);
  assert.match(result.warnings.join("\n"), /有手机号，这份没标私密：04-客户\/甲公司\.md/);
  assert.match(all, /10-作品库\/ 在磁盘上有，但 AGENTS\.md 地图里没有/);
  assert.match(all, /10-作品库\/ 没写进建库档案/);
  assert.ok(result.warnings.some((w) => w.includes("索引里没有 甲公司.md")));
  rmSync(root, { recursive: true });
});

test("体检：--forbid 的词出现就报错", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "03-生意/生意总览.md", note({ 类型: "生意", 更新: "2026-10-20", 确认: "待确认", 隐私: "内部", 来源: "采访" }, "客户 XYZ 公司"));
  const result = checkKnowledgeBase(root, { forbid: ["XYZ"] });
  assert.ok(result.errors.some((e) => e.includes("XYZ")));
  rmSync(root, { recursive: true });
});

test("--stage quick：只跑过 init 的库报出缺什么", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  const { errors } = checkKnowledgeBase(root, { stage: "quick" });
  for (const re of [/AGENTS\.md.*占位/, /建库档案.*占位/, /类型画像/, /老板最关心/, /采访记录/, /产品/, /客户/, /判断样本/, /真实任务/]) {
    assert.ok(has(errors, re), `应该报出 ${re}：\n${errors.join("\n")}`);
  }
  assert.deepEqual(checkKnowledgeBase(root).errors, [], "不带 --stage 时照旧没有错误");
  rmSync(root, { recursive: true });
});

test("--stage quick：补齐的小库通过；客户少于 3 份只提醒", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  const ok = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(ok.errors, []);
  assert.ok(!has(ok.warnings, /至少 3 个真实客户/));
  rmSync(join(root, "04-客户/老客2.md"));
  rmSync(join(root, "04-客户/老客3.md"));
  const few = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(few.errors, []);
  assert.ok(has(few.warnings, /至少 3 个真实客户/));
  write(root, "10-门店/README.md", "# 10-门店｜这一层的说明\n- 装什么：门店\n- AI 什么时候读：x\n- 谁来写：x\n");
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", "| 门店 | 10-门店/ | 有门店 | 第 2 题 |"));
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("| 90-持续生长 |", "| 10-门店 | 门店 | 需要时 |\n| 90-持续生长 |"));
  assert.ok(has(checkKnowledgeBase(root, { stage: "quick" }).errors, /10-门店\/.*除了 README/));
  rmSync(root, { recursive: true });
});

test("--stage connect：就地建图只跑过 init 报缺什么，补齐后通过；标准结构不适用", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  runInit(root, { name: "王总", date: "2026-10-20", map: { "04-客户": "客户资料" } });
  const before = checkKnowledgeBase(root, { stage: "connect" }).errors;
  for (const re of [/接入清单/, /建库快照/, /占位/, /真实任务/, /采访记录/]) assert.ok(has(before, re), `应该报出 ${re}：\n${before.join("\n")}`);
  fillAgents(root);
  const profile = readText(root, "01-AI协作/建库档案.md");
  write(root, "01-AI协作/建库档案.md", profile
    .replace("（第 2 题后填：主类型 + 叠加）", "本地服务型")
    .replace("1. （第 10 题后填）", "1. 今天该回访谁")
    .replace("| （还没有） | | | |", "| 暂不启用 | | 固定层够用 | 接入采访 |")
    .replace("### 已知\n（待填）", "### 已知\n- 客户资料/ 里 1 位客户")
    .replace(/（待填）/g, "暂无")
    .replace("## 已完成\n", "## 已完成\n- 2026-10-20 真实任务：替王总写了张总的回访草稿\n"));
  write(root, "99-原始材料/采访记录/2026-10-20-接入采访.md", INTERVIEW);
  fillMustRead(root, { "04-客户": "客户资料" });
  const readme = readText(root, "客户资料/README.md");
  write(root, "客户资料/README.md", readme.replace("| （待填） | | | | | | | |", "| 张总 | 客户 | 企业客户 | 报价中 | 张总 | 未知 | 未定 | [张总.md](张总.md) |"));
  const after = checkKnowledgeBase(root, { stage: "connect" });
  assert.deepEqual(after.errors, []);
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  assert.ok(has(checkKnowledgeBase(std, { stage: "connect" }).errors, /标准结构.*请用 --stage quick/));
  // 命令行：当成用法错误，stderr 只说该用哪个，不出 JSON、不出结论
  for (const extra of [[], ["--brief"]]) {
    const r = cli("check.mjs", std, "--stage", "connect", ...extra);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^这是标准结构的知识库.*请用 --stage quick\n$/);
    assert.doesNotMatch(r.stderr, /体检结论/);
  }
  rmSync(root, { recursive: true });
  rmSync(std, { recursive: true });
});

test("只登记了只读或不读的文件夹（没有 --map）也算就地建图：有接入清单、建库快照、原件清单，--stage connect 适用", () => {
  for (const opts of [{ readonly: ["笔记"] }, { exclude: ["日记"] }]) {
    const root = tmp();
    write(root, "笔记/读书.md", "读书笔记");
    write(root, "日记/2026-10-01.md", "日记");
    runInit(root, { date: "2026-10-20", ...opts });
    const profile = readText(root, "01-AI协作/建库档案.md");
    assert.match(profile, /^建库方式: 就地建图$/m);
    assert.match(profile, /^结构: 就地建图$/m);
    assert.match(profile, /## 接入清单/);
    assert.ok(existsSync(join(root, "01-AI协作/原件清单.md")), "要有原件清单");
    assert.match(readText(root, "04-客户/README.md"), /## 建库快照/);
    const { errors } = checkKnowledgeBase(root, { stage: "connect" });
    assert.ok(!has(errors, /标准结构/), errors.join("\n"));
    assert.ok(has(errors, /接入清单/), "照常报接入还缺什么");
    rmSync(root, { recursive: true });
  }
});

test("体检命令行：有错误退出码 1，文件夹不存在退出码 2，没错误 0", () => {
  const run = (...args) => spawnSync(process.execPath, [join(SCRIPTS, "check.mjs"), ...args], { encoding: "utf8" });
  const root = tmp();
  assert.equal(run(join(root, "没有这个")).status, 2);
  runInit(root, { date: "2026-10-20" });
  assert.equal(run(root).status, 0);
  assert.equal(run(root, "--stage", "quick").status, 1);
  rmSync(root, { recursive: true });
});

test("索引：只补漏的行，追加到表的最后，不删不改已有行；链接不编码", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const readmePath = join(root, "04-客户", "README.md");
  const custom = readFileSync(readmePath, "utf8").replace(
    /## 索引\n[\s\S]*?\n\n/,
    "## 索引（只放不常变的列）\n| 客户 | 分组 | 拍板人 | 一句话 | 文件 |\n|---|---|---|---|---|\n| 甲公司 | 企业客户 | 周总 | 老板手写的一句 | [企业客户/甲公司.md](企业客户/甲公司.md) |\n\n",
  );
  writeFileSync(readmePath, custom);
  write(root, "04-客户/企业客户/甲公司.md", customer("甲公司"));
  write(root, "04-客户/乙公司.md", customer("乙公司", { 一句话: "老客户，春节买员工礼" }));
  write(root, "04-客户/丙 公司.md", customer("丙公司"));
  write(root, "04-客户/门店老客/README.md", "# 门店老客\n- 装什么：常来门店的老客\n");
  const preview = buildIndex(join(root, "04-客户"));
  assert.equal(preview.rows.length, 3, preview.table);
  assert.match(preview.table, /\| 乙公司 \| 企业客户 \|  \| 老客户，春节买员工礼 \| \[乙公司\.md\]\(乙公司\.md\) \|/);
  assert.match(preview.table, /\| 丙公司 \| 企业客户 \|  \| （待补） \| \[丙 公司\.md\]\(<丙 公司\.md>\) \|/);
  assert.match(preview.table, /\[门店老客\/\]\(门店老客\/README\.md\)/);
  assert.doesNotMatch(preview.table, /%[0-9A-F]{2}/, "链接不做百分号编码");
  assert.doesNotMatch(preview.table, /甲公司/, "已在索引里的不再出现");
  assert.equal(readFileSync(readmePath, "utf8"), custom, "预览不写文件");
  const out = writeIndex(join(root, "04-客户"));
  assert.ok(out.written);
  const after = readFileSync(readmePath, "utf8");
  const lines = after.split("\n");
  const last = lines.indexOf("| 甲公司 | 企业客户 | 周总 | 老板手写的一句 | [企业客户/甲公司.md](企业客户/甲公司.md) |");
  assert.match(lines[last + 1], /^\| (乙公司|丙公司|门店老客) \|/, "新行接在原来最后一行后面");
  assert.equal(lines.slice(last + 1, last + 4).filter((l) => l.startsWith("| ")).length, 3);
  for (const line of custom.split("\n")) assert.ok(after.includes(line), `原有的行不能删改：${line}`);
  assert.equal(after.split("## 这一层的规矩")[1], custom.split("## 这一层的规矩")[1]);
  const again = writeIndex(join(root, "04-客户"));
  assert.equal(again.rows.length, 0);
  assert.equal(readFileSync(readmePath, "utf8"), after, "再跑一次没有要补的");
  rmSync(root, { recursive: true });
});

test("索引：没有表就在“## 索引”下面建默认表头；没有“## 索引”不写", () => {
  const root = tmp();
  write(root, "a/README.md", "# a\n\n## 索引\n\n## 规矩\n- 不动\n");
  write(root, "a/甲.md", note(base({ 类型: "产品", 名称: "甲", 一句话: "招牌" })));
  writeIndex(join(root, "a"));
  assert.match(readText(root, "a/README.md"), /## 索引\n\| 名称 \| 类型 \| 分组 \| 一句话 \| 文件 \|\n\|---\|---\|---\|---\|---\|\n\| 甲 \| 产品 \|  \| 招牌 \| \[甲\.md\]\(甲\.md\) \|\n\n## 规矩\n- 不动\n/);
  write(root, "b/README.md", "# b\n## 方法选择表\n");
  write(root, "b/乙.md", note(base({ 类型: "做法", 工作: "报价" })));
  const out = writeIndex(join(root, "b"));
  assert.equal(out.written, false);
  assert.match(out.reason, /没有“## 索引”/);
  assert.equal(readText(root, "b/README.md"), "# b\n## 方法选择表\n");
  rmSync(root, { recursive: true });
});

test("追加到已有 AGENTS.md：标记段里的标题是二级标题，文件只有一个一级标题", () => {
  const root = tmp();
  writeFileSync(join(root, "AGENTS.md"), "# 我原来的规矩\n- 回答先给结论\n");
  runInit(root, { date: "2026-10-20", updateAgents: true, name: "周岚", shop: "一禾设计" });
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.equal((text.match(/^# /gm) || []).length, 1);
  assert.match(text, /^## 周岚的知识库（一禾设计）$/m);
  rmSync(root, { recursive: true });
});

test("补索引：追加真内容时去掉骨架自带的“（暂时没有）”占位行", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "06-项目/春季上新.md", note({ 类型: "项目", 名称: "春季上新", 状态: "进行中", 截止: "未定", 负责人: "我", 更新: "2026-10-20", 确认: "待确认", 隐私: "内部", 来源: "采访" }));
  const out = writeIndex(join(root, "06-项目"));
  assert.ok(out.written);
  const text = readFileSync(join(root, "06-项目", "README.md"), "utf8");
  assert.ok(!text.includes("（暂时没有）"));
  assert.match(text, /春季上新/);
  rmSync(root, { recursive: true });
});

test("通过软链接运行脚本也有输出", async () => {
  const { symlinkSync } = await import("node:fs");
  const here = dirname(fileURLToPath(import.meta.url));
  const linkDir = tmp();
  const link = join(linkDir, "check-link.mjs");
  symlinkSync(join(here, "..", "check.mjs"), link);
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const run = spawnSync(process.execPath, [link, root], { encoding: "utf8" });
  assert.match(run.stdout, /"format": "老板知识库\/2"/);
  rmSync(linkDir, { recursive: true });
  rmSync(root, { recursive: true });
});

test("收件箱里新丢进来的文件不要求进 README 索引", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "00-收件箱/2026-10-21-某客户-微信聊天.md", "---\n类型: 原始材料\n日期: 2026-10-21\n---\n聊天原文");
  const result = checkKnowledgeBase(root);
  assert.ok(!result.warnings.some((w) => w.includes("00-收件箱") && w.includes("索引里没有")));
  rmSync(root, { recursive: true });
});

test("就地建图另起的往来记录不要求进 README 索引", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总的情况");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  write(root, "客户资料/张总-往来记录.md", note({ 类型: "往来记录", 名称: "张总", 更新: "2026-10-21", 确认: "待确认", 隐私: "内部", 来源: "工作台" }, "[张总](张总.md)\n- 2026-10-21｜微信｜问报价"));
  const result = checkKnowledgeBase(root);
  assert.ok(!result.warnings.some((w) => w.includes("张总-往来记录.md")));
  rmSync(root, { recursive: true });
});

// ───────────── 第三轮 ─────────────

test("N1 命令行：--help / -h 打印用法、退出 0、不建任何东西", () => {
  const parent = tmp();
  const root = join(parent, "新库");
  for (const script of ["init.mjs", "check.mjs", "index.mjs"]) {
    for (const flag of ["--help", "-h"]) {
      const run = cli(script, root, flag);
      assert.equal(run.status, 0, `${script} ${flag}：${run.stderr}`);
      assert.match(run.stdout, /用法/);
    }
  }
  assert.ok(!existsSync(root), "--help 不建任何东西");
  rmSync(parent, { recursive: true });
});

test("N1 命令行：不认识的参数、多出来的路径、缺值都报错退出 1，什么都不做", () => {
  const parent = tmp();
  const root = join(parent, "新库");
  const typo = cli("init.mjs", root, "--dryrun");
  assert.equal(typo.status, 1);
  assert.match(typo.stderr, /不认识的参数：--dryrun/);
  assert.match(typo.stderr, /用法/);
  assert.ok(!existsSync(root), "参数写错了不能真建");
  assert.equal(cli("init.mjs", "-x").status, 1, "知识库路径不能以 - 开头");
  assert.equal(cli("init.mjs", root, "多余的").status, 1, "多出来的路径要报错");
  assert.equal(cli("init.mjs", root, "--name").status, 1, "--name 后面要跟值");
  assert.equal(cli("init.mjs", root, "--map", "04-客户:客户资料").status, 1, "--map 写法不对要报错，不能悄悄忽略");
  assert.equal(cli("init.mjs", root, "--date", "2026/10/20").status, 1);
  assert.ok(!existsSync(root));
  runInit(root, { date: "2026-10-20" });
  assert.equal(cli("check.mjs", root, "--stgae", "quick").status, 1);
  assert.equal(cli("check.mjs", "-quick").status, 1);
  const before = readText(root, "04-客户/README.md");
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  const idx = cli("index.mjs", join(root, "04-客户"), "--wirte");
  assert.equal(idx.status, 1);
  assert.match(idx.stderr, /不认识的参数：--wirte/);
  assert.equal(readText(root, "04-客户/README.md"), before);
  rmSync(parent, { recursive: true });
});

test("N1 命令行：认 --stage=quick、--forbid=a,b、--name=王总；--stage 只能是 quick / connect", () => {
  const root = tmp();
  const init = cli("init.mjs", root, "--name=王总", "--shop=示例小店", "--date=2026-10-20");
  assert.equal(init.status, 0, init.stderr);
  assert.equal(readText(root, "AGENTS.md").split("\n")[1], "# 王总的知识库（示例小店）");
  const quick = cli("check.mjs", root, "--stage=quick");
  assert.equal(quick.status, 1);
  const out = JSON.parse(quick.stdout);
  assert.equal(out.stage, "quick");
  assert.ok(has(out.errors, /真实任务/));
  write(root, "03-生意/生意总览.md", note(base({ 类型: "生意" }), "客户 XYZ 公司"));
  const forbid = JSON.parse(cli("check.mjs", root, "--forbid=XYZ,QRS").stdout);
  assert.ok(has(forbid.errors, /“XYZ”/));
  const bad = cli("check.mjs", root, "--stage=fast");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--stage 只能是 quick 或 connect/);
  assert.equal(cli("check.mjs", root, "--stage").status, 1);
  assert.equal(cli("check.mjs", root, "--stage", "connect").status, 1);
  rmSync(root, { recursive: true });
});

test("N3 原件清单：接入时生成（原有文件夹、只读文件夹、根目录原有入口），只建一次，dry-run 不写", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总的情况");
  write(root, "客户资料/2024/老客户.md", "老客户名单");
  write(root, "客户资料/.DS_Store", "x");
  write(root, "客户资料/报价单.xlsx", "二进制也算");
  write(root, "报价/2025报价单.md", "老报价单");
  write(root, "README.md", "# 我的资料\n");
  write(root, "AGENTS.md", "# 我原来的规矩\n- 回答先给结论\n");
  write(root, "CLAUDE.md", "# 我的 Claude 设置\n");
  const agents = readText(root, "AGENTS.md");
  const claude = readText(root, "CLAUDE.md");
  const opts = { date: "2026-10-20", map: { "04-客户": "客户资料" }, readonly: ["报价"], updateAgents: true };
  const dry = runInit(root, { ...opts, dryRun: true });
  assert.ok(dry.created.includes("01-AI协作/原件清单.md"));
  assert.ok(!existsSync(join(root, "01-AI协作/原件清单.md")), "dry-run 不写");
  const out = runInit(root, opts);
  assert.ok(out.created.includes("01-AI协作/原件清单.md"));
  const text = readText(root, "01-AI协作/原件清单.md");
  const fm = parseFrontmatter(text);
  assert.deepEqual([fm["类型"], fm["更新"], fm["确认"], fm["隐私"], fm["来源"]], ["原件清单", "2026-10-20", "已确认", "内部", "老板知识库 Skill 接入时自动生成"]);
  assert.match(text, /# 原件清单\n\n> 接入时老板原有的文件。体检会逐份比对：改了、少了、改名了都会报出来（接入收尾时算错误，只读文件夹里的只提醒）。这份由 Skill 维护，不要手改；老板说是自己改的，用 init\.mjs --refresh-originals <文件夹> 重新登记。\n\n\| 文件 \| 大小 \| SHA-256 \|\n\|---\|---\|---\|\n/);
  assert.ok(text.includes(`| 客户资料/张总.md | ${Buffer.byteLength("张总的情况")} | ${sha("张总的情况")} |`));
  assert.ok(text.includes(`| 客户资料/2024/老客户.md | ${Buffer.byteLength("老客户名单")} | ${sha("老客户名单")} |`));
  assert.ok(text.includes(`| 客户资料/报价单.xlsx |`));
  assert.ok(text.includes(`| 报价/2025报价单.md |`));
  assert.ok(text.includes(`| README.md | ${Buffer.byteLength("# 我的资料\n")} | ${sha("# 我的资料\n")} |`));
  assert.ok(text.includes(`| AGENTS.md | 原长度 ${Buffer.byteLength(agents)} | ${sha(agents)} |`));
  assert.ok(text.includes(`| CLAUDE.md | 原长度 ${Buffer.byteLength(claude)} | ${sha(claude)} |`));
  assert.doesNotMatch(text, /DS_Store|README-知识库|客户资料\/README\.md|01-AI协作\/建库档案/);
  assert.ok(readText(root, "AGENTS.md").length > agents.length, "AGENTS.md 已经追加了标记段");
  assert.match(readText(root, "01-AI协作/README.md"), /\| 原件清单 \| 原件清单 \| [^\n]*\[原件清单\.md\]\(原件清单\.md\) \|/);
  assert.deepEqual(TYPES["01-AI协作"].includes("原件清单"), true);
  const again = runInit(root, { ...opts, date: "2026-10-21" });
  assert.ok(!again.created.includes("01-AI协作/原件清单.md"));
  assert.equal(readText(root, "01-AI协作/原件清单.md"), text, "已有的原件清单不覆盖");
  assert.deepEqual(checkKnowledgeBase(root).errors, []);
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  assert.ok(!existsSync(join(std, "01-AI协作/原件清单.md")), "标准结构不生成");
  rmSync(root, { recursive: true });
  rmSync(std, { recursive: true });
});

test("N3 原件清单：接入收尾时原有文件改了、删了、改名都报错，平时只提醒；AGENTS.md、CLAUDE.md 只比追加之前那段", () => {
  const root = tmp();
  for (const n of ["张总", "李总", "王总"]) write(root, `客户资料/${n}.md`, `${n}的情况`);
  write(root, "AGENTS.md", "# 我原来的规矩\n");
  write(root, "CLAUDE.md", "# 我的设置\n");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" }, updateAgents: true });
  assert.deepEqual(checkKnowledgeBase(root).errors, [], "AGENTS.md、CLAUDE.md 追加之后不报");
  writeFileSync(join(root, "AGENTS.md"), `${readText(root, "AGENTS.md")}- 我后来又加的一条\n`);
  assert.deepEqual(checkKnowledgeBase(root).errors, [], "追加的部分随便改");
  write(root, "客户资料/张总.md", "张总的情况（被改了）");
  rmSync(join(root, "客户资料/李总.md"));
  renameSync(join(root, "客户资料/王总.md"), join(root, "客户资料/王总-旧.md"));
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("# 我原来的规矩", "# 我原来的规矩（改）"));
  const strict = checkKnowledgeBase(root, { stage: "connect" }).errors;
  for (const e of [
    "原有文件被改了：客户资料/张总.md",
    "原有文件不见了：客户资料/李总.md（可能被移动或改名）",
    "原有文件不见了：客户资料/王总.md（可能被移动或改名）",
    "客户资料/王总-旧.md 是新写的文件，但没有开头元信息",
    "原有文件被改了：AGENTS.md",
  ]) assert.ok(strict.includes(e), `connect 应该报：${e}\n${strict.join("\n")}`);
  assert.ok(!strict.includes("原有文件被改了：CLAUDE.md"));
  for (const stage of [null, "quick"]) {
    const { errors, warnings } = checkKnowledgeBase(root, { stage });
    assert.ok(!has(errors, /原有文件|王总-旧/), `stage=${stage} 平时不该报错：\n${errors.join("\n")}`);
    for (const w of ["原有文件被改了：客户资料/张总.md", "原有文件不见了：客户资料/李总.md", "客户资料/王总-旧.md 是接入以后新写的文件"]) {
      assert.ok(warnings.some((x) => x.includes(w)), `stage=${stage} 应该提醒：${w}\n${warnings.join("\n")}`);
    }
  }
  rmSync(root, { recursive: true });
});

test("N3 原有文件夹里新写的文件：没有开头元信息，接入收尾时是错误、平时是提醒；没有原件清单的库照旧只提醒", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  write(root, "客户资料/赵总.md", "AI 新写的，没有元信息");
  write(root, "客户资料/钱总.md", customer("钱总"));
  const strict = checkKnowledgeBase(root, { stage: "connect" });
  assert.ok(strict.errors.includes("客户资料/赵总.md 是新写的文件，但没有开头元信息"), strict.errors.join("\n"));
  assert.ok(!has(strict.errors, /钱总\.md|张总\.md/));
  const first = checkKnowledgeBase(root);
  assert.ok(!has(first.errors, /赵总\.md/));
  assert.ok(first.warnings.some((w) => w.includes("客户资料/赵总.md 是接入以后新写的文件")));
  assert.ok(first.warnings.some((w) => w.includes("客户资料/ 下有 1 份老板原有的文件没有开头元信息")));
  rmSync(join(root, "01-AI协作/原件清单.md"));
  write(root, "01-AI协作/README.md", readText(root, "01-AI协作/README.md").replace(/\| 原件清单 \|[^\n]*\n/, ""));
  const old = checkKnowledgeBase(root);
  assert.deepEqual(old.errors, []);
  assert.ok(old.warnings.some((w) => w.includes("客户资料/ 下有 2 份老板原有的文件没有开头元信息")));
  rmSync(root, { recursive: true });
});

test("必读四份：--stage quick 和 connect 缺哪份报哪份，按目录对应换算位置", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  assert.deepEqual(checkKnowledgeBase(root, { stage: "quick" }).errors, []);
  rmSync(join(root, "02-关于我/基本情况.md"));
  rmSync(join(root, "06-项目/近期要事.md"));
  const { errors } = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(has(errors, /^工作台每次都要读 02-关于我\/基本情况\.md，还没有：/), errors.join("\n"));
  assert.ok(has(errors, /^工作台每次都要读 06-项目\/近期要事\.md，还没有：/));
  assert.ok(!has(errors, /协作偏好\.md|生意总览\.md/));
  assert.deepEqual(checkKnowledgeBase(root).errors, [], "不带 --stage 不查必读四份");
  const kb = tmp();
  write(kb, "我自己/简历.md", "简历");
  runInit(kb, { date: "2026-10-20", map: { "02-关于我": "我自己" } });
  const connect = checkKnowledgeBase(kb, { stage: "connect" }).errors;
  for (const p of ["我自己/基本情况.md", "01-AI协作/协作偏好.md", "03-生意/生意总览.md", "06-项目/近期要事.md"]) {
    assert.ok(connect.some((e) => e.startsWith(`工作台每次都要读 ${p}，还没有：`)), `应该报 ${p}：\n${connect.join("\n")}`);
  }
  rmSync(root, { recursive: true });
  rmSync(kb, { recursive: true });
});

test("N4 init 生成的层 README：索引表头统一 5 列；01 层列建库档案、任务手册（有协作偏好就列），99 层列采访记录；刚建好的库没有漏索引提醒", () => {
  const root = tmp();
  write(root, "01-AI协作/协作偏好.md", note(base({ 类型: "协作偏好" })));
  runInit(root, { date: "2026-10-20" });
  for (const id of LAYER_IDS.filter((x) => x !== "05-方法与判断")) {
    const lines = readText(root, `${id}/README.md`).split("\n");
    const i = lines.findIndex((l) => l.startsWith("## 索引"));
    assert.equal(lines[i + 1], "| 名称 | 类型 | 分组 | 一句话 | 文件 |", id);
    assert.equal(lines[i + 2], "|---|---|---|---|---|", id);
  }
  const ai = readText(root, "01-AI协作/README.md");
  assert.match(ai, /\| 建库档案 \| 建库档案 \| \| [^|]+ \| \[建库档案\.md\]\(建库档案\.md\) \|/);
  assert.match(ai, /\| 协作偏好 \| 协作偏好 \| \| [^|]+ \| \[协作偏好\.md\]\(协作偏好\.md\) \|/);
  assert.match(ai, /\| 任务手册 \| 任务手册 \| \| [^|]+ \| \[整理新材料\]\(任务手册\/整理新材料\.md\)、\[每周复盘\]\(任务手册\/每周复盘\.md\)、\[改稿后记下来\]\(任务手册\/改稿后记下来\.md\) \|/);
  assert.doesNotMatch(ai, /\| 原件清单 \||原件清单\.md/, "标准结构的索引里没有原件清单");
  assert.match(readText(root, "99-原始材料/README.md"), /\| 采访记录 \| 采访记录 \| \| [^|]+ \| 采访记录\/ \|/);
  assert.ok(!has(checkKnowledgeBase(root).warnings, /索引里没有|没提到子文件夹/), checkKnowledgeBase(root).warnings.join("\n"));
  const bare = tmp();
  runInit(bare, { date: "2026-10-20" });
  assert.doesNotMatch(readText(bare, "01-AI协作/README.md"), /\| 协作偏好 \||协作偏好\.md/, "还没有协作偏好.md 就不列");
  const mapped = tmp();
  write(mapped, "客户资料/张总.md", "张总");
  runInit(mapped, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.ok(!has(checkKnowledgeBase(mapped).warnings, /01-AI协作\/README\.md|99-原始材料\/README\.md/));
  for (const r of [root, bare, mapped]) rmSync(r, { recursive: true });
});

test("N5 建库档案：“未知（老板说以后再说）”和“（AI 推断，待确认）”开头的条目算填了；报错文字说长期最关心", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE()
    .replace("本地服务型：一家小餐馆，外卖为辅。", "- （AI 推断，待确认）本地服务型：一家小餐馆，外卖为辅。")
    .replace("1. 今天该回访哪几位老客。", "1. 未知（老板说以后再说）"));
  const { errors, warnings } = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(errors, []);
  assert.ok(!has(warnings, /占位/), warnings.join("\n"));
  const fresh = tmp();
  runInit(fresh, { date: "2026-10-20" });
  const e = checkKnowledgeBase(fresh, { stage: "quick" }).errors;
  assert.ok(e.includes("建库档案的“老板最关心”还是空的：写上老板长期最关心的 1—3 个方面（从第 10 题早上想看的、最怕漏掉的东西归类，加上第 6 题最操心的事）"), e.join("\n"));
  rmSync(root, { recursive: true });
  rmSync(fresh, { recursive: true });
});

test("N6 N8 N16 init 生成的说明：02 层隐私规矩、05 层装什么、追加到原有 AGENTS.md 的“我加的规矩”", () => {
  const root = tmp();
  write(root, "AGENTS.md", "# 我原来的规矩\n");
  runInit(root, { date: "2026-10-20", updateAgents: true });
  const about = readText(root, "02-关于我/README.md");
  assert.ok(about.includes("- 用第一人称“我”写。\n- 边界默认私密；做事与决策方式里如果有私人的事（健康、家庭、收入）也标私密，否则标内部。\n- 内容本身私密的部分（边界、健康、家庭、收入、别人的私人信息）才标私密；采访记录整份私密，不等于整理稿都私密。"), about);
  assert.doesNotMatch(about, /从私密材料整理出的东西也是私密/);
  assert.match(readText(root, "05-方法与判断/README.md"), /- 装什么：一类工作一个文件夹（判断样本、判断规则，需要时加做法、话术）；内容很少的可以先一个文件，做法和样本写在一起；老板自己的方法放 我的方法\/\n/);
  const methods = LAYERS.find((l) => l.id === "05-方法与判断");
  assert.match(methods.mapHolds, /我/);
  assert.doesNotMatch(methods.mapHolds, /老板/);
  const agents = readText(root, "AGENTS.md");
  assert.ok(agents.includes(`| 05-方法与判断 | ${methods.mapHolds} |`));
  assert.match(agents, /<!-- 本段结束 -->\n\n## 我加的规矩\n最上面我原来写的规矩照旧有效；以后新加的写在这里。（Skill 不改这里）\n/);
  const fresh = tmp();
  runInit(fresh, { date: "2026-10-20" });
  assert.match(readText(fresh, "AGENTS.md"), /## 我加的规矩\n（我自己写，或我点名让 AI 记成规矩、确认过的写在这里；知识库 Skill 不会自己改这里。）\n/, "新建的 AGENTS.md 用新说明");
  assert.match(agents, /## 跟我说话\n见最上面我原来写的；新的补在这里。\n/, "追加的不重抄原来的规矩");
  assert.match(readText(fresh, "AGENTS.md"), /## 跟我说话\n<最常被纠正的 1—2 条。>\n/, "新建的留占位");
  rmSync(root, { recursive: true });
  rmSync(fresh, { recursive: true });
});

test("N9 索引只认链接和恰好等于名字的格子，正文提到名字不算", () => {
  const dir = tmp();
  const readme = [
    "# 客户", "", "正文里提到张总，还有 企业客户 文件夹，见 门店老客/老周.md。", "",
    "| 名称 | 文件 |", "|---|---|",
    "| 王总 | 王总的档案 |", "| `赵总.md` | |", "| 孙总的情况 | |", "| 渠道客户/ | |", "| 老客/周总 | |", "",
    "见 [钱总](钱总.md)、[程阿姨](门店老客/程阿姨.md)、[带空格](<甲 公司.md>)。",
  ].join("\n");
  const yes = (name, opts) => assert.equal(mentionedIn(readme, dir, name, opts), true, name);
  const no = (name, opts) => assert.equal(mentionedIn(readme, dir, name, opts), false, name);
  no("张总.md"); yes("王总.md"); yes("赵总.md"); no("孙总.md"); yes("钱总.md"); yes("甲 公司.md");
  no("企业客户", { dir: true }); yes("渠道客户", { dir: true }); yes("门店老客", { dir: true });
  yes("门店老客/程阿姨.md"); no("门店老客/老周.md"); yes("老客/周总.md"); no("周总.md");
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  write(root, "04-客户/README.md", readText(root, "04-客户/README.md").replace("## 怎么找", "甲公司是老客户。\n\n## 怎么找"));
  assert.ok(checkKnowledgeBase(root).warnings.includes("04-客户/README.md 的索引里没有 甲公司.md"), "正文提到名字不算进了索引");
  rmSync(dir, { recursive: true });
  rmSync(root, { recursive: true });
});

test("N9 没有 README 的子文件夹：里面每份文件都要被父级 README 链接到；index 会补上", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/渠道客户/西岭酒店.md", customer("西岭酒店"));
  write(root, "04-客户/渠道客户/北辰酒店.md", customer("北辰酒店"));
  write(root, "04-客户/渠道客户/西岭酒店-往来记录.md", note(base({ 类型: "往来记录", 名称: "西岭酒店" })));
  write(root, "04-客户/README.md", readText(root, "04-客户/README.md").replace("| （暂时没有） | | | | |", "| 西岭酒店 | 客户 | 渠道客户 | 月结 | [渠道客户/西岭酒店.md](渠道客户/西岭酒店.md) |"));
  const { warnings } = checkKnowledgeBase(root);
  assert.ok(warnings.includes("04-客户/README.md 的索引里没有 渠道客户/北辰酒店.md"), warnings.join("\n"));
  assert.ok(!has(warnings, /西岭酒店|没提到子文件夹 渠道客户/), warnings.join("\n"));
  const plan = buildIndex(join(root, "04-客户"));
  assert.equal(plan.rows.length, 2, plan.table);
  assert.ok(plan.rows.includes("| 北辰酒店 | 客户 | 企业客户 | （待补） | [渠道客户/北辰酒店.md](渠道客户/北辰酒店.md) |"), plan.table);
  writeIndex(join(root, "04-客户"));
  // 补出来的行“一句话”先写（待补）：只剩这一条提醒
  const left = checkKnowledgeBase(root).warnings.filter((w) => /04-客户\/README\.md/.test(w));
  assert.deepEqual(left, ["04-客户/README.md 的索引里还有 2 行写着（待补）：补上一句稳定的定位（是谁、怎么来的、做哪类事）"], left.join("\n"));
  const readmePath = join(root, "04-客户/README.md");
  writeFileSync(readmePath, readFileSync(readmePath, "utf8").replace(/（待补）/g, "老客户，月结"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /04-客户\/README\.md/));
  rmSync(root, { recursive: true });
});

test("N10 就地建图：建库快照的上次联系、下次跟进按日期规则查", () => {
  const root = tmp();
  for (const n of ["张总", "李总", "王总"]) write(root, `客户资料/${n}.md`, n);
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  write(root, "客户资料/README.md", readText(root, "客户资料/README.md").replace("| （待填） | | | | | | | |", [
    "| 张总 | 客户 | 企业客户 | 报价中 | 张总 | 上周 | 2026-11-01 | [张总.md](张总.md) |",
    "| 李总 | 客户 | 企业客户 | 报价中 | 李总 | 未知 | （待填） | [李总.md](李总.md) |",
    "| 王总 | 客户 | 企业客户 | 报价中 | 王总 | 2026-10-01 |  | [王总.md](王总.md) |",
  ].join("\n")));
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.ok(errors.includes("“上次联系”要写成 2026-10-25，不知道写未知或未定：客户资料/README.md 的建库快照 · 张总（现在是 上周）（原因写到正文里，字段里只留这两个字）"), errors.join("\n"));
  assert.ok(!has(errors, /李总|王总/), errors.join("\n"));
  assert.ok(has(warnings, /建库快照.*李总.*下次跟进/), warnings.join("\n"));
  assert.ok(has(warnings, /建库快照.*王总.*下次跟进/));
  const connect = checkKnowledgeBase(root, { stage: "connect" }).errors;
  assert.ok(has(connect, /建库快照.*李总.*下次跟进/) && has(connect, /建库快照.*王总.*下次跟进/), connect.join("\n"));
  rmSync(root, { recursive: true });
});

test("N24 index 对知识库根目录：不生成任何行，说明用 AGENTS.md 的地图", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const agents = readText(root, "AGENTS.md");
  assert.equal(buildIndex(root).rows.length, 0);
  const out = writeIndex(root);
  assert.equal(out.written, false);
  assert.match(out.reason, /根目录用 AGENTS\.md 的地图，不用 README 索引/);
  const run = cli("index.mjs", root, "--write");
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /根目录用 AGENTS\.md 的地图，不用 README 索引/);
  assert.equal(readText(root, "AGENTS.md"), agents);
  assert.ok(!existsSync(join(root, "README.md")));
  rmSync(root, { recursive: true });
});

test("N25 密钥：否定词紧跟在冒号后面才不报", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "01-AI协作/工具与账号.md", note(base({ 类型: "工具与账号" }), "公众号后台密码：不存在这里\n抖店密码: 不放在知识库\napi_key = 不写在这里\n飞书密码：“不记在这里”"));
  assert.ok(!has(checkKnowledgeBase(root).errors, /疑似密码/));
  write(root, "01-AI协作/协作偏好.md", note(base({ 类型: "协作偏好" }), "后台密码：Sn2026abc（怕自己不记得）"));
  write(root, "03-生意/生意总览.md", note(base({ 类型: "生意" }), "后台密码：不存；api_key: sk-12345678"));
  const { errors } = checkKnowledgeBase(root);
  assert.ok(errors.includes("疑似密码或密钥：01-AI协作/协作偏好.md"), errors.join("\n"));
  assert.ok(errors.includes("疑似密码或密钥：03-生意/生意总览.md"));
  assert.ok(!errors.includes("疑似密码或密钥：01-AI协作/工具与账号.md"));
  rmSync(root, { recursive: true });
});

// ───────────── 第四轮 ─────────────

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
/** 把夹具拷到临时目录再用，夹具本身不动 */
const fixture = (name) => {
  const root = tmp();
  cpSync(join(FIXTURES, name), root, { recursive: true });
  return root;
};
/** 文件夹下所有文件（含点开头的）的 sha256，键是相对路径 */
function hashTree(root) {
  const out = {};
  const visit = (dir) => {
    for (const n of readdirSync(dir)) {
      const abs = join(dir, n);
      if (lstatSync(abs).isDirectory()) visit(abs);
      else out[relative(root, abs).split(sep).join("/")] = sha(readFileSync(abs));
    }
  };
  visit(root);
  return out;
}
const lineCount = (text) => text.replace(/\n$/, "").split("\n").length;
/** 工作台 Skill 现在真实写进 AGENTS.md 的那一段（7 行、约 700 字节） */
const WORKBENCH_BLOCK = [
  "<!-- 工作台 开始：由老板工作台 Skill 维护，其他 Skill 不改这一段 -->",
  "## 工作台",
  "- 地址 http://127.0.0.1:4537（开机自启；演示日期固定 2026-05-20）。程序和数据在 `工作台/`，不是知识，查资料不要进去。",
  "- 先读 `工作台/README.md`：命令、写入规则、怎么打开网页给我看。",
  "- 常用命令（在知识库根目录运行）：`node 工作台/程序/server/cli.ts today`（今天的情况）、`client <名字>`、`log <名字> \"说了什么\"`、`todo-add \"事情\" --due 日期`。",
  "- 往工作台写东西也一样：先列出要写什么，我说“确认”再写；不直接改数据库文件。",
  "<!-- 工作台 结束 -->",
].join("\n");
/** 在“本段结束”后面插入工作台段（boss-workbench 的放法） */
const withWorkbench = (agents, block = WORKBENCH_BLOCK) => agents.replace("<!-- 本段结束 -->\n", `<!-- 本段结束 -->\n\n${block}\n`);

/** 只答了第 1、2、3、6、7、10 题：必读四份、1 个客户、画像和最关心都有；没有产品、样本、真实任务 */
function fillHalfKb(root) {
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("- 2026-10-20 真实任务：替老板写了一条老客回访草稿，老板改了一句就发了\n", ""));
  write(root, "99-原始材料/采访记录/2026-10-20-建库采访.md", INTERVIEW);
  write(root, "04-客户/老客1.md", customer("老客1"));
  fillMustRead(root);
}

test("C02 体检结论：只答了一半的库“工作台能跑”，标准版还差判断样本、真实任务", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillHalfKb(root);
  const { summary, errors } = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(errors.length > 0);
  assert.equal(summary.workbench_ready, true, JSON.stringify(summary));
  assert.equal(summary.standard_ready, false);
  assert.ok(summary.verdict.startsWith("工作台能跑，标准版还差："), summary.verdict);
  for (const label of ["判断样本", "真实任务", "产品"]) assert.ok(summary.missing.includes(label), `${label}：${summary.missing}`);
  assert.ok(summary.verdict.includes("判断样本") && summary.verdict.includes("真实任务"));
  assert.equal(summary.counts.clients, 1);
  assert.equal(summary.skill_version, SKILL_VERSION);
  assert.ok(summary.reminders.some((r) => r.includes("新对话")));
  assert.equal(checkKnowledgeBase(root).summary, undefined, "不带 --stage 不出 summary");
  rmSync(root, { recursive: true });
});

test("C02 体检结论：补齐的库“标准版建好了”，只跑过 init 的“还差：”；计数按“## 样本”条数算", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  const fresh = checkKnowledgeBase(root, { stage: "quick" }).summary;
  assert.ok(fresh.verdict.startsWith("还差："), fresh.verdict);
  assert.equal(fresh.workbench_ready, false);
  for (const label of ["地图占位", "建库档案占位", "类型画像", "老板最关心", "采访原话", "基本情况", "协作偏好", "生意总览", "近期要事", "产品", "客户", "判断样本", "真实任务"]) {
    assert.ok(fresh.missing.includes(label), `应该缺 ${label}：${fresh.missing}`);
  }
  fillQuickKb(root);
  write(root, "05-方法与判断/报价与接单/判断样本.md", note(base({ 类型: "判断样本", 工作: "报价与接单" }), "## 样本 1｜包场\n- 判断：收定金\n\n## 样本 2｜团餐\n- 判断：先付一半\n\n## 样本 3｜外卖大单\n- 判断：提前一天"));
  write(root, "06-项目/春季上新.md", note(base({ 类型: "项目", 名称: "春季上新", 状态: "进行中", 截止: "未定", 负责人: "我" })));
  write(root, "00-收件箱/2026-10-21-老客1-微信.md", "聊天原文");
  const { summary, errors } = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(errors, []);
  assert.equal(summary.verdict, "标准版建好了");
  assert.equal(summary.standard_ready, true);
  assert.equal(summary.workbench_ready, true);
  assert.deepEqual(summary.missing, []);
  assert.equal(summary.counts.samples, 3);
  assert.equal(summary.counts.clients, 3);
  assert.equal(summary.counts.projects, 1);
  assert.equal(summary.counts.products, 1);
  assert.equal(summary.counts.inbox, 1);
  assert.ok(summary.counts.pending_files >= 5, "fillQuickKb 写的整理稿都是待确认");
  rmSync(root, { recursive: true });
});

test("C02 --brief：stdout 只有一行结论，退出码和不带时一样；平时结论打在 stderr，stdout 照旧是 JSON", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  const full = cli("check.mjs", root, "--stage", "quick");
  const out = JSON.parse(full.stdout);
  assert.ok(out.summary.verdict.startsWith("还差："));
  assert.match(full.stderr, /^体检结论：还差：[^\n]*｜客户 0 · 项目 0 · 产品 0 · 判断样本 0 条 · 待确认 \d+ 份 · 收件箱 0 份｜老板知识库\/2 2026-10-12$/m);
  assert.match(full.stderr, /新对话/);
  const brief = cli("check.mjs", root, "--stage", "quick", "--brief");
  assert.equal(brief.status, full.status);
  assert.equal(brief.stdout.trimEnd().split("\n").length, 1, brief.stdout);
  assert.match(brief.stdout, /^体检结论：还差：/);
  fillQuickKb(root);
  const ok = cli("check.mjs", root, "--stage=quick", "--brief");
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^体检结论：标准版建好了｜/);
  assert.equal(cli("check.mjs", root, "--brief").status, 1, "--brief 要和 --stage 一起用");
  rmSync(root, { recursive: true });
});

test("C14 C57 C58 C61 收件箱说明：和工作台的收件箱分开讲；先别丢、一屏一张、转成文字稿、整理过的去了哪", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const inbox = readText(root, "00-收件箱/README.md");
  const a = inbox.indexOf("## 和工作台的收件箱不是一回事");
  assert.ok(a > 0 && a < inbox.indexOf("## 这一层的规矩"), inbox);
  for (const w of ["不要丢", "转成文字稿", "## 整理过的去了哪", "| 原件 | 整理进 | 原件现在在 |", "一屏一张", "只登记位置", "日期-我-", "复制文字", "不用抓取工具"]) {
    assert.ok(inbox.includes(w), `收件箱说明应有：${w}`);
  }
  const l00 = LAYERS.find((l) => l.id === "00-收件箱");
  assert.ok(readText(root, "AGENTS.md").includes(`| 00-收件箱 | ${l00.mapHolds} | ${l00.mapWhen} |`));
  assert.match(l00.mapHolds, /认不出/);
  assert.doesNotMatch(l00.holds, /、随手记/, "不再单列“随手记”");
  rmSync(root, { recursive: true });
});

test("C19 入口：两个起始标记、结束标记在起始之前都报错；工作台段放进知识库段里提醒", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const agents = readText(root, "AGENTS.md");
  write(root, "AGENTS.md", `${agents}\n${MARK_START_TEXT}\n## 又一段\n<!-- 本段结束 -->\n`);
  assert.ok(checkKnowledgeBase(root).errors.includes("AGENTS.md 里有 2 个知识库标记段，只能留一个"));
  write(root, "AGENTS.md", `<!-- 本段结束 -->\n${agents.replace("<!-- 本段结束 -->", "")}`);
  assert.ok(has(checkKnowledgeBase(root).errors, /结束标记/), "结束标记只在起始之前，也算没有");
  write(root, "AGENTS.md", agents.replace("## 跟我说话", `${WORKBENCH_BLOCK}\n\n## 跟我说话`));
  const inside = checkKnowledgeBase(root);
  assert.ok(inside.warnings.includes("工作台段的标记不成对（或放进了知识库段里），交给 boss-workbench 修"), inside.warnings.join("\n"));
  write(root, "AGENTS.md", withWorkbench(agents, WORKBENCH_BLOCK.replace("<!-- 工作台 结束 -->", "")));
  assert.ok(checkKnowledgeBase(root).warnings.includes("工作台段的标记不成对（或放进了知识库段里），交给 boss-workbench 修"));
  write(root, "AGENTS.md", withWorkbench(agents));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /工作台段/), "放在知识库段后面、成对，不提醒");
  rmSync(root, { recursive: true });
});

test("C19 行数分段算：全文 120 行、标记段不长时，说“你原来写的”；标记段超过 90 行、工作台段超过 8 行分别提醒", () => {
  const root = tmp();
  writeFileSync(join(root, "AGENTS.md"), `# 我原来的规矩\n${Array.from({ length: 60 }, (_, i) => `- 第 ${i + 1} 条`).join("\n")}\n`);
  runInit(root, { date: "2026-10-20", updateAgents: true });
  const text = readText(root, "AGENTS.md");
  assert.ok(lineCount(text) > 100);
  const { warnings } = checkKnowledgeBase(root);
  const w = warnings.find((x) => x.startsWith("AGENTS.md 一共"));
  assert.ok(w, warnings.join("\n"));
  assert.match(w, /其中你原来写的有 \d+ 行；AI 每次都会读全文，建议精简你自己写的部分/);
  assert.ok(!has(warnings, /挪进 01/), "全文超长但标记段不长时，不叫人挪进 01");
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  const agents = readText(std, "AGENTS.md");
  write(std, "AGENTS.md", agents.replace("## 跟我说话", `${Array.from({ length: 40 }, (_, i) => `- 细则 ${i}`).join("\n")}\n\n## 跟我说话`));
  assert.ok(has(checkKnowledgeBase(std).warnings, /^知识库 Skill 维护的那段有 \d+ 行，超过 90 行：细则挪进 01-AI协作\/README\.md$/));
  write(std, "AGENTS.md", withWorkbench(agents, WORKBENCH_BLOCK.replace("<!-- 工作台 结束 -->", "- 多一行。\n- 再多一行。\n<!-- 工作台 结束 -->")));
  assert.ok(checkKnowledgeBase(std).warnings.includes("工作台段有 9 行，交给 boss-workbench 精简"));
  rmSync(root, { recursive: true });
  rmSync(std, { recursive: true });
});

test("C19 旧版“知识库规则”段：接入时原件只记到它之前；和 v2 同时在时提醒，删掉后 connect 不报原件被改", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  const own = "# 我原来的规矩\n- 回答先给结论\n\n";
  writeFileSync(join(root, "AGENTS.md"), `${own}<!-- 知识库规则 开始 -->\n先读 知识库说明.md\n<!-- 知识库规则 结束 -->\n`);
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" }, updateAgents: true });
  assert.ok(readText(root, "01-AI协作/原件清单.md").includes(`| AGENTS.md | 原长度 ${Buffer.byteLength(own)} | ${sha(own)} |`));
  assert.ok(checkKnowledgeBase(root).warnings.includes("旧版‘知识库规则’段还在，和新规矩冲突；先把 check 跑通，老板同意后删掉"));
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("<!-- 知识库规则 开始 -->\n先读 知识库说明.md\n<!-- 知识库规则 结束 -->\n", ""));
  const after = checkKnowledgeBase(root, { stage: "connect" });
  assert.ok(!after.errors.includes("原有文件被改了：AGENTS.md"), after.errors.join("\n"));
  assert.ok(!has(after.warnings, /旧版‘知识库规则’/));
  rmSync(root, { recursive: true });
});

test("C24 接入夹具（Obsidian）：init 不动原有文件；不带 stage 体检 0 错误，双链不报也不提醒", () => {
  const root = fixture("接入-Obsidian");
  const before = hashTree(root);
  const ownAgents = readText(root, "AGENTS.md");
  const run = cli("init.mjs", root, "--map", "04-客户=客户,06-项目=项目", "--readonly", "日记,Templates", "--exclude", "私人", "--update-agents", "--date", "2026-10-09");
  assert.equal(run.status, 0, run.stderr);
  const after = hashTree(root);
  for (const [path, h] of Object.entries(before)) {
    if (path === "AGENTS.md") continue;
    assert.equal(after[path], h, `原有文件被改了：${path}`);
  }
  assert.ok(readText(root, "AGENTS.md").startsWith(ownAgents), "AGENTS.md 前面原有那段不变");
  assert.doesNotMatch(readText(root, "01-AI协作/原件清单.md"), /私人\/|家庭待办/, "不读的文件夹不进原件清单");
  const result = checkKnowledgeBase(root);
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
  assert.ok(!has(result.warnings, /双链/), result.warnings.join("\n"));
  rmSync(root, { recursive: true });
});

test("C24 接入夹具（Notion 导出）：整包放进 99-原始材料，%20 编码的链接不报不存在", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-09" });
  cpSync(join(FIXTURES, "接入-Notion导出"), join(root, "99-原始材料/导入-Notion-2026-10-09"), { recursive: true });
  const linked = readdirSync(join(root, "99-原始材料/导入-Notion-2026-10-09/Export-3f2a")).find((n) => n.endsWith(".md") && n.startsWith("客户"));
  assert.match(readText(root, `99-原始材料/导入-Notion-2026-10-09/Export-3f2a/${linked}`), /%20/, "夹具里的链接是 %20 编码的");
  const { errors } = checkKnowledgeBase(root);
  assert.ok(!has(errors, /链接指向不存在的文件/), errors.join("\n"));
  rmSync(root, { recursive: true });
});

test("C24 接入夹具（Obsidian）：补齐必读四份、建库快照、接入采访和真实任务后，--stage connect 通过，结论“标准版建好了”", () => {
  const root = fixture("接入-Obsidian");
  runInit(root, { date: "2026-10-09", map: { "04-客户": "客户", "06-项目": "项目" }, readonly: ["日记", "Templates"], exclude: ["私人"], updateAgents: true });
  fillAgents(root);
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md")
    .replace("（第 2 题后填：主类型 + 叠加）", "专业服务型：外贸代理，接网站和小程序的单")
    .replace("1. （第 10 题后填）", "1. 这周该回谁的报价")
    .replace("| （还没有） | | | |", "| 暂不启用 | | 固定层够用 | 接入采访 |")
    .replace("### 已知\n（待填）", "### 已知\n- 客户/ 里 2 位客户")
    .replace(/（待填）/g, "暂无")
    .replace("## 已完成\n", "## 已完成\n- 2026-10-09 真实任务：替王总写了张总的报价跟进草稿\n"));
  write(root, "99-原始材料/采访记录/2026-10-09-接入采访.md", INTERVIEW);
  fillMustRead(root, { "04-客户": "客户", "06-项目": "项目" });
  write(root, "客户/README.md", readText(root, "客户/README.md").replace("| （待填） | | | | | | | |", [
    "| 张总 | 客户 | 远山贸易 | 报价中 | 张总 | 2026-10-08 | 未定 | [张总-远山贸易.md](张总-远山贸易.md) |",
    "| 李姐 | 客户 | 花间民宿 | 维护中 | 李姐 | 未知 | 未定 | [李姐-花间民宿.md](李姐-花间民宿.md) |",
  ].join("\n")));
  const result = checkKnowledgeBase(root, { stage: "connect" });
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
  assert.equal(result.summary.verdict, "标准版建好了");
  assert.equal(result.summary.counts.clients, 2);
  rmSync(root, { recursive: true });
});

test("C31 C35 品牌与口吻：有文件没有“## 不能说的话”提醒；做内容的缺这份提醒；门店画像不提醒", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "03-生意/品牌与口吻.md", note(base({ 类型: "品牌" }), "## 口吻\n短句，不用感叹号。"));
  assert.ok(has(checkKnowledgeBase(root).warnings, /^03-生意\/品牌与口吻\.md 里没有‘## 不能说的话’：工作台和它的内容模块按这个标题取红线词表$/));
  write(root, "03-生意/品牌与口吻.md", note(base({ 类型: "品牌" }), "## 口吻\n短句。\n\n## 不能说的话\n| 类别 | 不说 | 换成 |\n|---|---|---|\n| 功效 | 治病、降三高 | 喝着舒服 |"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /不能说的话/));
  rmSync(join(root, "03-生意/品牌与口吻.md"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /不能说的话/), "门店、没写画像的不提醒");
  // 第五轮（R5-7）起只认做内容的词：电商、品牌、零售本身不触发，见下面 R5-7
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("本地服务型：一家小餐馆，外卖为辅。", "电商品牌零售：天猫、抖店卖茶，小红书种草。"));
  assert.ok(has(checkKnowledgeBase(root).warnings, /^做内容、对外发东西的老板要有 03-生意\/品牌与口吻\.md 和它的‘不能说的话’表/));
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", "| 内容与作品 | `11-内容与作品/`（计划） | 想开小红书 | 第 9 题 |"));
  assert.ok(has(checkKnowledgeBase(root).warnings, /^做内容、对外发东西的老板要有/), "计划中的内容模块也算");
  write(root, "03-生意/品牌与口吻.md", note(base({ 类型: "品牌" }), "## 不能说的话\n| 类别 | 不说 | 换成 |\n|---|---|---|\n| 功效 | 治病 | 喝着舒服 |"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /不能说的话/));
  rmSync(root, { recursive: true });
});

test("C43 示例库：体检认得出、不报错；收件箱混进没标示例的材料提醒；在示例库上跑 init 退出 1、不写东西", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("结构: 标准\n", "结构: 标准\n示例: 是\n"));
  write(root, "99-原始材料/采访记录/2026-10-20-建库采访.md", INTERVIEW.replace("隐私: 私密\n", "隐私: 私密\n示例: 是\n"));
  write(root, "00-收件箱/2026-10-21-老客1-微信.md", "---\n类型: 原始材料\n日期: 2026-10-21\n示例: 是\n---\n聊天原文");
  const ok = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.summary.sample_kb, true);
  assert.equal(ok.summary.verdict, "标准版建好了", "结论文字不加前缀");
  assert.ok(!has(ok.warnings, /不是示例自带的材料/), ok.warnings.join("\n"));
  const brief = cli("check.mjs", root, "--stage", "quick", "--brief");
  assert.match(brief.stdout, /^这是示例库｜体检结论：标准版建好了｜/);
  write(root, "00-收件箱/2026-11-16-演示-电话纪要.md", "---\n类型: 原始材料\n日期: 2026-11-16\n---\n演示材料，原样不动");
  write(root, "00-收件箱/README.md", readText(root, "00-收件箱/README.md").replace("| （暂时没有） | | | | |", "| 演示电话纪要 | 原始材料 | | 演示用 | [2026-11-16-演示-电话纪要](2026-11-16-演示-电话纪要.md) |"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /不是示例自带的材料/), "收件箱 README 里列着的演示材料不用改文件开头");
  write(root, "00-收件箱/2026-10-27-我的客户-微信.md", "我自己的客户聊天");
  assert.ok(checkKnowledgeBase(root).warnings.includes("示例库里有一份不是示例自带的材料：00-收件箱/2026-10-27-我的客户-微信.md。如果是你自己的真实资料，建议放进你自己的知识库"));
  const before = hashTree(root);
  for (const args of [[], ["--dry-run"]]) {
    const run = cli("init.mjs", root, ...args);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /这是示例库，不在这里建库；新建一个空文件夹再跑 init/);
  }
  assert.deepEqual(hashTree(root), before, "在示例库上跑 init 不写任何东西");
  rmSync(root, { recursive: true });
});

test("C44 演示日期：写了就要是日期，没写不报", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("结构: 标准\n", "结构: 标准\n演示日期: 2026-10-27\n"));
  assert.ok(!has(checkKnowledgeBase(root).errors, /演示日期/));
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("结构: 标准\n", "结构: 标准\n演示日期: 10月27日\n"));
  assert.ok(has(checkKnowledgeBase(root).errors, /^演示日期要写成 2026-10-27/));
  rmSync(root, { recursive: true });
});

test("C47 客户阶段：不在 12 个里的提醒，写进“阶段对应”表或写“未知”不提醒；就地建图查建库快照", () => {
  assert.deepEqual(CUSTOMER_STAGES, ["新线索", "需求确认", "方案中", "报价中", "待签约", "交付中", "售后", "待复购", "合作中", "维护中", "暂停", "流失"]);
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/甲公司.md", customer("甲公司", { 阶段: "谈判中" }));
  write(root, "04-客户/乙公司.md", customer("乙公司", { 阶段: "未知" }));
  const w = checkKnowledgeBase(root).warnings.find((x) => x.startsWith("阶段‘谈判中’工作台不认识"));
  assert.ok(w && w.endsWith("：04-客户/甲公司.md") && w.includes("新线索 / 需求确认"), w);
  assert.ok(!has(checkKnowledgeBase(root).warnings, /阶段‘未知’/));
  assert.ok(!has(checkKnowledgeBase(root).errors, /阶段/), "只提醒不拦");
  write(root, "01-AI协作/README.md", `${readText(root, "01-AI协作/README.md")}\n## 阶段对应\n| 我的说法 | 工作台的阶段 |\n|---|---|\n| 谈判中 | 报价中 |\n`);
  assert.ok(!has(checkKnowledgeBase(root).warnings, /阶段‘谈判中’/));
  const kb = tmp();
  write(kb, "客户资料/张总.md", "张总");
  runInit(kb, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  write(kb, "客户资料/README.md", readText(kb, "客户资料/README.md").replace("| （待填） | | | | | | | |", "| 张总 | 客户 | 企业客户 | 跟进中 | 张总 | 未知 | 未定 | [张总.md](张总.md) |"));
  assert.ok(has(checkKnowledgeBase(kb).warnings, /^阶段‘跟进中’工作台不认识.*客户资料\/README\.md 的建库快照 · 张总$/));
  rmSync(root, { recursive: true });
  rmSync(kb, { recursive: true });
});

test("C16 C27 C56 C57 C73 C83 C88 AGENTS.md 的规矩：新建和追加的都有；≤100 行、≤8KB；常见任务在前 60 行", () => {
  const fresh = tmp();
  runInit(fresh, { date: "2026-10-20" });
  const appended = tmp();
  writeFileSync(join(appended, "AGENTS.md"), "# 我原来的规矩\n");
  runInit(appended, { date: "2026-10-20", updateAgents: true });
  const block = readText(appended, "AGENTS.md").slice("# 我原来的规矩\n".length).trimStart();
  for (const text of [readText(fresh, "AGENTS.md"), block]) {
    for (const w of [
      "开头不动", "确认后替换上一条", "一件事只在一处写全", "英文冒号", "要有原件",
      "移到 99-原始材料 前先问", "我加的规矩", "模型服务商", "这段别记",
      "## 做事", "已确认优先于待确认", "说法对不上时摆出来", "隐私按私密", "不装抓取微信聊天",
      "| 记一笔：答应了客户什么、哪件事做完了、发了 |", "| 我改完了、这版是我改过的 | 01-AI协作/任务手册/改稿后记下来.md |",
      "| 这周要做什么、该跟进谁 | 06-项目/近期要事.md → 04-客户/README.md → 各客户文件开头的“下次跟进”（装了工作台先看工作台） |",
      "| 做方案、报表、PPT 给别人看 | 02-关于我/README.md 里的 做事与决策方式（什么叫好，有这份时再读）→ 03-生意/README.md |",
      "对外发东西前，先看 03-生意/品牌与口吻.md 的‘不能说的话’（还没建就先问我）", "| 02-关于我 | 我的基本情况、边界（其他的建了再补） |",
      "01-AI协作/协作偏好.md", "标“不读”的文件夹不打开、不搜、不列文件名",
    ]) assert.ok(text.includes(w), `AGENTS.md 应有：${w}`);
    assert.ok(lineCount(text) <= 100, `行数 ${lineCount(text)}`);
    assert.ok(Buffer.byteLength(text) <= 8192);
    assert.doesNotMatch(text.split("<!-- 本段结束 -->")[0].split("\n").slice(1).join("\n"), /老板/, "标记段里不写“老板”");
    assert.doesNotMatch(text, /我原来的笔记/, "标准结构没有就地建图那一句");
  }
  const lines = readText(fresh, "AGENTS.md").split("\n");
  assert.ok(lines.findIndex((l) => l.startsWith("## 常见任务先读哪里")) < 60);
  assert.ok(lines.findIndex((l) => l.startsWith("## 地图")) < 60);
  rmSync(fresh, { recursive: true });
  rmSync(appended, { recursive: true });
});

/** 照一份填满的真实库那样填 AGENTS.md：生意介绍、两个生长模块（地图和常见任务各一行）、第 4、10 题各补一行路由、“跟我说话”两条 */
function fillLikeRealKb(root) {
  for (const [dir, file] of [["10-渠道与经营", "数据口径.md"], ["11-内容与作品", "账号定位.md"]]) write(root, `${dir}/${file}`, note(base({ 类型: dir.startsWith("10") ? "数据口径" : "账号定位" })));
  const text = readText(root, "AGENTS.md")
    .replace("<一两句：我是谁、卖什么、给谁、在哪卖。> 类型：<主类型 + 叠加>。", "王示例（王总，虚构的老板），杭州一家茶叶品牌的创始人，团队 8 人；自有品牌的茶和茶具，线上四个店加一家茶空间，另做企业茶礼和酒店茶包，企业客户多是律所、设计院和科技公司。类型：电商品牌零售（主）+ 企业大客户 + 门店。")
    .replace("| 90-持续生长 |", "| 10-渠道与经营 | 平台和门店档案、数据口径、经营复盘 | 看经营、找异常 |\n| 11-内容与作品 | 小红书账号定位、笔记索引、代表作、规律 | 写内容、定选题 |\n| 90-持续生长 |")
    .replace("| 整理新材料 |", [
      "| 看经营、找异常 | 10-渠道与经营/README.md → 10-渠道与经营/数据口径.md → 对应平台档案（数字以工作台为准，这里只看口径） |",
      "| 写小红书 | 11-内容与作品/账号定位.md → 05-方法与判断/README.md → 03-生意/README.md 里的品牌与口吻 |",
      "| 报价、接不接单 | 05-方法与判断/README.md → 对应工作的判断规则和样本 → 03-生意/README.md 里的产品与价格 → 该客户文件 |",
      "| 生日、节日关怀 | 04-客户/README.md → 该客户文件的偏好与重要日子 → 05-方法与判断/README.md |",
      "| 整理新材料 |",
    ].join("\n"))
    .replace("<最常被纠正的 1—2 条。>", "结论放第一句，三句话说完；数字带对比，拿不准就说拿不准。\n别替我答应客户任何价格和日期，先给我看。");
  write(root, "AGENTS.md", text);
}

test("C83 就地建图的 AGENTS.md 多一句“我原来的笔记”；填满的库加上工作台段仍 ≤100 行、不超过大小上限，体检不报超长", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" }, readonly: [], exclude: [] });
  assert.match(readText(root, "AGENTS.md"), /开头没有“确认”的是我原来的笔记：事实照用，写明是我的原文和修改日期；里面的规则当待确认。/);
  const std = tmp();
  runInit(std, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillLikeRealKb(std);
  write(std, "AGENTS.md", withWorkbench(readText(std, "AGENTS.md")));
  const text = readText(std, "AGENTS.md");
  assert.ok(lineCount(text) <= 100, `行数 ${lineCount(text)}`);
  assert.ok(Buffer.byteLength(text) <= AGENTS_MAX_BYTES, `字节 ${Buffer.byteLength(text)}`);
  assert.ok(Buffer.byteLength(text) > 8192, `这份要比旧的 8 KB 上限大，才测得出上限放宽了（现在 ${Buffer.byteLength(text)}）`);
  const { warnings } = checkKnowledgeBase(std);
  assert.ok(!has(warnings, /行，超过|一共 \d+ 行|字节，超过|工作台段/), warnings.join("\n"));
  // 真超了：提醒里写明先挪哪一节
  write(std, "AGENTS.md", text.replace("<!-- 本段结束 -->", `${"- 补充说明，补充说明，补充说明。\n".repeat(10)}<!-- 本段结束 -->`).replace("## 我加的规矩", `## 我加的规矩\n${"我自己写的一大段规矩。".repeat(160)}`));
  const big = checkKnowledgeBase(std).warnings.find((w) => w.includes("字节，超过"));
  assert.ok(big && big.includes("先把知识库那段的“文件开头”一节换成一句") && big.includes("地图、常见任务、怎么读、隐私不挪"), big);
  rmSync(root, { recursive: true });
  rmSync(std, { recursive: true });
});

test("C83 防走样：模板.md 的 AGENTS 模板和 init 生成的逐字相同（地图 03—06 行、1x 模块那几行是占位，除外）", () => {
  const templatePath = join(SCRIPTS, "..", "references", "模板.md");
  const template = readFileSync(templatePath, "utf8");
  const block = (template.match(/## AGENTS\.md[^\n]*\n[\s\S]*?\n````markdown\n([\s\S]*?)\n````/) || [])[1];
  assert.ok(block, "模板.md 里找不到 AGENTS 模板（“## AGENTS.md…”下面的 ````markdown 代码块）");
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const out = readText(root, "AGENTS.md").replace(/\n$/, "");
  // 地图里 03—06 行、带 <1x 的行在模板里是占位，比的时候两边都去掉
  const placeholderRow = /^\| (?:03-生意|04-客户|05-方法与判断|06-项目|<1x[^|]*) \||^\| <1x/;
  const norm = (t) => t.split("\n").filter((l) => !placeholderRow.test(l)).join("\n");
  const a = norm(block).split("\n");
  const b = norm(out).split("\n");
  const firstDiff = a.findIndex((l, i) => l !== b[i]);
  assert.ok(a.length === b.length && firstDiff < 0, `第 ${firstDiff + 1} 行不一样：\n模板：${a[firstDiff]}\ninit：${b[firstDiff]}`);
  // 模板里那几行占位要在
  for (const id of ["03-生意", "04-客户", "05-方法与判断", "06-项目"]) assert.match(block, new RegExp(`^\\| ${id} \\| <`, "m"), `${id} 那行要是占位`);
  assert.match(block, /^\| <1x-模块> \|/m);
  rmSync(root, { recursive: true });
});

test("C56 待确认的行：已确认的文件里行内的“（待确认）”和“AI 的看法”下的条目都计数，只计数不提醒", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  const before = checkKnowledgeBase(root, { stage: "quick" });
  write(root, "04-客户/老客1.md", customer("老客1", { 确认: "已确认" }).replace("正文。", [
    "## 往来记录",
    "- 2026-10-21｜微信｜问年货；答应：周五前给报价（待确认）",
    "- 2026-10-22｜电话｜改成 30 份（待确认，确认后替换上一条）",
    "",
    "## 当前判断与下一步",
    "下周回访。",
    "",
    "### AI 的看法",
    "- 可能还会加单",
    "- 价格不是主要顾虑",
  ].join("\n")));
  const { summary, warnings } = checkKnowledgeBase(root, { stage: "quick" });
  assert.equal(summary.counts.pending_lines, 4);
  assert.deepEqual(summary.pending_line_files, [{ path: "04-客户/老客1.md", lines: 4 }]);
  assert.equal(warnings.length, before.warnings.length, "只计数，不进提醒");
  rmSync(root, { recursive: true });
});

test("C63 C58 C28 类型清单：01 层加“定时任务”“变更记录”，原件组加“资料地图”；init 不建空壳", () => {
  assert.ok(TYPES["01-AI协作"].includes("定时任务"));
  assert.ok(TYPES["01-AI协作"].includes("变更记录"));
  assert.ok(TYPES["原件"].includes("资料地图"));
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  assert.ok(!existsSync(join(root, "01-AI协作/定时任务.md")));
  assert.ok(!existsSync(join(root, "01-AI协作/变更记录.md")));
  assert.match(readText(root, "01-AI协作/README.md"), /定时任务/);
  write(root, "01-AI协作/变更记录.md", note({ 类型: "变更记录", 更新: "2026-10-21", 确认: "已确认", 隐私: "内部", 来源: "整理新材料" }, "| 日期 | 材料 | 写到哪 | 怎么撤回 |\n|---|---|---|---|\n| 2026-10-21 | 老客1 微信 | 04-客户/老客1.md 往来记录 | 删掉那一行 |"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /“类型: 变更记录”不在类型清单里/));
  rmSync(root, { recursive: true });
});

test("C70 开头元信息的写法：列表只给来源、来源别用顿号连、英文冒号、第 1 行就是 ---、不超过 2KB", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "03-生意/甲.md", "---\n类型: 产品\n名称: 甲\n标签:\n  - 茶\n  - 礼盒\n更新: 2026-10-20\n确认: 待确认\n隐私: 内部\n来源: 采访\n---\n正文");
  write(root, "03-生意/乙.md", note(base({ 类型: "产品", 名称: "乙", 来源: "99-原始材料/采访记录/a.md、99-原始材料/采访记录/b.md" })));
  write(root, "03-生意/丙.md", note(base({ 类型: "产品", 名称: "丙", 来源: "[采访, 微信]" })));
  write(root, "03-生意/丁.md", "---\n类型：产品\n名称: 丁\n更新: 2026-10-20\n确认: 待确认\n隐私: 内部\n来源: 采访\n---\n正文");
  write(root, "03-生意/戊.md", `\n${note(base({ 类型: "产品", 名称: "戊" }))}`);
  write(root, "03-生意/己.md", note(base({ 类型: "产品", 名称: "己", 备注: "长".repeat(800) })));
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.ok(errors.includes("只有‘来源’能写成多行列表：03-生意/甲.md 的 标签"), errors.join("\n"));
  assert.ok(errors.includes("多个来源写成列表（来源: 下一行起，每行写‘  - 路径’）：03-生意/乙.md"));
  assert.ok(errors.includes("多个来源写成列表（来源: 下一行起，每行写‘  - 路径’）：03-生意/丙.md"));
  assert.ok(errors.includes("开头元信息要用英文冒号：03-生意/丁.md → 类型：产品"));
  assert.ok(!has(errors, /缺少字段 类型：03-生意\/丁\.md/), "用了中文冒号的不再报缺少字段");
  assert.ok(errors.includes("文件第 1 行要是 ---（前面不能有空行或别的字）：03-生意/戊.md"));
  assert.ok(!has(errors, /缺少文件开头的元信息：03-生意\/戊\.md/));
  assert.ok(has(warnings, /^开头元信息超过 2 KB：03-生意\/己\.md/));
  assert.ok(!has(errors, /03-生意\/己\.md/));
  rmSync(root, { recursive: true });
});

test("C85 接入：名字像证件、密码的原件不记文件名、不进索引；像收件箱或原件的原有文件夹提示对过去", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "客户资料/证件/身份证正反面.md", "图");
  write(root, "客户资料/银行卡密码.md", "别看");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  const manifest = readText(root, "01-AI协作/原件清单.md");
  assert.doesNotMatch(manifest, /身份证|银行卡密码/);
  assert.match(manifest, /另有 2 份名字像证件、密码的文件没有记录（建议移出知识库）/);
  assert.ok(!buildIndex(join(root, "客户资料")).rows.some((r) => /身份证|银行卡/.test(r)));
  const result = checkKnowledgeBase(root);
  assert.deepEqual(result.errors, []);
  assert.ok(!has(result.warnings, /身份证正反面|银行卡密码/), result.warnings.join("\n"));
  assert.ok(!has(checkKnowledgeBase(root, { stage: "connect" }).errors, /身份证正反面|银行卡密码/));
  const other = tmp();
  mkdirSync(join(other, "99-附件库"));
  mkdirSync(join(other, "10-旧笔记"));
  const dry = runInit(other, { date: "2026-10-20", dryRun: true });
  assert.ok(dry.notes.some((n) => n.includes("99-附件库/ 看起来就是收件箱（或原件）")), dry.notes.join("\n"));
  assert.ok(dry.notes.some((n) => n.includes("你原来也用 00—99 编号，先对一遍，别出现两套编号")));
  rmSync(root, { recursive: true });
  rmSync(other, { recursive: true });
});

test("C27 C13 C17 C46 C52 C68 C69 C115 init 生成的说明：采访骨架、01 字段表、04 规矩、各层“怎么找”", () => {
  const root = tmp();
  write(root, "01-AI协作/协作偏好.md", note(base({ 类型: "协作偏好" })));
  runInit(root, { date: "2026-10-20" });
  const interview = readText(root, "99-原始材料/采访记录/2026-10-20-建库采访.md");
  assert.match(interview, /别记/);
  assert.match(interview, /下一题：第 0 题/);
  const profile = readText(root, "01-AI协作/建库档案.md");
  assert.match(profile, /开场第 0 题和快速版 11 题还没问/);
  assert.match(profile, /从第 0 题开始（先问哪些东西不放进来/);
  const ai = readText(root, "01-AI协作/README.md");
  for (const w of ["隐私按私密", "阶段、上次联系、下次跟进是建库快照", "1 开头的文件夹（10—19）", "原始材料（00、99）", "靠什么赚钱、最关心什么、多建了哪些文件夹、进度和缺口", "最怕漏掉什么", "| 类型 | 必填 | 可选 |", "所有类型都可以加：业务线、范围、复核、一句话"]) {
    assert.ok(ai.includes(w), `01 README 应有：${w}`);
  }
  // 字段表“必填”一列和 TYPE_FIELDS 逐个一致，“可选”一列和 OPTIONAL_FIELDS 一致
  const lines = ai.split("\n");
  const at = lines.indexOf("| 类型 | 必填 | 可选 |");
  const rows = [];
  for (const l of lines.slice(at + 2)) { if (!l.startsWith("|")) break; rows.push(l.slice(1, -1).split("|").map((c) => c.trim())); }
  const unparen = (t) => { let prev; do { prev = t; t = t.replace(/（[^（）]*）/g, ""); } while (t !== prev); return t; };
  const fields = (cell) => unparen(cell).split("、").map((x) => x.trim()).filter((x) => x && x !== "—");
  for (const type of new Set([...Object.keys(TYPE_FIELDS), ...Object.keys(OPTIONAL_FIELDS)])) {
    const row = rows.find((r) => r[0].split("、").includes(type));
    assert.ok(row, `字段表缺 ${type}`);
    assert.deepEqual(fields(row[1]), TYPE_FIELDS[type] || [], `${type} 的必填`);
    assert.deepEqual(fields(row[2]), OPTIONAL_FIELDS[type] || [], `${type} 的可选`);
  }
  const cust = readText(root, "04-客户/README.md");
  assert.match(cust, /照实记：联系人、电话、地址、开票信息、生日、口味、送礼对象都可以；有联系方式、证件这类个人信息的文件标私密/);
  assert.match(cust, /往来记录只追加，一行一条：`- 日期｜渠道｜说了什么；答应：…（没有写“无”）；来源：…`/);
  for (const id of LAYER_IDS) assert.match(readText(root, `${id}/README.md`), /索引的“一句话”只写稳定的定位（是谁、怎么来的、做哪类事）/, id);
  assert.match(readText(root, "06-项目/README.md"), /`- \[ \] 事项 · 截止 2026-10-30 · 谁做 小周 · 关联 客户或项目名`/);
  assert.match(readText(root, "99-原始材料/README.md"), /`交接与建议\/`/);
  assert.match(readText(root, "99-原始材料/README.md"), /`改稿\/`/);
  assert.match(readText(root, "99-原始材料/README.md"), /资料地图/);
  rmSync(root, { recursive: true });
});

test("字段表：references/结构与规矩.md 里的“| 类型 | 必填 | 可选 |”表和 init 写进 01-AI协作/README.md 的逐行一致，下面那句也一样", () => {
  const doc = readFileSync(join(SCRIPTS, "..", "references", "结构与规矩.md"), "utf8").split("\n");
  const at = doc.indexOf("| 类型 | 必填 | 可选 |");
  assert.ok(at >= 0, "结构与规矩.md 里没有字段表");
  const rows = [];
  for (const l of doc.slice(at)) { if (!l.startsWith("|")) break; rows.push(l); }
  assert.deepEqual(rows, fieldTableRows());
  assert.ok(doc.join("\n").includes(RAW_HEAD_RULE), "原件开头那句要和 init 的一样");
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const ai = readText(root, "01-AI协作/README.md");
  assert.ok(ai.includes(fieldTableRows().join("\n")) && ai.includes(RAW_HEAD_RULE));
  rmSync(root, { recursive: true });
});

test("index 对只读文件夹：拒绝，退出码 1，不写任何东西；体检对只读文件夹里没有开头的文件说靠建库快照或原件清单找", () => {
  const root = tmp();
  write(root, "报价/2026报价单.md", "茶礼 198 一盒");
  runInit(root, { date: "2026-10-20", readonly: ["报价"] });
  assert.throws(() => buildIndex(join(root, "报价")), /这是标‘只读’的文件夹：报价\/。只读文件夹不放 README/);
  const r = cli("index.mjs", join(root, "报价"), "--write");
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(root, "报价", "README.md")));
  assert.ok(checkKnowledgeBase(root).warnings.includes("报价/ 下有 1 份老板原有的文件没有开头元信息（只读文件夹不放 README、不改原文件，正常；靠上级 README 的索引、建库快照或原件清单找到它们）"));
  rmSync(root, { recursive: true });
});

test("待确认的行：任务手册里讲规矩的“（候选，待确认）”不算", () => {
  const line = "| 老板自己想让 AI 做的事 | 建库档案“老板最关心”或协作偏好（候选，待确认）；改工作台的三行需求不写进各层 |";
  assert.equal(pendingLines(line), 1, "pendingLines 本身照数");
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  const before = checkKnowledgeBase(root, { stage: "quick" }).summary.counts.pending_lines;
  const manual = join(root, "01-AI协作/任务手册/整理新材料.md");
  writeFileSync(manual, `${readFileSync(manual, "utf8")}\n| 材料里的东西 | 写到哪 |\n|---|---|\n${line}\n`);
  assert.equal(checkKnowledgeBase(root, { stage: "quick" }).summary.counts.pending_lines, before, "任务手册不计数");
  rmSync(root, { recursive: true });
});

test("C57 C58 C80 C113 C42 C117 C73 任务手册：整理新材料、每周复盘、改稿后记下来", () => {
  const root = tmp();
  const out = runInit(root, { date: "2026-10-20" });
  const sort = readText(root, "01-AI协作/任务手册/整理新材料.md");
  for (const w of ["实际有的文件", "只读", "不写", "写了哪几个文件", "交接记录", "分流", "变更记录", "近期要事", "份数条件", "交接与建议/", "开头不动", "确认后替换上一条"]) {
    assert.ok(sort.includes(w), `整理新材料应有：${w}`);
  }
  const review = readText(root, "01-AI协作/任务手册/每周复盘.md");
  for (const w of ["不覆盖", "实际的文件数", "采纳后写到", "99-原始材料/改稿/", "YYYY-MM-DD-周复盘.md"]) assert.ok(review.includes(w), `每周复盘应有：${w}`);
  assert.doesNotMatch(review, /<日期>/);
  assert.ok(out.created.includes("01-AI协作/任务手册/改稿后记下来.md"));
  const edit = readText(root, "01-AI协作/任务手册/改稿后记下来.md");
  const fm = parseFrontmatter(edit);
  assert.deepEqual([fm["类型"], fm["确认"], fm["来源"]], ["任务手册", "已确认", "老板知识库 Skill 自带"]);
  assert.match(edit, /99-原始材料\/改稿\//);
  assert.match(edit, /不升成规则/);
  const ai = readText(root, "01-AI协作/README.md");
  assert.match(ai, /AI 常做任务的步骤：整理新材料、每周复盘、改稿后记下来/);
  assert.match(ai, /## 谁管什么\n\| 老板说什么 \| 用哪个 Skill \| 读写哪里 \|/);
  assert.ok(ai.indexOf("## 谁管什么") < ai.indexOf("## 这一层的规矩"));
  assert.doesNotMatch(ai, /boss-kb-access|boss-add-module|boss-deploy|xhs-creator|小红书 Skill|加模块 Skill|上线 Skill/, "合并后只剩 boss-kb 和 boss-workbench");
  assert.match(ai, /\| 建库、继续建库、补访、整理一下、体检、定期维护、本周复盘、知识库加一个资料模块 \| 知识库 Skill（boss-kb） \|/);
  assert.match(ai, /别的项目里[^|]*\| 知识库 Skill（boss-kb） \| 读这里；写回只做三种/);
  assert.match(ai, /\| 帮我搭工作台（可以从空白开始）、换配色、加减模块、改功能、导入平台导出表、上线手机版 \| 工作台 Skill（boss-workbench） \|[^\n]*知识库原文不上云/);
  assert.match(ai, /\| 写小红书、出选题这类内容工作 \| 工作台里的内容模块（先在对话里理清写法，再让工作台做成模块） \| 读品牌与口吻、账号定位和 05 的写法卡；只出草稿 \|/);
  assert.match(ai, /装了才有；没装的那行不用管。/);
  assert.deepEqual(checkKnowledgeBase(root).errors, []);
  rmSync(root, { recursive: true });
});

test("C09 判断样本：05 层任何文件里的“## 样本”都算，不只认“类型: 判断样本”", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  rmSync(join(root, "05-方法与判断/报价与接单"), { recursive: true });
  write(root, "05-方法与判断/售后与补偿.md", note(base({ 类型: "做法", 工作: "售后与补偿" }), "## 怎么做\n先认。\n\n## 样本 1｜压坏\n- 判断：补发"));
  const ok = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(!has(ok.errors, /判断样本/), ok.errors.join("\n"));
  assert.equal(ok.summary.counts.samples, 1);
  write(root, "05-方法与判断/售后与补偿.md", note(base({ 类型: "做法", 工作: "售后与补偿" }), "## 怎么做\n先认。"));
  const e = checkKnowledgeBase(root, { stage: "quick" }).errors.find((x) => x.startsWith("还没有判断样本"));
  assert.ok(e && e.includes("（内容少时也可以写在这类工作的那一份文件里）"), e);
  rmSync(root, { recursive: true });
});

test("C16 CLAUDE.md 只放 @AGENTS.md：多写了规矩提醒；老板原有的设置不管", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  assert.ok(!has(checkKnowledgeBase(root).warnings, /CLAUDE/));
  write(root, "CLAUDE.md", "@AGENTS.md\n<!-- 注释不算 -->\n\n- 每次回答先说结论\n");
  assert.ok(has(checkKnowledgeBase(root).warnings, /^CLAUDE\.md 里除了 @AGENTS\.md 还写了别的。Codex 和工作台看不到这里/));
  write(root, "CLAUDE.md", "@AGENTS.md\n");
  write(root, "CLAUDE.local.md", "- 我的偷偷规矩\n");
  assert.ok(has(checkKnowledgeBase(root).warnings, /^CLAUDE\.local\.md 里/));
  const kb = tmp();
  write(kb, "客户资料/张总.md", "张总");
  write(kb, "CLAUDE.md", "# 我的 Claude 设置\n回答用中文。\n");
  runInit(kb, { date: "2026-10-20", map: { "04-客户": "客户资料" }, updateAgents: true });
  assert.ok(!has(checkKnowledgeBase(kb).warnings, /CLAUDE/), "老板原有的 CLAUDE.md 加上追加的 @AGENTS.md 不报");
  rmSync(root, { recursive: true });
  rmSync(kb, { recursive: true });
});

test("C64 表格：机读表错列报错，普通表错列提醒，格子里的 [[名字|别名]] 也报", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", "| 暂不启用 | 生意简单 | 第 2 题 |"));
  assert.ok(has(checkKnowledgeBase(root).errors, /^01-AI协作\/建库档案\.md 第 \d+ 行的表格有 3 格，表头是 4 格：格子里不要写 \|/));
  assert.ok(!has(checkKnowledgeBase(root).errors, /转义了也会错|工作台按 \| 切列/), "工作台现在认 \\| 和 [[…]]，不再这么说");
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE());
  write(root, "03-生意/招牌套餐.md", note(base({ 类型: "产品", 名称: "招牌套餐" }), "| 档 | 价格 |\n|---|---|\n| 小份 | 38 | 多一格 |"));
  const r = checkKnowledgeBase(root);
  assert.ok(has(r.warnings, /^03-生意\/招牌套餐\.md 第 \d+ 行的表格有 3 格，表头是 2 格/), r.warnings.join("\n"));
  assert.ok(!has(r.errors, /招牌套餐\.md 第/));
  write(root, "04-客户/README.md", readText(root, "04-客户/README.md").replace("| （暂时没有） | | | | |", "| 甲公司 | 客户 | | 老客户 | [[甲公司|甲]] |"));
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  assert.ok(has(checkKnowledgeBase(root).warnings, /^04-客户\/README\.md 第 \d+ 行的表格有 6 格，表头是 5 格/));
  write(root, "05-方法与判断/README.md", readText(root, "05-方法与判断/README.md").replace("| （暂时没有） | | |", "| 报价 | 报价\\|接单.md | |"));
  assert.ok(has(checkKnowledgeBase(root).errors, /^05-方法与判断\/README\.md 第 \d+ 行的表格/), "方法选择表是机读表");
  rmSync(root, { recursive: true });
});

test("C64 C28 银行卡号：照实记，整理稿没标私密只提醒；Luhn 不过的订单号不报；原件不查", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "04-客户/甲公司.md", customer("甲公司").replace("正文。", "对公卡号 4111 1111 1111 1111"));
  write(root, "03-生意/生意总览.md", note(base({ 类型: "生意" }), "订单 2026102512345678 已发货"));
  const first = checkKnowledgeBase(root);
  assert.ok(!has(first.errors, /甲公司/), first.errors.join("\n"));
  assert.ok(first.warnings.includes("有银行卡号，这份没标私密：04-客户/甲公司.md"), first.warnings.join("\n"));
  assert.ok(!has([...first.errors, ...first.warnings], /银行卡号.*生意总览/), "Luhn 不过的订单号不报");
  write(root, "03-生意/生意总览.md", note(base({ 类型: "生意" }), "单号 4111111111111111 已发货"));
  const second = checkKnowledgeBase(root);
  assert.ok(!has(second.errors, /生意总览/));
  assert.ok(has(second.warnings, /银行卡号.*生意总览\.md/), second.warnings.join("\n"));
  write(root, "00-收件箱/2026-10-21-甲公司-微信.md", "打到这张卡号 6222 0212 3456 7890 128");
  const third = checkKnowledgeBase(root);
  assert.ok(!has(third.errors, /00-收件箱/));
  assert.ok(!has(third.warnings, /银行卡号.*00-收件箱/), third.warnings.join("\n"));
  rmSync(root, { recursive: true });
});

test("C64 日期字段带原因报错并提示；层 README 缺“不装什么”提醒", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "06-项目/春节预售.md", note(base({ 类型: "项目", 名称: "春节预售", 状态: "进行中", 截止: "未知（老板说以后再说）", 负责人: "我" })));
  assert.ok(has(checkKnowledgeBase(root).errors, /“截止”要写成 2026-10-25.*春节预售\.md.*（原因写到正文里，字段里只留这两个字）$/));
  write(root, "02-关于我/README.md", readText(root, "02-关于我/README.md").replace(/- 不装什么：[^\n]*\n/, ""));
  assert.ok(checkKnowledgeBase(root).warnings.includes("02-关于我/README.md 缺少“不装什么”"));
  rmSync(root, { recursive: true });
});

test("C87 接入：清单上的原件带“类型”也不查字段；原有文件里没做完的待办提醒抄进近期要事，跳过不读、模板", () => {
  const root = tmp();
  write(root, "客户/张总.md", "---\n类型: 客户\n---\n张总，做外贸");
  write(root, "日记/2026-10-09.md", "# 2026-10-09\n- [ ] 回张总报价\n- [x] 寄样品");
  write(root, "私人/家庭待办.md", "- [ ] 周末体检");
  write(root, "Templates/客户模板.md", "# {{title}}\n- [ ] 跟进");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户" }, readonly: ["日记", "私人", "Templates"] });
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md").replace("| 原有·只读 | 私人/ | 只读，不放 README，整理时不移动 |", "| 原有·只读 | 私人/ | 不读：老板说别看 |"));
  const { errors, warnings } = checkKnowledgeBase(root, { stage: "connect" });
  assert.ok(!has(errors, /客户\/张总\.md/), errors.join("\n"));
  const w = warnings.filter((x) => x.startsWith("老板原有文件里有"));
  assert.equal(w.length, 1, warnings.join("\n"));
  assert.match(w[0], /^老板原有文件里有 1 条没做完的待办（如 日记\/2026-10-09\.md），近期要事里还没有：接入时抄进去，每条写来源，原文件不动$/);
  write(root, "06-项目/近期要事.md", note(base({ 类型: "待办" }), "- [ ] 回张总报价 · 来源 日记/2026-10-09.md"));
  assert.ok(!has(checkKnowledgeBase(root, { stage: "connect" }).warnings, /没做完的待办/));
  rmSync(root, { recursive: true });
});

test("C88 不读的文件夹：--exclude 登记进建库档案、地图和 .ignore；不进原件清单，体检不扫，index 拒绝", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "私人/家庭待办.md", "老婆电话 13812345678");
  mkdirSync(join(root, "日记"));
  write(root, ".ignore", "工作台/\n");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" }, exclude: ["私人", "日记"] });
  const profile = readText(root, "01-AI协作/建库档案.md");
  assert.match(profile, /\| 原有·不读 \| 私人\/ \| 老板的私人文件夹，AI 不打开、不列文件名 \|/);
  assert.match(profile, /\| 原有·不读 \| 日记\/ \|/);
  assert.match(readText(root, "AGENTS.md"), /\| 私人（不读） \| 我的私人文件夹，AI 不打开 \| 不读 \|/);
  assert.equal(readText(root, ".ignore"), "工作台/\n私人/\n日记/\n", ".ignore 只追加缺的行");
  assert.doesNotMatch(readText(root, "01-AI协作/原件清单.md"), /私人|家庭待办/);
  const result = checkKnowledgeBase(root);
  assert.deepEqual(result.errors, []);
  assert.ok(!has([...result.errors, ...result.warnings], /家庭待办|私人\//), result.warnings.join("\n"));
  assert.throws(() => buildIndex(join(root, "私人")), /这是标‘不读’的文件夹/);
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace(/\| 私人（不读）[^\n]*\n/, ""));
  assert.ok(has(checkKnowledgeBase(root).errors, /私人\/.*地图/));
  assert.throws(() => runInit(tmp(), { exclude: ["没有这个"] }), /不存在/);
  const both = tmp();
  mkdirSync(join(both, "日记"));
  assert.throws(() => runInit(both, { readonly: ["日记"], exclude: ["日记"] }), /只读.*不读|不读.*只读/);
  const fresh = tmp();
  mkdirSync(join(fresh, "日记"));
  const dry = runInit(fresh, { exclude: ["日记"], dryRun: true });
  assert.ok(dry.created.includes(".ignore"));
  assert.ok(!existsSync(join(fresh, ".ignore")));
  for (const r of [root, both, fresh]) rmSync(r, { recursive: true });
});

test("C17 C82 AGENTS.md：标题在标记前提醒（就地建图不提醒）；地图太靠后提醒；路由写不存在的路径报错；启用模块没路由提醒", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  const agents = readText(root, "AGENTS.md");
  write(root, "AGENTS.md", `# 王总的知识库\n\n${agents}`);
  assert.ok(has(checkKnowledgeBase(root).warnings, /^AGENTS\.md 第 1 行应是 <!-- 老板知识库 v2… -->，标题和说明放进标记段/));
  const kb = tmp();
  writeFileSync(join(kb, "AGENTS.md"), "# 我原来的规矩\n");
  write(kb, "客户资料/张总.md", "张总");
  runInit(kb, { date: "2026-10-20", map: { "04-客户": "客户资料" }, updateAgents: true });
  assert.ok(!has(checkKnowledgeBase(kb).warnings, /第 1 行应是/), "就地建图追加在后面的不提醒");
  write(root, "AGENTS.md", agents.replace("## 我和我的生意", `${Array.from({ length: 55 }, (_, i) => `> 说明 ${i}`).join("\n")}\n\n## 我和我的生意`));
  assert.ok(has(checkKnowledgeBase(root).warnings, /^AGENTS\.md 的地图在第 \d+ 行/));
  write(root, "AGENTS.md", agents.replace("| 整理新材料 |", "| 看报价 | 05-方法与判断/报价/判断规则.md → 03-生意/README.md |\n| 整理新材料 |"));
  assert.ok(checkKnowledgeBase(root).errors.includes("AGENTS.md 常见任务表里的 05-方法与判断/报价/判断规则.md 不存在"));
  assert.deepEqual(checkKnowledgeBase(kb).errors, [], "就地建图的路由路径不按 00—99 查");
  write(root, "AGENTS.md", agents.replace("| 90-持续生长 |", "| 10-门店 | 门店 | 需要时 |\n| 90-持续生长 |"));
  fillQuickKb(root);
  write(root, "10-门店/README.md", "# 10-门店｜这一层的说明\n- 装什么：门店\n- 不装什么：x\n- AI 什么时候读：x\n- 谁来写：x\n");
  write(root, "10-门店/会员.md", note(base({ 类型: "门店" })));
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", "| 门店 | 10-门店/ | 有门店 | 第 2 题 |"));
  const quick = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(has(quick.warnings, /^生长模块 10-门店 还没有一行常见任务路由/), quick.warnings.join("\n"));
  write(root, "AGENTS.md", readText(root, "AGENTS.md").replace("| 整理新材料 |", "| 门店会员 | 10-门店/README.md → 该会员 |\n| 整理新材料 |"));
  assert.ok(!has(checkKnowledgeBase(root, { stage: "quick" }).warnings, /还没有一行常见任务路由/));
  rmSync(root, { recursive: true });
  rmSync(kb, { recursive: true });
});

test("C21 空壳：模板占位、空段落提醒；--stage quick 下只有说明的层、索引里留着“（暂时没有）”提醒；新建库不出前两种", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  assert.ok(!has(checkKnowledgeBase(root).warnings, /模板占位|是空的：/), checkKnowledgeBase(root).warnings.join("\n"));
  fillQuickKb(root);
  write(root, "03-生意/招牌套餐.md", note(base({ 类型: "产品", 名称: "招牌套餐" }), "## 价格\n<多少钱>\n\n## 适用条件\n\n### 细节\n\n## 示例\n```text\n<这是代码块里的，不算>\n```"));
  const { warnings } = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(warnings.includes("03-生意/招牌套餐.md 还有没填的模板占位：<多少钱>；没内容的段落删掉，不留空壳"), warnings.join("\n"));
  assert.ok(warnings.includes("03-生意/招牌套餐.md 的“适用条件”是空的：删掉，或补上内容"));
  assert.ok(!has(warnings, /“示例”是空的/), "只有代码块的段落不算空");
  assert.ok(!has(warnings, /00-收件箱\/ 还只有说明|90-持续生长\/ 还只有说明/), "收件箱和持续生长不提醒：发现是复盘时 AI 提的，不是采访能补的");
  rmSync(join(root, "06-项目/近期要事.md"));
  assert.ok(checkKnowledgeBase(root, { stage: "quick" }).warnings.includes("06-项目/ 还只有说明：下次补访补上，或在建库档案“下次补访”写明"));
  write(root, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("补一条判断样本", "补一条判断样本；06-项目 等第二次补访再写"));
  assert.ok(!has(checkKnowledgeBase(root, { stage: "quick" }).warnings, /06-项目\/ 还只有说明/), "下次补访写明了就不提醒");
  write(root, "06-项目/近期要事.md", note(base({ 类型: "待办" }), "- [ ] 给老客发新菜单 · 截止 2026-10-30"));
  write(root, "04-客户/README.md", readText(root, "04-客户/README.md").replace("| （暂时没有） | | | | |", "| （暂时没有） | | | | |\n| 老客1 | 客户 | | 常来 | [老客1.md](老客1.md) |"));
  assert.ok(checkKnowledgeBase(root, { stage: "quick" }).warnings.includes("04-客户/README.md 的索引里还留着“（暂时没有）”，删掉这行"));
  rmSync(root, { recursive: true });
});

test("C28 敏感原件：99 下的营业执照.pdf 提醒，登记成私密后不提醒；非 .md 文件照样跳过隐藏文件", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "99-原始材料/证照/营业执照.pdf", "%PDF");
  write(root, "03-生意/菜单.png", "png");
  write(root, "02-关于我/.DS_Store", "x");
  const w = checkKnowledgeBase(root).warnings;
  assert.ok(w.includes("99-原始材料/证照/营业执照.pdf 疑似敏感原件：确认只登记位置；要复制进来，在 99-原始材料 的资料地图里登记成私密"), w.join("\n"));
  assert.ok(!has(w, /菜单\.png|DS_Store/), "不在 00、99 下、名字没有关键词的不提醒");
  write(root, "99-原始材料/资料地图.md", note({ 类型: "资料地图", 更新: "2026-10-20", 确认: "已确认", 隐私: "私密", 来源: "老板口述" }, "| 位置 | 是什么 | 隐私 | 只登记/已复制 | 登记日期 |\n|---|---|---|---|---|\n| 99-原始材料/证照/营业执照.pdf | 营业执照扫描件 | 私密 | 已复制 | 2026-10-20 |"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /营业执照\.pdf 疑似敏感原件/));
  rmSync(root, { recursive: true });
});

test("C77 云盘：路径在 iCloud、OneDrive 里算同步；在“文稿”里又读不到设置算说不准", () => {
  const home = "/Users/示例";
  const no = () => { throw new Error("没有这个设置"); };
  assert.equal(cloudStatus("/Users/示例/Library/Mobile Documents/com~apple~CloudDocs/知识库", { platform: "darwin", home, readDefault: no }).synced, true);
  assert.equal(cloudStatus("C:/Users/示例/OneDrive/知识库", { platform: "win32", home: "C:/Users/示例", readDefault: no }).synced, true);
  const maybe = cloudStatus("/Users/示例/Documents/知识库", { platform: "darwin", home, readDefault: no });
  assert.deepEqual([maybe.synced, maybe.maybe], [false, true]);
  assert.ok(maybe.note.length > 0);
  const on = cloudStatus("/Users/示例/Documents/知识库", { platform: "darwin", home, readDefault: () => "1" });
  assert.deepEqual([on.synced, on.maybe], [true, false]);
  const plain = cloudStatus("/Users/示例/老板知识库", { platform: "darwin", home, readDefault: no });
  assert.deepEqual([plain.synced, plain.maybe, plain.note], [false, false, ""]);
  const root = tmp();
  const out = runInit(root, { date: "2026-10-20", dryRun: true });
  assert.ok("cloud" in out && typeof out.cloud.synced === "boolean");
  rmSync(root, { recursive: true });
});

// ───────────── 第五轮 ─────────────

const ENTRY_DEFERRED = "入口没接上：AGENTS.md 里还没有知识库那一段（老板暂缓追加）。不接上，Codex 和工作台都读不到这张地图；老板同意后，在知识库里再跑一次 init.mjs --update-agents（会按建库档案里的目录对应补上地图）";
const NO_MARK = "AGENTS.md 缺少维护标记 <!-- 老板知识库 v2｜本段由知识库 Skill 维护… -->";

/** 就地建图收尾要补的：画像、最关心、接入清单、真实任务、接入采访、必读四份、建库快照里的张总 */
function fillConnectKb(root, layout) {
  write(root, "01-AI协作/建库档案.md", readText(root, "01-AI协作/建库档案.md")
    .replace("（第 2 题后填：主类型 + 叠加）", "本地服务型")
    .replace("1. （第 10 题后填）", "1. 今天该回访谁")
    .replace("### 已知\n（待填）", "### 已知\n- 客户资料/ 里 1 位客户")
    .replace(/（待填）/g, "暂无")
    .replace("## 已完成\n", "## 已完成\n- 2026-10-20 真实任务：替王总写了张总的回访草稿\n"));
  write(root, "99-原始材料/采访记录/2026-10-20-接入采访.md", INTERVIEW);
  fillMustRead(root, layout);
  const readme = `${layout["04-客户"]}/README.md`;
  write(root, readme, readText(root, readme).replace("| （待填） | | | | | | | |", "| 张总 | 客户 | 企业客户 | 报价中 | 张总 | 未知 | 未定 | [张总.md](张总.md) |"));
}

/** 就地建图，老板原有的 AGENTS.md、CLAUDE.md 没同意追加（没带 --update-agents）；别的都按接入收尾补齐 */
function deferredKb(map = { "04-客户": "客户资料" }) {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  for (const where of Object.values(map)) if (where !== "客户资料") write(root, `${where}/原有笔记.md`, "老板原有的");
  write(root, "报价/2026报价单.md", "茶礼 198 一盒");
  write(root, "AGENTS.md", "# 我原来的规矩\n- 回答先给结论\n");
  write(root, "CLAUDE.md", "# 我的 Claude 设置\n回答用中文。\n");
  runInit(root, { name: "王总", date: "2026-10-20", map, readonly: ["报价"] });
  fillConnectKb(root, map);
  return root;
}

test("R5-1 就地建图、老板暂缓追加 AGENTS.md：只报 1 条“入口没接上”，地图检查跳过，CLAUDE.md 那条并进去；结论“入口还没接上”；同意追加后标准版建好了", () => {
  const root = deferredKb();
  assert.equal(readText(root, "AGENTS.md"), "# 我原来的规矩\n- 回答先给结论\n", "没带 --update-agents 不动");
  const connect = checkKnowledgeBase(root, { stage: "connect" });
  assert.deepEqual(connect.errors, [ENTRY_DEFERRED]);
  assert.ok(!has(connect.warnings, /地图|CLAUDE\.md|常见任务/), connect.warnings.join("\n"));
  assert.equal(connect.summary.workbench_ready, false);
  assert.ok(connect.summary.verdict.startsWith("入口还没接上（AGENTS.md 里没有知识库那一段）"), connect.summary.verdict);
  assert.doesNotMatch(connect.summary.verdict, /其他 \d+ 处错误/, "入口那条不算进“其他”");
  assert.ok(connect.summary.missing.includes("入口"));
  const plain = checkKnowledgeBase(root);
  assert.deepEqual(plain.errors, [ENTRY_DEFERRED], "不带 --stage 也只报这一条");
  assert.ok(!has(plain.warnings, /不在地图里/), plain.warnings.join("\n"));
  const brief = cli("check.mjs", root, "--stage", "connect", "--brief");
  assert.equal(brief.status, 1);
  assert.match(brief.stdout, /^体检结论：入口还没接上（AGENTS\.md 里没有知识库那一段）/);
  // 老板同意后追加：入口接上
  runInit(root, { date: "2026-10-21", map: { "04-客户": "客户资料" }, readonly: ["报价"], updateAgents: true });
  fillAgents(root);
  assert.match(readText(root, "CLAUDE.md"), /@AGENTS\.md/);
  const after = checkKnowledgeBase(root, { stage: "connect" });
  assert.deepEqual(after.errors, [], after.errors.join("\n"));
  assert.equal(after.summary.workbench_ready, true);
  assert.equal(after.summary.verdict, "标准版建好了");
  rmSync(root, { recursive: true });
});

test("R5-1 建库档案写了“入口: 暂缓”：默认体检和 quick 是提醒（退出 0），--stage connect 照样是错误", () => {
  const root = deferredKb();
  const profile = readText(root, "01-AI协作/建库档案.md");
  write(root, "01-AI协作/建库档案.md", profile.replace("结构: 就地建图\n", "结构: 就地建图\n入口: 暂缓\n"));
  const plain = checkKnowledgeBase(root);
  assert.deepEqual(plain.errors, [], plain.errors.join("\n"));
  assert.equal(plain.warnings.filter((w) => w === ENTRY_DEFERRED).length, 1, plain.warnings.join("\n"));
  assert.equal(cli("check.mjs", root).status, 0);
  const quick = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(!quick.errors.includes(ENTRY_DEFERRED));
  assert.ok(quick.warnings.includes(ENTRY_DEFERRED));
  assert.equal(quick.summary.workbench_ready, false);
  assert.ok(quick.summary.verdict.startsWith("入口还没接上（AGENTS.md 里没有知识库那一段）"), quick.summary.verdict);
  assert.deepEqual(checkKnowledgeBase(root, { stage: "connect" }).errors, [ENTRY_DEFERRED]);
  rmSync(root, { recursive: true });
});

test("R5-2 工作台能跑要求入口：没有结束标记、标准结构没有标记段，结论都写“入口还没接上”；标准结构的老错误照报", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  const agents = readText(root, "AGENTS.md");
  write(root, "AGENTS.md", agents.replace("<!-- 本段结束 -->", ""));
  const open = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(has(open.errors, /没有结束标记/));
  assert.equal(open.summary.workbench_ready, false);
  assert.ok(open.summary.verdict.startsWith("入口还没接上（AGENTS.md 的知识库那一段没有结束标记）"), open.summary.verdict);
  write(root, "AGENTS.md", "# 我自己的规矩\n- 先给结论\n");
  const none = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(none.errors.includes(NO_MARK), "标准结构老逻辑不变");
  assert.ok(has(none.errors, /AGENTS\.md 里没有“地图”表/), "标准结构照旧查地图");
  assert.ok(!none.errors.includes(ENTRY_DEFERRED));
  assert.equal(none.summary.workbench_ready, false);
  assert.ok(none.summary.verdict.startsWith("入口还没接上（AGENTS.md 里没有知识库那一段）；还差："), none.summary.verdict);
  rmSync(join(root, "AGENTS.md"));
  const missing = checkKnowledgeBase(root, { stage: "quick" }).summary;
  assert.ok(missing.verdict.startsWith("入口还没接上（根目录没有 AGENTS.md）"), missing.verdict);
  rmSync(root, { recursive: true });
});

test("R5-3 产品计数认 README 索引里类型恰好是“产品”、链接到存在的文件的行（含只读文件夹里的原件），同一个文件只算一次；quick 用同一个数", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "报价/2026报价单.md", "茶礼 198 一盒");
  runInit(root, { name: "王总", date: "2026-10-20", map: { "04-客户": "客户资料" }, readonly: ["报价"] });
  fillAgents(root);
  fillConnectKb(root, { "04-客户": "客户资料" });
  const count = () => checkKnowledgeBase(root, { stage: "connect" }).summary.counts.products;
  const productError = () => has(checkKnowledgeBase(root, { stage: "quick" }).errors, /^还没有产品档案/);
  assert.equal(count(), 0);
  assert.ok(productError());
  const readme = readText(root, "03-生意/README.md");
  const rows = (list) => write(root, "03-生意/README.md", readme.replace("| （暂时没有） | | | | |", list.join("\n")));
  rows(["| 2026报价单 | 产品 | | 老板原有的价目表 | [2026报价单.md](../报价/2026报价单.md) |"]);
  assert.equal(count(), 1);
  assert.ok(!productError(), "只读文件夹里的价目表在索引里登记过，就算有产品");
  write(root, "03-生意/招牌茶礼.md", note(base({ 类型: "产品", 名称: "招牌茶礼" })));
  rows([
    "| 2026报价单 | 产品 | | 老板原有的价目表 | [2026报价单.md](../报价/2026报价单.md) |",
    "| 招牌茶礼 | 产品 | | 卖得最多的礼盒 | [招牌茶礼.md](招牌茶礼.md) |",
    "| 报价单 | `产品` | | 同一份价目表换个写法 | [报价单](<../报价/2026报价单.md>) |",
    "| 生意总览 | 产品介绍 | | 类型不是恰好“产品” | [生意总览.md](生意总览.md) |",
    "| 茶具 | 产品 | | 只写了名字，没链接 | 茶具 |",
    "| 旧价目表 | 产品 | | 链接的文件不在了 | [旧价目表.md](旧价目表.md) |",
  ]);
  assert.equal(count(), 2, "同一个文件只算一次；类型不是恰好“产品”的、没链接的、链接断了的不算");
  rmSync(root, { recursive: true });
});

test("R5-4 index 对收件箱、原始材料（含就地建图对应的文件夹、它们的子文件夹）：不出行，说不用补，退出 0，什么都不写", () => {
  const RAW_REASON = "收件箱和原始材料不用补索引：README 里列子文件夹就够，体检也不查";
  const root = tmp();
  write(root, "原始资料/老合同.md", "合同原文");
  runInit(root, { date: "2026-10-20", map: { "99-原始材料": "原始资料" } });
  write(root, "00-收件箱/2026-10-21-张总-微信.md", "聊天原文");
  write(root, "原始资料/聊天与通话/2026-10-01-李总.md", "通话原文");
  const before = hashTree(root);
  for (const dir of ["00-收件箱", "原始资料", "原始资料/采访记录", "原始资料/聊天与通话"]) {
    const plan = buildIndex(join(root, dir));
    assert.equal(plan.rows.length, 0, `${dir}：${plan.table}`);
    assert.equal(plan.reason, RAW_REASON, dir);
    const out = writeIndex(join(root, dir));
    assert.equal(out.written, false);
    assert.equal(out.reason, RAW_REASON);
  }
  const run = cli("index.mjs", join(root, "原始资料"), "--write");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /收件箱和原始材料不用补索引：README 里列子文件夹就够，体检也不查/);
  assert.deepEqual(hashTree(root), before, "什么都不写");
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  write(std, "99-原始材料/聊天与通话/2026-10-01-李总.md", "通话原文");
  assert.equal(buildIndex(join(std, "99-原始材料")).reason, RAW_REASON);
  assert.ok(buildIndex(join(std, "04-客户")).reason === undefined, "别的层照常");
  rmSync(root, { recursive: true });
  rmSync(std, { recursive: true });
});

test("R5-4 index 对暂缓追加入口的就地建图根目录：认得是知识库根目录，不往老板的 README.md 里写", () => {
  const root = deferredKb();
  write(root, "README.md", "# 我的资料\n\n## 索引\n| 名称 | 文件 |\n|---|---|\n");
  const before = readText(root, "README.md");
  const out = writeIndex(root);
  assert.equal(out.written, false);
  assert.match(out.reason, /根目录用 AGENTS\.md 的地图/);
  assert.equal(readText(root, "README.md"), before);
  rmSync(root, { recursive: true });
});

test("R5-5 上级目录有 CLAUDE.md、.git 这类：init（含 dry-run）和体检都提醒；主目录本身不算；示例库不提醒；干净的位置不提醒", () => {
  const parent = tmp();
  write(parent, "CLAUDE.md", "# 上级项目的规矩\n");
  mkdirSync(join(parent, ".git"));
  const root = join(parent, "老板知识库");
  const head = `知识库放在了 ${parent} 里面，那里有 CLAUDE.md、.git`;
  const tail = "Claude Code 会把上级的规则一起读进来，Codex 会把上级当项目根。建议把知识库挪到一个干净的地方（比如 ~/老板知识库）";
  const isIt = (s) => s.startsWith(head) && s.endsWith(tail);
  const dry = runInit(root, { date: "2026-10-20", dryRun: true });
  assert.ok(dry.notes.some(isIt), dry.notes.join("\n"));
  assert.ok(!existsSync(root), "dry-run 不写");
  const real = cli("init.mjs", root, "--date", "2026-10-20");
  assert.equal(real.status, 0, real.stderr);
  assert.ok(JSON.parse(real.stdout).notes.some(isIt), real.stdout);
  assert.ok(checkKnowledgeBase(root).warnings.some(isIt), checkKnowledgeBase(root).warnings.join("\n"));
  assert.deepEqual(checkKnowledgeBase(root).errors, [], "只提醒");
  // 到用户主目录为止：主目录自己的 AGENTS.md、.claude/CLAUDE.md（全局设置）不算
  const home = tmp();
  write(home, "AGENTS.md", "# 主目录的");
  write(home, ".claude/CLAUDE.md", "# 全局设置");
  assert.deepEqual(parentRuleFiles(join(home, "老板知识库"), { home }), []);
  write(home, "课程/AGENTS.md", "# 课程项目的");
  write(home, "课程/.claude/CLAUDE.md", "# 课程项目的");
  write(home, "课程/示例/CLAUDE.md", "# 示例的");
  const kb = join(home, "课程", "示例", "老板知识库");
  assert.deepEqual(parentRuleFiles(kb, { home }), [
    { dir: join(home, "课程", "示例"), names: ["CLAUDE.md"] },
    { dir: join(home, "课程"), names: ["AGENTS.md", ".claude/CLAUDE.md"] },
  ]);
  const w = parentRulesWarning(kb, { home });
  assert.ok(w.startsWith(`知识库放在了 ${join(home, "课程", "示例")} 里面，那里有 CLAUDE.md（再往上 ${join(home, "课程")} 也有 AGENTS.md、.claude/CLAUDE.md）：`) && w.endsWith(tail), w);
  write(kb, "CLAUDE.md", "@AGENTS.md\n");
  mkdirSync(join(kb, ".git"));
  assert.equal(parentRuleFiles(kb, { home }).length, 2, "知识库根目录自己的不算");
  // 示例库（示例: 是）不提醒：示例自带的材料，放在哪由提供示例的人定
  const sample = join(parent, "示例库");
  runInit(sample, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(sample);
  write(sample, "01-AI协作/建库档案.md", FILLED_PROFILE().replace("结构: 标准\n", "结构: 标准\n示例: 是\n"));
  assert.ok(!has(checkKnowledgeBase(sample).warnings, /^知识库放在了/));
  const clean = tmp();
  runInit(clean, { date: "2026-10-20" });
  assert.ok(!has(checkKnowledgeBase(clean).warnings, /^知识库放在了/));
  for (const r of [parent, home, clean]) rmSync(r, { recursive: true });
});

test("R5-6 init 的建库档案没有生长模块：表头保留，下面写“暂时没有生长模块。”；填完画像和最关心后 --stage quick 不报占位、空表不报错", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const profile = readText(root, "01-AI协作/建库档案.md");
  assert.match(profile, /## 启用的模块\n\| 模块 \| 路径 \| 为什么启用 \| 证据 \|\n\|---\|---\|---\|---\|\n\n暂时没有生长模块。\n/);
  assert.doesNotMatch(profile, /（还没有）/);
  write(root, "01-AI协作/建库档案.md", profile.replace("（第 2 题后填：主类型 + 叠加）", "本地服务型").replace("1. （第 10 题后填）", "1. 今天该回访谁"));
  const quick = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(!has(quick.errors, /建库档案.*占位|启用的模块|建库档案\.md 第 \d+ 行的表格/), quick.errors.join("\n"));
  assert.ok(!quick.summary.missing.includes("建库档案占位"), quick.summary.missing.join("、"));
  assert.ok(!has(quick.warnings, /建库档案.*占位/));
  const mapped = tmp();
  write(mapped, "客户资料/张总.md", "张总");
  runInit(mapped, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.match(readText(mapped, "01-AI协作/建库档案.md"), /\|---\|---\|---\|---\|\n\n暂时没有生长模块。\n\n## 目录对应\n/);
  rmSync(root, { recursive: true });
  rmSync(mapped, { recursive: true });
});

test("R5-7 “做内容”提醒：类型画像写“品牌设计工作室”、电商零售不提醒，写小红书这些词提醒；启用了内容与作品、作品库提醒，作品集不算", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const remind = () => has(checkKnowledgeBase(root).warnings, /^做内容、对外发东西的老板要有/);
  const profile = (portrait, row) => {
    let text = FILLED_PROFILE().replace("本地服务型：一家小餐馆，外卖为辅。", portrait);
    if (row) text = text.replace("| 暂不启用 | | 生意简单，固定层够用 | 第 2 题 |", row);
    write(root, "01-AI协作/建库档案.md", text);
  };
  profile("专业服务型：品牌设计工作室，给小微企业做 VI 和包装。");
  assert.equal(remind(), false, "“品牌”二字不触发");
  profile("电商品牌零售：天猫、抖店卖茶。");
  assert.equal(remind(), false, "电商、零售本身不算做内容");
  for (const w of ["自媒体", "创作者", "小红书", "公众号", "抖音", "视频号", "直播", "内容"]) {
    profile(`本地服务型（主）+ ${w}`);
    assert.equal(remind(), true, w);
  }
  const studio = "专业服务型：品牌设计工作室。";
  profile(studio, "| 作品库 | `12-作品库/`（计划） | 想把案例整理出来 | 第 9 题 |");
  assert.equal(remind(), true, "作品库");
  profile(studio, "| 内容与作品 | `11-内容与作品/`（计划） | 想开号 | 第 9 题 |");
  assert.equal(remind(), true, "内容与作品");
  profile(studio, "| 作品集 | `12-作品集/`（计划） | 给客户看的案例 | 第 9 题 |");
  assert.equal(remind(), false, "作品集不算做内容");
  rmSync(root, { recursive: true });
});

// ───────────── 第六轮 ─────────────

const PROFILE = "01-AI协作/建库档案.md";
const MANIFEST_PATH = "01-AI协作/原件清单.md";
const ENTRY_DONE = "入口已经接上了，建库档案里的‘入口: 暂缓’可以删掉";
const markDeferred = (root) => write(root, PROFILE, readText(root, PROFILE).replace("结构: 就地建图\n", "结构: 就地建图\n入口: 暂缓\n"));
const managedBlock = (text) => text.slice(text.indexOf(MARK_START_TEXT), text.indexOf("<!-- 本段结束 -->"));
const between = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a)));

test("R6-1 暂缓后只带 --update-agents 补追加：按建库档案的目录对应来，不新建 03/04，地图有原来的对应和只读行，“入口: 暂缓”被删", () => {
  const map = { "03-生意": "生意资料", "04-客户": "客户资料" };
  const root = deferredKb(map);
  markDeferred(root);
  assert.ok(!existsSync(join(root, "03-生意")) && !existsSync(join(root, "04-客户")));
  const profile = readText(root, PROFILE);
  const dry = runInit(root, { date: "2026-10-21", updateAgents: true, dryRun: true });
  assert.ok(dry.notes.some((n) => n.includes("入口: 暂缓")), dry.notes.join("\n"));
  assert.equal(readText(root, PROFILE), profile, "dry-run 不删");
  const out = runInit(root, { date: "2026-10-21", updateAgents: true });
  assert.ok(!existsSync(join(root, "03-生意")) && !existsSync(join(root, "04-客户")), "已经有对应的标准层不新建");
  assert.ok(!out.created.some((p) => /^0[34]-/.test(p)), out.created.join("\n"));
  assert.deepEqual(out.appended.sort(), ["AGENTS.md", "CLAUDE.md"]);
  assert.deepEqual(out.edited, [PROFILE]);
  const agents = readText(root, "AGENTS.md");
  assert.ok(agents.startsWith("# 我原来的规矩\n- 回答先给结论\n"), "原有那段不动");
  assert.match(agents, /\| 生意资料（生意） \|/);
  assert.match(agents, /\| 客户资料（客户） \|/);
  assert.match(agents, /\| 报价（只读） \| 我原有的资料，AI 只读不改 \| 需要时 \|/);
  assert.doesNotMatch(agents, /^\| 0[34]-/m, "地图里没有标准的 03、04");
  assert.match(agents, /开头没有“确认”的是我原来的笔记/, "按就地建图写");
  assert.match(readText(root, "CLAUDE.md"), /@AGENTS\.md/);
  assert.equal(readText(root, PROFILE), profile.replace("入口: 暂缓\n", ""), "建库档案只删这一行");
  assert.ok(out.notes.some((n) => n.includes("入口: 暂缓") && n.includes("删掉")), out.notes.join("\n"));
  fillAgents(root);
  const after = checkKnowledgeBase(root, { stage: "connect" });
  assert.deepEqual(after.errors, [], after.errors.join("\n"));
  assert.ok(!after.warnings.includes(ENTRY_DONE));
  assert.equal(after.summary.verdict, "标准版建好了");
  rmSync(root, { recursive: true });
});

test("R6-1 已有目录对应时，传了和表里不一致的 --map / --readonly / --exclude：报错退出 1，什么都不写；一致的照常", () => {
  const root = deferredKb();
  markDeferred(root);
  mkdirSync(join(root, "笔记"));
  const before = hashTree(root);
  for (const opts of [{ map: { "04-客户": "报价" } }, { map: { "04-客户": "客户资料", "06-项目": "笔记" } }, { readonly: ["笔记"] }, { readonly: [] }, { exclude: ["笔记"] }]) {
    assert.throws(() => runInit(root, { date: "2026-10-21", updateAgents: true, ...opts }), /^Error: 和建库档案的目录对应不一致：/, JSON.stringify(opts));
  }
  const run = cli("init.mjs", root, "--update-agents", "--readonly", "笔记", "--date", "2026-10-21");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^和建库档案的目录对应不一致：.*--readonly/);
  assert.match(run.stderr, /还什么都没写/);
  assert.deepEqual(hashTree(root), before, "不一致时不写任何东西");
  const same = runInit(root, { date: "2026-10-21", updateAgents: true, map: { "04-客户": "客户资料/" }, readonly: ["报价"], dryRun: true });
  assert.ok(same.appended.includes("AGENTS.md"), "和表里一致的参数照常");
  assert.ok(!same.created.some((p) => p.startsWith("04-客户")));
  rmSync(root, { recursive: true });
});

test("R6-1 入口提示：init 和体检都说“在知识库里再跑一次 init.mjs --update-agents”；入口接上了还写着“入口: 暂缓”提醒删掉", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "AGENTS.md", "# 我原来的规矩\n");
  const out = runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.ok(out.notes.some((n) => n.includes("没动它") && n.includes("老板同意后，在知识库里再跑一次 init.mjs --update-agents（会按建库档案里的目录对应补上地图）")), out.notes.join("\n"));
  assert.ok(checkKnowledgeBase(root).errors.includes(ENTRY_DEFERRED));
  const std = tmp();
  write(std, "AGENTS.md", "# 我原来的规矩\n");
  const plain = runInit(std, { date: "2026-10-20" });
  assert.ok(plain.notes.some((n) => n.includes("老板同意后，在知识库里再跑一次 init.mjs --update-agents") && !n.includes("目录对应")), plain.notes.join("\n"));
  // 标记段已经在（比如老板自己贴进去的），建库档案还写着暂缓
  const kb = deferredKb();
  runInit(kb, { date: "2026-10-21", updateAgents: true });
  markDeferred(kb);
  assert.ok(checkKnowledgeBase(kb).warnings.includes(ENTRY_DONE), checkKnowledgeBase(kb).warnings.join("\n"));
  assert.ok(checkKnowledgeBase(kb, { stage: "connect" }).warnings.includes(ENTRY_DONE));
  // 再带 --update-agents 跑一次：入口已经接上，也把这一行删掉（误写了两遍的、Windows 换行的也删干净，别的行不动）
  write(kb, PROFILE, readText(kb, PROFILE).replace("入口: 暂缓\n", "入口: 暂缓\n入口:暂缓\n").replace(/\n/g, "\r\n"));
  const crlf = readText(kb, PROFILE);
  const again = runInit(kb, { date: "2026-10-22", updateAgents: true });
  assert.equal(readText(kb, PROFILE), crlf.replace("入口: 暂缓\r\n入口:暂缓\r\n", ""));
  assert.deepEqual(again.edited, [PROFILE]);
  assert.ok(!/^入口:/m.test(readText(kb, PROFILE)));
  assert.ok(!checkKnowledgeBase(kb).warnings.includes(ENTRY_DONE));
  for (const r of [root, std, kb]) rmSync(r, { recursive: true });
});

test("R6-2 就地建图的 AGENTS 段：记一笔写进 <客户名>-往来记录.md、这周要做什么看建库快照、05 行不提我的方法/、隐私不替老板说功效；02 行新说法；路径按目录对应换算", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "生意资料/价目.md", "价目");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料", "03-生意": "生意资料" } });
  const block = managedBlock(readText(root, "AGENTS.md"));
  assert.doesNotMatch(block, /该客户文件|该文件“往来记录”末尾/, block);
  assert.doesNotMatch(block, /我的方法\//);
  assert.equal((block.match(/新往来写进客户层里的 `<客户名>-往来记录\.md`（我原有的客户文件不追加/g) || []).length, 2, "常见任务和“怎么写”两处");
  assert.match(block, /\| 这周要做什么、该跟进谁 \| 客户资料\/README\.md 的“建库快照” → 06-项目\/近期要事\.md（装了工作台先看工作台） \|/);
  assert.match(block, /\| 05-方法与判断 \| 我各类工作的做法和判断，一类一个文件夹 \|/);
  assert.match(block, /\| 02-关于我 \| 我的基本情况、边界（其他的建了再补） \|/);
  assert.match(block, /\| 做方案、报表、PPT 给别人看 \| 02-关于我\/README\.md 里的 做事与决策方式（什么叫好，有这份时再读）→ 生意资料\/README\.md \|/);
  const privacy = between(block, "## 隐私", "## 跟我说话");
  assert.doesNotMatch(privacy, /功效|最、第一/);
  assert.ok(privacy.includes("- 对外发东西前，先看 生意资料/品牌与口吻.md 的‘不能说的话’（还没建就先问我）；资质、获奖、数量、价格承诺要有原件才能说。"), privacy);
  assert.doesNotMatch(block.split("\n").slice(1).join("\n"), /老板/, "标记段里不写“老板”");
  // `<客户名>` 写在反引号里，不算没填的占位
  const ph = checkKnowledgeBase(root).warnings.find((w) => w.startsWith("AGENTS.md 还有"));
  assert.ok(ph && !ph.includes("<客户名>") && !ph.includes("<项目名>"), ph);
  // 06 也对应老板原有的文件夹：项目的事也另起往来记录
  const kb = tmp();
  write(kb, "项目/官网.md", "官网");
  runInit(kb, { date: "2026-10-20", map: { "06-项目": "项目" } });
  const kbBlock = managedBlock(readText(kb, "AGENTS.md"));
  assert.match(kbBlock, /项目的事同样另起 `<项目名>-往来记录\.md`/);
  assert.doesNotMatch(kbBlock, /项目的事去 项目 该项目/);
  // 标准结构：05 行保留我的方法/，隐私和 02 行一样改
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  const stdBlock = managedBlock(readText(std, "AGENTS.md"));
  assert.match(stdBlock, /\| 05-方法与判断 \| 我各类工作的做法和判断，一类一个文件夹；我自己的方法在 我的方法\/ \|/);
  assert.match(stdBlock, /\| 02-关于我 \| 我的基本情况、边界（其他的建了再补） \|/);
  assert.doesNotMatch(between(stdBlock, "## 隐私", "## 跟我说话"), /功效|最、第一/);
  assert.ok(stdBlock.includes("- 对外发东西前，先看 03-生意/品牌与口吻.md 的‘不能说的话’（还没建就先问我）；资质、获奖、数量、价格承诺要有原件才能说。"));
  assert.match(stdBlock, /\| 记一笔：答应了客户什么、哪件事做完了、发了 \| 04-客户\/README\.md → 该客户文件（项目的事去 06-项目 该项目）→ 末尾“往来记录” \|/, "标准结构的记一笔不变");
  for (const r of [root, kb, std]) rmSync(r, { recursive: true });
});

test("R6-2 AGENTS 标记段里提到的 00—99 路径不存在时提醒；刚建好的库（标准、就地建图）不提醒；“文件开头”里的示例不算", () => {
  const re = /^AGENTS\.md 里提到的 /;
  const std = tmp();
  runInit(std, { name: "王总", shop: "示例小店", date: "2026-10-21" });
  assert.ok(!existsSync(join(std, "99-原始材料/采访记录/2026-10-20-建库采访.md")), "“文件开头”一节的示例路径不存在");
  assert.ok(!has(checkKnowledgeBase(std).warnings, re), checkKnowledgeBase(std).warnings.join("\n"));
  const mapped = tmp();
  write(mapped, "客户资料/张总.md", "张总");
  runInit(mapped, { date: "2026-10-21", map: { "04-客户": "客户资料" }, readonly: [] });
  assert.ok(!has(checkKnowledgeBase(mapped).warnings, re));
  const agents = readText(std, "AGENTS.md");
  write(std, "AGENTS.md", agents.replace("<最常被纠正的 1—2 条。>", "写方案前看 02-关于我/做事与决策方式.md（什么叫好）和 `05-方法与判断/报价/`；样本见 05-方法与判断/README.md。"));
  const { warnings, errors } = checkKnowledgeBase(std);
  assert.ok(warnings.includes("AGENTS.md 里提到的 02-关于我/做事与决策方式.md 还不存在：建好再写进地图，或先删掉"), warnings.join("\n"));
  assert.ok(warnings.includes("AGENTS.md 里提到的 05-方法与判断/报价/ 还不存在：建好再写进地图，或先删掉"));
  assert.ok(!has(warnings, /AGENTS\.md 里提到的 05-方法与判断\/README\.md/));
  assert.ok(!has(errors, /做事与决策方式/), "只提醒");
  write(std, "02-关于我/做事与决策方式.md", note(base({ 类型: "关于我" })));
  mkdirSync(join(std, "05-方法与判断/报价"));
  assert.ok(!has(checkKnowledgeBase(std).warnings, re));
  // 常见任务表里的照旧按错误报，不重复提醒
  write(std, "AGENTS.md", agents.replace("| 整理新材料 |", "| 看报价 | 05-方法与判断/报价/判断规则.md → 03-生意/README.md |\n| 整理新材料 |"));
  const route = checkKnowledgeBase(std);
  assert.ok(route.errors.includes("AGENTS.md 常见任务表里的 05-方法与判断/报价/判断规则.md 不存在"));
  assert.ok(!has(route.warnings, /AGENTS\.md 里提到的 05-方法与判断\/报价\/判断规则\.md/));
  for (const r of [std, mapped]) rmSync(r, { recursive: true });
});

/** 示例库：先看环境变量 BOSS_KB_SAMPLE，没设就按课程资料里的相对位置找；都找不到就跳过 */
const SAMPLE_KB = process.env.BOSS_KB_SAMPLE || join(SCRIPTS, "..", "..", "..", "..", "2026-10-10-示例老板ABC茶社", "示例老板知识库");
test("R6-2 示例库（只读体检）：--stage quick 仍 0 错误 0 提醒", { skip: !existsSync(SAMPLE_KB) && "没有示例库" }, () => {
  const before = hashTree(SAMPLE_KB);
  const r = checkKnowledgeBase(SAMPLE_KB, { stage: "quick" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.summary.verdict, "标准版建好了");
  assert.equal(r.summary.inferred_profile, undefined);
  assert.deepEqual(hashTree(SAMPLE_KB), before, "体检不改示例库");
});

/** 接入：客户资料对应 04，日记是只读、老板还在用的文件夹 */
function readonlyKb() {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "日记/2026-10-01.md", "# 10-01\n今天去看了茶园");
  write(root, "日记/2026-10-02.md", "# 10-02\n下雨");
  write(root, "私人/家庭.md", "家里的事");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" }, readonly: ["日记"], exclude: ["私人"] });
  return root;
}
const manifestRow = (root, path) => readText(root, MANIFEST_PATH).split("\n").find((l) => l.startsWith(`| ${path} |`));

test("R6-3 只读文件夹的原件：connect 时改了、删了、新加了只提醒；对应层的原件照样报错", () => {
  const root = readonlyKb();
  write(root, "日记/2026-10-01.md", "# 10-01\n今天去看了茶园，补一句");
  rmSync(join(root, "日记/2026-10-02.md"));
  write(root, "日记/2026-10-21.md", "---\ntags: [日记]\n---\n新的一天，客户 13812345678");
  write(root, "客户资料/张总.md", "张总（改了）");
  const { errors, warnings } = checkKnowledgeBase(root, { stage: "connect" });
  assert.ok(errors.includes("原有文件被改了：客户资料/张总.md"), errors.join("\n"));
  assert.ok(!has(errors, /日记\//), errors.join("\n"));
  for (const p of ["日记/2026-10-01.md", "日记/2026-10-02.md"]) assert.ok(warnings.includes(`${p} 有变化——它在只读文件夹里，老板还在用的话，正常`), warnings.join("\n"));
  assert.ok(warnings.includes("日记/ 里有 1 份接入以后新加的文件（如 日记/2026-10-21.md）——它在只读文件夹里，老板还在用的话，正常；老板说是自己加的，用 init.mjs --refresh-originals 日记 重新登记"), warnings.join("\n"));
  assert.ok(!has(warnings, /手机号.*日记\//), "只读文件夹里新加的当老板的原件：手机号不查");
  const plain = checkKnowledgeBase(root);
  assert.ok(!has(plain.errors, /日记\//));
  assert.ok(plain.warnings.includes("日记/2026-10-01.md 有变化——它在只读文件夹里，老板还在用的话，正常"));
  assert.ok(plain.warnings.includes("原有文件被改了：客户资料/张总.md（如果是你自己改的，正常；不是的话查一下是谁动的）"));
  rmSync(root, { recursive: true });
});

test("R6-3 --refresh-originals：只读文件夹按现在的样子重新登记，对应层的只重算清单上已有的；清单末尾追加一行；之后不再提醒", () => {
  const root = readonlyKb();
  write(root, "日记/2026-10-01.md", "# 10-01\n补一句");
  rmSync(join(root, "日记/2026-10-02.md"));
  write(root, "日记/2026-10-21.md", "新的一天");
  write(root, "客户资料/张总.md", "张总（改了）");
  write(root, "客户资料/张总-往来记录.md", note(base({ 类型: "往来记录", 名称: "张总" }), "- 2026-10-21｜微信｜问报价"));
  const zhang = manifestRow(root, "客户资料/张总.md");
  const before = readText(root, MANIFEST_PATH);
  const tree = hashTree(root);
  for (const bad of ["没有这个", "私人", "01-AI协作", "../外面", ""]) assert.throws(() => refreshOriginals(root, bad, { date: "2026-10-22" }), /原件清单|不读|文件夹/, bad);
  const dry = refreshOriginals(root, "日记", { date: "2026-10-22", dryRun: true });
  assert.deepEqual([dry.updated, dry.removed, dry.added], [1, 1, 1]);
  assert.deepEqual(hashTree(root), tree, "dry-run 不写");
  const out = refreshOriginals(root, "日记/", { date: "2026-10-22" });
  assert.equal(out.dryRun, false);
  const text = readText(root, MANIFEST_PATH);
  assert.ok(text.trimEnd().endsWith("- 2026-10-22 老板确认重新登记：日记/"), text);
  assert.equal(parseFrontmatter(text)["更新"], "2026-10-22");
  assert.ok(manifestRow(root, "日记/2026-10-01.md").includes(sha("# 10-01\n补一句")));
  assert.equal(manifestRow(root, "日记/2026-10-02.md"), undefined, "删了的去掉");
  assert.ok(manifestRow(root, "日记/2026-10-21.md").includes(sha("新的一天")), "只读文件夹里新加的登记上");
  assert.equal(manifestRow(root, "客户资料/张总.md"), zhang, "别的文件夹不动");
  assert.doesNotMatch(text, /私人|家庭/);
  assert.equal(text.split("\n").filter((l) => /^\| 文件 \| 大小 \| SHA-256 \|$/.test(l)).length, 1);
  const tableOf = (t) => t.split("\n").filter((l) => /^\| .+ \| .+ \| [0-9a-f]{64} \|$/.test(l));
  assert.deepEqual(tableOf(text).map((l) => l.split(" | ")[0]), [...tableOf(text).map((l) => l.split(" | ")[0])].sort(), "按路径排好");
  assert.notEqual(text, before);
  const connect = checkKnowledgeBase(root, { stage: "connect" });
  assert.ok(!has(connect.warnings, /日记.*(有变化|新加的)/), connect.warnings.join("\n"));
  assert.ok(connect.errors.includes("原有文件被改了：客户资料/张总.md"));
  // 对应层的原有文件夹：只重算清单上已有的，AI 新写的往来记录不登记成原件
  const run = cli("init.mjs", root, "--refresh-originals", "客户资料", "--date", "2026-10-29");
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).added, 0);
  assert.ok(manifestRow(root, "客户资料/张总.md").includes(sha("张总（改了）")));
  assert.equal(manifestRow(root, "客户资料/张总-往来记录.md"), undefined);
  assert.ok(readText(root, MANIFEST_PATH).trimEnd().endsWith("- 2026-10-22 老板确认重新登记：日记/\n- 2026-10-29 老板确认重新登记：客户资料/"));
  assert.ok(!has(checkKnowledgeBase(root, { stage: "connect" }).errors, /原有文件/));
  // 命令行：只能和 --date、--dry-run 一起用；标准库没有原件清单
  assert.equal(cli("init.mjs", root, "--refresh-originals", "日记", "--update-agents").status, 1);
  const std = tmp();
  runInit(std, { date: "2026-10-20" });
  const none = cli("init.mjs", std, "--refresh-originals", "04-客户");
  assert.equal(none.status, 1);
  assert.match(none.stderr, /没有原件清单/);
  for (const r of [root, std]) rmSync(r, { recursive: true });
});

test("R6-4 类型画像、老板最关心还全是 AI 推断：结论不变，结论行后面加一句，summary 带 inferred_profile", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20" });
  fillQuickKb(root);
  const NOTE = "（类型画像、老板最关心还是 AI 推断，请老板确认）";
  const setProfile = (portrait, care) => write(root, PROFILE, FILLED_PROFILE().replace("本地服务型：一家小餐馆，外卖为辅。", portrait).replace("1. 今天该回访哪几位老客。", care));
  setProfile("- （AI 推断，待确认）本地服务型：一家小餐馆，外卖为辅。", "1. （AI 推断，待确认）今天该回访哪几位老客\n2. 未知（老板说以后再说）");
  const { summary, errors } = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(errors, []);
  assert.equal(summary.verdict, "标准版建好了", "verdict 不变");
  assert.equal(summary.inferred_profile, true);
  assert.match(summaryLine(summary), new RegExp(`^体检结论：标准版建好了${NOTE}｜客户 3 · `));
  const brief = cli("check.mjs", root, "--stage", "quick", "--brief");
  assert.equal(brief.status, 0);
  assert.ok(brief.stdout.startsWith(`体检结论：标准版建好了${NOTE}｜`), brief.stdout);
  assert.ok(brief.stdout.trimEnd().endsWith(SKILL_VERSION), "版本号还在最后");
  for (const [portrait, care] of [
    ["- （AI 推断，待确认）本地服务型。\n- 林总说外卖只是顺带", "1. （AI 推断，待确认）回访老客"],
    ["本地服务型：一家小餐馆。", "1. （AI 推断，待确认）回访老客"],
    ["未知（老板说以后再说）", "1. 未知（老板说以后再说）"],
  ]) {
    setProfile(portrait, care);
    const s = checkKnowledgeBase(root, { stage: "quick" }).summary;
    assert.equal(s.inferred_profile, undefined, `${portrait} / ${care}`);
    assert.ok(!summaryLine(s).includes(NOTE));
  }
  rmSync(root, { recursive: true });
});

test("R6-5 做内容的老板缺说话方式：提醒（quick 也只是提醒），路径按目录对应换算；不做内容的不提醒", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const W = "做内容的老板最好有 02-关于我/说话方式.md：贴 1—2 段最满意的原文，AI 才写得像你（第 9 题）";
  write(root, PROFILE, FILLED_PROFILE().replace("本地服务型：一家小餐馆，外卖为辅。", "本地服务型（主）+ 小红书"));
  assert.ok(checkKnowledgeBase(root).warnings.includes(W), checkKnowledgeBase(root).warnings.join("\n"));
  const quick = checkKnowledgeBase(root, { stage: "quick" });
  assert.ok(quick.warnings.includes(W));
  assert.ok(!has(quick.errors, /说话方式/));
  write(root, "02-关于我/说话方式.md", note(base({ 类型: "说话方式" }), "> 原文：今天的茶，像雨后的山。"));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /^做内容的老板最好有/));
  rmSync(join(root, "02-关于我/说话方式.md"));
  write(root, PROFILE, FILLED_PROFILE());
  assert.ok(!has(checkKnowledgeBase(root).warnings, /做内容的老板最好有/), "不做内容的不提醒");
  const kb = tmp();
  write(kb, "我自己/简历.md", "简历");
  runInit(kb, { date: "2026-10-20", map: { "02-关于我": "我自己" } });
  write(kb, PROFILE, readText(kb, PROFILE).replace("（第 2 题后填：主类型 + 叠加）", "创作者：公众号写茶"));
  assert.ok(checkKnowledgeBase(kb).warnings.includes("做内容的老板最好有 我自己/说话方式.md：贴 1—2 段最满意的原文，AI 才写得像你（第 9 题）"));
  for (const r of [root, kb]) rmSync(r, { recursive: true });
});

// ───────────── 第六轮（10/11 合并）：Obsidian 模式、体检/ ─────────────

/** Obsidian 模式下 AGENTS 标记段“怎么写”里多出来的那一句（和 references/模板.md 同步） */
const OBSIDIAN_RULE = "- 我用 Obsidian 看这个库：文件之间互相链接用双链 `[[路径]]`（从知识库根目录写起，不带 .md）；README 索引表里只写 `[[路径]]`，别的表格要换显示名写 `[[路径\\|名字]]`。";
const editorOf = (root) => parseFrontmatter(readText(root, PROFILE))["编辑器"];

test("O1 init --obsidian：建库档案记“编辑器: Obsidian”，01 层索引用双链，AGENTS 只多一句双链的规矩；普通写法不变；体检 0 错误、不提双链", () => {
  const root = tmp();
  const out = runInit(root, { date: "2026-10-20", obsidian: true });
  assert.equal(editorOf(root), "Obsidian");
  assert.match(readText(root, PROFILE), /\n结构: 标准\n编辑器: Obsidian\n/);
  const ai = readText(root, "01-AI协作/README.md");
  assert.match(ai, /\| 建库档案 \| 建库档案 \| \| [^|]+ \| \[\[01-AI协作\/建库档案\]\] \|/);
  assert.match(ai, /\| 任务手册 \| 任务手册 \| \| [^|]+ \| \[\[01-AI协作\/任务手册\/整理新材料\]\]、\[\[01-AI协作\/任务手册\/每周复盘\]\]、\[\[01-AI协作\/任务手册\/改稿后记下来\]\] \|/);
  assert.doesNotMatch(ai, /\]\(/, "01 层 README 里没有普通链接");
  assert.match(ai, /- 链接：文件之间用双链/, "01 层规矩里写明双链的写法");
  assert.ok(ai.includes("README 索引表的“文件”格只写 `[[路径]]`，不加显示名；别的表格要换显示名写 `[[路径\\|名字]]`"), "01 层规矩和 AGENTS 同一个说法");
  assert.ok(ai.includes("“来源”“整理进”照旧写从知识库根目录起的 .md 路径"), "开头元信息不写双链");
  const agents = readText(root, "AGENTS.md");
  assert.equal(agents.split(OBSIDIAN_RULE).length - 1, 1, "AGENTS 里有且只有一句双链的规矩");
  assert.ok(between(agents, "## 怎么写", "## 文件开头").includes(`别处写一句、链过去。\n${OBSIDIAN_RULE}\n`), "这一句在“怎么写”里，紧跟“一件事只在一处写全”");
  assert.ok(!has(out.notes, /\.obsidian/), "自己带了 --obsidian，不提 .obsidian");
  const plain = tmp();
  runInit(plain, { date: "2026-10-20" });
  assert.equal(editorOf(plain), undefined, "普通写法没有“编辑器”这一行");
  assert.equal(agents.replace(`${OBSIDIAN_RULE}\n`, ""), readText(plain, "AGENTS.md"), "AGENTS 除了这一句，和普通写法逐字一样");
  assert.ok(!readText(plain, "01-AI协作/README.md").includes("[["));
  const r = checkKnowledgeBase(root);
  assert.deepEqual(r.errors, []);
  assert.ok(!has(r.warnings, /双链|索引里没有|没提到子文件夹|表格/), r.warnings.join("\n"));
  assert.equal(resolveLayout(root).obsidian, true);
  assert.equal(resolveLayout(plain).obsidian, false);
  const viaCli = tmp();
  const run = cli("init.mjs", viaCli, "--obsidian", "--date", "2026-10-20");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(editorOf(viaCli), "Obsidian");
  assert.match(cli("init.mjs", "--help").stdout, /--obsidian/);
  for (const d of [root, plain, viaCli]) rmSync(d, { recursive: true });
});

test("O2 根目录已有 .obsidian/：init 自动按 Obsidian 写法建并说一声；再跑按建库档案读回；普通写法建的库带 --obsidian 报错、什么都不写", () => {
  const root = tmp();
  write(root, ".obsidian/app.json", "{}");
  const out = runInit(root, { date: "2026-10-20" });
  assert.ok(has(out.notes, /看到 \.obsidian\/，按 Obsidian 写法建/), out.notes.join("\n"));
  assert.equal(editorOf(root), "Obsidian");
  assert.ok(readText(root, "AGENTS.md").includes(OBSIDIAN_RULE));
  const dry = tmp();
  write(dry, ".obsidian/app.json", "{}");
  assert.ok(has(runInit(dry, { dryRun: true }).notes, /看到 \.obsidian/), "dry-run 也说");
  // 再跑：.obsidian 删了也按建库档案来，缺的 01 README 按双链补
  rmSync(join(root, ".obsidian"), { recursive: true });
  rmSync(join(root, "01-AI协作/README.md"));
  const again = runInit(root, { date: "2026-10-21" });
  assert.deepEqual(again.created, ["01-AI协作/README.md"]);
  assert.match(readText(root, "01-AI协作/README.md"), /\[\[01-AI协作\/建库档案\]\]/);
  assert.ok(!has(again.notes, /\.obsidian/));
  // 普通写法建的库：带 --obsidian 报错，什么都不写；有 .obsidian/ 只说一声，照普通写法补
  const plain = tmp();
  runInit(plain, { date: "2026-10-20" });
  rmSync(join(plain, "04-客户/README.md"));
  const before = hashTree(plain);
  assert.throws(() => runInit(plain, { date: "2026-10-20", obsidian: true }), /编辑器: Obsidian[\s\S]*还什么都没写/);
  const run = cli("init.mjs", plain, "--obsidian");
  assert.equal(run.status, 1);
  assert.match(run.stderr, /还什么都没写/);
  assert.deepEqual(hashTree(plain), before);
  write(plain, ".obsidian/app.json", "{}");
  const later = runInit(plain, { date: "2026-10-20" });
  assert.ok(has(later.notes, /看到 \.obsidian\/，但建库档案里没写“编辑器: Obsidian”/), later.notes.join("\n"));
  assert.equal(editorOf(plain), undefined);
  assert.ok(!readText(plain, "04-客户/README.md").includes("[["));
  // --obsidian 不能和 --refresh-originals 一起用
  const refresh = cli("init.mjs", plain, "--refresh-originals", "日记", "--obsidian");
  assert.equal(refresh.status, 1);
  assert.match(refresh.stderr, /多了 --obsidian/);
  for (const d of [root, dry, plain]) rmSync(d, { recursive: true });
});

test("O3 接入夹具（Obsidian）：有 .obsidian/ 自动按 Obsidian 写法接入；原件里的断链不管，新写的整理稿断链报错", () => {
  const root = fixture("接入-Obsidian");
  write(root, "客户/李姐-花间民宿.md", `${readText(root, "客户/李姐-花间民宿.md")}\n还没写的笔记：[[去年的小程序]]\n`);
  const out = runInit(root, { date: "2026-10-09", map: { "04-客户": "客户", "06-项目": "项目" }, readonly: ["日记", "Templates"], exclude: ["私人"], updateAgents: true });
  assert.ok(has(out.notes, /看到 \.obsidian\//), out.notes.join("\n"));
  assert.equal(editorOf(root), "Obsidian");
  assert.ok(readText(root, "AGENTS.md").includes(OBSIDIAN_RULE));
  assert.match(readText(root, "01-AI协作/README.md"), /\[\[01-AI协作\/原件清单\]\]/);
  let r = checkKnowledgeBase(root);
  assert.deepEqual(r.errors, [], r.errors.join("\n"));
  assert.ok(!has(r.warnings, /双链|去年的小程序/), r.warnings.join("\n"));
  write(root, "客户/张总-往来记录.md", note(base({ 类型: "往来记录", 名称: "张总" }), "- 2026-10-09｜微信｜问报价，见 [[项目/官网改版]]、[[报价单-不存在]]；答应：无；来源：我口述 2026-10-09"));
  r = checkKnowledgeBase(root);
  assert.deepEqual(r.errors, ["链接指向不存在的文件：客户/张总-往来记录.md → [[报价单-不存在]]"]);
  rmSync(root, { recursive: true });
});

/** 按 Obsidian 写法补齐快速版：各层索引用 index 补（写 [[路径]]），正文用 [[路径|显示名]]，表格里用 [[路径\|显示名]] */
function fillQuickObsidianKb(root) {
  fillQuickKb(root);
  write(root, PROFILE, FILLED_PROFILE().replace("结构: 标准\n", "结构: 标准\n编辑器: Obsidian\n"));
  write(root, "04-客户/老客1.md", customer("老客1", { 一句话: "常来的老客" }).replace("正文。", "常点 [[03-生意/招牌套餐|招牌套餐]]，也问过 [[招牌套餐]]；见 [[02-关于我/基本情况#我是谁]]。"));
  write(root, "04-客户/老客2.md", customer("老客2").replace("正文。", "| 点过 | 链接 |\n|---|---|\n| 套餐 | [[03-生意/招牌套餐\\|招牌套餐]] |"));
  write(root, "03-生意/价目表.md", note(base({ 类型: "生意", 一句话: "全部价格" }), "两荤一素 38 元。"));
  for (const id of ["01-AI协作", "02-关于我", "03-生意", "04-客户", "05-方法与判断", "06-项目"]) writeIndex(join(root, id));
  write(root, "03-生意/README.md", readText(root, "03-生意/README.md").replace(/\| 价目表 \| 生意 \|/, "| 价目表 | 产品 |"));
  write(root, "05-方法与判断/README.md", readText(root, "05-方法与判断/README.md").replace("| （暂时没有） | | |", "| 报价 | [[05-方法与判断/报价与接单/判断样本\\|报价样本]] | |"));
}

test("O4 Obsidian 写法补完快速版：--stage quick 照样“标准版建好了”；双链、表格里的 \\|、索引里的 [[路径]] 都认；索引里登记成产品的双链也算产品", () => {
  const root = tmp();
  runInit(root, { name: "王总", shop: "示例小店", date: "2026-10-20", obsidian: true });
  fillQuickObsidianKb(root);
  assert.match(readText(root, "04-客户/README.md"), /\[\[04-客户\/老客1\]\]/);
  const r = checkKnowledgeBase(root, { stage: "quick" });
  assert.deepEqual(r.errors, [], r.errors.join("\n"));
  assert.ok(!has(r.warnings, /双链|表格|链接|索引里没有|没提到子文件夹|同名/), r.warnings.join("\n"));
  assert.equal(r.summary.verdict, "标准版建好了");
  assert.equal(r.summary.counts.products, 2, "招牌套餐（类型: 产品，索引也登记了，只算一次）+ 价目表（索引里登记成产品）");
  rmSync(root, { recursive: true });
});

test("O5 index：Obsidian 写法的库补出来的行写 [[从库根写起的路径]]（不带 .md、不带别名）；子文件夹有 README 的链到它的 README；补完体检不报漏", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20", obsidian: true });
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  write(root, "04-客户/企业客户/乙公司.md", customer("乙公司"));
  write(root, "04-客户/丙 公司.md", customer("丙公司"));
  write(root, "04-客户/门店老客/README.md", "# 门店老客\n- 装什么：常来门店的老客\n");
  const plan = buildIndex(join(root, "04-客户"));
  assert.equal(plan.rows.length, 4, plan.table);
  assert.match(plan.table, /\| 甲公司 \| 客户 \| 企业客户 \| （待补） \| \[\[04-客户\/甲公司\]\] \|/);
  assert.match(plan.table, /\| \[\[04-客户\/企业客户\/乙公司\]\] \|/);
  assert.match(plan.table, /\| \[\[04-客户\/丙 公司\]\] \|/);
  assert.match(plan.table, /\| 门店老客 \| 文件夹 \|\s+\| 常来门店的老客 \| \[\[04-客户\/门店老客\/README\]\] \|/);
  assert.doesNotMatch(plan.table, /\]\(|\.md\]\]|\\\|/, "不用普通链接、不带 .md、不带别名");
  assert.ok(writeIndex(join(root, "04-客户")).written);
  const r = checkKnowledgeBase(root);
  assert.deepEqual(r.errors, []);
  assert.ok(!has(r.warnings, /04-客户\/README\.md (的索引里没有|没提到子文件夹)/), r.warnings.join("\n"));
  // 普通写法的库照旧写普通链接
  const plain = tmp();
  runInit(plain, { date: "2026-10-20" });
  write(plain, "04-客户/甲公司.md", customer("甲公司"));
  assert.match(buildIndex(join(plain, "04-客户")).table, /\[甲公司\.md\]\(甲公司\.md\)/);
  for (const d of [root, plain]) rmSync(d, { recursive: true });
});

test("O6 表格切列：没转义、也不在 [[…]] 里的 | 才切，老写法不变；Obsidian 库表格里的 [[路径\\|显示名]] 不报，没转义的别名提醒；机读表照样报错", () => {
  assert.deepEqual(splitRow("| 甲 | 乙 |"), ["甲", "乙"]);
  assert.deepEqual(splitRow("甲|乙"), ["甲", "乙"]);
  assert.deepEqual(splitRow("| 甲 |  | 丙 |"), ["甲", "", "丙"]);
  assert.deepEqual(splitRow("| a | [[04-客户/张总\\|张总]] | b\\|c |"), ["a", "[[04-客户/张总|张总]]", "b|c"]);
  assert.deepEqual(splitRow("| a | [[张总|老张]] | b |"), ["a", "[[张总|老张]]", "b"]);
  assert.deepEqual(splitRow("| [[没关上 | b |"), ["[[没关上", "b"], "没有 ]] 的 [[ 照老办法切");
  assert.deepEqual(tableRows("| 名称 | 文件 |\n|---|---|\n| 张总 | [[04-客户/张总\\|张总]] |", "名称"), [["张总", "[[04-客户/张总|张总]]"]]);
  const root = tmp();
  runInit(root, { date: "2026-10-20", obsidian: true });
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  const readme = readText(root, "04-客户/README.md");
  write(root, "04-客户/README.md", readme.replace("| （暂时没有） | | | | |", "| 甲公司 | 客户 | | 老客户 | [[04-客户/甲公司\\|甲]] |"));
  let r = checkKnowledgeBase(root);
  assert.ok(!has([...r.errors, ...r.warnings], /表格|甲公司/), [...r.errors, ...r.warnings].join("\n"));
  write(root, "04-客户/README.md", readme.replace("| （暂时没有） | | | | |", "| 甲公司 | 客户 | | 老客户 | [[04-客户/甲公司|甲]] |"));
  r = checkKnowledgeBase(root);
  assert.ok(has(r.warnings, /^04-客户\/README\.md 第 \d+ 行的表格有 6 格，表头是 5 格：.*README 索引表里只写 \[\[路径\]\]，别的表格要换显示名写 \[\[路径\\\|名字\]\]/), r.warnings.join("\n"));
  assert.ok(!has(r.warnings, /转义了也会错/));
  write(root, "05-方法与判断/README.md", readText(root, "05-方法与判断/README.md").replace("| （暂时没有） | | |", "| 报价 | 报价\\|接单.md | |"));
  assert.ok(has(checkKnowledgeBase(root).errors, /^05-方法与判断\/README\.md 第 \d+ 行的表格/), "格子里双链以外的 \\| 照样不行，方法选择表是机读表");
  rmSync(root, { recursive: true });
});

test("O7 双链：带 / 的从库根找、只写文件名的全库找同名；同名多份提醒；整理稿里的断链报错；lib 的 wikiLinksIn、resolveWikiLink、mentionedIn", () => {
  assert.deepEqual(wikiLinksIn("a [[x/y#h|别名]] b [[z\\|w]] `[[代码]]` ![[图.png]] [[#只有小标题]]\n```\n[[代码块]]\n```"), ["x/y", "z", "图.png"]);
  const root = tmp();
  runInit(root, { date: "2026-10-20", obsidian: true });
  write(root, "04-客户/张总.md", customer("张总"));
  write(root, "06-项目/张总.md", note(base({ 类型: "项目", 名称: "张总", 状态: "进行中", 截止: "未定", 负责人: "我" })));
  write(root, "03-生意/报价单.pdf", "x");
  write(root, "03-生意/招牌套餐.md", note(base({ 类型: "产品", 名称: "招牌套餐" }), "老客 [[04-客户/张总#近况|张总]] 常点；见 [[生意总览]]；[[张总]] 也问过；附件 ![[报价单.pdf]]。"));
  const files = ["04-客户/张总.md", "06-项目/张总.md", "03-生意/报价单.pdf", "03-生意/招牌套餐.md"];
  const byName = wikiNameIndex(files);
  const at = { root, fromDir: join(root, "03-生意"), byName, files };
  assert.deepEqual(resolveWikiLink("04-客户/张总", at), ["04-客户/张总.md"]);
  assert.deepEqual(resolveWikiLink("张总", at).sort(), ["04-客户/张总.md", "06-项目/张总.md"]);
  assert.deepEqual(resolveWikiLink("报价单.pdf", at), ["03-生意/报价单.pdf"]);
  assert.deepEqual(resolveWikiLink("生意总览", at), []);
  let r = checkKnowledgeBase(root);
  assert.ok(r.errors.includes("链接指向不存在的文件：03-生意/招牌套餐.md → [[生意总览]]"), r.errors.join("\n"));
  assert.ok(!has(r.errors, /张总|报价单/), r.errors.join("\n"));
  assert.ok(has(r.warnings, /^03-生意\/招牌套餐\.md 里的 \[\[张总\]\] 对上了 2 份同名文件（04-客户\/张总\.md、06-项目\/张总\.md）/), r.warnings.join("\n"));
  write(root, "03-生意/招牌套餐.md", note(base({ 类型: "产品", 名称: "招牌套餐" }), "老客 [[04-客户/张总]] 常点。"));
  r = checkKnowledgeBase(root);
  assert.ok(!has([...r.errors, ...r.warnings], /同名|链接指向/), [...r.errors, ...r.warnings].join("\n"));
  // 索引：从库根写起的双链（含表格里转义的别名）算收录；别的层的同名文件不算
  const dir = join(root, "04-客户");
  assert.ok(mentionedIn("| 张总 | [[04-客户/张总]] |", dir, "张总.md"));
  assert.ok(mentionedIn("| 张总 | [[04-客户/张总\\|张总]] |", dir, "张总.md"));
  assert.ok(mentionedIn("[[04-客户/企业/乙]]", dir, "企业", { dir: true }));
  assert.ok(mentionedIn("[[04-客户/企业/README]]", dir, "企业", { dir: true }));
  assert.ok(!mentionedIn("[[03-生意/张总]]", dir, "张总.md"));
  assert.ok(!mentionedIn("[[04-客户/张总二]]", dir, "张总.md"));
  rmSync(root, { recursive: true });
});

test("O8 定期维护的体检报告：90 层的 体检/ 像收件箱一样，不要求进索引、不报没登记、没有开头也不报；index 不给它补；类型清单有“体检报告”", () => {
  assert.ok(TYPES["90-持续生长"].includes("体检报告"));
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  for (let i = 1; i <= 6; i += 1) write(root, `90-持续生长/体检/2026-10-${10 + i}-周体检.md`, note(base({ 类型: "体检报告", 确认: "已确认" }), "## 结论\n没有要改的。"));
  write(root, "90-持续生长/体检/草稿.md", "没有开头的草稿");
  const r = checkKnowledgeBase(root);
  assert.deepEqual(r.errors, [], r.errors.join("\n"));
  assert.ok(!has(r.warnings, /体检/), r.warnings.join("\n"));
  write(root, "90-持续生长/本月体检汇总.md", note(base({ 类型: "体检报告" })));
  assert.ok(!has(checkKnowledgeBase(root).warnings, /不在类型清单里/), "体检报告是认得的类型");
  rmSync(join(root, "90-持续生长/本月体检汇总.md"));
  assert.equal(buildIndex(join(root, "90-持续生长")).rows.length, 0, "90 层的索引不要求列 体检/");
  const inner = writeIndex(join(root, "90-持续生长/体检"));
  assert.equal(inner.written, false);
  assert.match(inner.reason, /体检/);
  assert.equal(cli("index.mjs", join(root, "90-持续生长/体检")).status, 0);
  // 就地建图时按 90 层的实际位置
  const mapped = tmp();
  write(mapped, "我的复盘/去年.md", "去年的复盘");
  runInit(mapped, { date: "2026-10-20", map: { "90-持续生长": "我的复盘" } });
  for (let i = 1; i <= 6; i += 1) write(mapped, `我的复盘/体检/2026-10-${10 + i}-周体检.md`, note(base({ 类型: "体检报告" })));
  assert.ok(!has(checkKnowledgeBase(mapped).warnings, /体检/), checkKnowledgeBase(mapped).warnings.join("\n"));
  for (const d of [root, mapped]) rmSync(d, { recursive: true });
});

test("O9 .obsidian/、.trash/ 里的东西：体检不扫、index 不列、原件清单不记", () => {
  const root = tmp();
  write(root, "客户资料/张总.md", "张总");
  write(root, "客户资料/.trash/旧客户.md", "13812345678");
  write(root, ".trash/旧客户.md", "手机 13812345678，见 [[不存在]]");
  write(root, ".obsidian/workspace.md", "13812345678");
  runInit(root, { date: "2026-10-20", map: { "04-客户": "客户资料" } });
  assert.doesNotMatch(readText(root, MANIFEST_PATH), /trash|obsidian|旧客户/);
  const r = checkKnowledgeBase(root);
  assert.ok(!has([...r.errors, ...r.warnings], /旧客户|workspace|不存在/), [...r.errors, ...r.warnings].join("\n"));
  assert.doesNotMatch(buildIndex(join(root, "客户资料")).table, /旧客户/);
  rmSync(root, { recursive: true });
});

// ───────────── 10/11 复核：来源写成双链、采访原话、Obsidian 写法的认法、--plain、05 层的索引 ─────────────

test("C70b 来源、整理进写成双链：对症提示“写 .md 路径，不写双链”，不再说成“多个来源写成列表”；原件里的整理进只提醒", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "03-生意/庚.md", note(base({ 类型: "产品", 名称: "庚", 来源: "[[99-原始材料/采访记录/2026-10-20-建库采访]]" })));
  write(root, "03-生意/辛.md", "---\n类型: 产品\n名称: 辛\n更新: 2026-10-20\n确认: 待确认\n隐私: 内部\n来源:\n  - 99-原始材料/采访记录/2026-10-20-建库采访.md\n  - \"[[04-客户/老客1|老客1]]\"\n---\n正文\n");
  write(root, "03-生意/壬.md", note(base({ 类型: "产品", 名称: "壬", 来源: "\"[[建库采访]]\"" })));
  write(root, "99-原始材料/聊天与通话/2026-10-01-老客1-微信.md", "---\n类型: 原始材料\n日期: 2026-10-01\n隐私: 私密\n整理进: [[04-客户/老客1]]\n---\n老客1：下周来拿货。\n");
  const { errors, warnings } = checkKnowledgeBase(root);
  assert.ok(errors.includes("来源写从知识库根目录起的 .md 路径，不写双链：03-生意/庚.md（[[99-原始材料/采访记录/2026-10-20-建库采访]] 改成 99-原始材料/采访记录/2026-10-20-建库采访.md）"), errors.join("\n"));
  assert.ok(errors.includes("来源写从知识库根目录起的 .md 路径，不写双链：03-生意/辛.md（[[04-客户/老客1|老客1]] 改成 04-客户/老客1.md）"), errors.join("\n"));
  assert.ok(errors.includes("来源写从知识库根目录起的 .md 路径，不写双链：03-生意/壬.md（[[建库采访]] 改成 建库采访.md 的完整路径）"), errors.join("\n"));
  assert.ok(!has(errors, /多个来源写成列表/), errors.join("\n"));
  assert.ok(warnings.includes("整理进写从知识库根目录起的 .md 路径，不写双链：99-原始材料/聊天与通话/2026-10-01-老客1-微信.md（[[04-客户/老客1]] 改成 04-客户/老客1.md）"), warnings.join("\n"));
  assert.ok(!has(errors, /整理进/), "原件的开头不查，整理进只提醒");
  assert.ok(!has(warnings, /^用了 \[\[双链\]\].*03-生意\/(庚|辛|壬)\.md/), `开头里的双链已经按来源报了，不再说一遍“用了双链”：\n${warnings.join("\n")}`);
  // 整理稿里写了整理进也一样（错误）；老写法照旧报“多个来源”
  write(root, "03-生意/癸.md", note(base({ 类型: "产品", 名称: "癸", 整理进: "[[03-生意/庚]]" })));
  write(root, "03-生意/丙.md", note(base({ 类型: "产品", 名称: "丙", 来源: "[采访, 微信]" })));
  const again = checkKnowledgeBase(root).errors;
  assert.ok(again.includes("整理进写从知识库根目录起的 .md 路径，不写双链：03-生意/癸.md（[[03-生意/庚]] 改成 03-生意/庚.md）"), again.join("\n"));
  assert.ok(again.includes("多个来源写成列表（来源: 下一行起，每行写‘  - 路径’）：03-生意/丙.md"));
  rmSync(root, { recursive: true });
});

test("C02b 采访记录有没有原话：小标题（含“## 第 N 题”）、“已完成：”后有内容、带“原话”的行都算；init 的空骨架、引用块、代码块、注释里的不算", () => {
  const root = tmp();
  runInit(root, { name: "王总", date: "2026-10-20" });
  const path = "99-原始材料/采访记录/2026-10-20-建库采访.md";
  const skeleton = readText(root, path);
  assert.match(skeleton, /原话/, "骨架开头的说明里本来就有“原话”两个字");
  assert.equal(interviewHasContent(skeleton), false, "空骨架不算");
  for (const add of [
    "## 第 1 题｜怎么称呼你\n王总：叫我王总就行。",
    "## 第 1 题\n王总：叫我王总就行。",
    "### 第 1 题\n王总：叫我王总。",
    "原话：叫我王总就行，开了一家小餐馆。",
    "- 原话：叫我王总就行。",
    "- 原话\n  叫我王总就行。",
    "叫我王总就行，开了一家小餐馆（原话）。",
    "**王总原话**：叫我王总就行。",
  ]) assert.equal(interviewHasContent(`${skeleton}${add}\n`), true, add);
  assert.equal(interviewHasContent(skeleton.replace("- 已完成：", "- 已完成：第 1 题")), true);
  for (const add of ["> 原话：引用块里的说明", "```\n原话：代码块里的示例\n```", "<!-- 原话：以后补 -->"]) {
    assert.equal(interviewHasContent(`${skeleton}${add}\n`), false, add);
  }
  // 体检：只有“- 原话：”、没有小标题的采访记录，不再报“采访原话”
  const before = checkKnowledgeBase(root, { stage: "quick" }).summary.missing;
  assert.ok(before.includes("采访原话"), before.join("、"));
  write(root, path, `${skeleton}- 原话：叫我王总就行。\n`);
  const after = checkKnowledgeBase(root, { stage: "quick" }).summary.missing;
  assert.ok(!after.includes("采访原话"), after.join("、"));
  rmSync(root, { recursive: true });
});

test("O10 认 Obsidian 写法只看建库档案的“编辑器”：开头是 Obsidian（不分大小写，后面带括号说明也认）就算；check、index 一个口径", () => {
  for (const v of ["Obsidian", "obsidian", "OBSIDIAN", "Obsidian（手机也用）", "Obsidian (desktop)", "Obsidian 1.6", "“Obsidian”"]) assert.equal(usesObsidian({ 编辑器: v }), true, v);
  for (const v of ["", "Typora", "不用 Obsidian", "ObsidianX", "Notion"]) assert.equal(usesObsidian({ 编辑器: v }), false, v);
  assert.equal(usesObsidian({}), false);
  assert.equal(usesObsidian(null), false);
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const plainProfile = readText(root, PROFILE);
  write(root, "04-客户/甲公司.md", customer("甲公司"));
  write(root, PROFILE, plainProfile.replace("结构: 标准\n", "结构: 标准\n编辑器: Obsidian（手机也用）\n"));
  assert.equal(resolveLayout(root).obsidian, true);
  assert.ok(!has(checkKnowledgeBase(root).warnings, /“编辑器”/), checkKnowledgeBase(root).warnings.join("\n"));
  assert.match(buildIndex(join(root, "04-客户")).table, /\[\[04-客户\/甲公司\]\]/);
  write(root, PROFILE, plainProfile.replace("结构: 标准\n", "结构: 标准\n编辑器: Typora\n"));
  assert.equal(resolveLayout(root).obsidian, false);
  assert.ok(has(checkKnowledgeBase(root).warnings, /“编辑器”.*现在是 Typora/), checkKnowledgeBase(root).warnings.join("\n"));
  assert.match(buildIndex(join(root, "04-客户")).table, /\[甲公司\.md\]\(甲公司\.md\)/);
  // 有 .obsidian/ 但建库档案没写：照普通写法
  write(root, PROFILE, plainProfile);
  write(root, ".obsidian/app.json", "{}");
  assert.equal(resolveLayout(root).obsidian, false);
  assert.match(buildIndex(join(root, "04-客户")).table, /\[甲公司\.md\]\(甲公司\.md\)/);
  rmSync(root, { recursive: true });
});

test("O11 init --plain：根目录有 .obsidian/ 也按普通写法建；和 --obsidian 只能选一个；Obsidian 写法建的库带 --plain 报错、什么都不写", () => {
  const root = tmp();
  write(root, ".obsidian/app.json", "{}");
  const out = runInit(root, { date: "2026-10-20", plain: true });
  assert.equal(editorOf(root), undefined);
  assert.ok(!readText(root, "AGENTS.md").includes("我用 Obsidian"));
  assert.ok(!readText(root, "01-AI协作/README.md").includes("[["));
  assert.ok(!has(out.notes, /\.obsidian/), out.notes.join("\n"));
  assert.deepEqual(checkKnowledgeBase(root).errors, []);
  // 再跑：普通写法的库 + .obsidian/ + --plain，不再提“要改用 Obsidian 写法”
  rmSync(join(root, "04-客户/README.md"));
  const again = runInit(root, { date: "2026-10-21", plain: true });
  assert.deepEqual(again.created, ["04-客户/README.md"]);
  assert.ok(!has(again.notes, /\.obsidian/), again.notes.join("\n"));
  assert.ok(!readText(root, "04-客户/README.md").includes("[["));
  // 命令行
  const viaCli = tmp();
  write(viaCli, ".obsidian/app.json", "{}");
  const run = cli("init.mjs", viaCli, "--plain", "--date", "2026-10-20");
  assert.equal(run.status, 0, run.stderr);
  assert.equal(editorOf(viaCli), undefined);
  assert.match(cli("init.mjs", "--help").stdout, /--plain/);
  // 两个都带：报错，什么都不写
  const both = tmp();
  const r = cli("init.mjs", both, "--plain", "--obsidian");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--obsidian 和 --plain 只能选一个/);
  assert.deepEqual(readdirSync(both), []);
  assert.throws(() => runInit(both, { date: "2026-10-20", obsidian: true, plain: true }), /只能选一个/);
  assert.deepEqual(readdirSync(both), []);
  // Obsidian 写法建的库带 --plain：报错，什么都不写
  const obs = tmp();
  runInit(obs, { date: "2026-10-20", obsidian: true });
  rmSync(join(obs, "04-客户/README.md"));
  const before = hashTree(obs);
  assert.throws(() => runInit(obs, { date: "2026-10-20", plain: true }), /编辑器: Obsidian[\s\S]*--plain[\s\S]*还什么都没写/);
  const viaCliObs = cli("init.mjs", obs, "--plain");
  assert.equal(viaCliObs.status, 1);
  assert.match(viaCliObs.stderr, /还什么都没写/);
  assert.deepEqual(hashTree(obs), before);
  // --plain 不能和 --refresh-originals 一起用
  const refresh = cli("init.mjs", root, "--refresh-originals", "日记", "--plain");
  assert.equal(refresh.status, 1);
  assert.match(refresh.stderr, /多了 --plain/);
  for (const d of [root, viaCli, both, obs]) rmSync(d, { recursive: true });
});

test("index 对 05 层：预览就直接说“05 层用的是方法选择表，请手工维护”，不出标准索引表；--write 一样不写", () => {
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  write(root, "05-方法与判断/报价与接单/判断样本.md", note(base({ 类型: "判断样本", 工作: "报价与接单" }), "## 样本 1｜包场\n- 判断：收定金"));
  const dir = join(root, "05-方法与判断");
  const before = readText(root, "05-方法与判断/README.md");
  const plan = buildIndex(dir);
  assert.deepEqual(plan.rows, []);
  assert.equal(plan.table, "");
  assert.match(plan.reason, /05 层用的是“方法选择表”，请手工维护/);
  const preview = cli("index.mjs", dir);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.stdout, "", "预览不出表");
  assert.match(preview.stderr, /05 层用的是“方法选择表”，请手工维护/);
  const written = cli("index.mjs", dir, "--write");
  assert.equal(written.stdout, "");
  assert.match(written.stderr, /05 层用的是“方法选择表”，请手工维护/);
  assert.equal(readText(root, "05-方法与判断/README.md"), before);
  // 别的没有“## 索引”的 README：预览也不出表
  write(root, "b/README.md", "# b\n## 说明\n");
  write(root, "b/乙.md", note(base({ 类型: "做法", 工作: "报价" })));
  const other = buildIndex(join(root, "b"));
  assert.equal(other.table, "");
  assert.match(other.reason, /没有“## 索引”/);
  assert.doesNotMatch(other.reason, /05 层/);
  rmSync(root, { recursive: true });
});

// ───────────── 公开发布：一份源文件，公开仓库和配套课程两边用 ─────────────

const SKILL_ROOT = join(SCRIPTS, "..");
/** Skill 文件夹里的文本文件（含 tests、fixtures；跳过点开头的和二进制的），键是相对路径 */
function skillTexts() {
  const out = {};
  const visit = (dir) => {
    for (const n of readdirSync(dir)) {
      if (n.startsWith(".")) continue;
      const abs = join(dir, n);
      if (lstatSync(abs).isDirectory()) { visit(abs); continue; }
      const buf = readFileSync(abs);
      if (!buf.includes(0)) out[relative(SKILL_ROOT, abs).split(sep).join("/")] = buf.toString("utf8");
    }
  };
  visit(SKILL_ROOT);
  return out;
}
const GUARD = "公开用语护栏";
/** 本文件里护栏词表那一段不扫（词表本身就是这些词） */
function withoutGuard(text) {
  const a = text.indexOf(`// ${GUARD}：开始`);
  const b = text.indexOf(`// ${GUARD}：结束`);
  return a >= 0 && b > a ? text.slice(0, a) + text.slice(b) : text;
}

// 公开用语护栏：开始（词表只放在这一段，扫这份文件时跳过）
/** 课程用语：公开版里不出现（“学员”“课程”作为老板生意里的东西照常用，不在这里） */
const COURSE_TALK = ["助教", "讲师", "作业", "课程包", "课程示例库", "课程自带", "课程页", "课后", "课上", "课前", "课堂", "开课", "上课",
  "试讲", "试跑", "install-all.mjs", "安装说明.md", "官方核实"];
/** 生意里的讲师（MCN 管着的达人、主播或讲师），不算课程用语 */
const BUSINESS_TALK = ["主播或讲师"];
// 公开用语护栏：结束
// 示例库的客户名和演示要点不在这里列（列出来就等于把示例的答案写进公开仓库），由维护示例库的人另外核对。

test("P1 公开版：Skill 里所有文字（说明、脚本提示、测试）不出现课程用语和本机路径", () => {
  const hits = [];
  for (const [f, raw] of Object.entries(skillTexts())) {
    const text = f === "scripts/tests/scripts.test.mjs" ? withoutGuard(raw) : raw;
    text.split("\n").forEach((line, i) => {
      if (f.startsWith("scripts/tests/") && line.includes("assert.doesNotMatch(")) return; // 断言“不出现”的那一行本来就要写出这个词
      const l = BUSINESS_TALK.reduce((acc, ok) => acc.split(ok).join(""), line);
      const found = COURSE_TALK.filter((w) => l.includes(w));
      // 虚构的写法不算：/Users/<你的用户名>、/Users/...、/Users/…、虚构老板林总的 /Users/lin/、测试里的 /Users/示例
      if (/\/Users\/(?!<|lin\/|示例|\.\.\.|…)/.test(l)) found.push("本机路径");
      if (found.length) hits.push(`${f}:${i + 1} ${found.join("、")}｜${line.trim().slice(0, 50)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test("P2 版本号是公开版的写法：老板知识库/2 2026-10-12；体检结论那一行照旧以它结尾", () => {
  assert.equal(SKILL_VERSION, "老板知识库/2 2026-10-12");
  const root = tmp();
  runInit(root, { date: "2026-10-20" });
  const brief = cli("check.mjs", root, "--stage", "quick", "--brief");
  assert.ok(brief.stdout.trimEnd().split("\n")[0].endsWith("｜老板知识库/2 2026-10-12"), brief.stdout);
  rmSync(root, { recursive: true });
});

test("P3 写到的 references 文件都在：官方说法核对.md 改了名，SKILL.md、references、脚本里引用的 references/*.md 都找得到", () => {
  const missing = [];
  for (const [f, text] of Object.entries(skillTexts())) {
    if (f.startsWith("scripts/tests/")) continue;
    for (const m of text.matchAll(/references\/([^\s`'"“”‘’（）()、，。；：|*<>[\]]+?\.md)/g)) {
      if (!existsSync(join(SKILL_ROOT, "references", m[1]))) missing.push(`${f} → references/${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(readdirSync(join(SKILL_ROOT, "references")).filter((n) => n.startsWith("官方")), ["官方说法核对.md"], "旧名字的那份不留");
});

test("P4 新建的知识库里没有课程用语：标准、Obsidian、就地建图三种 init 写出来的每份文件都查", () => {
  const roots = [tmp(), tmp(), tmp()];
  runInit(roots[0], { name: "王总", shop: "示例小店", date: "2026-10-20" });
  runInit(roots[1], { name: "王总", shop: "示例小店", date: "2026-10-20", obsidian: true });
  write(roots[2], "客户资料/张总.md", "张总");
  runInit(roots[2], { date: "2026-10-20", map: { "04-客户": "客户资料" }, readonly: [], exclude: [] });
  const hits = [];
  for (const root of roots) {
    for (const [f, h] of Object.entries(hashTree(root))) {
      if (!h || f.startsWith(".")) continue;
      const text = readText(root, f);
      for (const w of COURSE_TALK) if (text.includes(w)) hits.push(`${f}：${w}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.match(readText(roots[0], "01-AI协作/README.md"), /（先在对话里理清写法，再让工作台做成模块）/);
  for (const r of roots) rmSync(r, { recursive: true });
});
