#!/usr/bin/env node
// 老板知识库体检（只读）：入口、固定层、地图、建库档案、README 索引、文件开头、日期、表格、链接、敏感信息。
// 有原件清单（接入时 init 建的）就逐份比对老板原有的文件。用法见 USAGE，或 node check.mjs --help。
// 不改任何文件。跳过 工作台/、隐藏文件夹（含 .obsidian/、.trash/）、node_modules、标“不读”的文件夹。退出码：0 没有错误，1 有错误或参数不对，2 文件夹不存在。
// 分成几份：check-rules.mjs（共用的规则和提示）、check-entry.mjs（入口）、check-files.mjs（文件夹和每份文件）、check-stage.mjs（--stage 和体检结论）。
import { existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { isMainModule, runCli, LAYER_IDS, RAW_LAYERS, MARK_START, MANIFEST, EDITOR_FIELD, OBSIDIAN,
  rel, read, isDir, isReadme, inFolder, parseFrontmatter, tableRows, stripPath, resolveLayout, listDirs, kbReadme, parseManifest, parentRulesWarning,
  checkupFolder, usesObsidian, wikiNameIndex,
} from "./lib.mjs";
import { CONNECT_ON_STANDARD, DATE, PLANNED, ENTRY_DEFERRED, ENTRY_DONE, INFERRED_NOTE, NO_AGENTS, NO_BLOCK,
  walk, agentsPlaceholders, profilePlaceholders, describePlaceholders } from "./check-rules.mjs";
import { checkEntry, checkClaude } from "./check-entry.mjs";
import { checkSnapshot, checkOriginals, checkBrand, indexedProducts, checkReadmes, checkOtherFiles, scanFiles } from "./check-files.mjs";
import { stageCheck, buildSummary, summaryLine } from "./check-stage.mjs";

export { ENTRY_DEFERRED, INFERRED_NOTE, summaryLine };
export const STAGES = ["quick", "connect"];
export const USAGE = `用法：node check.mjs <知识库根目录> [--stage quick|connect] [--brief] [--forbid 词1,词2]
  --stage quick     快速版收尾检查：占位填完、必读四份、采访记录、产品、客户、判断样本、做过一件真实任务
  --stage connect   接入已有资料（就地建图）的检查：目录对应、接入清单、建库快照、必读四份、采访记录、真实任务；标准结构用不了
  --brief           只打一行体检结论（要和 --stage 一起用；退出码不变）
  --forbid 词1,词2  这些词出现就报错（比如对外发布前不能出现的客户名）
  -h, --help        显示这段说明
也可以写成 --stage=quick、--forbid=词1,词2。只读，不改任何文件。
带 --stage 时，结果里多一个 summary（体检结论），“体检结论：……”那一行人话也打在 stderr。
退出码：0 没有错误，1 有错误或参数不对，2 文件夹不存在。`;

/** 入口（AGENTS.md、CLAUDE.md、上级目录的规则文件）。返回 checkEntry 的结果，加上工作台能不能跑要看的 entryGap */
function checkEntryFiles(ctx, errors, warnings) {
  const { root, agentsText, structure, layout, onManifest, profile, stage, manifest, sample } = ctx;
  // 就地建图时老板没同意往原有 AGENTS.md 追加（暂缓）：只报一条“入口没接上”，地图相关的检查都跳过；
  // 建库档案写了“入口: 暂缓”是老板知情的选择，平时降成提醒，接入收尾（--stage connect）照样算错
  const { deferred } = ctx;
  let entry = { format: null, routes: [] };
  if (!agentsText) errors.push(NO_AGENTS);
  else {
    if (deferred) (profile?.fm["入口"] === "暂缓" && stage !== "connect" ? warnings : errors).push(ENTRY_DEFERRED);
    entry = checkEntry(root, agentsText, { structure, layout, onManifest, deferred }, errors, warnings);
    if (MARK_START.test(agentsText) && profile?.fm["入口"] === "暂缓") warnings.push(ENTRY_DONE);
    const ph = agentsPlaceholders(agentsText);
    if (ph.length) warnings.push(describePlaceholders("AGENTS.md", ph));
  }
  // 工作台能不能跑：AGENTS.md 要有知识库那一段，而且有结束标记
  const entryGap = !agentsText ? "根目录没有 AGENTS.md" : !entry.range ? NO_BLOCK : !entry.range.closed ? "AGENTS.md 的知识库那一段没有结束标记" : null;
  const claudePath = join(root, "CLAUDE.md");
  if (!existsSync(claudePath)) warnings.push("根目录缺少 CLAUDE.md（一行 @AGENTS.md，给 Claude Code 转接）");
  else if (!/@AGENTS\.md/.test(read(claudePath)) && !deferred) errors.push("CLAUDE.md 里没有 @AGENTS.md");
  checkClaude(root, manifest, warnings);
  // 上级目录的规则文件（示例库不提醒：示例自带的材料，放在哪由提供示例的人定）
  const parentRules = sample ? null : parentRulesWarning(root);
  if (parentRules) warnings.push(parentRules);
  return { ...entry, entryGap };
}

/** 地图（入口暂缓追加时没有地图，不查） */
function checkMap({ root, agentsText, layerDirs, growth, others, readonly, excluded }, errors, warnings) {
  const rows = tableRows(agentsText, "文件夹") || [];
  if (!rows.length) errors.push("AGENTS.md 里没有“地图”表（表头以“文件夹”开头）");
  const mapped = new Set(rows.map((r) => stripPath(r[0] || "")));
  for (const name of mapped) {
    if (!name || /[<…]/.test(name) || name.includes("x-")) continue;
    if (!isDir(join(root, name))) errors.push(`AGENTS.md 地图里的 ${name}/ 不存在`);
  }
  for (const d of [...layerDirs, ...growth]) if (isDir(join(root, d)) && !mapped.has(d)) errors.push(`${d}/ 在磁盘上有，但 AGENTS.md 地图里没有`);
  for (const d of readonly) if (isDir(join(root, d)) && !mapped.has(d)) errors.push(`只读文件夹 ${d}/ 没写进 AGENTS.md 地图：加一行“| ${d}（只读） | 我原有的资料，AI 只读不改 | 需要时 |”`);
  for (const d of excluded) if (isDir(join(root, d)) && !mapped.has(d)) errors.push(`不读文件夹 ${d}/ 没写进 AGENTS.md 地图：加一行“| ${d}（不读） | 我的私人文件夹，AI 不打开 | 不读 |”`);
  for (const d of others) if (!mapped.has(d) && !readonly.includes(d) && !excluded.includes(d)) warnings.push(`顶层文件夹 ${d}/ 不在地图里（老板原有的文件夹要在地图里写明对应哪一层，或写“不用”）`);
}

/** 建库档案：格式、演示日期、编辑器、三节、启用的模块。返回启用了的生长模块 */
function checkProfile({ root, profile, growth }, errors, warnings) {
  const enabledGrowth = [];
  if (!profile) { errors.push("缺少 01-AI协作/建库档案.md"); return enabledGrowth; }
  const { text, fm } = profile;
  if (!String(fm["格式"] || "").startsWith("老板知识库/")) errors.push("建库档案.md 开头缺少 格式: 老板知识库/2");
  if (fm["演示日期"] !== undefined && !(typeof fm["演示日期"] === "string" && DATE.test(fm["演示日期"]))) {
    errors.push(`演示日期要写成 2026-10-27：01-AI协作/建库档案.md（现在是 ${[].concat(fm["演示日期"]).join("、") || "空的"}）`);
  }
  if (fm[EDITOR_FIELD] !== undefined && !usesObsidian(fm)) {
    warnings.push(`建库档案的“${EDITOR_FIELD}”只认开头是 ${OBSIDIAN} 的写法（后面可以带括号说明）：不用 Obsidian 就删掉这一行，按普通写法（现在是 ${[].concat(fm[EDITOR_FIELD]).join("、") || "空的"}）`);
  }
  for (const h of ["类型画像", "老板最关心", "启用的模块"]) if (!text.includes(h)) errors.push(`建库档案.md 缺少“${h}”`);
  const listed = new Set();
  for (const r of tableRows(text, "为什么") || []) {
    if (r.some((c) => PLANNED.test(c))) continue; // 计划中的模块：磁盘上还没有是对的，也不算启用
    const cell = r.find((c) => /^`?\d{2}-[^|]+`?\/?$/.test(c.replace(/[\[\]]/g, "")));
    if (!cell) continue;
    const path = stripPath(cell).split(/\s+/)[0];
    listed.add(path.split("/")[0]);
    if (!existsSync(join(root, path))) errors.push(`建库档案“启用的模块”里的 ${path} 不存在`);
  }
  for (const g of growth) if (!listed.has(g)) errors.push(`生长模块 ${g}/ 没写进建库档案的“启用的模块”表（工作台按这张表找路径）`);
  enabledGrowth.push(...[...listed].filter((n) => /^1\d-/.test(n) && isDir(join(root, n))));
  const ph = profilePlaceholders(text);
  if (ph.length) warnings.push(describePlaceholders("建库档案.md", ph));
  return enabledGrowth;
}

export function checkKnowledgeBase(rootArg, { forbid = [], stage = null } = {}) {
  const root = resolve(rootArg);
  const errors = [];
  const warnings = [];
  if (!isDir(root)) return { root, format: null, errors: [`文件夹不存在：${root}`], warnings, stats: {} };

  // 旧格式（v1）：根目录有 知识库说明.md，AGENTS.md 没有 v2 标记
  const agentsPath = join(root, "AGENTS.md");
  const agentsText = existsSync(agentsPath) ? read(agentsPath).replace(/\r\n/g, "\n").replace(/^﻿/, "") : "";
  const v1Index = join(root, "知识库说明.md");
  if (existsSync(v1Index) && !MARK_START.test(agentsText)) {
    const fm = parseFrontmatter(read(v1Index)) || {};
    return {
      root, format: fm["格式"] || "老板知识库/1",
      errors: ["这是旧格式（v1：根目录用 知识库说明.md 当地图）。请先“升级旧库”：地图搬进 AGENTS.md，进度搬进 01-AI协作/建库档案.md，文件清单搬进各层 README.md"],
      warnings, stats: {},
    };
  }

  const { layout, structure, profile, readonly, noread, excluded, originals, sample, obsidian } = resolveLayout(root);
  const manifestPath = join(root, MANIFEST);
  const manifest = existsSync(manifestPath) ? parseManifest(read(manifestPath)) : null;
  const onManifest = new Set((manifest || []).map((m) => m.path.normalize("NFC")));
  const deferred = Boolean(agentsText) && structure === "就地建图" && !MARK_START.test(agentsText);
  const ctx = { root, agentsText, structure, layout, profile, readonly, noread, excluded, originals, sample, obsidian, manifest, onManifest, deferred, stage, forbid };

  // 入口
  const entry = checkEntryFiles(ctx, errors, warnings);

  // 固定层（就地建图时按建库档案的“目录对应”表）
  for (const id of LAYER_IDS) {
    const where = layout[id];
    const dir = join(root, where);
    if (!isDir(dir)) errors.push(`缺少固定层：${where}/${where !== id ? `（对应 ${id}）` : ""}`);
    else if (!kbReadme(dir)) errors.push(`${where}/ 缺少 README.md`);
  }
  for (const d of readonly) if (!isDir(join(root, d))) errors.push(`建库档案里登记的只读文件夹 ${d}/ 不存在`);
  for (const d of excluded) if (!isDir(join(root, d))) errors.push(`建库档案里登记的不读文件夹 ${d}/ 不存在`);
  const layerDirs = new Set(Object.values(layout));
  const topDirs = listDirs(root);
  const growth = topDirs.filter((n) => /^1\d-/.test(n));
  const others = topDirs.filter((n) => !layerDirs.has(n) && !growth.includes(n));
  Object.assign(ctx, { entry, layerDirs, growth });

  if (agentsText && !deferred) checkMap({ ...ctx, others }, errors, warnings);
  const enabledGrowth = checkProfile(ctx, errors, warnings);
  checkBrand(root, layout, profile, warnings);

  const tree = walk(root, root, { dirs: [], files: [], others: [], symlinks: [] }, (r) => excluded.some((x) => inFolder(r, x)));
  for (const s of tree.symlinks) warnings.push(`跳过软链接：${s}`);
  // 双链按文件名找文件用：全库（不含跳过的文件夹）的文件
  const allFiles = [...tree.files, ...tree.others].map((f) => rel(root, f).normalize("NFC"));
  const wiki = { root, byName: wikiNameIndex(allFiles), files: allFiles };
  Object.assign(ctx, { tree, wiki, rawRoots: RAW_LAYERS.map((id) => layout[id]), checkup: checkupFolder(layout) });

  // README 与索引
  checkReadmes(ctx, warnings);

  // 原件清单（接入时 init 建的）：逐份比对；清单上没有的就是新写的文件
  const originalNotes = [];
  if (manifest) checkOriginals(root, manifest, stage === "connect" ? errors : originalNotes, stage === "connect", { readonly, notes: originalNotes });
  warnings.push(...originalNotes);

  // 非 .md 的原件；每份 .md
  checkOtherFiles(ctx, warnings);
  const scanned = scanFiles(ctx, errors, warnings);
  const { types, samples, productFiles, clientNames, groupNames, pendingFiles, pendingLineFiles } = scanned;
  const files = tree.files.map((f) => rel(root, f));

  if (structure === "就地建图") {
    for (const row of checkSnapshot(root, layout, stage, errors, warnings)) (row.type === "客户分组" ? groupNames : clientNames).add(row.name);
  }

  let summary;
  if (stage) {
    // 产品：“类型: 产品”的文件，加上 README 索引里登记成“产品”的（含只读文件夹里的原件），同一个文件只算一次
    const products = new Set([...productFiles, ...indexedProducts(root, tree.dirs, { readonly, excluded, wiki })]).size;
    const extra = stageCheck(stage, { root, layout, structure, profile, agentsText, types, products, samples, enabledGrowth, files, routes: entry.routes, originals, noread, onManifest, deferred });
    errors.push(...extra.errors);
    // 升成错误的提醒（占位）不再重复
    const kept = warnings.filter((w) => !extra.errors.some((e) => e.startsWith(w)));
    warnings.splice(0, warnings.length, ...kept, ...extra.warnings);
    const counts = {
      clients: clientNames.size, client_groups: groupNames.size, projects: types["项目"] || 0, products,
      samples, pending_files: pendingFiles, pending_lines: pendingLineFiles.reduce((a, x) => a + x.lines, 0),
      inbox: files.filter((r) => inFolder(r, layout["00-收件箱"]) && !isReadme(basename(r))).length,
    };
    summary = buildSummary({ root, layout, profile, errors, labels: extra.labels, counts, sample, pendingLineFiles, entryGap: entry.entryGap });
  }

  return {
    root, format: entry.format, structure, ...(stage ? { stage } : {}), errors, warnings,
    stats: { files: tree.files.length, notes: scanned.notes, growth_modules: growth, types },
    ...(summary ? { summary } : {}),
  };
}

const CLI_SPEC = { flags: { "--brief": "brief" }, values: { "--stage": "stage", "--forbid": "forbid" } };

if (isMainModule(import.meta.url)) {
  runCli(process.argv.slice(2), CLI_SPEC, USAGE, ({ opts, positional }) => {
    const stage = opts.stage === undefined ? null : opts.stage.trim();
    if (stage !== null && !STAGES.includes(stage)) {
      console.error(`--stage 只能是 quick 或 connect（现在是 ${stage}）\n\n${USAGE}`);
      process.exit(1);
    }
    if (opts.brief && stage === null) {
      console.error(`--brief 要和 --stage quick 或 --stage connect 一起用\n\n${USAGE}`);
      process.exit(1);
    }
    const forbid = String(opts.forbid || "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
    const target = positional[0] ?? ".";
    const result = checkKnowledgeBase(target, { forbid, stage });
    // 标准结构用了 --stage connect：当成用法错误，只说该用哪个，不出结论
    if (result.errors.includes(CONNECT_ON_STANDARD)) {
      console.error(CONNECT_ON_STANDARD);
      process.exit(1);
    }
    const code = !isDir(resolve(target)) ? 2 : result.errors.length ? 1 : 0;
    if (result.summary) {
      const line = summaryLine(result.summary);
      if (opts.brief) console.log(line);
      else console.log(JSON.stringify(result, null, 2));
      console.error(opts.brief ? result.summary.reminders.join("\n") : `${line}\n${result.summary.reminders.join("\n")}`);
    } else console.log(JSON.stringify(result, null, 2));
    process.exit(code);
  });
}
