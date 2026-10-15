// 体检（check.mjs）共用的规则、提示文字和小工具。只读，不改任何文件。
import { readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { LAYER_IDS, TYPES, SKIP_DIRS, CUSTOMER_STAGES, MARK_START, MARK_END,
  rel, read, isDir, inFolder, body, section, tableRows, splitRow, kbReadme, PLACEHOLDER, stripCode, stripInline, unique,
} from "./lib.mjs";

export const CONNECT_ON_STANDARD = "这是标准结构的知识库（建库档案里“结构”不是“就地建图”），接入检查不适用；请用 --stage quick";

// 冒号（或等号）后面紧跟着“不存 / 不放……”才算否定说法；“密码：Sn2026abc（怕自己不记得）”照样报
export const SECRET = /(api[_-]?key|access[_-]?token|secret[_-]?key|password|密码)\s*[:：=]\s*([^\s，,；;。、]+)/gi;
export const SECRET_DENIAL = /^[*_“"'「]*(?:不存|不在这里|不放|不写|不记)/;
export const hasSecret = (line) => [...line.matchAll(SECRET)].some((m) => !SECRET_DENIAL.test(m[2]));
export const PHONE = /(?<![\d*])1[3-9]\d{9}(?!\d)/;
export const ID_CARD = /(?<!\d)\d{17}[\dXx](?!\d)/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const UNKNOWN = ["未知", "未定"];
export const DATE_FIELDS = ["截止", "上次联系", "下次跟进"];
export const DATE_TAIL = "（原因写到正文里，字段里只留这两个字）";
export const TODO = /^- \[[ /x-]\] .+$/;
export const TODO_DUE = /截止(?:日期|时间)?(?:\s*[:：]\s*|\s+|(?=\d))([^\s·|，,；;）)]+)/;
export const OPEN_TODO = /^\s*- \[[ /]\]/;
export const PROFILE_PLACEHOLDER = /（第\s*\d+\s*题后填[^）\n]*）|（还没有）|（待填）/g;
export const PLANNED = /[（(]计划[）)]|计划启用/;
export const SENSITIVE_ORIGINAL = /营业执照|执照|身份证|护照|合同|协议|银行|流水|录音|简历/;
export const BINARY_EXT = new Set([".jpg", ".jpeg", ".png", ".heic", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".m4a", ".mp3", ".wav", ".mp4", ".mov", ".zip"]);
/** 要有“不能说的话”表的：类型画像里有这些词，或启用了内容与作品、作品库（“品牌”“电商”本身不算做内容） */
export const CONTENT_PORTRAIT = /自媒体|创作者|小红书|公众号|抖音|视频号|直播|内容/;
export const CONTENT_MODULE = /内容与作品|作品库/;
export const REMINDERS = ["最后请老板点‘新对话’验收入口，脚本查不了"];
/** 工作台每次都要读的四份：层、文件名、还没有时怎么补、体检结论里的短标签 */
export const MUST_READ = [
  ["02-关于我", "基本情况.md", "问完第 1 题就建（我是谁、做什么、精力放在哪、每天的节奏）", "基本情况"],
  ["01-AI协作", "协作偏好.md", "问完第 10 题就建（怎么跟老板说话、早上想看什么、最怕漏掉什么、哪些能直接做、哪些先问）", "协作偏好"],
  ["03-生意", "生意总览.md", "问完第 3 题就建（卖什么、卖给谁、在哪卖），第 4 题再补交付流程", "生意总览"],
  ["06-项目", "近期要事.md", "问完第 7 题就建（在推进、有截止的事，一行一条）", "近期要事"],
];
export const mustReadPath = (layout, id, name) => `${id === "01-AI协作" ? id : layout[id]}/${name}`;

// ───── 入口没接上（工作台能不能跑也看它） ─────
/** 就地建图、老板原有的 AGENTS.md 还没追加知识库那一段：只报这一条（CLAUDE.md 没有 @AGENTS.md 也算在里面） */
export const ENTRY_DEFERRED = "入口没接上：AGENTS.md 里还没有知识库那一段（老板暂缓追加）。不接上，Codex 和工作台都读不到这张地图；老板同意后，在知识库里再跑一次 init.mjs --update-agents（会按建库档案里的目录对应补上地图）";
/** 标记段已经在、建库档案还写着“入口: 暂缓” */
export const ENTRY_DONE = "入口已经接上了，建库档案里的‘入口: 暂缓’可以删掉";
/** 类型画像、老板最关心下面全是 AI 推断（或老板说以后再说）时，结论行后面加的那一句 */
export const INFERRED_NOTE = "（类型画像、老板最关心还是 AI 推断，请老板确认）";
export const INFERRED_ENTRY = /^[（(]\s*AI\s*推断[，,]\s*待确认\s*[）)]/;
export const LATER_ENTRY = /^未知[（(]老板说以后再说[）)]/;
export const NO_AGENTS = "根目录缺少 AGENTS.md（知识库的入口）";
export const NO_MARK = "AGENTS.md 缺少维护标记 <!-- 老板知识库 v2｜本段由知识库 Skill 维护… -->";
export const NO_END = "AGENTS.md 的知识库标记段后面没有结束标记 <!-- 本段结束 -->：起始标记之后要有这一行";
/** 这几条错误在体检结论里归到“入口”，不算进“其他 N 处错误” */
export const ENTRY_ERRORS = new Set([NO_AGENTS, NO_MARK, NO_END, ENTRY_DEFERRED]);
export const ENTRY_LABEL = "入口";
export const NO_BLOCK = "AGENTS.md 里没有知识库那一段";

/** .md 收进 files，别的文件收进 others；skipDir(相对路径) 为真的文件夹整个不进（“不读”的文件夹） */
export function walk(root, dir, out, skipDir) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (lstatSync(full).isSymbolicLink()) { out.symlinks.push(rel(root, full)); continue; }
    if (isDir(full)) { if (!skipDir(rel(root, full))) { out.dirs.push(full); walk(root, full, out, skipDir); } }
    else if (name.toLowerCase().endsWith(".md")) out.files.push(full);
    else out.others.push(full);
  }
  return out;
}

export const lineCount = (t) => t.replace(/\n$/, "").split("\n").length;
export const lineAt = (t, idx) => t.slice(0, idx).split("\n").length;
export const indexesOf = (t, re) => [...t.matchAll(new RegExp(re.source, "g"))].map((m) => m.index);

/** AGENTS.md 里 Skill 维护的那一段：从第一个开始标记到它后面的结束标记（含） */
export function managedRange(text) {
  const start = text.search(MARK_START);
  if (start < 0) return null;
  const m = text.slice(start).match(MARK_END);
  const end = m ? start + m.index + m[0].length : text.length;
  return { start, end, closed: Boolean(m), text: text.slice(start, end) };
}
// 反引号里的是照写的字（如 `<客户名>-往来记录.md`），不算占位
export const agentsPlaceholders = (text) => stripInline(stripCode(managedRange(text)?.text || "")).match(PLACEHOLDER) || [];
export const profilePlaceholders = (text) => {
  const t = stripCode(body(text));
  return [...(t.match(PLACEHOLDER) || []), ...(t.match(PROFILE_PLACEHOLDER) || [])];
};
export const describePlaceholders = (file, found) => `${file} 还有 ${found.length} 处没填的占位：${unique(found).join("、")}`;

/** 一节里除了占位、标题、列表符号，还有没有真内容 */
export function hasContent(text) {
  if (!text) return false;
  return text.split("\n").some((line) => {
    if (/^#{1,6}\s/.test(line.trim())) return false;
    const t = line.replace(PLACEHOLDER, "").replace(PROFILE_PLACEHOLDER, "").replace(/^\s*(?:\d+[.、]|[-*>])\s*/, "").replace(/[|\s-]/g, "");
    return t.length > 0;
  });
}

export function typeWarning(type, r, layout, growth) {
  const layer = LAYER_IDS.find((id) => inFolder(r, layout[id]));
  const common = layer ? TYPES[layer] : growth.some((g) => inFolder(r, g)) ? TYPES["生长模块"] : null;
  const hint = common ? `。这一层常用：${common.join("、")}` : "";
  return `“类型: ${type}”不在类型清单里，工作台可能认不出：${r}${hint}`;
}

export function checkTodos(text, r, warnings) {
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.startsWith("- [")) continue;
    // 列表里的导航链接不是待办；链接本身由链接检查管
    if (/^- \[(?:[^\]\\]|\\.)+\](?:\(|\[[^\]]*\])/.test(line) || /^- \[\[[^\]]+\]\]/.test(line)) continue;
    if (!TODO.test(line)) warnings.push(`待办格式不对：${r} → ${line}`);
    const due = line.match(TODO_DUE);
    if (due && !DATE.test(due[1]) && !UNKNOWN.includes(due[1])) warnings.push(`待办的截止要写成 2026-10-25（不知道写未定）：${r} → ${line}`);
  }
}

export function checkDates(fm, r, errors) {
  const upd = fm["更新"];
  if (upd !== undefined && !(Array.isArray(upd) && !upd.length) && !(typeof upd === "string" && DATE.test(upd))) {
    errors.push(`“更新”要写成 2026-10-25 这样的日期：${r}（现在是 ${[].concat(upd).join("、")}）`);
  }
  const keys = fm["类型"] === "代表作" ? [...DATE_FIELDS, "日期"] : DATE_FIELDS;
  for (const k of keys) {
    const v = fm[k];
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    if (typeof v === "string" && (DATE.test(v) || UNKNOWN.includes(v))) continue;
    errors.push(`“${k}”要写成 2026-10-25，不知道写未知或未定：${r}（现在是 ${[].concat(v).join("、")}）${DATE_TAIL}`);
  }
}

export const stageWarning = (v, where) => `阶段‘${v}’工作台不认识，导入时会被拒：改成 ${CUSTOMER_STAGES.join(" / ")} 里的一个，或在 01-AI协作/README.md 写一张‘阶段对应’表（| 我的说法 | 工作台的阶段 |）：${where}`;
/** 01-AI协作/README.md 里“阶段对应”表的第一列（我的说法） */
export function stageAliases(root) {
  const readme = kbReadme(join(root, "01-AI协作"));
  return new Set(((readme && tableRows(read(readme), "工作台的阶段")) || []).map((r) => (r[0] || "").replace(/^`(.*)`$/, "$1").trim()).filter(Boolean));
}
export const badStage = (v, aliases) => typeof v === "string" && v && !CUSTOMER_STAGES.includes(v) && v !== "未知" && !aliases.has(v);

/** 找到表头含某个词的表，返回表头和数据行 */
export function tableWithHeader(text, headerIncludes) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith("|") && l.includes(headerIncludes));
  if (i < 0) return null;
  return { header: splitRow(lines[i]), rows: tableRows(lines.slice(i).join("\n"), headerIncludes) || [] };
}
