// 老板知识库脚本共用的常量和小工具。只用 Node 自带模块。
import { readFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync, openSync, readSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, relative, sep, basename, dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

/** 是不是被直接运行的（通过软链接路径运行也认得出） */
export function isMainModule(metaUrl) {
  try {
    return Boolean(process.argv[1]) && realpathSync.native(process.argv[1]) === realpathSync.native(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export const FORMAT = "老板知识库/2";
/** 这一版 Skill 的说法：体检结论末尾带上，下游按它认版本 */
export const SKILL_VERSION = "老板知识库/2 2026-10-12";
export const MARK_START_TEXT = "<!-- 老板知识库 v2｜本段由知识库 Skill 维护；我自己的补充写在最后 -->";
export const MARK_END_TEXT = "<!-- 本段结束 -->";
export const MARK_START = /<!--\s*老板知识库 v(\d+)/;
export const MARK_END = /<!--\s*本段结束\s*-->/;
/** AGENTS.md 的大小上限（含工作台段和老板自己写的）。Codex 读入口文件默认最多 32 KiB（连全局规则一起算），这里留足余量 */
export const AGENTS_MAX_BYTES = 12 * 1024;
export const OWN_RULES = "## 我加的规矩";
/** 旧版（v1）Skill 在 AGENTS.md 里写的“知识库规则”段 */
export const V1_MARK = /<!--\s*知识库规则\s*开始/;
/** 工作台 Skill 在 AGENTS.md 里维护的一段（只认前缀，以 boss-workbench 现在用的为准） */
export const WORKBENCH_START = /<!--\s*工作台\s*开始/;
export const WORKBENCH_END = /<!--\s*工作台\s*结束/;

// holds / when：README（说明书，第三人称）；mapHolds / mapWhen：AGENTS.md 地图（第一人称、短）；mapHoldsInPlace：就地建图时地图用的说法（没有就用 mapHolds）
export const LAYERS = [
  { id: "00-收件箱", title: "收件箱", holds: "认不出类型或归属的材料，和老板自己丢进来、还没让 AI 处理的东西：聊天导出、通话纪要、语音转写、要沉淀的随手记、老板自己写的需求", notHold: "整理过的结论（写进对应的层）；认得出客户或项目、AI 已经归位的材料（原件在 99-原始材料）；录音、视频原文件（先转成文字稿）；每天的订单和经营数据、随手记的小事（在工作台）", when: "老板说“整理一下”时；每周复盘时", who: "老板、工作台、其他 Skill 丢进来；知识库 Skill 整理", mapHolds: "我丢进来还没整理的、AI 认不出放哪的材料", mapWhen: "我说“整理一下”时；每周复盘时" },
  { id: "01-AI协作", title: "AI 协作", holds: "建库档案、协作偏好、工具与账号（不存密码）、任务手册", notHold: "业务内容（去 03—06）", when: "做不熟的任务前；工作台 Skill 开工时", who: "知识库 Skill 首建；老板改偏好；AI 提议、老板确认", mapHolds: "建库档案、协作偏好、任务手册", mapWhen: "做不熟的任务前；工作台开工前" },
  { id: "02-关于我", title: "关于我", holds: "基本情况、做事与决策方式、说话方式、边界", notHold: "具体某类工作的做法（去 05-方法与判断）", when: "替老板起草、替老板判断时", who: "建库采访；老板确认", mapHolds: "我的基本情况、边界（其他的建了再补）", mapWhen: "替我起草、替我判断时" },
  { id: "03-生意", title: "生意", holds: "生意总览、品牌与口吻、产品与服务、团队与伙伴；多条线时加业务线、合作模式", notHold: "客户档案（去 04）、每天的经营数据（在工作台）", when: "涉及卖什么、价格、交付、谁负责时", who: "建库采访；老板确认", mapHolds: "生意总览、产品与价格、团队与伙伴、品牌与口吻", mapWhen: "涉及卖什么、多少钱、怎么交付、谁负责时" },
  { id: "04-客户", title: "客户", holds: "一客户一份（多了按分组建子文件夹）；跨客户的原话与顾虑", notHold: "订单流水、每天的跟进状态（在工作台）", when: "跟进、回复、做方案、关怀之前", who: "建库采访；整理沟通材料后追加；老板确认", mapHolds: "我的客户，一家一份；跨客户的原话与顾虑", mapWhen: "跟进、回复、做方案、关怀之前" },
  { id: "05-方法与判断", title: "方法与判断", holds: "一类工作一个文件夹（判断样本、判断规则，需要时加做法、话术）；内容很少的可以先一个文件，做法和样本写在一起；老板自己的方法放 我的方法/", notHold: "跨工作通用的“我”（去 02-关于我）", when: "报价、接单、审核、选题这类要判断的事", who: "补访采集；AI 从改稿、复盘里提候选；老板确认", mapHolds: "我各类工作的做法和判断，一类一个文件夹；我自己的方法在 我的方法/", mapHoldsInPlace: "我各类工作的做法和判断，一类一个文件夹", mapWhen: "报价、接单、审核、选题这类要拿主意的事" },
  { id: "06-项目", title: "项目", holds: "一项目一份；近期要事（建库时的待办快照）", notHold: "每天的待办（在工作台）", when: "推进、检查项目时", who: "建库采访；推进中追加决策和进展", mapHolds: "我在推进的项目，一个一份；近期要事", mapWhen: "推进、检查项目时" },
  { id: "90-持续生长", title: "持续生长", holds: "待确认的发现、复盘", notHold: "已确认的规则（去 05）", when: "复盘时；老板问“最近有什么发现”时", who: "AI 提出；老板确认", mapHolds: "AI 的发现、等我确认的问题、复盘", mapWhen: "复盘时；我问“最近有什么发现”时" },
  { id: "99-原始材料", title: "原始材料", holds: "原样存着的原始材料（原件）：采访记录、聊天与通话、导入的资料包、改稿前后两版、处理完的交接记录和修改建议", notHold: "整理稿", when: "只在核对原话和数字时", who: "只放不改", mapHolds: "原样存着的采访、聊天、通话和导入的资料", mapWhen: "只在核对原话和数字时" },
];
export const LAYER_IDS = LAYERS.map((l) => l.id);
export const RAW_LAYERS = ["00-收件箱", "99-原始材料"];
export const CONFIRM = ["待确认", "已确认", "已过期"];
export const PRIVACY = ["私密", "内部", "可公开"];
export const PROJECT_STATUS = ["进行中", "等待", "暂停", "完成"];
export const REQUIRED = ["类型", "更新", "确认", "隐私", "来源"];

/** “类型”字段的合法值，按层分组（文档和检查共用） */
export const TYPES = {
  "01-AI协作": ["建库档案", "协作偏好", "工具与账号", "任务手册", "原件清单", "定时任务", "变更记录"],
  "02-关于我": ["关于我", "边界", "说话方式", "对外人设", "观点与故事"],
  "03-生意": ["生意", "品牌", "业务线", "合作模式", "产品", "团队"],
  "04-客户": ["客户", "客户分组", "客户原话", "往来记录"],
  "05-方法与判断": ["做法", "判断样本", "判断规则", "话术", "方法"],
  "06-项目": ["项目", "待办"],
  生长模块: ["渠道", "数据口径", "经营复盘", "账号定位", "作品索引", "代表作", "规律", "达人", "案例", "门店", "专业知识", "供应商", "资料"],
  "90-持续生长": ["发现清单", "复盘", "体检报告"],
  原件: ["原始材料", "采访记录", "资料地图"],
};
export const TYPE_NAMES = new Set(Object.values(TYPES).flat());

export const TYPE_FIELDS = {
  客户: ["名称", "分组", "阶段", "联系人", "上次联系", "下次跟进"],
  客户分组: ["名称"],
  往来记录: ["名称"],
  项目: ["名称", "状态", "截止", "负责人"],
  产品: ["名称"],
  做法: ["工作"], 判断样本: ["工作"], 判断规则: ["工作"], 话术: ["工作"],
  方法: ["名称", "适用"],
  代表作: ["编号", "日期", "平台", "形式"],
  渠道: ["名称", "负责人"],
  建库档案: ["格式", "建库方式"],
};
/** 可以写、不强制的字段（01-AI协作/README.md 的字段表按 TYPE_FIELDS + 这张表生成；和 references/结构与规矩.md 的字段表逐行一致） */
export const OPTIONAL_FIELDS = {
  客户: ["业务线"],
  项目: ["业务线"],
  产品: ["价格", "复核"],
  做法: ["范围"], 判断样本: ["范围"], 判断规则: ["范围"], 话术: ["范围"],
  建库档案: ["结构", "编辑器", "示例", "演示日期"],
  规律: ["范围"],
};
/** 哪种类型都可以加的字段 */
export const COMMON_OPTIONAL = ["业务线", "范围", "复核", "一句话"];

/** 客户“阶段”的取值。和工作台模板 shared/schema.ts 的 CLIENT_STAGES 一致，改了两边一起改 */
export const CUSTOMER_STAGES = ["新线索", "需求确认", "方案中", "报价中", "待签约", "交付中", "售后", "待复购", "合作中", "维护中", "暂停", "流失"];
export const SKIP_DIRS = new Set(["工作台", "node_modules", ".git", ".obsidian", ".trash"]);

// ───── Obsidian 模式：建库档案开头写了“编辑器: Obsidian”的库，文件之间的链接用双链 ─────
export const EDITOR_FIELD = "编辑器";
export const OBSIDIAN = "Obsidian";
/**
 * “编辑器”的值算不算 Obsidian：开头是 Obsidian（不分大小写）就算，后面带括号说明也认（如“Obsidian（手机也用）”）；
 * 紧跟字母数字的（ObsidianX）不算。check、index、maintain、init 和 find_kb（access-lib.mjs）都用这一个判断。
 */
export const isObsidianEditor = (value) => /^["'“]?obsidian(?![a-z0-9])/i.test(String(value ?? "").trim());
/** 建库档案开头的“编辑器”是不是 Obsidian；没有这一行就是普通写法。只看建库档案，不看有没有 .obsidian/ 文件夹 */
export const usesObsidian = (fm) => isObsidianEditor((fm || {})[EDITOR_FIELD]);

// ───── 定期维护的体检报告：放在 90 层（实际位置）下的 体检/，像收件箱一样不要求进索引 ─────
export const CHECKUP_DIR = "体检";
/** 体检报告所在的文件夹（相对知识库根目录）；layout 是 resolveLayout 返回的 layout */
export const checkupFolder = (layout) => `${(layout || {})["90-持续生长"] || "90-持续生长"}/${CHECKUP_DIR}`;

/** 知识库自己的 README 标记：层 README 的标题里有这几个字 */
export const README_MARK = "这一层的说明";
export const KB_README = "README-知识库.md";
export const READONLY_LABEL = "原有·只读";
/** 老板说“别看”的文件夹：AI 不打开、不搜、不列文件名 */
export const EXCLUDE_LABEL = "原有·不读";
/** 名字像密码、验证码、密钥的文件和文件夹：不记文件名，也不提议进索引 */
export const SENSITIVE_NAME = /密码|验证码|密钥|私钥|secret|credentials/i;
export const isSensitivePath = (r) => r.split("/").some((seg) => SENSITIVE_NAME.test(seg));

export const rel = (root, p) => relative(root, p).split(sep).join("/");
export const read = (p) => readFileSync(p, "utf8");
export const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
export const isReadme = (name) => name === "README.md" || name === KB_README;

/** 解析开头的“键: 值”元信息；支持“来源:”下一行起的“  - 路径”列表。没有元信息返回 null。 */
export function parseFrontmatter(text) {
  const t = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 4);
  if (end < 0) return null;
  const fields = {};
  let lastKey = null;
  for (const line of t.slice(4, end).split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && lastKey) {
      fields[lastKey] = [].concat(fields[lastKey] || [], item[1].trim());
      continue;
    }
    const m = line.match(/^([^\s:#][^:]*):\s*(.*)$/);
    if (m) {
      lastKey = m[1].trim();
      const v = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      fields[lastKey] = v === "" ? [] : v;
    }
  }
  return fields;
}

/** 正文（去掉元信息） */
export function body(text) {
  const t = text.replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return t;
  const end = t.indexOf("\n---", 4);
  return end < 0 ? t : t.slice(end + 4).replace(/^\n+/, "");
}

/** 二级标题（## 开头，标题文字以 heading 开头）下面的内容，到下一个二级标题为止；没有这一节返回 null */
export function section(text, heading) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.replace(/^##\s+/, "").trim().startsWith(heading));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

/**
 * 拆一行表格：只按没转义、也不在 [[…]] 里面的 | 切。\| 还原成 |（[[路径\|显示名]] 得到 [[路径|显示名]]）；
 * 找不到 ]] 的 [[ 照普通字处理。没有 \| 和 [[ 的老写法，切出来和以前完全一样。
 */
export function splitRow(line) {
  const s = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const cells = [];
  let cur = "";
  for (let k = 0; k < s.length; k += 1) {
    if (s[k] === "\\" && s[k + 1] === "|") { cur += "|"; k += 1; continue; }
    if (s[k] === "[" && s[k + 1] === "[") {
      const close = s.indexOf("]]", k + 2);
      if (close > 0 && !s.slice(k + 2, close).includes("[[")) { cur += s.slice(k, close + 2).replace(/\\\|/g, "|"); k = close + 1; continue; }
    }
    if (s[k] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

/** 找到表头含某个词的 Markdown 表，返回数据行（每行是单元格数组） */
export function tableRows(text, headerIncludes) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith("|") && l.includes(headerIncludes));
  if (i < 0) return null;
  const rows = [];
  for (const line of lines.slice(i + 2)) {
    if (!line.trim().startsWith("|")) break;
    rows.push(splitRow(line));
  }
  return rows;
}

/** 正文里的相对链接（不含网址和锚点）；认得 [x](<带 空格.md>) 这种写法 */
export function linksIn(text) {
  const out = [];
  for (const m of text.matchAll(/\]\((?:<([^<>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\)/g)) {
    const href = (m[1] ?? m[2]).split("#")[0];
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    try { out.push(decodeURI(href)); } catch { out.push(href); }
  }
  return out;
}

export const stripPath = (cell) => cell.replace(/[`\[\]]/g, "").replace(/\s*[（(][^（()）]*[）)]\s*$/, "").trim().replace(/\/$/, "").trim();

/**
 * 知识库在这个文件夹里用哪份 README：
 * README.md 是我们生成的（含“这一层的说明”）就用它；否则有 README-知识库.md 用那份；都没有返回 null。
 */
export function kbReadme(dir) {
  const own = join(dir, "README.md");
  const kb = join(dir, KB_README);
  if (existsSync(own) && read(own).includes(README_MARK)) return own;
  if (existsSync(kb)) return kb;
  return existsSync(own) ? own : null;
}

/** README 里所有表格的格子（去掉分隔行；包在反引号里的去掉反引号） */
function tableCells(text) {
  const cells = new Set();
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim().startsWith("|") || /^\|[\s:|-]+\|?$/.test(line.trim())) continue;
    for (const c of splitRow(line)) if (c) cells.add(c.replace(/^`(.*)`$/, "$1").trim().normalize("NFC"));
  }
  return cells;
}

// ───── 双链 [[目标]]、[[目标|别名]]、[[目标\|别名]]（表格里）、[[目标#小标题]]、![[附件]] ─────
const WIKI = /!?\[\[([^[\]\n]+?)\]\]/g;
/** 双链方括号里的那段 → 目标：去掉别名、表格里转义用的 \、# 后面的小标题 */
const wikiTarget = (inner) => inner.split("|")[0].replace(/\\+$/, "").split("#")[0].trim().normalize("NFC");
/** 所有双链的目标（含代码里的；README 收录判断用） */
const wikiTargets = (text) => [...text.matchAll(WIKI)].map((m) => wikiTarget(m[1])).filter(Boolean);
const noMd = (p) => p.replace(/\.md$/i, "");
const slash = (p) => p.split(sep).join("/");

/** 正文里双链的目标（不看代码块和行内代码；只链到本文件小标题的 [[#…]] 不算） */
export function wikiLinksIn(text) {
  return wikiTargets(stripInline(stripCode(text.replace(/\r\n/g, "\n"))));
}

/** 全库文件按文件名（不分大小写）分组，给只写了文件名的双链找文件用。paths 是相对库根、用 / 分隔的路径 */
export function wikiNameIndex(paths) {
  const byName = new Map();
  for (const p of paths) {
    const key = p.split("/").pop().normalize("NFC").toLowerCase();
    byName.set(key, [...(byName.get(key) || []), p]);
  }
  return byName;
}

/**
 * 双链目标在库里对应哪些文件（相对库根、用 / 分隔）。没有扩展名的补 .md。
 * - 带 / 的：从库根找（./、../ 开头的从 fromDir 找），找不到再从 fromDir 找，再按路径结尾在 files 里找（只写了后半截路径）；
 * - 只写文件名的：按 Obsidian 的“最短路径”，在 byName（wikiNameIndex 建的）里找同名文件。
 * 返回空数组是没找到；多于一份是同名的不止一份，要提醒写成从库根起的路径。
 */
export function resolveWikiLink(target, { root, fromDir = root, byName = new Map(), files = [] } = {}) {
  const t = String(target).replace(/\\/g, "/").normalize("NFC");
  if (!t) return [];
  if (!t.includes("/")) {
    const key = t.toLowerCase();
    return unique([...(byName.get(key) || []), ...(byName.get(`${key}.md`) || [])]);
  }
  const fileAt = (base, p) => {
    for (const c of [p, `${p}.md`]) {
      const abs = resolve(base, c);
      const r = relative(root, abs);
      if (r && !r.startsWith("..") && !isAbsolute(r) && existsSync(abs) && statSync(abs).isFile()) return slash(r).normalize("NFC");
    }
    return null;
  };
  const p = t.replace(/^\/+/, "");
  const hit = /^\.\.?\//.test(p) ? fileAt(fromDir, p) : fileAt(root, p) || fileAt(fromDir, p);
  if (hit) return [hit];
  const tail = p.replace(/^(?:\.\.?\/)+/, "").toLowerCase();
  return files.filter((f) => {
    const q = f.normalize("NFC").toLowerCase();
    return q.endsWith(`/${tail}`) || q.endsWith(`/${tail}.md`);
  });
}

/** 写索引用的双链 [[从库根写起的路径，不带 .md]]；路径里有双链放不下的字符（[ ] # ^ |）返回 null，那就用普通链接 */
export function wikiLinkTo(relPath) {
  const p = noMd(slash(relPath));
  return /[[\]#^|]/.test(p) ? null : `[[${p}]]`;
}

/**
 * README 里有没有收录某个文件或子文件夹（name 相对 README 所在文件夹，可以是“子文件夹/文件.md”）：
 * 只认两种——有链接指向它（相对链接解析后是同一个文件；文件夹是链接到它里面的任何文件），
 * 或者某个表格格子恰好等于它的名字（文件含不含 .md 都行；文件夹含不含结尾的 / 都行）。正文里出现过这个词不算。
 */
export function mentionedIn(readmeText, readmeDir, name, { dir = false } = {}) {
  const n = name.normalize("NFC").replace(/\/+$/, "");
  const target = join(readmeDir, n).normalize("NFC");
  for (const href of linksIn(readmeText)) {
    const p = join(readmeDir, href).normalize("NFC");
    if (p === target || (dir && p.startsWith(target + sep))) return true;
  }
  // 双链：相对这个文件夹写的、只写文件名的，或从库根（更上层）写起的 [[04-客户/张总]]——按路径结尾对
  const T = noMd(slash(target));
  const endsAt = (p) => T === p || T.endsWith(`/${p}`);
  for (const w of wikiTargets(readmeText)) {
    if (dir) {
      if (w === n || w.startsWith(`${n}/`)) return true;
      const segs = noMd(w).split("/");
      for (let k = 1; k <= segs.length; k += 1) if (endsAt(segs.slice(0, k).join("/"))) return true;
    } else if (noMd(w) === noMd(n) || (!w.includes("/") && noMd(w) === noMd(basename(n))) || (w.includes("/") && endsAt(noMd(w)))) return true;
  }
  const cells = tableCells(readmeText);
  return dir ? cells.has(n) || cells.has(`${n}/`) : cells.has(n) || cells.has(noMd(n));
}

/**
 * 一个有 README 的文件夹里，README 还没收录的东西（路径相对这个文件夹）：
 * - 直接放着的 .md 文件；
 * - 有 README 的子文件夹（提到文件夹就行）；
 * - 没有 README 的子文件夹：里面的每份 .md 都要被链接到（一层层往下，直到遇到有 README 的文件夹）；里面没有 .md 的，提到文件夹就行。
 * files: false 时（原件层）只要求提到子文件夹。skipFile(绝对路径) 为真的文件不要求；folderOnly(绝对路径) 为真的子文件夹只要求提到文件夹。
 * 不跟软链接，跳过点开头的和 工作台/ 这类不归知识库管的文件夹，以及名字像密码、验证码、密钥的文件和文件夹；skipDir(绝对路径) 为真的文件夹整个跳过。
 */
export function missingFromIndex(dir, readmeText, { files = true, skipFile = () => false, folderOnly = () => false, skipDir = () => false } = {}) {
  const out = [];
  // 名字像密码、验证码、密钥的不提议进索引（不把这种文件名写进 README）
  const list = (abs) => readdirSync(abs).filter((n) => !n.startsWith(".") && !SENSITIVE_NAME.test(n)).sort((a, b) => a.localeCompare(b, "zh"));
  const isLink = (abs) => lstatSync(abs).isSymbolicLink();
  const isNote = (n) => n.toLowerCase().endsWith(".md") && !isReadme(n);
  const need = (abs, path) => !skipFile(abs) && !mentionedIn(readmeText, dir, path) && out.push({ path, dir: false });
  const needDir = (path) => !mentionedIn(readmeText, dir, path, { dir: true }) && out.push({ path, dir: true });
  const visitDir = (abs, path) => {
    if (!files || kbReadme(abs) || folderOnly(abs)) return needDir(path);
    let any = false;
    for (const n of list(abs)) {
      const child = join(abs, n);
      if (isLink(child)) continue;
      if (isDir(child)) { if (!SKIP_DIRS.has(n) && !skipDir(child)) { any = true; visitDir(child, `${path}/${n}`); } }
      else if (isNote(n)) { any = true; need(child, `${path}/${n}`); }
    }
    if (!any) needDir(path);
  };
  for (const n of list(dir)) {
    const abs = join(dir, n);
    if (isLink(abs)) continue;
    if (isDir(abs)) { if (!SKIP_DIRS.has(n) && !skipDir(abs)) visitDir(abs, n); }
    else if (files && isNote(n)) need(abs, n);
  }
  return out;
}

/**
 * 读建库档案，得到每个固定层实际在哪：标准结构就是同名文件夹；
 * “就地建图”时按“目录对应”表（层 | 实际位置 | 说明）。表里“层”写“原有·只读”的是只读文件夹（说明以“不读”开头的另记进 noread），
 * 写“原有·不读”的是 AI 不打开的文件夹（excluded，不算原件、不进原件清单）。开头“示例: 是”的是示例库。
 */
export function resolveLayout(root) {
  // 建库档案永远在 01-AI协作/（就地建图时 01 也是新建的，不和老板原有文件夹对应）
  const profilePath = join(root, "01-AI协作", "建库档案.md");
  const layout = Object.fromEntries(LAYER_IDS.map((id) => [id, id]));
  const readonly = [];
  const noread = [];
  const excluded = [];
  let structure = "标准";
  let profile = null;
  if (existsSync(profilePath)) {
    const text = read(profilePath);
    profile = { path: profilePath, text, fm: parseFrontmatter(text) || {} };
    if (typeof profile.fm["结构"] === "string") structure = profile.fm["结构"];
    for (const r of tableRows(text, "实际位置") || []) {
      const layer = stripPath(r[0] || "");
      const where = stripPath(r[1] || "");
      if (!where) continue;
      if (layer === READONLY_LABEL) {
        readonly.push(where);
        if (/^\s*不读/.test(r[2] || "")) noread.push(where);
      } else if (layer === EXCLUDE_LABEL) excluded.push(where);
      else if (LAYER_IDS.includes(layer) && layer !== "01-AI协作") layout[layer] = where;
    }
  }
  // 老板原有的文件夹：对应到某一层但名字不是标准层名的，加上只读文件夹（不读的不算：AI 不打开）
  const originals = [...new Set([...LAYER_IDS.filter((id) => layout[id] !== id).map((id) => layout[id]), ...readonly])];
  const sample = Boolean(profile) && profile.fm["示例"] === "是";
  // 建库档案开头写了“编辑器: Obsidian”：文件之间的链接用双链
  const obsidian = Boolean(profile) && usesObsidian(profile.fm);
  return { layout, structure, profile, readonly, noread, excluded, originals, sample, obsidian };
}

export function listDirs(dir) {
  return readdirSync(dir).filter((n) => !n.startsWith(".") && !SKIP_DIRS.has(n) && isDir(join(dir, n)));
}

/** 路径 r（用 / 分隔）在不在文件夹 folder 里（含 folder 本身） */
export const inFolder = (r, folder) => r === folder || r.startsWith(`${folder}/`);

// ───── 原件清单：接入时记下老板原有文件的大小和哈希，体检逐份比对 ─────
export const MANIFEST = "01-AI协作/原件清单.md";
/** 这两份老板原有的入口文件允许在末尾追加，只比对“原长度”之前的部分 */
export const APPEND_ONLY = ["AGENTS.md", "CLAUDE.md"];

/** 文件的 SHA-256；给了 limit 只算前 limit 个字节。按块读，大文件也不占内存 */
export function hashFile(path, limit = Infinity) {
  const hash = createHash("sha256");
  const buf = Buffer.alloc(1 << 20);
  const fd = openSync(path, "r");
  try {
    let left = limit;
    while (left > 0) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, left), null);
      if (!n) break;
      hash.update(buf.subarray(0, n));
      left -= n;
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

/** 读原件清单的表：{ path, size, appendOnly }；文件名里的 | 写成 \| */
export function parseManifest(text) {
  const rows = [];
  for (const line of body(text).split("\n")) {
    const m = line.trim().match(/^\|\s*(.+?)\s*\|\s*([^|]*?)\s*\|\s*([0-9a-fA-F]{64})\s*\|$/);
    if (!m) continue;
    const path = m[1].replace(/\\\|/g, "|");
    const size = (m[2].match(/\d+/) || [])[0];
    rows.push({ path, size: size === undefined ? null : Number(size), hash: m[3].toLowerCase(), appendOnly: APPEND_ONLY.includes(path) || /原长度/.test(m[2]) });
  }
  return rows;
}

// ───── 命令行：参数白名单 ─────
export class UsageError extends Error {}

/**
 * 按白名单解析命令行。flags：开关（如 --dry-run → dryRun）；values：要跟值的（--name 王总 或 --name=王总）。
 * 有 --help / -h 就只返回 help。不认识的 -x、开关带值、缺值、多出来的路径都抛 UsageError。
 */
export function parseCli(argv, { flags = {}, values = {}, maxPositional = 1 } = {}) {
  if (argv.some((a) => a === "--help" || a === "-h")) return { help: true, opts: {}, positional: [] };
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("-")) { positional.push(a); continue; }
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const key = eq > 0 ? a.slice(0, eq) : a;
    if (key in flags) {
      if (eq > 0) throw new UsageError(`${key} 是开关，后面不用跟值：${a}`);
      opts[flags[key]] = true;
    } else if (key in values) {
      let v = eq > 0 ? a.slice(eq + 1) : argv[i + 1];
      if (eq < 0) {
        if (v === undefined || v.startsWith("-")) throw new UsageError(`${key} 后面要跟一个值`);
        i += 1;
      }
      if (!String(v).trim()) throw new UsageError(`${key} 后面要跟一个值`);
      opts[values[key]] = v;
    } else {
      throw new UsageError(`不认识的参数：${a}`);
    }
  }
  if (positional.length > maxPositional) {
    throw new UsageError(`只能给一个路径，多出来：${positional.slice(maxPositional).join(" ")}（路径里有空格要用引号括起来）`);
  }
  return { help: false, opts, positional };
}

/** 命令行入口的共同收尾：--help 打印用法退出 0；参数不对打印原因和用法退出 1 */
export function runCli(argv, spec, usage, main) {
  let parsed;
  try {
    parsed = parseCli(argv, spec);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n\n${usage}`);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(usage);
    process.exit(0);
  }
  return main(parsed);
}

// ───── 表格、银行卡号（体检用） ─────
const TABLE_SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;
/** 按每个 | 切格子，不认转义：查错列用（按列取值用 splitRow，它和工作台的 kb_scan 一样认 \| 和 [[…]]） */
const rawCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");

/**
 * 正文里的 Markdown 表（跳过代码块）：表头行后面紧跟分隔行才算表。
 * 返回 { heading（所在的二级标题）, headerLine（从 1 数的行号）, header, rows: [{ line, cells, cols, raw }] }。
 * cells 按每个 | 切（查错列用）；cols 用 splitRow 切（认 \| 和 [[…]]，按列取值用）。
 */
export function markdownTables(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let fence = false;
  let heading = "";
  for (let i = 0; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^##\s/.test(t)) { heading = t.replace(/^##\s+/, "").trim(); continue; }
    if (!t.startsWith("|") || i + 1 >= lines.length || !TABLE_SEPARATOR.test(lines[i + 1].trim())) continue;
    const table = { heading, headerLine: i + 1, header: rawCells(t), rows: [] };
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith("|"); j += 1) table.rows.push({ line: j + 1, cells: rawCells(lines[j]), cols: splitRow(lines[j]), raw: lines[j].trim() });
    out.push(table);
    i = j - 1;
  }
  return out;
}

/** 银行卡号的校验位（Luhn） */
export function luhnOk(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

const CARD_PLAIN = /(?<!\d)\d{13,19}(?!\d)/g;
const CARD_GROUPED = /(?<![\d-])\d{4}(?:[ -]\d{4}){2,3}(?:[ -]\d{1,4})?(?![\d])/g;
const CARD_CONTEXT = /卡号|银行|账户|账号|开户|对公/;
/**
 * 一行里像不像银行卡号：13—19 位数字（连写，或每 4 位一个空格、短横），过 Luhn 校验。
 * 同一行有“卡号、银行、账户、账号、开户、对公”或按 4 位分组写的，是 "strong"；
 * 只是 16—19 位、3—6 开头又过了校验的，是 "weak"（订单号也常是这么长）。连写的 18 位按身份证号报，这里不重复。
 */
export function bankCardSignal(line) {
  const hits = [];
  for (const m of line.matchAll(CARD_PLAIN)) if (m[0].length !== 18) hits.push({ digits: m[0], grouped: false });
  for (const m of line.matchAll(CARD_GROUPED)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19) hits.push({ digits, grouped: true });
  }
  const context = CARD_CONTEXT.test(line);
  let weak = false;
  for (const h of hits) {
    if (!luhnOk(h.digits)) continue;
    if (context || h.grouped) return "strong";
    if (h.digits.length >= 16 && /^[3-6]/.test(h.digits)) weak = true;
  }
  return weak ? "weak" : null;
}

// ───── 云盘 ─────
/** 照抄 boss-workbench/scripts/kb_scan.mjs 的 CLOUD_RE（以 kb_scan 为准，改了两边一起改） */
export const CLOUD_RE = /Mobile Documents|CloudStorage|iCloud ?Drive|Dropbox|OneDrive|Google ?Drive|坚果云|Nutstore|百度网盘|BaiduNetdisk|BaiduSyncdisk|WPS ?云盘|WPSDrive|阿里云盘|夸克网盘/i;
export const CLOUD_KEEP_NOTE = "知识库在云盘同步的位置：右键知识库文件夹，Mac 选“保持下载”（老系统叫“立即下载”），Windows OneDrive 选“始终保留在此设备上”（菜单名按系统版本可能不同）。";

const readFinderDefault = (key) => execFileSync("defaults", ["read", "com.apple.finder", key], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * 知识库在不在云盘同步的位置（和 kb_scan 的 cloud_synced / cloud_maybe / cloud_note 同一套判断）：
 * 路径里能看出是云盘的算同步；Mac 上在 ~/Desktop、~/Documents 下的，读访达的 iCloud“桌面与文稿”设置，读不到算说不准。
 */
export function cloudStatus(absRoot, { platform = process.platform, home = homedir(), readDefault = readFinderDefault } = {}) {
  const p = String(absRoot).replace(/\\/g, "/");
  if (CLOUD_RE.test(p)) return { synced: true, maybe: false, note: "知识库在云盘同步的文件夹里" };
  if (platform !== "darwin") return { synced: false, maybe: false, note: "" };
  const h = String(home).replace(/\\/g, "/").replace(/\/+$/, "");
  for (const [folder, key, label] of [["Desktop", "FXICloudDriveDesktop", "桌面"], ["Documents", "FXICloudDriveDocuments", "文稿"]]) {
    const base = `${h}/${folder}`;
    if (p !== base && !p.startsWith(`${base}/`)) continue;
    try {
      return String(readDefault(key)).trim() === "1"
        ? { synced: true, maybe: false, note: `这台 Mac 开了 iCloud“${label}”同步，知识库在同步目录里` }
        : { synced: false, maybe: false, note: "" };
    } catch {
      return { synced: false, maybe: true, note: `知识库在“${label}”文件夹里，读不到 iCloud 设置；如果开了“桌面与文稿”同步，就当在云盘里` };
    }
  }
  return { synced: false, maybe: false, note: "" };
}

// ───── 上级目录的规则文件（init 和体检共用） ─────
/** 放在上级目录里会被 AI 工具一起读进来的规则文件，和让 Codex 把上级当项目根的 .git */
export const PARENT_RULE_FILES = ["AGENTS.md", "CLAUDE.md", ".claude/CLAUDE.md", ".git"];

/**
 * 从知识库根目录往上找（不含根目录本身），哪几级有 PARENT_RULE_FILES 里的东西，近的在前：[{ dir, names }]。
 * 在用户主目录下的，找到主目录为止，主目录本身不算（~/.claude/CLAUDE.md 是全局设置，挪知识库也躲不开）；不在主目录下的，找到磁盘根。
 * Mac、Windows 的路径不分大小写。
 */
export function parentRuleFiles(absRoot, { home = homedir(), platform = process.platform } = {}) {
  const fold = platform === "darwin" || platform === "win32" ? (p) => p.toLowerCase() : (p) => p;
  const root = resolve(absRoot);
  const h = resolve(home);
  const up = relative(fold(h), fold(root));
  if (up === "") return [];
  const underHome = !up.startsWith("..") && !isAbsolute(up);
  const out = [];
  for (let d = dirname(root); ; d = dirname(d)) {
    if (underHome && fold(d) === fold(h)) break;
    const names = PARENT_RULE_FILES.filter((n) => existsSync(join(d, n)));
    if (names.length) out.push({ dir: d, names });
    if (dirname(d) === d) break;
  }
  return out;
}

/** 上级目录有规则文件时的提醒（没有返回 null）：说最近的那一级，再往上的括在后面 */
export function parentRulesWarning(absRoot, opts) {
  const [first, ...more] = parentRuleFiles(absRoot, opts);
  if (!first) return null;
  const further = more.length ? `（再往上 ${more.map((f) => `${f.dir} 也有 ${f.names.join("、")}`).join("；")}）` : "";
  return `知识库放在了 ${first.dir} 里面，那里有 ${first.names.join("、")}${further}：Claude Code 会把上级的规则一起读进来，Codex 会把上级当项目根。建议把知识库挪到一个干净的地方（比如 ~/老板知识库）`;
}

// ───── 体检用的纯函数（check.mjs 用） ─────
// <称呼> 这类占位；不算 HTML 注释和标签、<https://…>、链接里的 <带 空格.md>
export const PLACEHOLDER = /(?<!\]\()<(?![a-zA-Z/!])[^<>\n]{1,30}>/g;
export const stripCode = (t) => t.replace(/```[\s\S]*?```/g, "");
export const stripInline = (t) => t.replace(/`[^`\n]*`/g, "");
export const unique = (list) => [...new Set(list)];


/** 开头元信息里写路径的字段：从知识库根目录起写 .md 路径，不写双链 */
export const PATH_FIELDS = ["来源", "整理进"];
const FILE_EXT = /\.(md|png|jpe?g|gif|svg|webp|heic|pdf|mp3|m4a|wav|mp4|mov|webm|canvas|base|csv|xlsx?|docx?|pptx?)$/i;

/**
 * 开头元信息的“来源”“整理进”（fields）写成了双链 [[…]]：每个字段报一条，带上怎么改。
 * 只写了文件名的双链（没有 /），提醒写成完整路径。
 */
export function wikiInPathFields(fm, r, fields = PATH_FIELDS) {
  const out = [];
  for (const k of fields) {
    const links = [].concat((fm || {})[k] ?? []).flatMap((v) => [...String(v).matchAll(/!?\[\[([^[\]\n]+?)\]\]/g)]);
    if (!links.length) continue;
    const fixes = unique(links.map((m) => {
      const t = wikiTarget(m[1]);
      const file = FILE_EXT.test(t) ? t : `${t}.md`;
      return `${m[0].replace(/^!/, "")} 改成 ${t.includes("/") ? file : `${file} 的完整路径`}`;
    }));
    out.push(`${k}写从知识库根目录起的 .md 路径，不写双链：${r}（${fixes.slice(0, 3).join("；")}${fixes.length > 3 ? "……" : ""}）`);
  }
  return out;
}

/** 开头元信息的写法（C70）：返回要报的，以及要不要省掉“缺少字段”“缺少元信息” */
export function frontmatterFormat(text, fm, r) {
  const errors = [];
  const warnings = [];
  const t = text.replace(/^﻿/, "");
  const lines = t.split("\n");
  let colon = false;
  const leading = lines[0].trim() !== "---" && lines.slice(1, 5).some((l) => l.trim() === "---");
  if (leading) errors.push(`文件第 1 行要是 ---（前面不能有空行或别的字）：${r}`);
  const end = t.startsWith("---\n") ? t.indexOf("\n---", 4) : -1;
  if (end > 0) {
    const head = t.slice(4, end);
    if (Buffer.byteLength(head) > 2048) warnings.push(`开头元信息超过 2 KB：${r}（工作台只读文件开头，太长会读不全；长内容写进正文）`);
    for (const line of head.split("\n")) {
      if (!line.trim() || /^\s+-\s/.test(line) || line.trim().startsWith("#")) continue;
      const cn = line.indexOf("：");
      const en = line.indexOf(":");
      if (cn >= 0 && (en < 0 || cn < en)) { errors.push(`开头元信息要用英文冒号：${r} → ${line.trim()}`); colon = true; }
    }
  }
  for (const [k, v] of Object.entries(fm || {})) {
    if (k !== "来源" && Array.isArray(v) && v.length) errors.push(`只有‘来源’能写成多行列表：${r} 的 ${k}`);
  }
  // 来源、整理进写成双链：说对症的那一句，不再当成“多个来源”
  const wiki = wikiInPathFields(fm, r);
  errors.push(...wiki);
  const src = fm?.["来源"];
  const wikiSrc = wiki.some((m) => m.startsWith("来源"));
  if (!wikiSrc && typeof src === "string" && (src.startsWith("[") || ((src.match(/\.md/g) || []).length >= 2 && /[、,，]/.test(src)))) {
    errors.push(`多个来源写成列表（来源: 下一行起，每行写‘  - 路径’）：${r}`);
  }
  return { errors, warnings, colon, leading };
}

/** 整理稿里留下的模板占位和空段落（C21 a、b）；代码块算内容 */
export function shellWarnings(text, r) {
  const out = [];
  const b = body(text);
  const ph = stripInline(stripCode(b)).match(PLACEHOLDER) || [];
  if (ph.length) out.push(`${r} 还有没填的模板占位：${unique(ph).join("、")}；没内容的段落删掉，不留空壳`);
  let fence = false;
  let current = null;
  const flush = () => { if (current && !current.content) out.push(`${r} 的“${current.heading}”是空的：删掉，或补上内容`); };
  for (const line of b.split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; if (current) current.content = true; continue; }
    if (!fence && /^##\s/.test(t)) { flush(); current = { heading: t.replace(/^##\s+/, ""), content: false }; continue; }
    if (current && t && (fence || !/^#{3,6}\s/.test(t))) current.content = true;
  }
  flush();
  return out;
}

/** 已确认的文件里还等老板点头的行：行内带“（待确认…）”“（AI 推断，待确认）”这类括注的（加了引号的是在讲规矩，不算），加上“AI 的看法”小标题下的条目 */
export function pendingLines(text) {
  let n = 0;
  let fence = false;
  let view = false;
  for (const line of body(text).split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^#{1,6}\s/.test(t)) { view = /^#{2,6}\s*AI 的看法/.test(t); continue; }
    const inline = /(?<![“‘"'`「])[（(](?:待确认[^（）()\n]*|[^（）()\n]*[，,、]\s*待确认)[）)]/.test(line);
    if (inline || (view && /^\s*(?:[-*+]|\d+[.、])\s+\S/.test(line))) n += 1;
  }
  return n;
}


/** 00—99 开头的路径（到空白、箭头、标点、括号为止） */
const KB_PATH = /(?<![0-9A-Za-z/._-])\d{2}-[^\s→|（(，、）)“”「」；;：:,<>`*]+/g;
const trimPath = (p) => p.split("#")[0].replace(/[。．.，,；;：:、）)】」”’]+$/, "");

/**
 * AGENTS.md 标记段正文里提到的、00—99 开头且带 / 的知识库内路径（如 02-关于我/说话方式.md、05-方法与判断/报价/）。
 * 不看代码块和“## 文件开头”一节（那里是格式示例）；路径后面紧跟 < 的是占位（如 05-方法与判断/<一类工作>/），跳过；带 … 的也跳过。
 */
export function blockPaths(block) {
  const out = [];
  let fence = false;
  let example = false;
  for (const line of block.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^#{1,6}\s/.test(t)) { example = /^#{1,6}\s*文件开头/.test(t); continue; }
    if (example) continue;
    for (const m of line.matchAll(KB_PATH)) {
      if (line[m.index + m[0].length] === "<") continue;
      const p = trimPath(m[0]);
      if (p.includes("/") && !/…|\.\.\./.test(p)) out.push(p);
    }
  }
  return unique(out);
}

/** 常见任务表（表头第一格是“要做的事”）第二列里 00—99 开头的路径 */
export function routePaths(block) {
  const out = [];
  for (const t of markdownTables(block)) {
    if ((t.header[0] || "").trim() !== "要做的事") continue;
    for (const row of t.rows) {
      const cell = row.cells[1] || "";
      if (cell.includes("<")) continue;
      for (const m of cell.matchAll(/(?<![0-9A-Za-z/._-])\d{2}-[^\s→|（(，、）)“”「」；;：:,<>]+/g)) out.push(m[0].replace(/[。．.，,；;：:、）)】」”’]+$/, ""));
    }
  }
  return out;
}
