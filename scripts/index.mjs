#!/usr/bin/env node
// 给某个文件夹的 README 索引补漏：找出还没写进 README 的文件和子文件夹，生成要追加的表格行。
// 只认链接和恰好等于名字的格子（和体检同一套规则）；没有 README 的子文件夹，把里面的文件一份份补成行。
// 默认只预览；加 --write 才追加到“## 索引”表的最后一行之后。只追加；有了真内容就去掉骨架自带的“（暂时没有）”占位行，别的行不动。
// README 里没有“## 索引”这一节的（05 层用的是“方法选择表”）：预览和 --write 都不出表，只说一句为什么。
// 对知识库根目录不做：根目录用 AGENTS.md 的地图。建库档案里标“原有·不读”的文件夹不做，也不把它们列进上级的索引；
// 标“原有·只读”的文件夹也不做（只读文件夹不放 README，在上级 README 的索引或建库快照里登记）。
// 收件箱、原始材料（就地建图时是对应这两层的文件夹）和它们下面的子文件夹也不做：README 里列子文件夹就够，体检也不查。
// 90 层（实际位置）下的 体检/ 也一样：定期维护的体检报告不进索引，上级 README 也不用列它。
// 建库档案写了“编辑器: Obsidian”的库，补出来的行写双链 [[从库根写起的路径]]（不带 .md、不带别名）。
// 名字像证件、密码的文件和文件夹不提议进索引。用法见 USAGE，或 node index.mjs --help。
import { writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename, relative, dirname } from "node:path";
import { isMainModule, runCli, read, isDir, rel, inFolder, parseFrontmatter, kbReadme, missingFromIndex, splitRow, resolveLayout, MARK_START, RAW_LAYERS,
  checkupFolder, wikiLinkTo } from "./lib.mjs";

export const USAGE = `用法：node index.mjs <文件夹> [--write]
  默认只预览：列出还没进这个文件夹 README 索引的文件和子文件夹
  --write      把这些行追加到“## 索引”表的最后（只追加；有了真内容就去掉“（暂时没有）”占位行，别的行不动）
  -h, --help   显示这段说明
知识库根目录不用这个：根目录用 AGENTS.md 的地图。标“只读”“不读”的文件夹也不用：它们不放 README。
收件箱、原始材料也不用：README 里列子文件夹就够，体检也不查；90 层的 体检/ 也不用。
README 里没有“## 索引”这一节的（05 层用的是“方法选择表”）不补，请手工维护。
补出来的行“一句话”先写（待补），体检会提醒补上。用 Obsidian 的库（建库档案写了“编辑器: Obsidian”），“文件”格写 [[从库根写起的路径]]。`;

const DEFAULT_HEADER = ["名称", "类型", "分组", "一句话", "文件"];
const KNOWN_COLUMNS = new Set(DEFAULT_HEADER);
const TODO = "（待补）";
const ROOT_REASON = "根目录用 AGENTS.md 的地图，不用 README 索引；要补的是各层文件夹里的 README";
const RAW_REASON = "收件箱和原始材料不用补索引：README 里列子文件夹就够，体检也不查";
const CHECKUP_REASON = "体检/ 放的是定期维护的体检报告，像收件箱一样不用补索引，体检也不查";

const cell = (s) => String(s ?? "").replace(/\|/g, "／").replace(/\s+/g, " ").trim();
/** 链接不做百分号编码；有空格或括号时用 <…> 包住路径 */
const href = (p) => (/[\s()]/.test(p) ? `<${p}>` : p);
const str = (v) => (typeof v === "string" ? v : "");

/** 是不是知识库根目录：有带 v2 标记的 AGENTS.md，或有 01-AI协作/建库档案.md（就地建图、老板暂缓追加入口时 AGENTS.md 里没有标记） */
function isKbRoot(dir) {
  const agents = join(dir, "AGENTS.md");
  return (existsSync(agents) && MARK_START.test(read(agents))) || existsSync(join(dir, "01-AI协作", "建库档案.md"));
}

/** README 里没有“## 索引”这一节时说的那一句（预览和 --write 一样）；05 层用的是“方法选择表” */
function noIndexReason(name, isMethods) {
  return `${name} 里没有“## 索引”这一节，没写（${isMethods ? "05 层用的是“方法选择表”，请手工维护" : "要补就先在 README 里加一节“## 索引”，再跑一次"}）`;
}

/** 往上找知识库根目录，找到了返回各层实际在哪、“不读”和“只读”的文件夹、用不用 Obsidian 写法 */
function ownFolders(dir) {
  for (let d = dir; ; d = dirname(d)) {
    if (isKbRoot(d)) {
      const { excluded, readonly, layout, obsidian } = resolveLayout(d);
      return { root: d, excluded, readonly, layout, obsidian };
    }
    if (dirname(d) === d) return { root: null, excluded: [], readonly: [], layout: null, obsidian: false };
  }
}

/** “文件”格的链接：Obsidian 写法写 [[从库根写起的路径]]；普通写法写 [显示名](相对路径) */
function fileLink({ dir, root, obsidian }, path, label) {
  const wiki = obsidian && root !== null ? wikiLinkTo(rel(root, join(dir, path))) : null;
  return wiki || `[${label}](${href(path)})`;
}

/** README 里“## 索引”一节的位置和表（行号从 0 开始；tableEnd 是表的最后一行） */
function findIndex(lines) {
  const start = lines.findIndex((l) => /^##\s*索引/.test(l.trim()));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  const tableStart = lines.findIndex((l, i) => i > start && i < end && l.trim().startsWith("|"));
  let tableEnd = tableStart;
  while (tableStart >= 0 && tableEnd + 1 < end && lines[tableEnd + 1].trim().startsWith("|")) tableEnd += 1;
  return { start, end, tableStart, tableEnd, header: tableStart >= 0 ? splitRow(lines[tableStart]) : null };
}

/** path 相对 dir，可以是“子文件夹/孙文件夹” */
function folderValues(at, path) {
  const readme = kbReadme(join(at.dir, path));
  const holds = readme ? (read(readme).match(/装什么：(.*)/) || [])[1] : "";
  return {
    名称: path, 类型: "文件夹", 一句话: holds || TODO,
    文件: readme ? fileLink(at, `${path}/${basename(readme)}`, `${path}/`) : `${path}/`,
  };
}

/** path 相对 dir，可以是“子文件夹/文件.md”（没有 README 的子文件夹里的文件） */
function fileValues(at, path) {
  const fm = parseFrontmatter(read(join(at.dir, path))) || {};
  const own = Object.fromEntries(Object.entries(fm).filter(([, v]) => typeof v === "string"));
  const folder = path.includes("/") ? path.split("/").slice(0, -1).join("/") : "";
  return {
    ...own,
    名称: str(fm["名称"]) || basename(path, ".md"),
    类型: str(fm["类型"]),
    分组: str(fm["分组"]) || str(fm["业务线"]) || str(fm["工作"]) || folder,
    一句话: str(fm["一句话"]) || TODO,
    文件: fileLink(at, path, path),
  };
}

/** 按表头排出一行：能对上的列填值，对不上的留空；没有“名称”列时第一列放名称 */
function toRow(header, values) {
  const nameCol = header.includes("名称") ? header.indexOf("名称") : KNOWN_COLUMNS.has(header[0]) ? -1 : 0;
  const cells = header.map((h, i) => (i === nameCol ? values["名称"] : values[h] ?? ""));
  return `| ${cells.map(cell).join(" | ")} |`;
}

export function buildIndex(dirArg) {
  const dir = resolve(dirArg);
  if (!isDir(dir)) throw new Error(`文件夹不存在：${dir}`);
  if (isKbRoot(dir)) return { dir, readme: null, header: DEFAULT_HEADER, rows: [], table: "", index: null, root: true, reason: ROOT_REASON };
  const { root, excluded, readonly, layout, obsidian } = ownFolders(dir);
  const checkup = root !== null ? checkupFolder(layout) : null;
  const isCheckup = (abs) => checkup !== null && inFolder(rel(root, abs), checkup);
  const isExcluded = (abs) => root !== null && excluded.some((x) => inFolder(rel(root, abs), x));
  if (isExcluded(dir)) throw new Error(`这是标‘不读’的文件夹：${rel(root, dir)}/。AI 不打开、不列文件名，不给它生成索引`);
  if (root !== null && readonly.some((x) => inFolder(rel(root, dir), x))) {
    throw new Error(`这是标‘只读’的文件夹：${rel(root, dir)}/。只读文件夹不放 README、不往里放任何东西；要用到里面的文件，在对应层 README 的索引里用 ../${rel(root, dir)}/文件名.md 这样的链接登记，或写进建库快照`);
  }
  // 收件箱、原始材料：和体检一个口径（原件层只要求 README 提到子文件夹，下面的子文件夹不查）
  const raw = root !== null ? RAW_LAYERS.some((id) => inFolder(rel(root, dir), layout[id])) : RAW_LAYERS.includes(basename(dir));
  if (raw) return { dir, readme: kbReadme(dir), header: DEFAULT_HEADER, rows: [], table: "", index: null, raw: true, reason: RAW_REASON };
  if (isCheckup(dir)) return { dir, readme: kbReadme(dir), header: DEFAULT_HEADER, rows: [], table: "", index: null, raw: true, reason: CHECKUP_REASON };
  const readme = kbReadme(dir);
  const text = readme ? read(readme) : "";
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const index = readme ? findIndex(lines) : null;
  if (readme && !index) {
    const isMethods = root !== null ? rel(root, dir) === layout["05-方法与判断"] : basename(dir) === "05-方法与判断";
    return { dir, readme, header: DEFAULT_HEADER, rows: [], table: "", index: null, reason: noIndexReason(relative(dir, readme), isMethods) };
  }
  const header = index?.header || DEFAULT_HEADER;
  const at = { dir, root, obsidian };
  const skipDir = (abs) => isExcluded(abs) || isCheckup(abs);
  const rows = missingFromIndex(dir, text, { skipDir }).map((m) => toRow(header, m.dir ? folderValues(at, m.path) : fileValues(at, m.path)));
  const newTable = !index || index.tableStart < 0;
  const table = [...(newTable ? [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`] : []), ...rows].join("\n");
  return { dir, readme, header, rows, table, index };
}

export function writeIndex(dirArg) {
  const plan = buildIndex(dirArg);
  const { dir, readme, rows, table, index } = plan;
  if (plan.reason) return { dir, written: false, rows, table, reason: plan.reason };
  if (!readme) return { dir, written: false, rows, table, reason: "这个文件夹还没有 README.md，先按模板建一个" };
  const name = relative(dir, readme);
  if (!rows.length) return { dir, written: false, rows, table, reason: `${name} 的索引已经齐全，没有要补的` };
  const text = read(readme);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const at = index.tableStart >= 0 ? index.tableEnd + 1 : index.start + 1;
  // 骨架自带的“（暂时没有）”占位行，有了真内容就去掉（只动索引这一节里的这一行）
  const head = lines.slice(0, at).filter((l, i) => !(i > index.start && /^\|\s*（暂时没有）\s*\|/.test(l.trim())));
  const next = [...head, ...table.split("\n"), ...lines.slice(at)].join(eol);
  writeFileSync(readme, next);
  return { dir, written: true, rows, table, reason: `已追加 ${rows.length} 行到 ${name} 的索引` };
}

const CLI_SPEC = { flags: { "--write": "write" } };

if (isMainModule(import.meta.url)) {
  runCli(process.argv.slice(2), CLI_SPEC, USAGE, ({ opts, positional }) => {
    if (!positional.length) {
      console.error(`没给文件夹。\n\n${USAGE}`);
      process.exit(1);
    }
    try {
      const out = opts.write ? writeIndex(positional[0]) : { ...buildIndex(positional[0]), written: false };
      if (out.rows.length) console.log(out.table);
      const reason = out.reason || (out.rows.length ? `只预览：上面 ${out.rows.length} 行还没进 README 的索引；加 --write 追加进去（已有的行不动）` : "README 的索引已经齐全，没有要补的");
      console.error(`\n${reason}`);
    } catch (e) {
      console.error(String(e.message || e));
      process.exit(1);
    }
  });
}
