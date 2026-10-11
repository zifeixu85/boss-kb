#!/usr/bin/env node
// 老板知识库定期维护（默认只读）：按冗余、问题、过期、积压、体量、结构信号六类找信号，stdout 出 JSON，stderr 打一行结论。
// 带 --write 时只在 <90 层实际位置>/体检/ 新建一份维护报告（同名加 -2、-3，绝不覆盖），别的文件一个都不改；示例库不写。
// 脚本只找信号、出报告；访谈和改结构由 AI 按 references/维护.md 做。体检结果用子进程跑 check.mjs --stage quick 读它的 JSON，
// 一条条分成“我可以直接改的”（纯格式）和“要你确认的”（见 maintain-check.mjs）。
// 所有位置按建库档案的“目录对应”换算；跳过 工作台/、隐藏文件夹、node_modules；“原有·不读”的不进去，“原有·只读”的只计数、不读内容。
import { existsSync, readdirSync, lstatSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, resolve, basename, extname, relative, isAbsolute } from "node:path";
import { runCheck, checkItems } from "./maintain-check.mjs";
import { isMainModule, runCli, LAYER_IDS, RAW_LAYERS, SKIP_DIRS, MANIFEST, APPEND_ONLY,
  rel, read, isDir, isReadme, inFolder, isSensitivePath, parseFrontmatter, body, section, tableRows, linksIn, stripPath,
  resolveLayout, listDirs, kbReadme, parseManifest, markdownTables, unique,
} from "./lib.mjs";

export const USAGE = `用法：node maintain.mjs <知识库根目录> [--write] [--date 2026-10-27] [--stale-days 90] [--inbox-days 14]
  --write            把结果写成一份新报告：<持续生长那一层>/体检/<日期>-维护报告.md（同名加 -2、-3，不覆盖），别的文件一个都不改；示例库不写
  --date 2026-10-27  按这一天算“多少天没动”（默认：建库档案写了演示日期就用它，否则用今天）
  --stale-days 90    整理稿多少天没更新算“很久没更新”（默认 90）
  --inbox-days 14    收件箱的材料放了多少天算积压（默认 14）
  -h, --help         显示这段说明
带值的参数也可以写成 --date=2026-10-27。默认只读：stdout 是 JSON，stderr 打一行结论（维护体检：冗余 N · 问题 N · 过期 N · 积压 N · 体量 N · 结构建议 N）。
脚本只找信号、出报告；访谈和改结构由 AI 按 references/维护.md 做。
退出码：0 跑完了（有信号也是 0），1 参数不对、不像知识库、示例库要写报告、报告写不进去，2 文件夹不存在。`;

/** 各项阈值（references/维护.md 照这里写） */
export const LIMITS = { staleDays: 90, inboxDays: 14, plannedDays: 30, bigLines: 300, trailMax: 20, folderMax: 30, agentsWarnBytes: 10 * 1024, paragraphMin: 40, top: 5, reportList: 30 };
export const CATEGORIES = [
  { key: "redundancy", label: "冗余", intro: "同一样东西写了两份以上：改了一处忘了另一处，AI 读到两个说法就不知道信哪个。" },
  { key: "problems", label: "问题", intro: "格式不对、链接断了、隐私标得不对、混进了敏感信息、还缺内容：AI 和工作台会读错、读不到，或者用了不该用的。格式问题我能直接改，别的要你点头。" },
  { key: "stale", label: "过期", intro: "很久没更新、标了已过期、到了复核时间：可能已经不对了。" },
  { key: "backlog", label: "积压", intro: "放着还没处理的：收件箱的材料、等你点头的文件和发现。" },
  { key: "size", label: "体量", intro: "文件或文件夹太大：AI 读起来费劲，按规矩该提议拆分。" },
  { key: "structure", label: "结构建议", intro: "空着的文件夹、计划了很久还没建的模块、地图里没写的文件夹。" },
];
export const REPORT_DIR = "体检";
export const SAMPLE_REFUSED = "这是示例库，只读体检，不写报告";
const NOT_KB = "这里不像老板知识库：根目录没有 AGENTS.md，也没有 01-AI协作/建库档案.md。确认路径对不对";
const NUMBERS = ["一", "二", "三", "四", "五", "六"];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_IN = /\d{4}-\d{2}-\d{2}/;
const TEMPLATE_DIR = /^(模板|templates?)$/i;
const FENCE = /^\s*(```|~~~)/;
/** 名称、别名会撞的类型（往来记录挂在客户名下、复盘按日期，不算） */
const ENTITY_TYPES = new Set(["客户", "客户分组", "项目", "产品", "达人", "渠道", "门店", "供应商", "案例", "方法", "业务线", "合作模式", "专业知识"]);
/** 记下当时情况、本来就不随时间更新的类型：不按“更新”算过期 */
const SNAPSHOT_TYPES = new Set(["任务手册", "原件清单", "变更记录", "复盘", "经营复盘", "代表作", "往来记录", "发现清单", "体检报告"]);
const GENERIC_NAMES = new Set(["档案", "往来记录", "总览", "index"]);
const PLANNED = /[（(]计划[）)]|计划启用/;
const DONE_STATUS = /^(已采纳|采纳|不采纳)/;
const KNOWN_EXT = /\.(md|png|jpe?g|gif|svg|webp|heic|pdf|mp3|m4a|wav|mp4|mov|webm|canvas|base|csv|xlsx?|docx?|pptx?)$/i;

// ───── 日期 ─────
const pad = (n) => String(n).padStart(2, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function isDate(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const dayNumber = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const daysSince = (from, today) => Math.max(0, dayNumber(today) - dayNumber(from));

const nfc = (s) => String(s).normalize("NFC");
const str = (v) => (typeof v === "string" ? v.trim() : "");
const item = (kind, paths, why, suggest, confirm, extra = {}) => ({ kind, where: paths.join("、"), paths, why, suggest, confirm, ...extra });

// ───── 扫一遍知识库 ─────
/** 列出文件和文件夹：不跟软链接，跳过隐藏的和 SKIP_DIRS；不读的文件夹整个不进去；只读的标上 readonly（只计数） */
function walk(root, { readonly, excluded }) {
  const out = { files: [], dirs: [] };
  const visit = (abs, ro) => {
    for (const name of readdirSync(abs).sort((a, b) => a.localeCompare(b, "zh"))) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      const full = join(abs, name);
      if (lstatSync(full).isSymbolicLink()) continue;
      const r = nfc(rel(root, full));
      if (excluded.some((x) => inFolder(r, x))) continue;
      const inRo = ro || readonly.find((x) => inFolder(r, x)) || null;
      if (statSync(full).isDirectory()) {
        out.dirs.push({ abs: full, r, readonly: inRo });
        visit(full, inRo);
      } else out.files.push({ abs: full, r, readonly: inRo, md: name.toLowerCase().endsWith(".md") });
    }
  };
  visit(root, null);
  return out;
}

/** 读一份 .md，标出它是什么：整理稿（note）、README、原件（raw）、老板原有的文件（original）、模板 */
function loadDoc(f, ctx) {
  const text = read(f.abs).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const parsed = parseFrontmatter(text);
  const fm = parsed || {};
  const readme = isReadme(basename(f.r));
  const top = f.r === "AGENTS.md" || f.r === "CLAUDE.md";
  const raw = ctx.rawRoots.some((x) => inFolder(f.r, x));
  const template = f.r.split("/").some((seg) => TEMPLATE_DIR.test(seg));
  const original = !APPEND_ONLY.includes(f.r)
    && (ctx.onManifest.has(f.r) || (ctx.originals.some((x) => inFolder(f.r, x)) && fm["类型"] === undefined));
  const note = Boolean(parsed) && !readme && !top && !raw && !template && !original;
  return { ...f, text, fm, hasFm: Boolean(parsed), readme, top, raw, template, original, note, type: str(fm["类型"]) };
}

function loadContext(root, opts) {
  const lay = resolveLayout(root);
  const { structure, profile, readonly, excluded, originals, sample, obsidian } = lay;
  const layout = Object.fromEntries(Object.entries(lay.layout).map(([id, where]) => [id, nfc(where)]));
  const demo = profile && isDate(profile.fm["演示日期"]) ? profile.fm["演示日期"] : null;
  const date = opts.date || demo || localDate(new Date());
  const reportDir = `${layout["90-持续生长"]}/${REPORT_DIR}`;
  const tree = walk(root, { readonly: readonly.map(nfc), excluded: excluded.map(nfc) });
  const manifestPath = join(root, MANIFEST);
  const manifest = existsSync(manifestPath) ? parseManifest(read(manifestPath)) : [];
  const ctx = {
    root, layout, structure, profile, sample, date, opts,
    dateSource: opts.date ? "参数" : demo ? "演示日期" : "今天",
    readonly: readonly.map(nfc), excluded: excluded.map(nfc), originals: originals.map(nfc), reportDir,
    rawRoots: RAW_LAYERS.map((id) => layout[id]), onManifest: new Set(manifest.map((m) => nfc(m.path))),
    // Obsidian 写法只看建库档案的“编辑器”（和 check、index 一样），不看有没有 .obsidian/
    tree, obsidian,
  };
  // 体检报告自己、名字像证件密码的不读内容
  ctx.docs = tree.files.filter((f) => f.md && !f.readonly && !inFolder(f.r, reportDir) && !isSensitivePath(f.r)).map((f) => loadDoc(f, ctx));
  ctx.notes = ctx.docs.filter((d) => d.note);
  ctx.byPath = new Map(ctx.docs.map((d) => [d.r, d]));
  ctx.lowerPaths = new Set([...tree.files, ...tree.dirs].map((f) => f.r.toLowerCase()));
  ctx.byName = new Map();
  for (const f of tree.files) {
    const key = basename(f.r).toLowerCase();
    ctx.byName.set(key, [...(ctx.byName.get(key) || []), f.r]);
  }
  ctx.agentsText = existsSync(join(root, "AGENTS.md")) ? read(join(root, "AGENTS.md")).replace(/\r\n/g, "\n") : "";
  return ctx;
}

// ───── 链接 ─────
/** 正文里的行（跳过代码块，去掉行内代码），带行号 */
function contentLines(text) {
  const out = [];
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (FENCE.test(line)) { fence = !fence; return; }
    if (!fence) out.push({ line: line.replace(/`[^`\n]*`/g, ""), no: i + 1 });
  });
  return out;
}

/** 一行里的双链：[[路径]]、[[路径|别名]]、表格里的 [[路径\|别名]]、[[路径#标题]]、![[图]] */
const wikiLinks = (line) => [...line.matchAll(/!?\[\[([^\]\n]+?)\]\]/g)].map((m) => m[1].split(/\\?\|/)[0].split("#")[0].replace(/\\$/, "").trim()).filter(Boolean);

const toPosix = (p) => p.replace(/\\/g, "/");
/** 路径在不在知识库里、在不在不读的文件夹里（不在库里返回 null） */
function insideKb(ctx, abs) {
  const r = relative(ctx.root, abs);
  if (r.startsWith("..") || isAbsolute(r)) return null;
  return nfc(toPosix(r));
}
const knownPath = (ctx, r) => r === "" || ctx.lowerPaths.has(r.toLowerCase());
const inExcluded = (ctx, r) => ctx.excluded.some((x) => inFolder(r, x));

/** 双链找不找得到：带 / 的从库根找（找不到再按相对路径、按结尾匹配）；只有文件名的按全库同名文件找。返回 true / false / null（不查） */
function wikiResolves(ctx, doc, target) {
  const withExt = KNOWN_EXT.test(target) ? target : `${target}.md`;
  if (!withExt.includes("/")) return (ctx.byName.get(basename(withExt).toLowerCase()) || []).length > 0;
  const fromRoot = insideKb(ctx, resolve(ctx.root, withExt.replace(/^\/+/, "")));
  if (fromRoot !== null && inExcluded(ctx, fromRoot)) return null;
  if (fromRoot !== null && knownPath(ctx, fromRoot)) return true;
  const fromHere = insideKb(ctx, resolve(dirname(doc.abs), withExt));
  if (fromHere !== null && knownPath(ctx, fromHere)) return true;
  const tail = `/${withExt.replace(/^(\.\.?\/)+/, "").toLowerCase()}`;
  return [...ctx.lowerPaths].some((p) => p.endsWith(tail));
}

/** Markdown 链接找不找得到：相对这份文件找；Obsidian 库再从库根找一次 */
function mdResolves(ctx, doc, href) {
  const abs = resolve(dirname(doc.abs), href);
  const r = insideKb(ctx, abs);
  if (r !== null && inExcluded(ctx, r)) return null;
  if (existsSync(abs)) return true;
  return ctx.obsidian && existsSync(resolve(ctx.root, href.replace(/^\/+/, "")));
}

/** 一份文件里所有找不到的链接：{ link, no, wiki }。原件里的双链多半是从别的笔记软件贴来的，不查 */
function brokenLinksIn(ctx, doc) {
  const out = [];
  for (const { line, no } of contentLines(doc.text)) {
    if (!doc.raw) for (const target of wikiLinks(line)) if (wikiResolves(ctx, doc, nfc(target)) === false) out.push({ link: target, no, wiki: true });
    for (const href of linksIn(line.replace(/!?\[\[[^\]\n]*\]\]/g, ""))) if (mdResolves(ctx, doc, href) === false) out.push({ link: href, no, wiki: false });
  }
  return out;
}

/** 文件里的链接指向哪些库内文件（相对路径，去掉找不到的） */
function linkTargets(ctx, doc, text) {
  const out = [];
  for (const { line } of contentLines(text)) {
    for (const href of linksIn(line)) {
      const r = insideKb(ctx, resolve(dirname(doc.abs), href));
      if (r !== null && ctx.byPath.has(r)) out.push(r);
    }
    for (const t of wikiLinks(line)) {
      const withExt = KNOWN_EXT.test(t) ? t : `${t}.md`;
      const hits = withExt.includes("/") ? [nfc(withExt.replace(/^\/+/, ""))] : ctx.byName.get(basename(withExt).toLowerCase()) || [];
      out.push(...hits.filter((r) => ctx.byPath.has(r)));
    }
  }
  return unique(out);
}

// ───── 1. 冗余 ─────
const nameKey = (s) => nfc(s).normalize("NFKC").toLowerCase().replace(/\s+/g, "");
function namesOf(doc) {
  const fileName = basename(doc.r, extname(doc.r));
  const main = str(doc.fm["名称"]) || (GENERIC_NAMES.has(fileName) ? basename(dirname(doc.r)) : fileName);
  const aliases = ["别名", "aliases", "alias"].flatMap((k) => [].concat(doc.fm[k] || []))
    .flatMap((v) => String(v).replace(/^\[|\]$/g, "").split(/[、,，;；|/]/));
  return unique([main, ...aliases].map((s) => s.replace(/^["'“”]|["'“”]$/g, "").trim()).filter(Boolean));
}

function duplicateNames(ctx) {
  const byKey = new Map();
  for (const doc of ctx.notes) {
    if (!ENTITY_TYPES.has(doc.type)) continue;
    for (const name of namesOf(doc)) {
      const key = `${doc.type}\u0000${nameKey(name)}`;
      if (!byKey.has(key)) byKey.set(key, { type: doc.type, name, files: new Set() });
      byKey.get(key).files.add(doc.r);
    }
  }
  const seen = new Set();
  const out = [];
  for (const g of byKey.values()) {
    const files = [...g.files].sort();
    const id = `${g.type}\u0000${files.join("\n")}`;
    if (files.length < 2 || seen.has(id)) continue;
    seen.add(id);
    out.push(item("同名档案", files, `“${g.type}”里有 ${files.length} 份档案都叫“${g.name}”（名称或别名一样）`,
      "先看是不是同一个：是的话合成一份，另一份只留一句话加链接（合并、删除都等你点头）；不是就把名字区分开，比如写全称、加城市", true));
  }
  return out;
}

/** 客户档案被哪些分组收了：所在的分组文件夹、分组文件夹 README 的索引、“客户分组”档案、客户层 README 表格里的“分组”列 */
function doubleGrouped(ctx) {
  const layer = ctx.layout["04-客户"];
  const customers = new Set(ctx.notes.filter((d) => d.type === "客户" && inFolder(d.r, layer)).map((d) => d.r));
  // 拆成文件夹的客户（某客户/档案.md）：那个文件夹是这位客户自己的，不是分组
  const ownDirs = new Set([...customers].filter((r) => GENERIC_NAMES.has(basename(r, ".md"))).map((r) => dirname(r)));
  const groupOf = (r) => {
    const dir = ownDirs.has(dirname(r)) ? dirname(dirname(r)) : dirname(r);
    return dir !== layer && inFolder(dir, layer) ? dir.slice(layer.length + 1).split("/")[0] : null;
  };
  const holders = new Map([...customers].map((r) => [r, new Map()]));
  const add = (r, group, via) => { if (holders.has(r) && group && !holders.get(r).has(group)) holders.get(r).set(group, via); };
  for (const r of customers) add(r, groupOf(r), "放在这个分组的文件夹里");
  for (const doc of ctx.docs.filter((d) => d.readme && inFolder(d.r, layer) && dirname(d.r) !== layer)) {
    const index = section(doc.text, "索引") ?? doc.text;
    for (const r of linkTargets(ctx, doc, index)) add(r, groupOf(doc.r), `${doc.r} 的索引收了它`);
  }
  for (const doc of ctx.notes.filter((d) => d.type === "客户分组")) {
    for (const r of linkTargets(ctx, doc, body(doc.text))) add(r, str(doc.fm["名称"]) || basename(doc.r, ".md"), `${doc.r}（客户分组）链到了它`);
  }
  const layerReadme = ctx.byPath.get(nfc(rel(ctx.root, kbReadme(join(ctx.root, layer)) || join(ctx.root, layer, "README.md"))));
  for (const t of layerReadme ? markdownTables(layerReadme.text) : []) {
    const k = t.header.findIndex((h) => h.trim() === "分组");
    if (k < 0) continue;
    for (const row of t.rows) {
      for (const r of linkTargets(ctx, layerReadme, row.raw)) add(r, (row.cells[k] || "").trim(), `${layerReadme.r} 第 ${row.line} 行写的分组`);
    }
  }
  const out = [];
  for (const [r, groups] of holders) {
    if (groups.size < 2) continue;
    const list = [...groups].map(([g, via]) => `“${g}”（${via}）`).join("、");
    out.push(item("两个分组都收了", [r], `这份客户档案同时算在 ${groups.size} 个分组里：${list}`,
      "一位客户只放在主要那一组，另一组的事写进同一份档案；你定放哪组，我再改两边的 README 索引", true));
  }
  return out;
}

/** “## 来源”这类小节：引用出处本来就会在各份文件里重复 */
const CITATION_HEADING = /^#{1,6}\s*(来源|出处|依据)/;
/** 比较用的文字：链接只留看得见的字（[名字](路径.md) → 名字，[[路径|别名]] → 别名），去掉所有空白 */
const paragraphKey = (text) => nfc(text)
  .replace(/!?\[\[([^\]|\n]+?)(?:\\?\|([^\]\n]+))?\]\]/g, (_, target, alias) => alias || basename(target.split("#")[0]))
  .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
  .replace(/\s+/g, "");

/** 正文的段落（空行隔开；跳过代码块、标题、注释、引用块、“来源”小节），带起始行号 */
function paragraphs(doc) {
  const b = body(doc.text);
  const offset = doc.text.slice(0, doc.text.length - b.length).split("\n").length - 1;
  const out = [];
  let block = [];
  let start = 0;
  let fence = false;
  let citation = false;
  const flush = () => { if (block.length) out.push({ text: block.join("\n"), line: start }); block = []; };
  b.split("\n").forEach((line, i) => {
    if (FENCE.test(line)) { flush(); fence = !fence; return; }
    const t = line.trim();
    if (!fence && /^#{1,6}\s/.test(t)) { flush(); citation = CITATION_HEADING.test(t); return; }
    if (fence || citation || !t || t.startsWith(">") || t.startsWith("<!--")) { flush(); return; }
    if (!block.length) start = offset + i + 1;
    block.push(line);
  });
  flush();
  return out;
}

function duplicateParagraphs(ctx) {
  const seen = new Map();
  for (const doc of ctx.notes) {
    for (const p of paragraphs(doc)) {
      const key = paragraphKey(p.text);
      if ([...key].length < LIMITS.paragraphMin) continue;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ r: doc.r, line: p.line, secret: str(doc.fm["隐私"]) === "私密", text: p.text });
    }
  }
  const groups = new Map();
  for (const occ of seen.values()) {
    const files = unique(occ.map((o) => o.r)).sort();
    if (files.length < 2) continue;
    const id = files.join("\n");
    if (!groups.has(id)) groups.set(id, { files, paras: [] });
    groups.get(id).paras.push(occ);
  }
  return [...groups.values()].map(({ files, paras }) => {
    const at = paras.slice(0, 3).map((occ) => occ.map((o) => `${o.r} 第 ${o.line} 行`).join(" ↔ ")).join("；");
    const first = paras[0];
    const preview = first.some((o) => o.secret) ? undefined : `${[...first[0].text.replace(/\s+/g, " ").trim()].slice(0, 24).join("")}…`;
    return item("重复段落", files, `这 ${files.length} 份有 ${paras.length} 段一模一样的文字（${at}${paras.length > 3 ? " 等" : ""}）`,
      "一件事只在一处写全：留在最该放的那份，别处换成一句话加“以 … 为准”的链接；改哪份你点头再改", true, preview ? { preview } : {});
  });
}

// ───── 2. 问题 ─────
function brokenLinks(ctx) {
  const out = [];
  for (const doc of ctx.docs) {
    if (doc.original || doc.template || doc.r === "CLAUDE.md") continue;
    for (const b of brokenLinksIn(ctx, doc)) {
      const shown = b.wiki ? `[[${b.link}]]` : `(${b.link})`;
      const name = basename(KNOWN_EXT.test(b.link) || !b.wiki ? b.link : `${b.link}.md`).toLowerCase();
      const moved = (ctx.byName.get(name) || []).filter((r) => r !== doc.r);
      const why = `链接 ${shown} 指向的文件找不到`;
      const where = { where: `${doc.r} 第 ${b.no} 行`, link: b.link };
      if (doc.raw) out.push({ ...item("断链", [doc.r], why, "这是原样存着的原始材料，不改；整理稿引用它时别照抄这个链接", false), ...where });
      else if (moved.length === 1) out.push({ ...item("断链", [doc.r], why, `看起来挪到了 ${moved[0]}，改成指向它`, false), ...where });
      else out.push({ ...item("断链", [doc.r], why, "问你这份文件去哪了：找到就改链接，不要了就把链接改成普通文字", true), ...where });
    }
  }
  return out;
}

/** 来源里写的库内路径（.md 结尾的，和双链） */
function sourcePaths(value) {
  const out = [];
  for (const s of [].concat(value || [])) {
    out.push(...(String(s).match(/[^\s，,、；;（()）"'“”[\]|]+\.md/g) || []));
    out.push(...wikiLinks(String(s)).map((t) => (KNOWN_EXT.test(t) ? t : `${t}.md`)));
  }
  return unique(out.map((p) => nfc(p.replace(/^\/+/, ""))));
}

function privacyMismatch(ctx) {
  const out = [];
  for (const doc of ctx.notes.filter((d) => str(d.fm["隐私"]) === "可公开")) {
    for (const p of sourcePaths(doc.fm["来源"])) {
      const r = ctx.byPath.has(p) ? p : insideKb(ctx, resolve(dirname(doc.abs), p));
      const src = r && ctx.byPath.get(r);
      if (!src || str(src.fm["隐私"]) !== "私密") continue;
      out.push(item("隐私对不上", [doc.r, src.r], `这份标了“可公开”，来源 ${src.r} 却是“私密”`,
        "看一眼这份里有没有从私密材料抄来的东西：有就改成“内部”；确实能公开就保持不变（采访记录整份私密，不等于整理稿都私密）", true));
    }
  }
  return out;
}

// ───── 3. 过期 ─────
function staleSignals(ctx) {
  const { date } = ctx;
  const items = [];
  const reviewEvents = [];
  for (const doc of ctx.notes) {
    const upd = str(doc.fm["更新"]);
    const review = str(doc.fm["复核"]);
    if (str(doc.fm["确认"]) === "已过期") {
      items.push(item("已过期", [doc.r], "开头标了“已过期”", "问你：换成新的，还是留着当历史？留着的话，别处引用它的地方改成指向新的", true));
    } else if (!SNAPSHOT_TYPES.has(doc.type) && isDate(upd) && daysSince(upd, date) > ctx.staleDays) {
      const profile = doc.r === "01-AI协作/建库档案.md";
      items.push(item("很久没更新", [doc.r], `“更新”是 ${upd}，已经 ${daysSince(upd, date)} 天没动（超过 ${ctx.staleDays} 天）`,
        profile ? "生意有没有变化？可以约一次访谈，按新情况调整结构（见 references/维护.md）"
          : "问你这份还对不对：对就把“更新”改成今天；不对就照新情况改（改已确认的内容等你点头）", true));
    }
    if (isDate(review) && dayNumber(review) < dayNumber(date)) {
      items.push(item("到了复核时间", [doc.r], `“复核”是 ${review}，已经过了 ${daysSince(review, date)} 天`,
        "问你这份还对不对（价格、规则这类到期就该核一遍）；核过了把“复核”改成下一次的日期", true));
    } else if (review && !isDate(review)) reviewEvents.push({ path: doc.r, review });
  }
  return { items, review_events: reviewEvents };
}

// ───── 4. 积压 ─────
/** 一份材料放了多久：开头的“更新” → “日期” → 文件名开头的日期 → 修改时间 */
function materialAge(ctx, f) {
  const doc = ctx.byPath.get(f.r);
  for (const [k, basis] of [["更新", "更新"], ["日期", "日期"]]) {
    const v = str(doc?.fm[k]);
    if (isDate(v)) return { date: v, basis };
  }
  const m = basename(f.r).match(/^(\d{4}-\d{2}-\d{2})/);
  if (m && isDate(m[1])) return { date: m[1], basis: "文件名" };
  return { date: localDate(statSync(f.abs).mtime), basis: "修改时间" };
}

function inboxBacklog(ctx) {
  const inbox = ctx.layout["00-收件箱"];
  const files = ctx.tree.files.filter((f) => inFolder(f.r, inbox) && !f.readonly && !isReadme(basename(f.r)));
  const ages = files.map((f) => {
    const a = materialAge(ctx, f);
    return { path: f.r, days: daysSince(a.date, ctx.date), basis: a.basis, sensitive: isSensitivePath(f.r) };
  }).sort((a, b) => b.days - a.days);
  const shown = ages.filter((a) => !a.sensitive).map(({ sensitive, ...a }) => a);
  const overdue = shown.filter((a) => a.days > ctx.inboxDays);
  const stats = { count: files.length, oldest_days: ages[0]?.days ?? 0, oldest: ages[0] && !ages[0].sensitive ? ages[0].path : null, overdue };
  if (!files.length) return { stats, items: [] };
  const why = `收件箱有 ${files.length} 份没整理，最老的放了 ${stats.oldest_days} 天${stats.oldest ? `（${stats.oldest}）` : ""}；超过 ${ctx.inboxDays} 天的 ${overdue.length} 份`;
  return { stats, items: [item("收件箱没整理", [inbox], why, `说“整理一下”，我按整理新材料的步骤一份份过${overdue.length ? `；先过超过 ${ctx.inboxDays} 天的` : ""}`, true, { overdue: overdue.map((a) => a.path) })] };
}

function pendingBacklog(ctx) {
  const pending = ctx.notes.filter((d) => str(d.fm["确认"]) === "待确认").map((d) => {
    const upd = str(d.fm["更新"]);
    return { path: d.r, updated: isDate(upd) ? upd : null, days: isDate(upd) ? daysSince(upd, ctx.date) : null };
  }).sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.path.localeCompare(b.path, "zh"));
  const stats = { count: pending.length, oldest: pending.slice(0, 10) };
  if (!pending.length) return { stats, items: [] };
  const o = pending[0];
  const age = o.updated ? `更新于 ${o.updated}，${o.days} 天` : "没写更新日期";
  return { stats, items: [item("待确认的文件", pending.slice(0, 10).map((p) => p.path), `${pending.length} 份文件还标着“待确认”，最老的是 ${o.path}（${age}）`,
    "挑最老的几份念给你听，你说“这几份对”就改成已确认；不对的照你说的改", true, { where: `最老的几份：${pending.slice(0, 3).map((p) => p.path).join("、")}` })] };
}

function findingsBacklog(ctx) {
  const r = `${ctx.layout["90-持续生长"]}/待确认的发现.md`;
  const doc = ctx.byPath.get(r);
  const stats = { path: doc ? r : null, total: 0, unprocessed: 0 };
  if (!doc) return { stats, items: [] };
  let current = null;
  const cards = [];
  for (const line of doc.text.split("\n")) {
    if (/^##\s*发现\s*\d+/.test(line)) { current = { status: null }; cards.push(current); continue; }
    if (/^##\s/.test(line)) { current = null; continue; }
    const m = line.match(/状态[：:]\s*(.*)$/);
    if (current && current.status === null && m) current.status = m[1].trim();
  }
  stats.total = cards.length;
  stats.unprocessed = cards.filter((c) => !c.status || !DONE_STATUS.test(c.status)).length;
  if (!stats.unprocessed) return { stats, items: [] };
  return { stats, items: [item("没回的发现", [r], `${r} 里有 ${stats.unprocessed} 张发现卡还在等你回（一共 ${stats.total} 张）`,
    "一张张念给你听：采纳就写进对应的地方，不采纳写个理由，卡留着", true)] };
}

// ───── 5. 体量 ─────
const lineCount = (t) => t.replace(/\n$/, "").split("\n").length;
/** “## 往来记录”一节里的条数：顶格的列表项，加表格的数据行 */
function trailCount(text) {
  const s = section(body(text), "往来记录");
  if (s === null) return 0;
  const listed = s.split("\n").filter((l) => /^[-*+]\s+\S/.test(l) || /^\d+[.、]\s*\S/.test(l)).length;
  return listed + markdownTables(s).reduce((n, t) => n + t.rows.length, 0);
}

function sizeSignals(ctx) {
  const out = [];
  const split = "按“文件怎么长大”提议拆：客户、项目、达人拆成文件夹（档案.md 放当前判断，往来记录.md 只追加）；你同意才拆";
  for (const doc of ctx.docs.filter((d) => (d.note || d.readme) && !d.raw && !d.template)) {
    const n = lineCount(doc.text);
    if (n > LIMITS.bigLines) out.push(item("文件太长", [doc.r], `${n} 行，超过 ${LIMITS.bigLines} 行`, split, true));
  }
  for (const doc of ctx.notes.filter((d) => d.type !== "往来记录")) {
    const n = trailCount(doc.text);
    if (n > LIMITS.trailMax) out.push(item("往来太多", [doc.r], `“往来记录”有 ${n} 条，超过 ${LIMITS.trailMax} 条`, split, true));
  }
  const perDir = new Map();
  for (const f of ctx.tree.files) if (f.md && !isReadme(basename(f.r))) perDir.set(dirname(f.r), (perDir.get(dirname(f.r)) || 0) + 1);
  for (const d of [{ r: "" }, ...ctx.tree.dirs.filter((x) => !x.readonly && !inFolder(x.r, ctx.reportDir))]) {
    const n = perDir.get(d.r || ".") || 0;
    if (n >= LIMITS.folderMax) out.push(item("文件夹太满", [d.r || "根目录"], `直接放了 ${n} 份文件（${LIMITS.folderMax} 份以上）`, "按分组拆成子文件夹，各配一份 README；怎么分组你定", true));
  }
  const bytes = Buffer.byteLength(ctx.agentsText);
  if (bytes > LIMITS.agentsWarnBytes) {
    out.push(item("AGENTS.md 偏大", ["AGENTS.md"], `${(bytes / 1024).toFixed(1)} KB，超过 10 KB（上限 12 KB；Codex 读入口文件有总量限制，超了后面的会被截掉）`,
      "先把知识库那段里“文件开头”“怎么写”的细则挪进 01-AI协作/README.md（我能直接做）；地图、常见任务、怎么读、隐私不挪；你自己写的部分要精简，先问你", false));
  }
  return out;
}

// ───── 6. 结构信号 ─────
const hasContent = (ctx, folder) => ctx.tree.files.some((f) => inFolder(f.r, folder) && !inFolder(f.r, ctx.reportDir) && !isReadme(basename(f.r)));
const EMPTY_HINT = {
  "90-持续生长": ["还没做过复盘，也没有等你回的发现：说“本周复盘”，或在 Codex 的自动化里定每周复盘", false],
  "99-原始材料": ["采访原话、聊天原件一份都没存：下次访谈随问随记进采访记录", true],
};

function enabledModules(ctx) {
  const rows = ctx.profile ? tableRows(ctx.profile.text, "为什么") || [] : [];
  return rows.map((cells) => {
    const planned = cells.some((c) => PLANNED.test(c));
    const cell = cells.find((c) => /^`?\d{2}-[^|]+`?\/?$/.test(c.replace(/[[\]]/g, "")));
    return { name: (cells[0] || "").trim(), planned, path: cell ? stripPath(cell).split(/\s+/)[0].split("/")[0] : null, cells };
  });
}

function structureSignals(ctx) {
  const out = [];
  for (const id of LAYER_IDS.filter((x) => x !== "00-收件箱")) {
    const where = ctx.layout[id];
    if (!isDir(join(ctx.root, where)) || hasContent(ctx, where)) continue;
    const [hint, confirm] = EMPTY_HINT[id] || ["下次访谈问这一层（我记进“下次访谈可以问”）；一时没有也没关系，先空着", true];
    out.push(item("层是空的", [where], `${where}/${where !== id ? `（对应 ${id}）` : ""} 除了 README 什么都没有`, hint, confirm));
  }
  const modules = enabledModules(ctx);
  const layers = new Set(Object.values(ctx.layout));
  const growth = unique([...listDirs(ctx.root).filter((n) => /^1\d-/.test(n)), ...modules.filter((m) => !m.planned && m.path).map((m) => m.path)].map(nfc)).filter((g) => !layers.has(g));
  for (const g of growth) {
    if (!isDir(join(ctx.root, g)) || hasContent(ctx, g)) continue;
    out.push(item("模块只有 README", [g], `${g}/ 只有 README，还没有内容`, "有材料就放进来；暂时没有，就在建库档案“启用的模块”里把它改成（计划）", true));
  }
  out.push(...plannedTooLong(ctx, modules));
  out.push(...unmappedFolders(ctx));
  return out;
}

function plannedTooLong(ctx, modules) {
  const out = [];
  const upd = str(ctx.profile?.fm["更新"]);
  for (const m of modules.filter((x) => x.planned)) {
    const own = m.cells.join(" ").match(DATE_IN);
    const since = own && isDate(own[0]) ? own[0] : isDate(upd) ? upd : null;
    if (!since) continue;
    const days = daysSince(since, ctx.date);
    if (days <= LIMITS.plannedDays) continue;
    const basis = own ? "" : "（这一行没写日期，按建库档案的更新日期算）";
    out.push(item("计划太久", ["01-AI协作/建库档案.md"], `“启用的模块”里“${m.name}”写着（计划），从 ${since} 起已经 ${days} 天${basis}`,
      "问你还做不做：做就补材料、建起来；不做就从表里删掉这一行", true));
  }
  return out;
}

function unmappedFolders(ctx) {
  const rows = tableRows(ctx.agentsText, "文件夹") || [];
  if (!rows.length) return [];
  const mapped = new Set(rows.map((r) => nfc(stripPath(r[0] || ""))));
  return listDirs(ctx.root).map(nfc).filter((d) => !mapped.has(d)).map((d) => item("地图里没写", [d], `根目录有 ${d}/，AGENTS.md 的地图里没有`,
    "问你这个文件夹装什么：对应某一层、登记成只读或不读，或者写“不用”；定了我改地图和建库档案", true));
}

// ───── 汇总 ─────
export function summaryText(result) {
  return `维护体检：${CATEGORIES.map((c) => `${c.label} ${result.counts[c.key]}`).join(" · ")}`;
}

/** 维护体检（只读）：返回 JSON 结果；不是文件夹或不像知识库时返回 { error, exitCode } */
export function maintainKnowledgeBase(rootArg, opts = {}) {
  const root = resolve(rootArg);
  if (!isDir(root)) return { root, error: `文件夹不存在：${root}`, exitCode: 2 };
  if (!existsSync(join(root, "AGENTS.md")) && !existsSync(join(root, "01-AI协作", "建库档案.md"))) return { root, error: NOT_KB, exitCode: 1 };
  if (opts.date !== undefined && !isDate(opts.date)) return { root, error: `日期要写成 2026-10-27 这样：${opts.date}`, exitCode: 1 };
  const ctx = loadContext(root, opts);
  ctx.staleDays = opts.staleDays ?? LIMITS.staleDays;
  ctx.inboxDays = opts.inboxDays ?? LIMITS.inboxDays;
  const check = runCheck(root, ctx.layout, ctx.reportDir);
  const broken = brokenLinks(ctx);
  const privacy = privacyMismatch(ctx);
  const stale = staleSignals(ctx);
  const inbox = inboxBacklog(ctx);
  const pending = pendingBacklog(ctx);
  const findings = findingsBacklog(ctx);
  const sizeItems = sizeSignals(ctx);
  const structureItems = structureSignals(ctx);
  // 体检报的事一条条分；结构建议、体量里已经说了的同一件事，这里不再说
  const folders = (kind) => new Set(structureItems.filter((i) => i.kind === kind).flatMap((i) => i.paths));
  const other = { unmapped: folders("地图里没写"), emptyLayers: folders("层是空的"), readmeOnly: folders("模块只有 README"), agentsBig: sizeItems.some((i) => i.kind === "AGENTS.md 偏大") };
  const known = [...ctx.tree.files, ...ctx.tree.dirs].map((f) => f.r);
  const fromCheck = checkItems(check, { known, byName: ctx.byName }, other);
  check.stats.counted = fromCheck.length;
  const categories = {
    redundancy: { items: [...duplicateNames(ctx), ...doubleGrouped(ctx), ...duplicateParagraphs(ctx)] },
    problems: { items: [...fromCheck, ...broken, ...privacy], check: check.stats },
    stale: { items: stale.items, review_events: stale.review_events },
    backlog: { items: [...inbox.items, ...pending.items, ...findings.items], inbox: inbox.stats, pending: pending.stats, findings: findings.stats },
    size: { items: sizeItems },
    structure: { items: structureItems },
  };
  for (const c of CATEGORIES) {
    const cat = categories[c.key];
    cat.label = c.label;
    cat.count = cat.items.length;
  }
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.key, categories[c.key].count]));
  const readonlyCounts = ctx.readonly.map((folder) => ({ folder, files: ctx.tree.files.filter((f) => f.readonly === folder).length }));
  const result = {
    root, date: ctx.date, date_source: ctx.dateSource, stale_days: ctx.staleDays, inbox_days: ctx.inboxDays,
    sample_kb: ctx.sample, structure: ctx.structure, layout: ctx.layout,
    scope: { files: ctx.tree.files.length, notes: ctx.notes.length, raw: ctx.docs.filter((d) => d.raw).length, readonly: readonlyCounts, noread: ctx.excluded },
    counts, categories, report: null,
  };
  result.summary = summaryText(result);
  return result;
}

// ───── 报告 ─────
const bullet = (i) => {
  const lines = [`- 【${i.kind}】${i.where}：${i.why}。建议：${i.suggest}`];
  for (const t of i.top || []) lines.push(`  - ${t}`);
  if (i.overdue?.length) lines.push(`  - 超期的：${i.overdue.join("、")}`);
  return lines;
};

function categoryLines(c, cat, index) {
  const lines = [`## ${NUMBERS[index]}、${c.label}`, "", c.intro, ""];
  if (!cat.items.length) return [...lines, "这次没有发现。", ""];
  for (const [title, list] of [["我可以直接改的（你说“修”我就修）", cat.items.filter((i) => !i.confirm)], ["要你确认的（一条条回我）", cat.items.filter((i) => i.confirm)]]) {
    lines.push(`### ${title}`, "");
    if (!list.length) lines.push("（没有）");
    for (const i of list.slice(0, LIMITS.reportList)) lines.push(...bullet(i));
    if (list.length > LIMITS.reportList) lines.push(`- 还有 ${list.length - LIMITS.reportList} 条没列出来，再跑一次 maintain.mjs 能看到全部`);
    lines.push("");
  }
  if (c.key === "stale" && cat.review_events.length) {
    lines.push(`另有 ${cat.review_events.length} 份的“复核”写的是事件（${cat.review_events.slice(0, 5).map((e) => `${e.path}：${e.review}`).join("；")}），脚本判断不了，我看一眼是不是到时候了。`, "");
  }
  return lines;
}

/** 报告全文（--write 写的就是它） */
export function renderReport(result) {
  const ro = result.scope.readonly.map((x) => `${x.folder}（只读，${x.files} 份，只数没看）`);
  const no = result.scope.noread.map((x) => `${x}（不读，没进去）`);
  const scope = `这次看了：整理稿 ${result.scope.notes} 份、原始材料 ${result.scope.raw} 份${[...ro, ...no].length ? `；${[...ro, ...no].join("；")}` : ""}。日期按 ${result.date} 算（${result.date_source}）。`;
  const lines = [
    "---", "类型: 体检报告", `更新: ${result.date}`, "确认: 待确认", "隐私: 内部", "来源: 01-AI协作/建库档案.md", "---", "",
    `# ${result.date} 维护报告`, "",
    "> 维护脚本找出来的信号，脚本没有改任何文件。",
    "> “我可以直接改的”：你说“修”我就修；“要你确认的”：一条条回我，没回的下次还会出现。", "",
    `一句话：${result.summary.replace(/^维护体检：/, "")}`, "", scope, "",
  ];
  CATEGORIES.forEach((c, i) => lines.push(...categoryLines(c, result.categories[c.key], i)));
  lines.push("## 本月结构建议", "", "<!-- 由 AI 按 references/维护.md 补写 -->", "", "## 下次访谈可以问", "", "<!-- 由 AI 按 references/维护.md 补写 -->", "");
  return lines.join("\n");
}

/** 只新建一份报告：<90 层>/体检/<日期>-维护报告.md，同名加 -2、-3，绝不覆盖；返回相对路径 */
export function writeReport(result) {
  if (result.sample_kb) throw new Error(SAMPLE_REFUSED);
  const growth = join(result.root, result.layout["90-持续生长"]);
  if (!isDir(growth) || lstatSync(growth).isSymbolicLink()) throw new Error(`找不到持续生长那一层（${result.layout["90-持续生长"]}/），不新建层；先跑 check.mjs 看看`);
  const dir = join(growth, REPORT_DIR);
  if (existsSync(dir) && (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory())) throw new Error(`${rel(result.root, dir)} 不是普通文件夹，不往里写`);
  mkdirSync(dir, { recursive: true });
  const text = renderReport(result);
  for (let n = 1; n < 1000; n += 1) {
    const path = join(dir, `${result.date}-维护报告${n === 1 ? "" : `-${n}`}.md`);
    try {
      writeFileSync(path, text, { flag: "wx" });
      return rel(result.root, path);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw new Error("同一天的维护报告已经有 999 份了，不再写");
}

// ───── 命令行 ─────
const CLI_SPEC = { flags: { "--write": "write" }, values: { "--date": "date", "--stale-days": "staleDays", "--inbox-days": "inboxDays" } };

function positiveDays(v, flag) {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(String(v).trim()) || Number(v) < 1) throw new Error(`${flag} 要写一个正整数（天数），现在是 ${v}`);
  return Number(v);
}

function main({ opts, positional }) {
  const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
  if (!positional.length) fail(`没给知识库根目录。\n\n${USAGE}`);
  let options;
  try {
    if (opts.date !== undefined && !isDate(String(opts.date).trim())) throw new Error(`--date 要写成 2026-10-27 这样的日期，现在是 ${opts.date}`);
    options = { date: opts.date?.trim(), staleDays: positiveDays(opts.staleDays, "--stale-days"), inboxDays: positiveDays(opts.inboxDays, "--inbox-days") };
  } catch (e) {
    return fail(`${e.message}\n\n${USAGE}`);
  }
  const result = maintainKnowledgeBase(positional[0], options);
  if (result.error) return fail(result.error, result.exitCode);
  if (opts.write) {
    if (result.sample_kb) return fail(SAMPLE_REFUSED);
    try {
      result.report = writeReport(result);
    } catch (e) {
      return fail(`报告没写成：${e.message}`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  console.error(`${result.sample_kb ? "这是示例库｜" : ""}${result.summary}${result.report ? `\n报告写在 ${result.report}` : ""}`);
  // 不用 process.exit：JSON 很长时，管道里的输出可能还没写完
  process.exitCode = 0;
}

if (isMainModule(import.meta.url)) runCli(process.argv.slice(2), CLI_SPEC, USAGE, main);
