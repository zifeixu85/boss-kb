// 体检的 --stage quick / connect 收尾检查和体检结论（check.mjs 用）。只读，不改任何文件。
import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { SKILL_VERSION, LAYER_IDS, APPEND_ONLY, rel, read, isDir, isReadme, inFolder, body, section, tableRows, kbReadme, stripCode, unique } from "./lib.mjs";
import { CONNECT_ON_STANDARD, OPEN_TODO, REMINDERS, MUST_READ, mustReadPath, INFERRED_NOTE, INFERRED_ENTRY, LATER_ENTRY, ENTRY_ERRORS, ENTRY_LABEL,
  agentsPlaceholders, profilePlaceholders, describePlaceholders, hasContent } from "./check-rules.mjs";

/**
 * 采访记录是不是只有 init 建的空骨架。记了原话的算：“采访进度”的“已完成：”后面有内容；
 * 有“采访进度”以外的小标题（如“## 第 1 题｜…”）；或者有带“原话”的行（“原话：…”“- 原话”“…（原话）”“**王总原话**：”）。
 * 引用块里的不算（骨架开头的说明就是引用块，里面有“原话”两个字），代码块、注释里的也不算。
 */
export function interviewHasContent(text) {
  const b = body(text);
  const progress = section(b, "采访进度");
  if (progress && /已完成[:：][ \t]*\S/.test(progress)) return true;
  const lines = stripCode(b).replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const heading = (l) => /^#{2,6}\s/.test(l) && !/^##\s+采访进度/.test(l);
  const quote = (l) => /原话/.test(l) && !l.trim().startsWith(">");
  return lines.some((l) => heading(l) || quote(l));
}

export function findInterviews(root, layout) {
  const dir = join(root, layout["99-原始材料"], "采访记录");
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md") && !isReadme(n) && interviewHasContent(read(join(dir, n))));
}

/** --stage quick / connect 的额外检查：每报一条错误，同时记下它在体检结论里的短标签 */
export function stageCheck(stage, ctx) {
  const { root, layout, structure, profile, agentsText, types, products, samples, enabledGrowth, files, routes, deferred } = ctx;
  const errors = [];
  const labels = [];
  const warnings = [];
  const fail = (label, msg) => { errors.push(msg); labels.push(label); };
  const placeholderErrors = () => {
    const a = agentsPlaceholders(agentsText);
    if (a.length) fail("地图占位", `${describePlaceholders("AGENTS.md", a)}。按采访结果填上，不知道的写“未知”`);
    const p = profile ? profilePlaceholders(profile.text) : [];
    if (p.length) fail("建库档案占位", `${describePlaceholders("建库档案.md", p)}。问完对应的题就填上`);
  };
  const interviewCheck = () => {
    if (!findInterviews(root, layout).length) {
      fail("采访原话", `${layout["99-原始材料"]}/采访记录/ 下还没有记了原话的采访记录：采访时每问完一题就把原话追加进去（每题一个“## 第 N 题”小标题，或写成“原话：……”；init 建的只是空骨架）`);
    }
  };
  const mustRead = () => {
    for (const [id, name, hint, label] of MUST_READ) {
      const path = mustReadPath(layout, id, name);
      if (!existsSync(join(root, path))) {
        fail(label, `工作台每次都要读 ${path}，还没有：${hint}${structure === "就地建图" ? "；就地建图时照样新建，正文链接老板的原文件" : ""}`);
      }
    }
  };
  if (!profile) return { errors: ["缺少 01-AI协作/建库档案.md：先跑 init.mjs 搭骨架"], labels: [], warnings };

  if (stage === "quick") {
    placeholderErrors();
    if (!hasContent(section(profile.text, "类型画像"))) fail("类型画像", "建库档案的“类型画像”还是空的：问完第 2 题，写上主类型和叠加（比如“电商品牌零售（主）+ 门店”）");
    if (!hasContent(section(profile.text, "老板最关心"))) fail("老板最关心", "建库档案的“老板最关心”还是空的：写上老板长期最关心的 1—3 个方面（从第 10 题早上想看的、最怕漏掉的东西归类，加上第 6 题最操心的事）");
    interviewCheck();
    mustRead();
    if (!products) fail("产品", `还没有产品档案：在 ${layout["03-生意"]}/ 下至少写一份“类型: 产品”的文件（先写卖得最多的那个）；老板原有的价目表、产品介绍，在那一层 README 的索引里登记一行、类型写“产品”也算`);
    const clients = (types["客户"] || 0) + (types["客户分组"] || 0);
    if (!clients) fail("客户", `还没有客户档案：在 ${layout["04-客户"]}/ 下至少写一份“类型: 客户”的文件（一群学员、会员可以写一份“类型: 客户分组”）`);
    else if (clients < 3) warnings.push("快速版建议至少 3 个真实客户；做内容、开门店的可以用客户分组代替");
    if (!samples) fail("判断样本", `还没有判断样本：在 ${layout["05-方法与判断"]}/<一类工作>/判断样本.md（内容少时也可以写在这类工作的那一份文件里）至少写一条“## 样本”（场景、判断、为什么、适用条件、来源）`);
    for (const g of enabledGrowth) {
      if (!files.some((r) => inFolder(r, g) && !isReadme(basename(r)))) {
        fail("模块文件", `生长模块 ${g}/ 已经启用，但里面除了 README 还没有文件：至少放一份；还没材料就先在建库档案“启用的模块”里把它标成（计划）`);
      }
      if (!deferred && !routes.some((p) => inFolder(p, g))) warnings.push(`生长模块 ${g} 还没有一行常见任务路由：补一行，例如“<要做的事> | ${g}/README.md → …”`);
    }
    warnings.push(...emptyLayerWarnings(ctx));
    // 建库完成后，老板想试用时再跑真实任务，不是建库条件。
  } else if (stage === "connect") {
    if (structure !== "就地建图") {
      fail("不是就地建图", CONNECT_ON_STANDARD);
      return { errors, labels, warnings };
    }
    if (section(profile.text, "目录对应") === null) fail("目录对应", "建库档案缺少“## 目录对应”：写清每一层对应老板原有的哪个文件夹");
    const intake = section(profile.text, "接入清单");
    if (intake === null) fail("接入清单", "建库档案缺少“## 接入清单”：按 已知 / 待确认 / 冲突 / 缺失 四项写");
    else if (!hasContent(intake)) fail("接入清单", "建库档案的“接入清单”还全是（待填）：读一遍老板原有的文件夹，把已知、待确认、冲突、缺失各写几条");
    const customerDir = layout["04-客户"];
    const readmePath = kbReadme(join(root, customerDir));
    const readmeName = readmePath ? basename(readmePath) : "README.md";
    const snapshot = readmePath ? section(read(readmePath), "建库快照") : null;
    // 只有老板维护客户时才需要客户表；没有客户业务也能建完整基础工作台。
    const hasClients = (types["客户"] || 0) + (types["客户分组"] || 0);
    if (hasClients && snapshot === null) warnings.push(`${customerDir}/${readmeName} 还没有建库快照：导入原有客户时补上来源表即可`);
    if (snapshot !== null && !(tableRows(snapshot, "名称") || []).some((row) => row.some((c) => c && c !== "（待填）")) && hasClients) warnings.push("建库快照尚未填好，导入客户前再补齐");
    placeholderErrors();
    mustRead();
    // 梳理已有资料不要求重做采访或先做业务任务，材料本身就是来源。
    warnings.push(...originalTodoWarnings(ctx));
  } else {
    errors.push(`不认识的 --stage：${stage}（只能是 quick 或 connect）`);
  }
  return { errors, labels, warnings };
}

/** 快速版收尾：除收件箱、持续生长外还只有 README 的层（发现是复盘时 AI 提的，不是采访能补的）；索引已有真实行却还留着“（暂时没有）” */
export function emptyLayerWarnings({ root, layout, profile, files }) {
  const out = [];
  const plan = section(profile.text, "下次补访") || "";
  for (const id of LAYER_IDS.filter((x) => x !== "00-收件箱" && x !== "90-持续生长")) {
    const where = layout[id];
    if (files.some((r) => inFolder(r, where) && !isReadme(basename(r)))) continue;
    if (plan.includes(where) || plan.includes(id)) continue;
    out.push(`${where}/ 还只有说明：下次补访补上，或在建库档案“下次补访”写明`);
  }
  for (const id of LAYER_IDS) {
    const readme = kbReadme(join(root, layout[id]));
    const rows = readme ? tableRows(section(read(readme), "索引") || "", "|") || [] : [];
    const names = rows.map((r) => (r[0] || "").trim()).filter(Boolean);
    if (names.includes("（暂时没有）") && names.some((n) => n !== "（暂时没有）")) out.push(`${rel(root, readme)} 的索引里还留着“（暂时没有）”，删掉这行`);
  }
  return out;
}

/** 接入收尾：老板原有文件里没做完的待办，近期要事里一条都没有（跳过“不读”的、模板） */
export function originalTodoWarnings({ root, layout, files, originals, noread, onManifest }) {
  const near = join(root, layout["06-项目"], "近期要事.md");
  if (existsSync(near) && /^\s*- \[[ /xX-]\]/m.test(read(near))) return [];
  let n = 0;
  let first = "";
  for (const r of files) {
    const own = onManifest.has(r.normalize("NFC")) || originals.some((x) => inFolder(r, x));
    if (!own || APPEND_ONLY.includes(r) || noread.some((x) => inFolder(r, x)) || /Templates|模板/i.test(r)) continue;
    const text = read(join(root, r));
    if (text.includes("{{")) continue;
    const k = text.split("\n").filter((l) => OPEN_TODO.test(l)).length;
    if (k && !first) first = r;
    n += k;
  }
  return n ? [`老板原有文件里有 ${n} 条没做完的待办（如 ${first}），近期要事里还没有：接入时抄进去，每条写来源，原文件不动`] : [];
}

/** 标准版达标时的体检结论（下游按 standard_ready / workbench_ready 判，不认这几个字） */
export const STANDARD_DONE = "标准版建好了";

/** 体检结论（C02）：工作台能不能跑、标准版过没过、还差什么（短标签）、计数。入口没接上时结论先说这个 */
export function buildSummary({ root, layout, profile, errors, labels, counts, sample, pendingLineFiles, entryGap }) {
  const workbenchMissing = [];
  if (entryGap) workbenchMissing.push(ENTRY_LABEL);
  if (!profile) workbenchMissing.push("建库档案占位");
  else {
    if (!hasContent(section(profile.text, "类型画像"))) workbenchMissing.push("类型画像");
    if (!hasContent(section(profile.text, "老板最关心"))) workbenchMissing.push("老板最关心");
  }
  for (const [id, name, , label] of MUST_READ) if (!existsSync(join(root, mustReadPath(layout, id, name)))) workbenchMissing.push(label);
  if (counts.clients + counts.client_groups + counts.projects < 1) workbenchMissing.push("客户");
  const workbenchReady = workbenchMissing.length === 0;
  const standardReady = errors.length === 0;
  const others = errors.length - labels.length - errors.filter((e) => ENTRY_ERRORS.has(e)).length;
  const missing = unique([...workbenchMissing.filter((m) => m === ENTRY_LABEL), ...labels, ...workbenchMissing]);
  if (others > 0) missing.push(`其他 ${others} 处错误`);
  const rest = missing.filter((m) => m !== ENTRY_LABEL);
  const verdict = standardReady && workbenchReady ? STANDARD_DONE
    : entryGap ? `入口还没接上（${entryGap}）${rest.length ? `；还差：${rest.join("、")}` : ""}`
    : workbenchReady ? `工作台能跑，标准版还差：${missing.join("、")}` : `还差：${missing.join("、")}`;
  return {
    verdict, workbench_ready: workbenchReady, standard_ready: standardReady, missing, counts,
    pending_line_files: pendingLineFiles.slice(0, 10), skill_version: SKILL_VERSION,
    ...(profileInferred(profile) ? { inferred_profile: true } : {}),
    ...(sample ? { sample_kb: true } : {}), reminders: REMINDERS,
  };
}

/** 一节里的条目：去掉空行、标题、引用、注释和列表符号 */
export const entryLines = (text) => stripCode(text || "").split("\n").map((l) => l.trim())
  .filter((l) => l && !/^#{1,6}\s/.test(l) && !l.startsWith(">") && !l.startsWith("<!--") && !/^[-*+|\s:]+$/.test(l))
  .map((l) => l.replace(/^(?:[-*+]|\d+[.、)])\s*/, ""));

/** 类型画像、老板最关心下面的条目全是“（AI 推断，待确认）”开头或“未知（老板说以后再说）”（至少有一条是 AI 推断） */
export function profileInferred(profile) {
  if (!profile) return false;
  let inferred = 0;
  for (const heading of ["类型画像", "老板最关心"]) {
    const lines = entryLines(section(profile.text, heading));
    if (!lines.length) return false;
    for (const l of lines) {
      if (INFERRED_ENTRY.test(l)) inferred += 1;
      else if (!LATER_ENTRY.test(l)) return false;
    }
  }
  return inferred > 0;
}

/** 体检结论那一行人话（stderr 和 --brief 用） */
export function summaryLine(s) {
  const c = s.counts;
  const head = s.sample_kb ? "这是示例库｜" : "";
  return `${head}体检结论：${s.verdict}${s.inferred_profile ? INFERRED_NOTE : ""}｜客户 ${c.clients + c.client_groups} · 项目 ${c.projects} · 产品 ${c.products} · 判断样本 ${c.samples} 条 · 待确认 ${c.pending_files} 份 · 收件箱 ${c.inbox} 份｜${s.skill_version}`;
}
