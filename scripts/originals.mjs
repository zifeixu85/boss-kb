// 原件清单（01-AI协作/原件清单.md）：接入时记下老板原有文件的大小和哈希，体检逐份比对；
// 老板确认是自己改的以后（init.mjs --refresh-originals），重新登记一个文件夹。init.mjs 用，只用 Node 自带模块。
import { existsSync, writeFileSync, readdirSync, lstatSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYER_IDS, SKIP_DIRS, SENSITIVE_NAME, KB_README, README_MARK, MANIFEST, APPEND_ONLY, MARK_START, V1_MARK,
  read, isDir, rel, inFolder, hashFile, parseManifest, resolveLayout } from "./lib.mjs";

/** 系统和软件自己会生成、会变的文件，不算老板的原件 */
const JUNK = /^(thumbs\.db|desktop\.ini|~\$.*)$/i;
const cellPath = (p) => p.replace(/\|/g, "\\|");

/** 读不了的原件直接停下（这时还什么都没写），不悄悄漏记 */
export function hashOriginal(root, full, limit) {
  try {
    return hashFile(full, limit);
  } catch (e) {
    throw new Error(`读不了老板原有的文件：${rel(root, full)}（${e.code || e.message}）。原件清单要逐份记下哈希；请检查权限。在云盘里的：右键知识库文件夹，Mac 选“保持下载”（老系统叫“立即下载”），Windows OneDrive 选“始终保留在此设备上”（菜单名按系统版本可能不同），再重跑。还什么都没写。`);
  }
}

/** 文件夹里一共几份文件（名字像证件、密码的文件夹只数个数；和别处一样跳过点开头的、工作台/ 这类） */
function countFiles(dirAbs) {
  let n = 0;
  for (const name of readdirSync(dirAbs)) {
    if (name.startsWith(".")) continue;
    const full = join(dirAbs, name);
    const st = lstatSync(full);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) n += countFiles(full); }
    else if (st.isFile()) n += 1;
  }
  return n;
}

/** 文件夹下老板原有的文件（递归；不跟软链接，跳过点文件、知识库自己的 README、不读的文件夹；名字像证件、密码的只数个数） */
function walkOriginals(root, dirAbs, out, ctx) {
  for (const name of readdirSync(dirAbs).sort()) {
    if (name.startsWith(".") || JUNK.test(name)) continue;
    const full = join(dirAbs, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name) || ctx.excluded.has(rel(root, full))) continue;
      if (SENSITIVE_NAME.test(name)) ctx.sensitive += countFiles(full);
      else walkOriginals(root, full, out, ctx);
      continue;
    }
    if (!st.isFile()) continue;
    if (name === KB_README || (name === "README.md" && read(full).includes(README_MARK))) continue;
    if (SENSITIVE_NAME.test(name)) { ctx.sensitive += 1; continue; }
    out.set(rel(root, full), { size: st.size, hash: hashOriginal(root, full) });
  }
}

/** 根目录原有的入口文件；AGENTS.md / CLAUDE.md 只记追加之前那段（已有标记段的记标记段之前；只有旧版“知识库规则”段的记到它之前） */
function rootOriginals(root, out) {
  for (const name of ["README.md", ...APPEND_ONLY]) {
    const full = join(root, name);
    if (!existsSync(full) || !lstatSync(full).isFile()) continue;
    if (!APPEND_ONLY.includes(name)) { out.set(name, { size: statSync(full).size, hash: hashOriginal(root, full) }); continue; }
    const text = readFileSync(full, "utf8");
    let at = -1;
    if (name === "AGENTS.md") at = MARK_START.test(text) ? text.search(MARK_START) : text.search(V1_MARK);
    const length = at < 0 ? statSync(full).size : Buffer.byteLength(text.slice(0, at));
    if (length > 0) out.set(name, { size: length, hash: hashOriginal(root, full, length), appendOnly: true });
  }
}

/** 要进原件清单的文件：目录对应里的原有文件夹（收件箱除外：里面的东西整理完本来就要移走）、只读文件夹、根目录原有的入口文件。不读的文件夹不进 */
export function collectOriginals(root, layout, readonly, excluded) {
  const out = new Map();
  const ctx = { excluded: new Set(excluded), sensitive: 0 };
  const folders = [...new Set([...LAYER_IDS.filter((id) => layout[id] !== id && id !== "00-收件箱").map((id) => layout[id]), ...readonly])];
  for (const f of folders) {
    const abs = join(root, f);
    if (isDir(abs) && !lstatSync(abs).isSymbolicLink()) walkOriginals(root, abs, out, ctx);
  }
  rootOriginals(root, out);
  return { rows: [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), sensitive: ctx.sensitive };
}

export const manifestFile = ({ date, rows, sensitive }) => `---
类型: 原件清单
更新: ${date}
确认: 已确认
隐私: 内部
来源: 老板知识库 Skill 接入时自动生成
---

# 原件清单

> 接入时老板原有的文件。体检会逐份比对：改了、少了、改名了都会报出来（接入收尾时算错误，只读文件夹里的只提醒）。这份由 Skill 维护，不要手改；老板说是自己改的，用 init.mjs --refresh-originals <文件夹> 重新登记。

| 文件 | 大小 | SHA-256 |
|---|---|---|
${rows.map(([path, r]) => `| ${cellPath(path)} | ${r.appendOnly ? `原长度 ${r.size}` : r.size} | ${r.hash} |`).join("\n")}${rows.length ? "\n" : ""}${sensitive ? `\n另有 ${sensitive} 份名字像证件、密码的文件没有记录（建议移出知识库）。\n` : ""}`;

// ───── 重新登记（--refresh-originals） ─────
const MANIFEST_ROW = /^\|\s*(.+?)\s*\|\s*([^|]*?)\s*\|\s*([0-9a-fA-F]{64})\s*\|$/;
const REFRESH_LOG = /^- \d{4}-\d{2}-\d{2} 老板确认重新登记：/;
const rowPath = (line) => (line.trim().match(MANIFEST_ROW) || [])[1]?.replace(/\\\|/g, "|") ?? "";
const manifestRow = ({ path, size, hash }) => `| ${cellPath(path)} | ${size} | ${hash} |`;

/**
 * 原件清单的“| 文件 | 大小 | SHA-256 |”表里，drop(路径) 为真的行换成 fresh（全表按路径排），更新“更新:”日期，
 * 末尾追加一行“- 日期 老板确认重新登记：文件夹/”。表外的行原样留着；换行符照旧。
 */
function rewriteManifest(text, { drop, fresh, date, folder }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const sep = lines.findIndex((l, i) => i > 0 && /^\|\s*文件\s*\|/.test(lines[i - 1].trim()) && /^\|[\s:|-]+\|$/.test(l.trim()));
  if (sep < 0) throw new Error(`${MANIFEST} 的表格认不出来（找不到“| 文件 | 大小 | SHA-256 |”表头），没改`);
  let end = sep + 1;
  while (end < lines.length && lines[end].trim().startsWith("|")) end += 1;
  const keep = lines.slice(sep + 1, end).filter((l) => !(MANIFEST_ROW.test(l.trim()) && drop(rowPath(l))));
  const rows = [...keep.map((line) => ({ path: rowPath(line), line })), ...fresh.map((r) => ({ path: r.path, line: manifestRow(r) }))]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((r) => r.line);
  const next = [...lines.slice(0, sep + 1), ...rows, ...lines.slice(end)];
  const fmEnd = next.findIndex((l, i) => i > 0 && l.trim() === "---");
  for (let i = 1; i < fmEnd; i += 1) if (/^更新\s*:/.test(next[i])) next[i] = `更新: ${date}`;
  while (next.length && !next[next.length - 1].trim()) next.pop();
  if (!REFRESH_LOG.test(next[next.length - 1] || "")) next.push("");
  next.push(`- ${date} 老板确认重新登记：${folder}/`, "");
  return next.join(eol);
}

/**
 * 老板说“这些是我自己改的”之后，重新登记原件清单里这个文件夹（只改原件清单这份 Skill 维护的文件）：
 * - 只读文件夹：按现在的样子整份重记（改了的、删了的、新加的都算老板的，AI 不往只读文件夹里写）；
 * - 对应到层的原有文件夹：只重算清单上已有的文件，删了的去掉；新加的不登记（可能是 AI 写的整理稿、往来记录）。
 * 文件夹要是原件清单里已有文件的，或建库档案登记的只读文件夹；“不读”的、不认识的报错。
 */
export function refreshManifest(root, folder, { date, dryRun = false }) {
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) throw new Error(`这个知识库没有原件清单（${MANIFEST}）：只有接入老板原有资料（就地建图）时才有，不用重新登记`);
  const { readonly, excluded } = resolveLayout(root);
  const nfc = (p) => p.normalize("NFC");
  if (excluded.some((x) => inFolder(folder, nfc(x)) || inFolder(nfc(x), folder))) throw new Error(`${folder}/ 是（或包含）标‘不读’的文件夹：不读的文件夹不进原件清单，不用登记`);
  const text = read(manifestPath);
  const under = (p) => nfc(p).startsWith(`${folder}/`);
  const listed = parseManifest(text).filter((r) => under(r.path));
  const ownReadonly = readonly.some((x) => inFolder(folder, nfc(x)));
  if (!listed.length && !ownReadonly) {
    const known = [...new Set(parseManifest(text).map((r) => r.path.split("/")).filter((p) => p.length > 1).map((p) => p[0]))];
    throw new Error(`原件清单里没有 ${folder}/ 下的文件，不认识这个文件夹：只能重新登记原件清单里已有的文件夹${known.length ? `（${known.join("、")}）` : ""}`);
  }
  const abs = join(root, folder);
  if (!isDir(abs) || lstatSync(abs).isSymbolicLink()) throw new Error(`文件夹不存在：${folder}/`);
  let fresh;
  if (ownReadonly) {
    const found = new Map();
    walkOriginals(root, abs, found, { excluded: new Set(excluded), sensitive: 0 });
    fresh = [...found.entries()].map(([path, r]) => ({ path, size: r.size, hash: r.hash }));
  } else {
    fresh = listed.filter((r) => existsSync(join(root, r.path)) && lstatSync(join(root, r.path)).isFile())
      .map((r) => ({ path: r.path, size: statSync(join(root, r.path)).size, hash: hashOriginal(root, join(root, r.path)) }));
  }
  const before = new Map(listed.map((r) => [nfc(r.path), r]));
  const after = new Map(fresh.map((r) => [nfc(r.path), r]));
  const updated = [...after].filter(([p, r]) => before.has(p) && (before.get(p).hash !== r.hash || before.get(p).size !== r.size)).length;
  const removed = [...before.keys()].filter((p) => !after.has(p)).length;
  const added = [...after.keys()].filter((p) => !before.has(p)).length;
  const out = { root, dryRun: Boolean(dryRun), folder: `${folder}/`, updated, removed, added, notes: [] };
  if (!updated && !removed && !added) {
    out.notes.push(`${folder}/ 下的文件和原件清单记的一样，没有要重新登记的，没写`);
    return out;
  }
  const next = rewriteManifest(text, { drop: under, fresh, date, folder });
  if (!dryRun) writeFileSync(manifestPath, next);
  out.notes.push(`${dryRun ? "预览：会" : "已"}重新登记 ${folder}/：改了 ${updated} 份、去掉 ${removed} 份、新登记 ${added} 份${ownReadonly ? "" : "（对应到层的原有文件夹只重算清单上已有的；新加的文件不登记）"}；只改了 ${MANIFEST}`);
  return out;
}
