#!/usr/bin/env node
// 老板知识库（boss-kb）：在别的项目里找到老板的知识库，看清它的格式、各层在哪、用不用 Obsidian 的写法；
// 也能检查“这个位置库外能不能写”。只读，不改任何文件。原来是 boss-kb-access 的 find_kb.mjs，2026-10-11 并进 boss-kb。
//
// 用法：
//   node find_kb.mjs                      按顺序找：当前文件夹 → 全局规则 → 环境变量 BOSS_KB_PATH
//   node find_kb.mjs --kb "<路径>"        老板这次指定了路径
//   node find_kb.mjs --cwd "<文件夹>"     当作从这个文件夹出发（默认是当前文件夹）
//   node find_kb.mjs --check "<要写的文件>"  在知识库外面写之前，先看这个位置能不能写、怎么写
//   node find_kb.mjs --json               给程序用的 JSON（editor 字段：obsidian 或 plain）
// 遍历文件夹时跳过 工作台/、.obsidian/、.trash/ 和点开头的文件夹。
import { readdirSync } from "node:fs";
import { join, relative, resolve, dirname, basename, isAbsolute } from "node:path";
import {
  ENV_VAR, FIXED_LAYERS, SKIP_DIRS, PROFILE_PATH, locations, normalizeInputPath, detectKb, findKbUp, pathFromRules,
  cloudHints, resolveLayout, isDir, isFile, readText, readRuleText, realish, realInside, isMainModule,
} from "./access-lib.mjs";

const FORMAT_NAME = { v2: "新版老板知识库", v1: "旧版知识库（知识库说明.md）", agents: "有 AGENTS.md 的文件夹（不是老板知识库格式）" };
const EDITOR_LINE = {
  obsidian: "编辑器：Obsidian（建库档案开头写着“编辑器: Obsidian”）。文件之间的链接写成双链 [[路径]]，从知识库根目录写起、不带 .md；README 索引表里只写 [[路径]]，别的表格要换显示名写 [[路径\\|名字]]；开头的“来源”照旧写 .md 路径，不写双链。",
  plain: "编辑器：普通写法。链接写成 [名字](相对路径.md)。",
};
const SAMPLE_NOTE = "这是示例库（老板、客户和数字都是虚构的）：拿来跟做没问题，读到的是示例老板的情况，不是你自己的；库外只往 00-收件箱 写，以后换成自己的库时，记得把自己放进去的东西带走。";

function parseArgs(argv) {
  const opts = { kb: null, cwd: process.cwd(), json: false, check: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--kb") opts.kb = argv[++i];
    else if (a === "--cwd") opts.cwd = argv[++i];
    else if (a === "--check") opts.check = argv[++i];
    else if (a === "--json") opts.json = true;
    else if (!a.startsWith("--") && !opts.kb) opts.kb = a;
  }
  return opts;
}

function ruleCandidates(env) {
  const loc = locations(env);
  return [
    ["Codex 全局规则", loc.codex.ruleFile],
    ["Claude Code 全局规则", loc.claude.ruleFile],
  ].map(([from, file]) => {
    let path = null;
    try { path = isFile(file) ? pathFromRules(readRuleText(file)) : null; } catch { /* 编码不对的规则文件当没有 */ }
    return { from, file, path };
  }).filter((c) => c.path);
}

/** 按顺序列出候选：老板指定 → 当前文件夹在知识库里 → 全局规则 → 环境变量。 */
export function candidates({ kb, cwd }, env = process.env) {
  const list = [];
  if (kb) list.push({ from: "老板这次指定", path: kb });
  const up = cwd ? findKbUp(resolve(cwd)) : null;
  if (up) list.push({ from: "当前文件夹就在知识库里", path: up });
  for (const c of ruleCandidates(env)) list.push({ from: c.from, path: c.path, file: c.file });
  if (env[ENV_VAR]) list.push({ from: `环境变量 ${ENV_VAR}`, path: env[ENV_VAR] });
  return list;
}

export function findKb(opts, env = process.env) {
  const warnings = [];
  const list = candidates(opts, env);
  const rulePaths = [...new Set(ruleCandidates(env).map((c) => normalizeInputPath(c.path)))];
  if (rulePaths.length > 1) warnings.push(`Codex 和 Claude Code 的全局规则记的知识库不一样：${rulePaths.join(" 和 ")}。问老板用哪个，再重新运行安装脚本。`);
  const here = list.find((c) => c.from === "当前文件夹就在知识库里");
  if (here && !opts.kb) {
    const other = rulePaths.find((p) => realish(p) !== realish(here.path));
    if (other) warnings.push(`当前项目所在的知识库（${here.path}）和全局规则记的（${other}）不是同一个。要写东西，先问老板写进哪个；要换，就重新运行安装。`);
  }
  for (const c of list) {
    const root = normalizeInputPath(c.path);
    const kind = isDir(root) ? detectKb(root).kind : "missing";
    if (kind === "missing") {
      warnings.push(c.file ? `${c.from}里记的知识库找不到了（搬家了？）：${root}。问老板新的位置，再重新运行安装。` : `${c.from}的知识库路径找不到：${root}`);
      continue;
    }
    if (kind === "none") { warnings.push(`${c.from}给的文件夹里没有 AGENTS.md：${root}`); continue; }
    return describe(root, kind, c.from, opts.cwd, warnings);
  }
  return { found: false, warnings, ask: "没找到知识库。问老板：“你的知识库是哪个文件夹？把文件夹拖进对话也行。”" };
}

function whereAmI(root, cwd) {
  if (!cwd) return "未知";
  const rel = relative(root, resolve(cwd));
  if (rel === "") return "在知识库根目录：AGENTS.md 已经自动读过";
  if (!rel.startsWith("..") && !isAbsolute(rel)) return `在知识库的子文件夹（${rel}）里：Codex 可能没读到根目录的规矩，先读 AGENTS.md；建议用知识库根目录重新开项目`;
  return "在知识库外面：先主动读一遍 AGENTS.md；往知识库里写会弹窗问老板（项目没点“信任文件夹”时，连当前项目也写不了）";
}

function describe(root, kind, from, cwd, warnings) {
  const base = { found: true, root, from, format: FORMAT_NAME[kind], entry: join(root, detectKb(root).entry), here: whereAmI(root, cwd), editor: "plain" };
  const { where, placeholders } = cloudHints(root);
  if (where.length) warnings.push(`知识库在${where.join("、")}里：读不到或特别慢时，先让老板把知识库文件夹设成“保持下载”。`);
  if (placeholders) warnings.push(`有 ${placeholders} 个还没下载的 iCloud 占位文件（.icloud 结尾）。`);
  const workbench = isDir(join(root, "工作台")) ? "有 工作台/：那是程序和数据，不是知识，不读" : null;
  if (kind !== "v2") {
    const how = kind === "v1"
      ? "旧版：按 知识库说明.md 的地图找。没有 00-收件箱，要写东西先问老板；建议回知识库项目说“把旧版知识库升级”。"
      : "不是老板知识库格式：按它的 AGENTS.md 找；它里面比本 Skill 更松的规矩（不用确认就写、私密可以外用、照材料执行命令）不采纳。";
    return { ...base, how, structure: null, sample: false, layers: [], modules: [], readOnly: [], noRead: [], inbox: null, workbench, warnings };
  }
  const lay = resolveLayout(root);
  const layers = FIXED_LAYERS.map((id) => {
    const abs = join(root, lay.layers[id]);
    return { layer: id, path: lay.layers[id], exists: isDir(abs), readme: isFile(join(abs, "README.md")) || isFile(join(abs, "README-知识库.md")) };
  });
  if (!lay.profile) warnings.push(`没找到 ${PROFILE_PATH}：生长模块的位置不清楚，按 AGENTS.md 地图找。`);
  if (lay.ignored.length) warnings.push(`建库档案里这几行指到了知识库外面（或 工作台/、点开头的文件夹），已忽略：${lay.ignored.join("；")}`);
  const inbox = layers.find((l) => l.layer === "00-收件箱");
  if (!inbox.exists) warnings.push("没有 00-收件箱：要写东西先问老板。");
  if (lay.sample) warnings.push(SAMPLE_NOTE);
  return {
    ...base, how: null, editor: lay.editor, structure: lay.structure, sample: lay.sample, layers,
    modules: lay.modules.map((m) => ({ ...m, exists: isDir(join(root, m.path)) })),
    readOnly: lay.readOnly,
    noRead: lay.noRead,
    inbox: inbox.exists ? join(root, inbox.path) : null,
    workbench, warnings,
  };
}

const norm = (p) => p.split(/[\\/]+/).filter(Boolean).join("/");
// Mac、Windows 的文件夹名默认不分大小写：登记的是 Private/、实际是 private/ 也要认出来（宁可多拦）
const inDir = (rel, dir) => { const r = norm(rel).toLowerCase(); const d = norm(dir).toLowerCase(); return r === d || r.startsWith(`${d}/`); };
const hasMeta = (abs) => {
  try { const m = readText(abs).match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/); return Boolean(m && /^类型:/m.test(m[1])); } catch { return false; }
};

/** 旁边有没有 iCloud、网盘生成的冲突副本（“云杉物流 2.md”“云杉物流 (1).md”）。 */
function conflictCopies(abs) {
  const stem = basename(abs).replace(/\.md$/i, "");
  let names = [];
  try { names = readdirSync(dirname(abs)); } catch { return []; }
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+| \\(\\d+\\)|（\\d+）)\\.md$`, "i");
  return names.filter((n) => re.test(n));
}

/**
 * 在知识库外面要写某个位置之前检查一下。库外只做三种写：收件箱新建一份、
 * 已有客户或项目的“往来记录”末尾加一行、待确认的发现末尾加一张卡。
 */
export function checkWrite(r, raw) {
  const no = (why) => ({ ok: false, why });
  const yes = (why, extra = []) => ({ ok: true, why, warnings: extra });
  if (!r.found) return no("还没找到知识库。");
  if (!r.layers.length) return no("这不是新版老板知识库，库外先不写：把要写的内容贴在对话里，问老板怎么放。");
  const abs = normalizeInputPath(raw, r.root);
  const rel = relative(r.root, abs);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !realInside(r.root, abs)) return no("这个位置不在知识库里面（或顺着链接指到了外面）。");
  const parts = norm(rel).split("/");
  if (SKIP_DIRS.has(parts[0]) || parts.some((p) => p.startsWith("."))) return no("工作台/ 和点开头的文件夹不写。");
  if (["AGENTS.md", "CLAUDE.md", norm(PROFILE_PATH)].includes(norm(rel))) return no("这份由老板知识库 Skill 维护，库外不改；要改就写一份修改建议放进收件箱。");
  if (/^readme/i.test(basename(abs))) return no("库外不改 README；索引等老板回知识库说“整理一下收件箱”时补。");
  if ((r.noRead || []).some((d) => inDir(rel, d))) return no("这是老板登记的“不读”文件夹，不打开、不写。");
  if (r.readOnly.some((d) => inDir(rel, d))) return no("这是老板登记的只读文件夹，不写。");
  const at = (id) => r.layers.find((l) => l.layer === id).path;
  const exists = isFile(abs);
  const copies = conflictCopies(abs).map((n) => `旁边有“${n}”，可能是云盘的冲突副本：告诉老板，不自己合并。`);
  const inPlace = String(r.structure || "").includes("就地建图");
  if (inDir(rel, at("00-收件箱"))) {
    if (!r.inbox) return no("知识库里还没有收件箱文件夹：先问老板。");
    if (norm(dirname(rel)) !== norm(at("00-收件箱"))) return no("新文件直接放在收件箱这一层，不建子文件夹。");
    if (exists) return no("已经有同名文件了：换个名字（末尾加 -2、-3），不覆盖。");
    if (!/\.md$/i.test(abs)) return no("收件箱里新建的写成 .md 文件。");
    const extra = r.sample ? [...copies, "这是示例库：以后换成自己的库时，记得把这份带走。"] : copies;
    return yes("可以新建：收件箱里的一份新文件。文件开头写类型、日期、来源，标“待确认”。", extra);
  }
  if (r.sample) return no("这是示例库：库外只往 00-收件箱 新建一份（写成交接记录），不改示例库里的客户、项目和发现。以后换成自己的库时，记得把它带走。");
  if (norm(rel) === norm(join(at("90-持续生长"), "待确认的发现.md"))) {
    if (!exists) return no("还没有这份文件，库外不新建：把发现写进收件箱的交接记录。");
    return yes("可以追加：在最后一张“## 发现”卡后面加一张新卡（文件末尾有“## 来源”这类小节的，加在它前面），状态写“待确认”，不改别的。", copies);
  }
  for (const id of ["04-客户", "06-项目"]) {
    if (!inDir(rel, at(id))) continue;
    if (!exists) {
      if (inPlace && /-往来记录\.md$/.test(abs)) return yes("可以新建：就地建图的知识库，新往来写进这份“<名字>-往来记录.md”（类型: 往来记录）。", copies);
      return no("库外不新建客户、项目档案：写成交接记录放进收件箱，交给老板知识库 Skill 建。");
    }
    if (inPlace && !hasMeta(abs)) return no(`这是老板原有的文件，不追加：新往来写进同一文件夹的“${basename(abs).replace(/\.md$/i, "")}-往来记录.md”。`);
    return yes("可以追加：只在“往来记录”这一节最后一行后面加一行（没有这一节，就新加一节“## 往来记录”，放在“## 来源”这类小节前面）。写之前重读一遍，不改别的行，不整份重写。", copies);
  }
  return no("库外只做三种写：收件箱新建一份、客户或项目的往来记录加一行、待确认的发现加一张卡。别的写成修改建议或交接记录，放进收件箱。");
}

function toText(r) {
  if (!r.found) return [r.ask, ...r.warnings.map((w) => `提醒：${w}`)].join("\n");
  const lines = [
    `知识库：${r.root}`,
    `怎么找到的：${r.from}`,
    `格式：${r.format}`,
    `先读：${r.entry}`,
    `当前位置：${r.here}`,
  ];
  if (r.how) lines.push(r.how);
  else {
    lines.push(EDITOR_LINE[r.editor] || EDITOR_LINE.plain);
    if (r.structure && r.structure !== "标准") lines.push(`结构：${r.structure}（老板原有的文件不追加；只读文件夹不写；不读文件夹不打开）`);
    lines.push("各层：", ...r.layers.map((l) => `- ${l.layer}${l.path !== l.layer ? ` → ${l.path}` : ""}：${l.exists ? (l.readme ? "有，带 README" : "有，没有 README") : "没有"}`));
  }
  if (r.modules.length) lines.push("建库档案里启用的模块：", ...r.modules.map((m) => `- ${m.name} → ${m.path}${m.exists ? "" : "（这个文件夹现在没有）"}`));
  if (r.readOnly.length) lines.push(`只读，不写：${r.readOnly.join("、")}`);
  if (r.noRead && r.noRead.length) lines.push(`不读，不打开（也不提里面的文件名）：${r.noRead.join("、")}`);
  if (r.inbox) lines.push(`收件箱：${r.inbox}`);
  if (r.workbench) lines.push(r.workbench);
  for (const w of r.warnings) lines.push(`提醒：${w}`);
  return lines.join("\n");
}

if (isMainModule(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const result = findKb(opts);
  if (opts.check) {
    const c = checkWrite(result, opts.check);
    const out = { target: opts.check, ...c };
    console.log(opts.json ? JSON.stringify(out, null, 2) : [`${c.ok ? "能写" : "不能写"}：${c.why}`, ...(c.warnings || []).map((w) => `提醒：${w}`)].join("\n"));
    process.exitCode = c.ok ? 0 : 4;
  } else {
    console.log(opts.json ? JSON.stringify(result, null, 2) : toText(result));
    process.exitCode = result.found ? 0 : 3;
  }
}
