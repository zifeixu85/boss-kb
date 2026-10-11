// 体检里按文件夹、按文件查的部分：README 与索引、原件清单、敏感原件、每份文件的开头、表格、链接、敏感信息（check.mjs 用）。只读。
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, basename, extname, relative, isAbsolute } from "node:path";
import { CONFIRM, PRIVACY, PROJECT_STATUS, REQUIRED, TYPE_FIELDS, TYPE_NAMES, MANIFEST, APPEND_ONLY,
  rel, read, isReadme, inFolder, isSensitivePath, parseFrontmatter, body, section, tableRows, linksIn, unique,
  kbReadme, mentionedIn, missingFromIndex, hashFile, markdownTables, bankCardSignal, frontmatterFormat, shellWarnings, pendingLines,
  wikiLinksIn, resolveWikiLink, wikiInPathFields,
} from "./lib.mjs";
import { DATE, UNKNOWN, DATE_TAIL, CONTENT_PORTRAIT, CONTENT_MODULE, PROFILE_PLACEHOLDER, SENSITIVE_ORIGINAL, BINARY_EXT,
  hasSecret, PHONE, ID_CARD, hasContent, typeWarning, checkTodos, checkDates, stageWarning, stageAliases, badStage, tableWithHeader, lineAt } from "./check-rules.mjs";

/** 就地建图时客户层 README 的“建库快照”：上次联系、下次跟进按日期规则查（空着的在 connect 阶段是错误，平时只提醒）；阶段按工作台的取值提醒 */
export function checkSnapshot(root, layout, stage, errors, warnings) {
  const readmePath = kbReadme(join(root, layout["04-客户"]));
  const snapshot = readmePath ? section(read(readmePath), "建库快照") : null;
  const table = snapshot ? tableWithHeader(snapshot, "名称") : null;
  if (!table) return [];
  const label = rel(root, readmePath);
  const col = (h) => table.header.indexOf(h);
  const cell = (row, h) => (col(h) < 0 ? "" : (row[col(h)] || "").replace(/^`(.*)`$/, "$1").trim());
  const aliases = stageAliases(root);
  const rows = [];
  for (const row of table.rows) {
    const name = cell(row, "名称");
    if (!name || name === "（待填）") continue;
    rows.push({ name, type: cell(row, "类型") });
    for (const k of ["上次联系", "下次跟进"]) {
      if (col(k) < 0) continue;
      const v = cell(row, k);
      if (!v || v === "（待填）") {
        (stage === "connect" ? errors : warnings).push(`${label} 的建库快照 · ${name} 的“${k}”还空着：写成 2026-10-25，不知道写未知或未定`);
      } else if (!DATE.test(v) && !UNKNOWN.includes(v)) {
        errors.push(`“${k}”要写成 2026-10-25，不知道写未知或未定：${label} 的建库快照 · ${name}（现在是 ${v}）${DATE_TAIL}`);
      }
    }
    const st = cell(row, "阶段");
    if (st !== "（待填）" && badStage(st, aliases)) warnings.push(stageWarning(st, `${label} 的建库快照 · ${name}`));
  }
  return rows;
}

/**
 * 按原件清单逐份比对老板原有的文件；AGENTS.md / CLAUDE.md 只比“原长度”之前的部分。
 * 接入收尾（--stage connect）时算错误：确认 AI 没动老板的文件；平时只提醒：接入以后老板自己改、自己挪是正常的。
 */
export function checkOriginals(root, manifest, sink, strict, { readonly = [], notes = sink } = {}) {
  const tail = strict ? "" : "（如果是你自己改的，正常；不是的话查一下是谁动的）";
  // 只读文件夹老板可能还在用（比如还在写的日记、笔记）：有变化只提醒，接入收尾时也一样
  const inReadonly = (p) => readonly.some((x) => inFolder(p.normalize("NFC"), x.normalize("NFC")));
  for (const m of manifest) {
    const abs = join(root, m.path);
    const ro = inReadonly(m.path);
    const roNote = `${m.path} 有变化——它在只读文件夹里，老板还在用的话，正常`;
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      if (ro) notes.push(roNote);
      else sink.push(`原有文件不见了：${m.path}（可能被移动或改名）${tail}`);
      continue;
    }
    const size = statSync(abs).size;
    try {
      const changed = m.appendOnly
        ? m.size === null || size < m.size || hashFile(abs, m.size) !== m.hash
        : (m.size !== null && size !== m.size) || hashFile(abs) !== m.hash;
      if (changed && ro) notes.push(roNote);
      else if (changed) sink.push(`原有文件被改了：${m.path}${tail}`);
    } catch (e) {
      sink.push(`原有文件读不了，没法比对：${m.path}（${e.code || e.message}；检查权限。在云盘里的：右键知识库文件夹，Mac 选“保持下载”（老系统叫“立即下载”），Windows OneDrive 选“始终保留在此设备上”（菜单名按系统版本可能不同））`);
    }
  }
}

/** Obsidian 写法：竖线全都转义了的双链 [[路径\|显示名]] 先换成不带竖线的样子，再按老规矩数格子 */
const maskEscapedWiki = (raw) => raw.replace(/\[\[[^[\]\n]*?\]\]/g, (m) => (/(?<!\\)\|/.test(m) ? m : m.replace(/\\\|/g, "¦")));
const countCells = (raw) => raw.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;
const TABLE_TIP = "格子里不要写 |：要链接写 [名字](路径.md)，不写 [[名字|别名]]";
const OBSIDIAN_TABLE_TIP = "格子里不要写 |；README 索引表里只写 [[路径]]，别的表格要换显示名写 [[路径\\|名字]]（竖线前加 \\，不然 Obsidian 会错列）";

/** 表格错列（C64）：机读表报错，其他表提醒；lineOffset 是这段文字在文件里的起始行。Obsidian 写法时，表格里的 [[路径\|显示名]] 不算错 */
export function checkTables(text, r, machine, errors, warnings, lineOffset = 0, { obsidian = false } = {}) {
  for (const t of markdownTables(text)) {
    const strict = machine(t);
    for (const row of t.rows) {
      const raw = obsidian ? maskEscapedWiki(row.raw) : row.raw;
      const n = obsidian ? countCells(raw) : row.cells.length;
      const ok = n === t.header.length && !/\[\[[^\]\n]*\|[^\]\n]*\]\]/.test(raw) && !raw.includes("\\|");
      if (ok) continue;
      (strict ? errors : warnings).push(`${r} 第 ${row.line + lineOffset} 行的表格有 ${n} 格，表头是 ${t.header.length} 格：${obsidian ? OBSIDIAN_TABLE_TIP : TABLE_TIP}`);
    }
  }
}

/** 资料地图（99 层的 资料地图.md，或 99 层 README 的“## 资料地图”）里登记成私密的位置 */
export function privateRegistry(root, layout) {
  const raw = layout["99-原始材料"];
  const texts = [];
  const mapFile = join(root, raw, "资料地图.md");
  if (existsSync(mapFile)) texts.push(body(read(mapFile)));
  const readme = kbReadme(join(root, raw));
  if (readme) texts.push(section(read(readme), "资料地图") || "");
  const out = new Set();
  for (const text of texts) {
    for (const t of markdownTables(text)) {
      const header = t.header.map((h) => h.trim());
      const kPlace = header.indexOf("位置");
      const kPrivacy = header.indexOf("隐私");
      if (kPlace < 0 || kPrivacy < 0) continue;
      for (const row of t.rows) {
        if ((row.cols[kPrivacy] || "").trim() !== "私密") continue;
        const cell = row.cols[kPlace] || "";
        for (const c of [cell.replace(/[`[\]<>]/g, "").replace(/\(.*\)$/, ""), ...linksIn(cell), ...wikiLinksIn(cell)]) {
          const p = c.trim().replace(/^\.\//, "").replace(/\/+$/, "");
          if (p) { out.add(p); out.add(`${raw}/${p}`); }
        }
      }
    }
  }
  return out;
}

/** 原件层里的文件有没有被所在文件夹（往上找到原件层为止）的 README 链接或列出：示例库里这样列着的算示例自带的材料 */
export function listedInReadme(root, f, rawRoots) {
  const r = rel(root, f);
  const top = rawRoots.find((x) => inFolder(r, x));
  for (let d = dirname(f); top && inFolder(rel(root, d), top); d = dirname(d)) {
    const readme = kbReadme(d);
    if (readme && mentionedIn(read(readme), d, rel(d, f))) return true;
    if (rel(root, d) === top) break;
  }
  return false;
}

/**
 * README“## 索引”表里“类型”格恰好是“产品”的行，链接指向知识库里一个存在的文件（只读文件夹里的原件也算，如 ../报价/2026报价单.md）：
 * 返回这些目标文件（绝对路径）。一行只取第一个能打开的链接；只读文件夹自己的 README 不看；指向不读的文件夹、知识库外面的不算。
 * 双链 [[03-生意/价目表]] 也认（wiki 是 resolveWikiLink 要的 { root, byName, files }）。
 */
export function indexedProducts(root, dirs, { readonly, excluded, wiki = null }) {
  const out = new Set();
  for (const d of dirs) {
    if (readonly.some((x) => inFolder(rel(root, d), x))) continue;
    const readme = kbReadme(d);
    if (!readme) continue;
    for (const t of markdownTables(read(readme))) {
      if (!t.heading.startsWith("索引")) continue;
      const k = t.header.findIndex((h) => h.trim() === "类型");
      if (k < 0) continue;
      for (const row of t.rows) {
        if ((row.cols[k] || "").trim().replace(/^`(.*)`$/, "$1").trim() !== "产品") continue;
        const wikiHits = wiki ? wikiLinksIn(row.raw).flatMap((t) => resolveWikiLink(t, { ...wiki, fromDir: d })).map((p) => join(root, p)) : [];
        const target = [...linksIn(row.raw).map((href) => resolve(d, href)), ...wikiHits].find((abs) => {
          const r = relative(root, abs);
          if (!r || r.startsWith("..") || isAbsolute(r) || excluded.some((x) => inFolder(rel(root, abs), x))) return false;
          return existsSync(abs) && statSync(abs).isFile();
        });
        if (target) out.add(target.normalize("NFC"));
      }
    }
  }
  return out;
}

/** 品牌与口吻（C31、C35）：做内容、对外发东西的要有“## 不能说的话”表；做内容的还要有说话方式（R6-5） */
export function checkBrand(root, layout, profile, warnings) {
  const where = `${layout["03-生意"]}/品牌与口吻.md`;
  const path = join(root, where);
  const text = existsSync(path) ? read(path) : null;
  const redlines = text === null ? null : section(text, "不能说的话");
  const hasTable = redlines !== null && markdownTables(redlines).some((t) => t.header.some((h) => h.includes("不说")));
  let need = false;
  if (profile) {
    // 计划中的模块也算：模块名或路径里有“内容与作品”“作品库”
    const modules = (tableRows(profile.text, "为什么") || []).some((r) => CONTENT_MODULE.test(`${r[0] || ""} ${r[1] || ""}`));
    const portrait = section(profile.text, "类型画像");
    need = modules || (hasContent(portrait) && CONTENT_PORTRAIT.test(portrait.replace(PROFILE_PLACEHOLDER, "")));
  }
  if (need && !hasTable) warnings.push(`做内容、对外发东西的老板要有 ${where} 和它的‘不能说的话’表：工作台发布前检查和它的内容模块都从这里取红线。补访时问第 9、11 题，按模板写`);
  else if (text !== null && redlines === null) warnings.push(`${where} 里没有‘## 不能说的话’：工作台和它的内容模块按这个标题取红线词表`);
  const voice = `${layout["02-关于我"]}/说话方式.md`;
  if (need && !existsSync(join(root, voice))) warnings.push(`做内容的老板最好有 ${voice}：贴 1—2 段最满意的原文，AI 才写得像你（第 9 题）`);
}

/**
 * README 与索引：层 README 的四项说明，索引有没有收全，（待补）的行。
 * 原件层下面的子文件夹、只读文件夹、体检报告文件夹（90 层的 体检/，定期维护新建的）不要求；收件箱和原件层只要求提到子文件夹。
 */
export function checkReadmes({ root, tree, rawRoots, readonly, excluded, layerDirs, checkup }, warnings) {
  const isReadonlyDir = (abs) => readonly.some((x) => inFolder(rel(root, abs), x));
  // 不读的文件夹整个跳过；体检报告像收件箱一样是临时的，上级 README 不用提到它
  const skipDir = (abs) => excluded.some((x) => inFolder(rel(root, abs), x)) || inFolder(rel(root, abs), checkup);
  for (const d of tree.dirs) {
    const r = rel(root, d);
    if (rawRoots.some((x) => r.startsWith(`${x}/`))) continue;
    if (readonly.some((x) => inFolder(r, x))) continue;
    if (inFolder(r, checkup)) continue;
    const mdFiles = readdirSync(d).filter((n) => !n.startsWith(".") && n.toLowerCase().endsWith(".md") && !isReadme(n));
    const readmePath = kbReadme(d);
    if (!readmePath) {
      if (mdFiles.length >= 5) warnings.push(`${r}/ 有 ${mdFiles.length} 份文件但没有 README.md`);
      continue;
    }
    const name = basename(readmePath);
    const text = read(readmePath);
    const isLayerTop = !r.includes("/") || layerDirs.has(r);
    if (isLayerTop) for (const head of ["装什么", "不装什么", "AI 什么时候读", "谁来写"]) if (!text.includes(head)) warnings.push(`${r}/${name} 缺少“${head}”`);
    // 收件箱是临时中转（boss-kb 在别的项目里读写时只往里放文件、不改 README），原件层也不要求索引收全
    const transient = rawRoots.includes(r);
    // 就地建图时另起的“往来记录”不要求进索引（它们挂在原有客户文件旁边，不改 README）
    const isTrail = (abs) => (parseFrontmatter(read(abs)) || {})["类型"] === "往来记录";
    // 只认链接和恰好等于名字的格子；没有 README 的子文件夹，里面每份文件都要在这里被链接到
    for (const miss of missingFromIndex(d, text, { files: !transient, skipFile: isTrail, folderOnly: isReadonlyDir, skipDir })) {
      warnings.push(miss.dir ? `${r}/${name} 没提到子文件夹 ${miss.path}/` : `${r}/${name} 的索引里没有 ${miss.path}`);
    }
    // 补索引脚本补出来的行，“一句话”先写（待补）
    const todoRows = markdownTables(text).flatMap((t) => t.rows).filter((row) => row.cells.some((c) => c.trim() === "（待补）")).length;
    if (todoRows) warnings.push(`${r}/${name} 的索引里还有 ${todoRows} 行写着（待补）：补上一句稳定的定位（是谁、怎么来的、做哪类事）`);
  }
}

/** 非 .md 的原件：证照、合同、录音这类（C28） */
export function checkOtherFiles({ root, layout, tree, rawRoots }, warnings) {
  const registry = tree.others.length ? privateRegistry(root, layout) : new Set();
  for (const f of tree.others) {
    const r = rel(root, f);
    const inRaw = rawRoots.some((x) => inFolder(r, x));
    if (!(SENSITIVE_ORIGINAL.test(basename(f)) || (inRaw && BINARY_EXT.has(extname(f).toLowerCase())))) continue;
    if (registry.has(r) || registry.has(basename(f))) continue;
    warnings.push(`${r} 疑似敏感原件：确认只登记位置；要复制进来，在 ${layout["99-原始材料"]} 的资料地图里登记成私密`);
  }
}

/** 双链（两种链接都认）：断了的报错；只写文件名、同名文件不止一份的提醒（Obsidian 只会打开其中一份） */
function checkWikiLinks(text, f, r, wiki, errors, warnings) {
  for (const t of unique(wikiLinksIn(text))) {
    const hits = resolveWikiLink(t, { ...wiki, fromDir: dirname(f) });
    if (!hits.length) errors.push(`链接指向不存在的文件：${r} → [[${t}]]`);
    else if (hits.length > 1) {
      const shown = `${hits.slice(0, 3).join("、")}${hits.length > 3 ? "……" : ""}`;
      warnings.push(`${r} 里的 [[${t}]] 对上了 ${hits.length} 份同名文件（${shown}）：Obsidian 只会打开其中一份，写成从知识库根目录起的路径，如 [[${hits[0].replace(/\.md$/i, "")}]]`);
    }
  }
}

/** 哪些表是工作台按列读的（机读表）：错列算错误，其他表只提醒 */
function machineTables(root, layout) {
  const customerReadme = rel(root, kbReadme(join(root, layout["04-客户"])) || join(root, layout["04-客户"], "README.md"));
  const methodReadme = rel(root, kbReadme(join(root, layout["05-方法与判断"])) || join(root, layout["05-方法与判断"], "README.md"));
  return (r) => (t) => {
    const h = t.heading;
    if (r === "AGENTS.md") return (t.header[0] || "").trim().startsWith("文件夹");
    if (r === "01-AI协作/建库档案.md") return ["启用的模块", "目录对应"].some((x) => h.startsWith(x));
    if (r === customerReadme) return h.startsWith("建库快照");
    if (r === `${layout["03-生意"]}/品牌与口吻.md`) return h.startsWith("不能说的话");
    if (r === methodReadme) return h.startsWith("方法选择表");
    return false;
  };
}

/**
 * 每份 .md：敏感信息、不该出现的词、链接、表格，再查整理稿的开头元信息、类型和字段；数客户、产品、判断样本、待确认。
 * 原件（原件层、老板原有的文件）只提醒敏感信息、不查开头；体检报告（90 层的 体检/）不查开头、表格和链接（是当时的快照），敏感信息照查。
 */
export function scanFiles(ctx, errors, warnings) {
  const { root, layout, structure, tree, rawRoots, originals, readonly, noread, manifest, onManifest, forbid, sample,
    entry, agentsText, deferred, layerDirs, growth, stage, checkup, obsidian, wiki } = ctx;
  const out = { notes: 0, samples: 0, pendingFiles: 0, pendingLineFiles: [], types: {}, productFiles: new Set(), clientNames: new Set(), groupNames: new Set() };
  const { types } = out;
  const bare = new Map();
  const newReadonly = new Map();
  const aliases = stageAliases(root);
  const machineTable = machineTables(root, layout);
  const tableOpts = { obsidian };
  for (const f of tree.files) {
    const r = rel(root, f);
    const raw = rawRoots.some((x) => inFolder(r, x));
    const checkupFile = inFolder(r, checkup);
    // 老板原有的文件夹（目录对应表里的非标准名、只读文件夹）里的文件
    const origin = originals.filter((x) => inFolder(r, x)).sort((a, b) => b.length - a.length)[0];
    if (origin && isSensitivePath(r)) continue; // 名字像证件、密码的：不记、不扫、不报文件名
    const text = read(f).replace(/\r\n/g, "\n");
    const fm = parseFrontmatter(text);
    // 有原件清单时，清单上的一律是老板原有的（带“类型”也只提醒）；没有清单时，原有文件夹里没写“类型”的算原文件。
    // 只读文件夹里接入以后新加的也算老板的（AI 不往只读文件夹里写；老板可能还在用），只提醒一次
    const roFolder = readonly.filter((x) => inFolder(r.normalize("NFC"), x.normalize("NFC"))).sort((a, b) => b.length - a.length)[0];
    const newInReadonly = Boolean(manifest) && Boolean(roFolder) && !onManifest.has(r.normalize("NFC"));
    if (newInReadonly) newReadonly.set(roFolder, [...(newReadonly.get(roFolder) || []), r]);
    const originalFile = manifest ? (onManifest.has(r.normalize("NFC")) && !APPEND_ONLY.includes(r)) || newInReadonly : Boolean(origin) && (!fm || fm["类型"] === undefined);
    const asIs = raw || originalFile; // 原件：手机号、身份证号、卡号只提醒，整理时别抄进整理稿
    // 原件清单里只有路径和哈希，哈希里的数字会被误认成手机号、身份证号
    const scan = r !== MANIFEST;
    const lines = text.split("\n");
    if (scan && lines.some(hasSecret)) errors.push(`疑似密码或密钥：${r}`);
    if (scan && PHONE.test(text)) (asIs ? warnings.push(`原件里有手机号，整理时不要抄进整理稿：${r}`) : errors.push(`疑似手机号：${r}`));
    if (scan && ID_CARD.test(text)) (asIs ? warnings.push(`原件里有身份证号，整理时不要抄进整理稿：${r}`) : errors.push(`疑似身份证号：${r}`));
    const card = scan ? lines.map(bankCardSignal).reduce((a, s) => (a === "strong" || s === "strong" ? "strong" : a || s), null) : null;
    if (card === "strong") (asIs ? warnings.push(`原件里有疑似银行卡号，整理时不要抄进整理稿：${r}`) : errors.push(`疑似银行卡号：${r}`));
    else if (card === "weak") warnings.push(`可能是银行卡号（也可能是订单号）：${r}；是卡号就删掉`);
    for (const word of forbid) if (word && text.includes(word)) errors.push(`出现了不该出现的词“${word}”：${r}`);
    if (!checkupFile) {
      // 只看正文：开头元信息里的双链按“来源”“整理进”那一条报，不重复
      if (!obsidian && structure !== "就地建图" && /\[\[[^\]]+\]\]/.test(body(text))) warnings.push(`用了 [[双链]]，换成普通 Markdown 链接更通用：${r}`);
      for (const href of linksIn(text)) if (!existsSync(resolve(dirname(f), href))) errors.push(`链接指向不存在的文件：${r} → ${href}`);
      // 双链只查 AI 写的：老板原有的笔记、原件层、只读文件夹里的断链（Obsidian 里常见，点了才建）不管；AGENTS.md 只看知识库那一段
      const own = !asIs && !roFolder && !(onManifest.has(r.normalize("NFC")) && r !== "AGENTS.md") && r !== "CLAUDE.md";
      if (own) checkWikiLinks(r === "AGENTS.md" ? entry.range?.text || "" : text, f, r, wiki, errors, warnings);
    }
    if (sample && raw && !isReadme(basename(f)) && (fm || {})["示例"] !== "是" && !listedInReadme(root, f, rawRoots)) {
      warnings.push(`示例库里有一份不是示例自带的材料：${r}。如果是你自己的真实资料，建议放进你自己的知识库`);
    }
    if (r === "AGENTS.md" && entry.range) checkTables(entry.range.text, r, machineTable(r), errors, warnings, lineAt(agentsText, entry.range.start) - 1, tableOpts);
    else if (!raw && !asIs && !checkupFile && r !== MANIFEST && r !== "CLAUDE.md" && !(deferred && r === "AGENTS.md") && !readonly.some((x) => inFolder(r, x))) checkTables(text, r, machineTable(r), errors, warnings, 0, tableOpts);

    // AI 新建的原件可以写“整理进”：写成双链只提醒（原件的开头不查）
    if (raw && fm && !checkupFile) warnings.push(...wikiInPathFields(fm, r, ["整理进"]));
    if (isReadme(basename(f)) || r === "AGENTS.md" || r === "CLAUDE.md" || raw || checkupFile) continue;
    if (originalFile) {
      if (!fm || fm["类型"] === undefined) bare.set(origin || "", (bare.get(origin || "") || 0) + 1);
      continue;
    }
    const format70 = frontmatterFormat(text, fm, r);
    if (!fm && origin) {
      if (stage === "connect") errors.push(`${r} 是新写的文件，但没有开头元信息`);
      else warnings.push(`${r} 是接入以后新写的文件，没有开头元信息（如果是你自己的笔记，正常；AI 写的要补上元信息）`);
      continue;
    }
    if (!fm) {
      const top = r.split("/")[0];
      const standardPlace = layerDirs.has(top) || growth.includes(top);
      if (structure === "就地建图" && !standardPlace) { const k = r.includes("/") ? top : ""; bare.set(k, (bare.get(k) || 0) + 1); continue; }
      if (format70.leading) errors.push(...format70.errors);
      else errors.push(`缺少文件开头的元信息：${r}`);
      continue;
    }
    out.notes += 1;
    errors.push(...format70.errors);
    warnings.push(...format70.warnings);
    if (!format70.colon) for (const k of REQUIRED) if (fm[k] === undefined || (Array.isArray(fm[k]) && !fm[k].length)) errors.push(`缺少字段 ${k}：${r}`);
    if (fm["确认"] && !CONFIRM.includes(fm["确认"])) errors.push(`“确认”只能是 ${CONFIRM.join(" / ")}：${r}（现在是 ${fm["确认"]}）`);
    if (fm["隐私"] && !PRIVACY.includes(fm["隐私"])) errors.push(`“隐私”只能是 ${PRIVACY.join(" / ")}：${r}（现在是 ${fm["隐私"]}）`);
    checkDates(fm, r, errors);
    for (const src of [].concat(fm["来源"] || [])) if (/\.md$/.test(src) && !existsSync(join(root, src))) errors.push(`来源文件不存在：${r} → ${src}`);
    const type = typeof fm["类型"] === "string" ? fm["类型"] : "";
    if (type) {
      types[type] = (types[type] || 0) + 1;
      if (!TYPE_NAMES.has(type)) warnings.push(typeWarning(type, r, layout, growth));
    }
    if (!format70.colon) for (const k of TYPE_FIELDS[type] || []) if (!fm[k] || (Array.isArray(fm[k]) && !fm[k].length)) errors.push(`类型“${type}”缺少字段 ${k}：${r}`);
    if (type === "项目" && fm["状态"] && !PROJECT_STATUS.includes(fm["状态"])) errors.push(`项目状态只能是 ${PROJECT_STATUS.join(" / ")}：${r}`);
    if (type === "产品") out.productFiles.add(f.normalize("NFC"));
    if (type === "客户") { out.clientNames.add(String(fm["名称"] || basename(r, ".md"))); if (badStage(fm["阶段"], aliases)) warnings.push(stageWarning(fm["阶段"], r)); }
    if (type === "客户分组") out.groupNames.add(String(fm["名称"] || basename(r, ".md")));
    if (type === "待办") checkTodos(text, r, warnings);
    // 判断样本：05 层任何文件里的“## 样本”都算（内容少的一类工作可以只有一个文件）
    if (type === "判断样本" || inFolder(r, layout["05-方法与判断"])) out.samples += (body(text).match(/^##\s*样本/gm) || []).length;
    if (fm["确认"] === "待确认") out.pendingFiles += 1;
    // 任务手册讲的是规矩（“写成候选，待确认”），里面的括注不是真的待确认
    if (fm["确认"] === "已确认" && type !== "任务手册") { const n = pendingLines(text); if (n) out.pendingLineFiles.push({ path: r, lines: n }); }
    if (r !== "01-AI协作/建库档案.md" && r !== MANIFEST) warnings.push(...shellWarnings(text, r));
  }
  for (const [folder, list] of newReadonly) {
    const example = noread.includes(folder) ? "" : `（如 ${list[0]}）`;
    warnings.push(`${folder}/ 里有 ${list.length} 份接入以后新加的文件${example}——它在只读文件夹里，老板还在用的话，正常；老板说是自己加的，用 init.mjs --refresh-originals ${folder} 重新登记`);
  }
  for (const [folder, n] of bare) {
    const how = readonly.includes(folder) ? "只读文件夹不放 README、不改原文件，正常；靠上级 README 的索引、建库快照或原件清单找到它们" : "就地建图不改原文件，正常；靠 README 的索引或建库快照找到它们";
    warnings.push(`${folder ? `${folder}/` : "根目录"} 下有 ${n} 份老板原有的文件没有开头元信息（${how}）`);
  }
  return out;
}
