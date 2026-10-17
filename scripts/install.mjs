#!/usr/bin/env node
// 安装或更新老板知识库 Skill（boss-kb），并在全局规则里记一句“我的知识库在哪”，让别的项目里的 AI 也能读写这个知识库。
// 2026-10-18 起还生成一个“我的知识库”Skill（my-kb，见 mine-skill.mjs），写死知识库位置和读写规矩，让别的 AI 也知道去哪读、怎么写；全局规则那段照旧做兜底。
// 只改四类东西：boss-kb 的 Skill 文件夹；生成的 my-kb 文件夹；全局规则文件里两行标记之间（<!-- boss-kb 老板知识库 开始 --> 到 <!-- boss-kb 老板知识库 结束 -->，
// 旧版 boss-kb-access 留下的 <!-- 老板知识库 开始 --> 那一段原地换成新的）；旧版“知识库读写”（boss-kb-access）的 Skill 文件夹（挪进备份）。
// 改之前先备份到 用户文件夹/.boss-kb/备份/；--dry-run 只预演、什么都不改。
// 原来是 boss-kb-access 的 install.mjs，2026-10-11 并进 boss-kb。
import { existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, rmdirSync, lstatSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SKILL_NAME, OLD_SKILL_NAME, V1_FILE, locations, normalizeInputPath, detectKb, findKbUp, upsertBlock, removeBlock, pathFromRules, blockLines,
  hasLegacyBlock, isLegacyStandardLine, cloudHints, isDir, isFile, isLink, readRuleText, writeTextAtomic, realish, isMainModule, stamp,
} from "./access-lib.mjs";
import { MINE_NAME, MINE_FILES, buildMineFiles, isMine, sameMine } from "./mine-skill.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `用法（路径写完整、加英文双引号；Windows 上别用 ~）：
  node install.mjs --kb "<知识库文件夹>"            安装或更新老板知识库（boss-kb），生成“我的知识库”Skill（my-kb），并在全局规则里记下知识库在哪（Codex 一定装；电脑上有 Claude Code 也装）
  node install.mjs --kb "<知识库文件夹>" --dry-run  只预演，什么都不改
  node install.mjs --status                          看看现在装没装、规则里记的是哪个知识库
  node install.mjs --uninstall [--dry-run]           卸载：拿掉规则里那一段（旧版 boss-kb-access 写的也拿掉），boss-kb 和“我的知识库”两个 Skill 文件夹挪进备份（用下载来的 boss-kb 文件夹里的这份运行）
不写 --kb：当前文件夹在知识库里就用这个知识库，不在就用全局规则里记过的。
装的时候发现旧版“知识库读写”（boss-kb-access）的文件夹，一起挪进备份。备份都在 用户文件夹/.boss-kb/备份/。
选项：
  --for auto|codex|claude|both   给谁装，默认 auto（Codex 必装，有 ~/.claude 文件夹才装 Claude Code）
  --force                        文件夹不是老板知识库也照样记。只在老板本人说“就用这个文件夹”之后加`;

export class Refusal extends Error {}

export function parseArgs(argv) {
  const opts = { kb: null, dryRun: false, uninstall: false, status: false, force: false, for: "auto", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--kb") opts.kb = argv[++i];
    else if (a.startsWith("--kb=")) opts.kb = a.slice(5);
    else if (a === "--for") opts.for = argv[++i];
    else if (a.startsWith("--for=")) opts.for = a.slice(6);
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--uninstall") opts.uninstall = true;
    else if (a === "--status") opts.status = true;
    else if (a === "--force") opts.force = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else if (!opts.kb && !a.startsWith("--")) opts.kb = a;
    else throw new Refusal(`看不懂这个参数：${a}\n\n${HELP}`);
  }
  if (!["auto", "codex", "claude", "both"].includes(opts.for)) throw new Refusal(`--for 只能是 auto、codex、claude、both，收到的是：${opts.for}`);
  return opts;
}

function pickTools(loc, choice) {
  if (choice === "codex") return ["codex"];
  if (choice === "claude") return ["claude"];
  if (choice === "both") return ["codex", "claude"];
  return isDir(loc.claude.home) ? ["codex", "claude"] : ["codex"];
}

const LABEL = { codex: "Codex", claude: "Claude Code" };
const FORCE_HINT = "如果你确定就是它，跟我说“就用这个文件夹”。\n（给 AI：老板本人在对话里这样说了，才加 --force 重新运行。）";
const OLD_LABEL = `旧版“知识库读写”（${OLD_SKILL_NAME}）`;

/** 检查知识库路径；有问题就抛 Refusal，用人话说清楚。from：given 老板给的 / cwd 当前项目 / rules 全局规则里记的。 */
export function checkKb(raw, force, from = "given") {
  const kb = normalizeInputPath(raw);
  if (!kb) throw new Refusal("还不知道知识库在哪。请把知识库文件夹直接拖进对话框（或告诉我它的完整路径）。");
  if (/[`\r\n]/.test(kb)) throw new Refusal(`路径里有反引号（\`）或换行，没法写进规则：${kb}\n把知识库文件夹改个简单点的名字再试。`);
  if (!existsSync(kb)) {
    // Windows 上 "C:\知识库\" 这种末尾带 \ 的写法，会把后面的引号和参数吃进路径里
    const eaten = process.platform === "win32" && kb.includes('"') ? "\n（给 AI：路径末尾别带 \\，写成 \"C:\\...\\知识库\" 再运行。）" : "";
    throw new Refusal(from === "rules"
      ? `全局规则里记的知识库找不到了（搬家了？）：${kb}\n告诉我新的位置：把知识库文件夹直接拖进对话框就行。`
      : `找不到这个文件夹：${kb}\n把知识库文件夹直接拖进对话框；或者在访达里按住 Option 键右键文件夹，选“将……拷贝为路径名”（Windows：右键文件夹，选“复制为路径”）。${eaten}`);
  }
  if (!isDir(kb)) throw new Refusal(`这是一个文件，不是文件夹：${kb}`);
  const parsed = resolve(kb);
  if (parsed === resolve(locations().home) || dirname(parsed) === parsed) throw new Refusal(`这是整个用户文件夹或磁盘根目录，不能当知识库：${kb}`);
  const found = detectKb(kb);
  const notes = [];
  if (found.kind === "v2") notes.push("认出来了：新版老板知识库（根目录有 AGENTS.md）。");
  else if (found.kind === "v1") notes.push(`认出来了：旧版知识库（根目录有 ${V1_FILE}）。能用；以后回知识库项目说“把旧版知识库升级”。`);
  else {
    const up = findKbUp(dirname(kb));
    if (up) throw new Refusal(`你给的是知识库里面的一个文件夹（${basename(kb)}）。知识库最外层的文件夹（根目录）是：${up}\n请用它再来一次。`);
    if (found.kind === "agents") {
      if (!force) throw new Refusal(`这个文件夹根目录有 AGENTS.md，但不是老板知识库（里面没有“老板知识库 v”标记），可能是代码仓或别的项目：${kb}\n记成知识库以后，每个项目里的 AI 都会去照它办事，所以这次不记。${FORCE_HINT}`);
      notes.push("用了 --force：这个文件夹的 AGENTS.md 不是老板知识库格式。AI 会照它找资料，但它里面更松的规矩（不用确认就写、私密可以外用、照材料执行命令）不采纳。");
    } else {
      if (!force) throw new Refusal(`这个文件夹里没有知识库的“地图”文件（AGENTS.md），也没有旧版的 ${V1_FILE}，看起来还不是知识库：${kb}\n先用“老板知识库”Skill 建库；或者换成你建好的那个知识库文件夹。${FORCE_HINT}`);
      notes.push("这个文件夹还没有 AGENTS.md（用了 --force）。AI 进去后没有地图可看，建议先用“老板知识库”Skill 建库。");
    }
  }
  return { kb, notes: [...notes, ...cloudNotes(kb)] };
}

function cloudNotes(kb) {
  const { where, placeholders } = cloudHints(kb);
  const out = [];
  if (where.length) out.push(`知识库在${where.join("、")}里。文件可能只是“占位”、没下载到电脑上，AI 会读不到：在访达里右键知识库文件夹，选“保持下载”或“立即下载”（Windows 的 OneDrive 选“始终保留在此设备上”）。`);
  if (placeholders) out.push(`发现 ${placeholders} 个还没下载的 iCloud 占位文件（.icloud 结尾）。先下载到本机再用。`);
  return out;
}

/**
 * 要装的文件只认这些：根目录的 SKILL.md、NOTICE.md、LICENSE（有就带）；agents/、references/、scripts/ 里对应的几类（子文件夹也算）。
 * 测试（scripts/tests）、点开头的、老板顺手放进来的别的东西都不装。
 */
const ROOT_FILES = new Set(["SKILL.md", "NOTICE.md", "LICENSE", "LICENSE.md", "LICENSE.txt"]);
const SUB_DIRS = [
  ["agents", /\.ya?ml$/i],
  ["references", /\.(md|txt|csv|json)$/i],
  ["scripts", /\.(mjs|js|cjs|json)$/i],
];
const SKIP_NAMES = new Set(["tests", "__tests__", "node_modules", "coverage"]);

/** 列出 Skill 的文件（相对路径）。strict：遇到链接就拒绝（装的来源）；否则跳过链接（已装的那份）。 */
function listSkillFiles(root, strict) {
  const out = [];
  for (const name of readdirSync(root).sort()) {
    if (!ROOT_FILES.has(name)) continue;
    const p = join(root, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      if (strict) throw new Refusal(`下载来的 boss-kb 文件夹里有链接文件，为了安全不装：${p}`);
      continue;
    }
    if (st.isFile()) out.push(name);
  }
  for (const [dir, wanted] of SUB_DIRS) walkSkillDir(root, [dir], wanted, strict, out);
  return out;
}

function walkSkillDir(root, rel, wanted, strict, out) {
  const d = join(root, ...rel);
  if (!plainDir(d, strict)) return;
  for (const name of readdirSync(d).sort()) {
    if (name.startsWith(".") || SKIP_NAMES.has(name)) continue;
    const p = join(d, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) {
      if (strict) throw new Refusal(`下载来的 boss-kb 文件夹里有链接文件，为了安全不装：${p}`);
      continue;
    }
    if (st.isDirectory()) walkSkillDir(root, [...rel, name], wanted, strict, out);
    else if (st.isFile() && wanted.test(name)) out.push(join(...rel, name));
  }
}

function plainDir(d, strict) {
  let st;
  try { st = lstatSync(d); } catch { return false; }
  if (st.isSymbolicLink()) {
    if (strict) throw new Refusal(`下载来的 boss-kb 文件夹里有链接文件夹，为了安全不装：${d}`);
    return false;
  }
  return st.isDirectory();
}

function sameTree(a, b) {
  if (!isDir(b)) return false;
  const fa = listSkillFiles(a, true);
  const fb = listSkillFiles(b, false);
  if (fa.join("\n") !== fb.join("\n")) return false;
  return fa.every((f) => readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

function skillAction(tool, target, seen) {
  const base = { kind: "skill", tool, target };
  const who = `${LABEL[tool]} 的 boss-kb`;
  if (isLink(target)) return { ...base, state: "link", say: `${who} 位置是一个链接，不动它：${target}` };
  const real = realish(target);
  if (real === realish(SKILL_ROOT)) return { ...base, state: "same", say: `${who} 就是从这里运行的，不用复制：${target}` };
  if (seen.has(real)) return { ...base, state: "same", say: `${who} 位置和 ${LABEL[seen.get(real)]} 那份是同一个文件夹（链接过去的），不重复装：${target}` };
  seen.set(real, tool);
  if (!existsSync(target)) return { ...base, state: "new", say: `把老板知识库（boss-kb）装到 ${LABEL[tool]} 的用户级位置（所有项目都能用）：${target}` };
  if (!isDir(target)) return { ...base, state: "blocked", say: `${who} 的位置上是一个同名文件、不是文件夹，不动它：${target}` };
  if (sameTree(SKILL_ROOT, target)) return { ...base, state: "same", say: `${who} 已经是最新的：${target}` };
  return { ...base, state: "update", say: `更新 ${who}（旧的先复制进备份，再原地换成新版）：${target}` };
}

/** “我的知识库”Skill：没有就生成；是安装脚本生成的、内容变了（换了知识库）就更新；别人自己放的同名文件夹不动 */
function mineAction(tool, target, kb, seen) {
  const files = buildMineFiles(kb);
  const base = { kind: "mine", tool, target, files };
  const who = `${LABEL[tool]} 的“我的知识库”（${MINE_NAME}）`;
  if (isLink(target)) return { ...base, state: "link", say: `${who}的位置是一个链接，不动它：${target}` };
  const real = realish(target);
  if (seen.has(real)) return { ...base, state: "same", say: `${who}的位置和 ${LABEL[seen.get(real)]} 那份是同一个文件夹（链接过去的），不重复写：${target}` };
  seen.set(real, tool);
  if (!existsSync(target)) return { ...base, state: "new", say: `生成“我的知识库”Skill：写明知识库在哪、先读 AGENTS.md、怎么按规矩读写，电脑上别的 AI 也看得懂：${target}` };
  if (!isDir(target) || !isMine(target)) return { ...base, state: "blocked", say: `${target} 已经有一个同名的、不是安装脚本生成的东西，不动它` };
  if (sameMine(target, files)) return { ...base, state: "same", say: `${who}已经是最新的：${target}` };
  return { ...base, state: "update", say: `更新${who}（换成现在这个知识库；旧的先复制进备份）：${target}` };
}

/** 备份里的文件夹名：codex-codex-skill（~/.codex/skills/boss-kb）、claude-claude-boss-kb-access 这样，一眼看出原来在哪。 */
function backupName(tool, dir) {
  const where = basename(dirname(dirname(dir))).replace(/^\./, "");
  return `${tool}-${where}-${basename(dir) === SKILL_NAME ? "skill" : basename(dir)}`;
}

/** 旧版 boss-kb-access 的文件夹是不是和正在运行的 boss-kb 放在同一个文件夹里（安装包自带的那份），是就不动。 */
const besideSource = (dir) => realish(dirname(dir)) === realish(dirname(SKILL_ROOT)) || realish(dir) === realish(SKILL_ROOT);

/** 某个工具那几个位置上的旧版 boss-kb-access：要挪进备份的，和只提醒不动的（链接、安装包里和 boss-kb 放在一起的那份）。 */
function oldNameActions(loc, tool, seen, notes) {
  const actions = [];
  for (const d of loc[tool].oldNameDirs) {
    if (isLink(d)) { notes.push(`${d} 是${OLD_LABEL}的一个链接，不动它；不想要了就手动删掉这个链接（删链接不会删掉它指向的文件夹）。`); continue; }
    if (!isDir(d)) continue;
    const real = realish(d);
    if (seen.has(real)) continue;
    seen.add(real);
    if (besideSource(d)) { notes.push(`${d} 是和这份 boss-kb 放在同一个文件夹里的${OLD_LABEL}（下载来的安装包里自带的），不动它。`); continue; }
    actions.push({ kind: "old", tool, target: d, state: "move", backupName: backupName(tool, d), say: `发现${OLD_LABEL}的文件夹：它的本事已经并进 boss-kb，留着会和 boss-kb 抢着回答，挪进备份：${d}` });
  }
  return actions;
}

function readRules(tool, file) {
  try { return isFile(file) ? readRuleText(file) : ""; } catch (e) { throw new Refusal(`${LABEL[tool]} 的全局规则（${file}）：${e.message}`); }
}

function ruleAction(tool, file, kb, why) {
  const before = readRules(tool, file);
  let result;
  try { result = upsertBlock(before, kb); } catch (e) { throw new Refusal(`${LABEL[tool]} 的全局规则（${file}）：${e.message}`); }
  const verb = {
    added: "加一段",
    updated: "更新那一段",
    migrated: `把${OLD_LABEL}写的那一段原地换成新版`,
    same: "已经记好了，不用改",
  }[result.action];
  const action = { kind: "rule", tool, file, before, after: result.text, state: result.action, say: `${LABEL[tool]} 的全局规则${why}：${verb}——“我的知识库在：${kb}”。文件：${file}` };
  const old = pathFromRules(before);
  if (old && old !== kb) action.changedFrom = old;
  const keep = new Set(blockLines(result.text));
  action.dropped = blockLines(before).filter((l) => l.trim() && !keep.has(l) && !l.includes("我的知识库在") && !isLegacyStandardLine(l));
  return action;
}

export function planInstall(opts, cwd = process.cwd()) {
  const loc = locations();
  const tools = pickTools(loc, opts.for);
  const here = findKbUp(cwd);
  const ruled = currentRulePath(loc, tools);
  const pick = opts.kb ? { raw: opts.kb, from: "given" } : here ? { raw: here, from: "cwd" } : { raw: ruled, from: "rules" };
  const { kb, notes } = checkKb(pick.raw, opts.force, pick.from);
  const asks = [];
  if (pick.from === "cwd") notes.unshift(`没指定知识库，用的是当前项目所在的知识库：${kb}`);
  if (pick.from === "rules") notes.unshift(`没指定知识库，用的是全局规则里记着的：${kb}`);
  const actions = [];
  const seen = new Map();
  const oldSeen = new Set();
  const mineSeen = new Map();
  const ruleSeen = new Map();
  for (const tool of tools) {
    const skill = skillAction(tool, loc[tool].skillDir, seen);
    actions.push(skill);
    if (skill.state === "blocked") asks.push(`${skill.target} 是一个文件、不是文件夹，boss-kb 装不进去。先问老板或帮你装的人这是什么，挪开以后再运行。`);
    if (tool === "codex" && hasStrayCopy(loc.codex)) {
      actions.push({ kind: "old", tool, target: loc.codex.legacySkillDir, state: "move", backupName: backupName(tool, loc.codex.legacySkillDir), say: `旧位置也有一份同名 Skill，会出现两个“老板知识库”，挪进备份：${loc.codex.legacySkillDir}` });
      asks.push(`旧位置（${loc.codex.legacySkillDir}）有一份同名 Skill，要挪进备份。那份可能是老板或帮你装的人自己放的，问一句再动。`);
    }
    actions.push(...oldNameActions(loc, tool, oldSeen, notes));
    const mine = mineAction(tool, loc[tool].mineDir, kb, mineSeen);
    actions.push(mine);
    if (mine.state === "blocked") asks.push(`${mine.target} 已经有一个同名的（不是老板知识库安装脚本生成的），这次不写“我的知识库”Skill。先问老板这是什么；挪开以后再运行一次。全局规则那一段照常写。`);
    for (const file of loc[tool].ruleFiles) {
      // 两份规则文件链到同一个真实文件（比如 CLAUDE.md 链到 AGENTS.md）：只改一次
      const real = realish(file);
      if (ruleSeen.has(real)) {
        actions.push({ kind: "rule", tool, file, state: "same", say: `${LABEL[tool]} 的全局规则和 ${ruleSeen.get(real)} 是同一份文件（链接过去的），上面那一步一起改好了：${file}` });
        continue;
      }
      ruleSeen.set(real, `${LABEL[tool]} 的 ${basename(file)}`);
      const isOverride = tool === "codex" && file === loc.codex.overrideFile;
      const why = tool !== "codex" || !loc.codex.overrideActive ? "" : isOverride ? "（AGENTS.override.md：它在的时候 Codex 只读这一份）" : "（AGENTS.md：override 删掉以后用它）";
      actions.push(ruleAction(tool, file, kb, why));
    }
  }
  if (tools.includes("codex") && loc.codex.overrideActive) {
    asks.push(`Codex 正在用 ${loc.codex.overrideFile}（它在的时候 Codex 不读 AGENTS.md）。这一段两份都写；override 一般是临时用的，问老板知不知道它在。`);
  }
  for (const a of actions.filter((x) => x.kind === "rule")) {
    if (a.changedFrom) asks.push(`${LABEL[a.tool]} 的全局规则里原来记的知识库是 ${a.changedFrom}，这次换成 ${kb}。问老板是不是要换。`);
    if (a.dropped?.length) notes.push(`${a.file} 里那一段会整段换成新版，原来这几行会去掉：${a.dropped.slice(0, 5).map((l) => `“${l.slice(0, 40)}”`).join("、")}${a.dropped.length > 5 ? " 等" : ""}`);
  }
  if (tools.length === 1 && opts.for === "auto") notes.push("没找到 Claude Code 的设置文件夹（~/.claude），只给 Codex 装。以后装了 Claude Code，再运行一次就行。");
  return { loc, kb, notes, asks: [...new Set(asks)], actions };
}

/** 旧位置有一份真的副本（不是链接、不是正在运行的这份、也不是新位置链过去的那份）。 */
function hasStrayCopy(codex) {
  const old = codex.legacySkillDir;
  if (!isDir(old) || isLink(old)) return false;
  const real = realish(old);
  return real !== realish(SKILL_ROOT) && real !== realish(codex.skillDir);
}

function currentRulePath(loc, tools) {
  for (const tool of tools) {
    for (const file of loc[tool].ruleFiles) {
      let p = null;
      try { p = isFile(file) ? pathFromRules(readRuleText(file)) : null; } catch { /* 读不了的交给后面 ruleAction 报 */ }
      if (p) return p;
    }
  }
  return null;
}

export function planUninstall() {
  const loc = locations();
  const dirs = [
    ["codex", loc.codex.skillDir], ["codex", loc.codex.legacySkillDir], ["claude", loc.claude.skillDir],
    ...loc.codex.oldNameDirs.map((d) => ["codex", d]), ...loc.claude.oldNameDirs.map((d) => ["claude", d]),
  ];
  const self = realish(SKILL_ROOT);
  const running = dirs.map(([, d]) => d).find((d) => existsSync(d) && realish(d) === self);
  if (running) throw new Refusal(`现在运行的就是装好的那一份（${running}），没法把自己挪走。\n请用下载来的 boss-kb 文件夹里的 install.mjs 再运行一次卸载；那个文件夹找不到了，就照 references/安装与全局规则.md 里“全局规则那一段”的第 5 节手工卸载。`);
  const actions = [];
  const notes = [];
  const seen = new Set();
  for (const [tool, d] of dirs) {
    const old = basename(d) === OLD_SKILL_NAME;
    if (isLink(d)) { notes.push(`${d} 是一个链接，不动它；不想要了就手动删掉这个链接（删链接不会删掉它指向的文件夹）。`); continue; }
    if (!isDir(d)) continue;
    const real = realish(d);
    if (seen.has(real)) continue;
    seen.add(real);
    if (old && besideSource(d)) { notes.push(`${d} 是和这份 boss-kb 放在同一个文件夹里的${OLD_LABEL}（下载来的安装包里自带的），不动它。`); continue; }
    const say = old ? `把${OLD_LABEL}挪进备份：${d}` : `把 ${LABEL[tool]} 的 boss-kb 挪进备份：${d}`;
    actions.push({ kind: "old", tool, target: d, state: "move", backupName: backupName(tool, d), say });
  }
  for (const [tool, d] of [["codex", loc.codex.mineDir], ["claude", loc.claude.mineDir]]) {
    if (isLink(d) || !isDir(d) || !isMine(d)) continue; // 别人自己放的同名文件夹、链接都不动
    const real = realish(d);
    if (seen.has(real)) continue;
    seen.add(real);
    actions.push({ kind: "old", tool, target: d, state: "move", backupName: `${tool}-${MINE_NAME}`, say: `把 ${LABEL[tool]} 的“我的知识库”（${MINE_NAME}）挪进备份：${d}` });
  }
  const ruleSeen = new Set();
  for (const [tool, file] of [["codex", loc.codex.agentsFile], ["codex", loc.codex.overrideFile], ["claude", loc.claude.ruleFile]]) {
    if (!isFile(file)) continue;
    const real = realish(file);
    if (ruleSeen.has(real)) continue; // 链到同一个真实文件的，只改一次
    ruleSeen.add(real);
    const before = readRules(tool, file);
    let res;
    try { res = removeBlock(before); } catch (e) { throw new Refusal(`${LABEL[tool]} 的全局规则（${file}）：${e.message}`); }
    const which = res.legacy ? `（含${OLD_LABEL}写的那段）` : "";
    if (res.removed) actions.push({ kind: "rule", tool, file, before, after: res.text, state: "removed", say: `从 ${LABEL[tool]} 的全局规则里拿掉“我的知识库”那一段${which}，别的内容不动：${file}` });
  }
  return { loc, actions, notes, asks: [] };
}

let lastBackupDir = null;

/** 真正动手。每一步之前先备份；返回备份文件夹（没备份就是 null）和没做干净的事。 */
export function apply(plan) {
  const log = [];
  const problems = [];
  let backupDir = null;
  const backup = () => {
    if (!backupDir) {
      mkdirSync(plan.loc.backupRoot, { recursive: true });
      backupDir = mkdtempSync(join(plan.loc.backupRoot, `${stamp()}-`));
      lastBackupDir = backupDir;
    }
    return backupDir;
  };
  const keep = (from, name) => {
    let to = join(backup(), name);
    for (let n = 2; existsSync(to); n += 1) to = join(backupDir, `${name}-${n}`);
    copyTree(from, to);
    log.push([from, to]);
  };
  try {
    for (const a of plan.actions) {
      if (a.kind === "skill" && a.state === "new") copySkill(SKILL_ROOT, a.target);
      else if (a.kind === "skill" && a.state === "update") {
        keep(a.target, `${a.tool}-skill`);
        copySkill(SKILL_ROOT, a.target, true);
      } else if (a.kind === "mine" && (a.state === "new" || a.state === "update")) {
        if (a.state === "update") {
          keep(a.target, `${a.tool}-${MINE_NAME}`);
          for (const f of MINE_FILES) rmSync(join(a.target, f), { force: true });
        }
        for (const [f, text] of Object.entries(a.files)) {
          mkdirSync(dirname(join(a.target, f)), { recursive: true });
          writeTextAtomic(join(a.target, f), text);
        }
      } else if (a.kind === "old" && a.state === "move") {
        keep(a.target, a.backupName);
        try { rmSync(a.target, { recursive: true, force: true }); } catch (e) {
          problems.push(`${a.target} 没删干净（${e.code || e.message}）。把 Codex、Claude Code 都退出，再运行一次。`);
        }
      } else if (a.kind === "rule" && a.state !== "same") {
        const now = isFile(a.file) ? readRuleText(a.file) : "";
        if (now !== a.before) throw new Refusal(`${a.file} 刚读完就被改过了（可能别的程序正在改它）。为了不覆盖新改的内容，这次停下；请重新运行一次。`);
        if (isFile(a.file)) {
          const to = join(backup(), a.tool, basename(a.file));
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(a.file, to);
          log.push([a.file, to]);
        }
        mkdirSync(dirname(a.file), { recursive: true });
        writeTextAtomic(a.file, a.after);
      }
    }
  } finally {
    if (backupDir) writeNote(backupDir, log);
  }
  return { backupDir, problems };
}

function writeNote(dir, log) {
  const lines = [
    `这是老板知识库（boss-kb）安装脚本在 ${stamp()} 改动之前留的备份。`,
    "要恢复哪份，就把右边的备份复制回左边的位置（先把那边现在的文件另存一份）。拿不准就请帮你装的人来。",
    "",
    "原位置 → 备份",
    ...log.map(([from, to]) => `${from} → ${to}`),
  ];
  writeFileSync(join(dir, "说明.txt"), `${lines.join("\n")}\n`, "utf8");
}

/** 复制 Skill。prune：已装那份里新版没有的旧文件删掉（只删 Skill 自己那几类文件，删空的子文件夹一起删）。不对 Skill 文件夹本身改名。 */
function copySkill(from, to, prune = false) {
  const files = listSkillFiles(from, true);
  for (const f of files) {
    mkdirSync(dirname(join(to, f)), { recursive: true });
    copyFileSync(join(from, f), join(to, f));
  }
  if (!prune) return;
  for (const f of listSkillFiles(to, false)) {
    if (files.includes(f)) continue;
    rmSync(join(to, f), { force: true });
    for (let d = dirname(join(to, f)); d !== to && dirname(d) !== d; d = dirname(d)) {
      try { if (readdirSync(d).length) break; rmdirSync(d); } catch { break; }
    }
  }
}

/** 整个文件夹复制进备份。链接不跟进去（避免绕圈），只复制普通文件。 */
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const p = join(from, name);
    const st = lstatSync(p);
    if (st.isDirectory()) copyTree(p, join(to, name));
    else if (st.isFile()) copyFileSync(p, join(to, name));
  }
}

/** 装完回读一遍：Skill 文件在、规则里的路径对、旧版那一段没了。 */
export function verify(plan) {
  const problems = [];
  for (const a of plan.actions) {
    if (a.kind === "skill" && a.state !== "link" && !isFile(join(a.target, "SKILL.md"))) problems.push(`没找到 ${join(a.target, "SKILL.md")}`);
    if (a.kind === "mine" && !["link", "blocked"].includes(a.state) && !sameMine(a.target, a.files)) problems.push(`“我的知识库”Skill 没写对：${a.target}`);
    if (a.kind !== "rule") continue;
    const text = isFile(a.file) ? readRuleText(a.file) : "";
    if (pathFromRules(text) !== plan.kb) problems.push(`${a.file} 里没读到正确的知识库路径`);
    if (hasLegacyBlock(text)) problems.push(`${a.file} 里${OLD_LABEL}写的那一段还在`);
  }
  return problems;
}

/** 卸完回读一遍：Skill 文件夹不在了、规则里没有那一段了（新旧两种）。 */
export function verifyUninstall(plan) {
  const problems = [];
  for (const a of plan.actions) {
    if (a.kind === "old" && existsSync(a.target)) problems.push(`Skill 还在：${a.target}`);
    if (a.kind === "rule" && isFile(a.file) && blockLines(readRuleText(a.file)).length) problems.push(`规则里那一段还在：${a.file}`);
  }
  return problems;
}

export function status() {
  const loc = locations();
  const lines = ["现在的情况："];
  const rows = [["codex", loc.codex.skillDir, [loc.codex.agentsFile, loc.codex.overrideFile]], ["claude", loc.claude.skillDir, [loc.claude.ruleFile]]];
  for (const [tool, dir, files] of rows) {
    lines.push(`- ${LABEL[tool]}：Skill ${isFile(join(dir, "SKILL.md")) ? `已装（${dir}）` : "没装"}`);
    const mineDir = loc[tool].mineDir;
    lines.push(`  “我的知识库”（${MINE_NAME}）：${isMine(mineDir) ? `已生成（${mineDir}）` : isDir(mineDir) ? `有一个同名的、不是安装脚本生成的（${mineDir}），没动` : "还没生成：运行安装（--kb）会生成"}`);
    for (const f of files) {
      if (!isFile(f)) { if (f !== loc.codex.overrideFile) lines.push(`  全局规则：还没有这个文件（${f}）`); continue; }
      let text;
      try { text = readRuleText(f); } catch (e) { lines.push(`  全局规则读不了（${f}）：${e.message}`); continue; }
      const kb = pathFromRules(text);
      lines.push(`  全局规则：${kb ? `记着“${kb}”` : "还没记知识库"}（${f}）`);
      if (hasLegacyBlock(text)) lines.push(`  这一段是${OLD_LABEL}写的：重新运行安装会原地换成新版。`);
      if (kb) lines.push(`  ${kbState(kb)}`);
    }
  }
  if (isFile(join(loc.codex.legacySkillDir, "SKILL.md"))) lines.push(`- 注意：旧位置还有一份（${loc.codex.legacySkillDir}），可能出现两个同名 Skill；重新运行安装会把它挪进备份。`);
  for (const d of [...loc.codex.oldNameDirs, ...loc.claude.oldNameDirs]) {
    if (isDir(d) && !isLink(d) && !besideSource(d)) lines.push(`- 注意：还有${OLD_LABEL}（${d}），它的本事已经并进 boss-kb；重新运行安装会把它挪进备份。`);
  }
  if (loc.codex.overrideActive) lines.push(`- 注意：Codex 正在用 ${loc.codex.overrideFile}，它在的时候 Codex 不读 AGENTS.md。`);
  const oldBackups = join(loc.home, `.${OLD_SKILL_NAME}`, "备份");
  if (isDir(oldBackups)) lines.push(`- 以前的备份还在 ${oldBackups}，没动；新的备份放在 ${loc.backupRoot}。`);
  return lines.join("\n");
}

function kbState(kb) {
  if (!isDir(kb)) return "这个文件夹现在找不到了（搬家了？），用新位置重新运行安装。";
  const kind = detectKb(kb).kind;
  return { v2: "文件夹在，是新版知识库。", v1: "文件夹在，是旧版知识库。", agents: "文件夹在，有 AGENTS.md，但不是老板知识库格式。", none: "文件夹在，但里面没有 AGENTS.md。" }[kind];
}

function report(plan, dryRun) {
  const out = [dryRun ? "预演（什么都没改）：" : "做了这些事："];
  plan.actions.forEach((a, i) => out.push(`${i + 1}. ${a.say}`));
  if (!plan.actions.length) out.push("（没有要做的事）");
  if (dryRun && plan.asks.length) out.push("", "要先问老板（问清楚再正式运行）：", ...plan.asks.map((a) => `- ${a}`));
  for (const n of plan.notes) out.push(`提醒：${n}`);
  const work = plan.actions.some((a) => a.state !== "same" && a.state !== "link");
  if (dryRun && work && !plan.asks.length) out.push("", "预演正常。正式运行要写到项目外面的用户文件夹：在 Codex 里直接申请带权限运行（不进沙箱）。");
  return out.join("\n");
}

function nextSteps(plan) {
  const skill = plan.actions.find((a) => a.kind === "skill");
  const firstRule = plan.actions.find((a) => a.kind === "rule");
  const from = firstRule?.tool === "claude" ? "Claude Code 全局规则" : "Codex 全局规则";
  const codex = plan.actions.some((a) => a.tool === "codex");
  const open = codex
    ? "Codex 里新建项目选它，弹出“信任此文件夹吗？”时点“信任文件夹”"
    : "在 Claude Code 里打开它（命令行版：进到这个文件夹再运行 claude），问信不信任这个文件夹时选“是”";
  const allow = codex ? "选“允许一次”，别选“始终允许”" : "选只允许这一次的那个";
  return `给 AI 的自检（现在就做，用装好的那份、从知识库外面找）：
  node "${join(skill.target, "scripts", "find_kb.mjs")}" --cwd "${plan.loc.home}"
  结果里“怎么找到的：${from}”，就说明规则记对了。

下一步（要你自己点）：
1. 在“文稿”里新建一个空文件夹“客户方案”；${open}。
2. 在这个项目里开新对话，问一个只有你知识库里才有的问题，比如“<某位客户>上次聊到哪了？写明出处。”能答出来、带出处，就装好了。规则和 Skill 只在新对话里生效。输入 $我的，列表里能看到“我的知识库”。
3. 再说“把刚才聊到的结论记到知识库”：它会先列要写什么，你说“确认”；弹窗问能不能改知识库时${allow}。`;
}

export function main(argv, cwd = process.cwd()) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.status) { console.log(status()); return 0; }
  const plan = opts.uninstall ? planUninstall() : planInstall(opts, cwd);
  if (opts.uninstall && !plan.actions.length) {
    console.log(["没找到装好的老板知识库（boss-kb），全局规则里也没有那一段，不用卸。", ...plan.notes.map((n) => `提醒：${n}`)].join("\n"));
    return 0;
  }
  console.log(report(plan, opts.dryRun));
  if (opts.dryRun) return 0;
  const { backupDir, problems } = apply(plan);
  if (backupDir) console.log(`\n改之前的旧文件备份在：${backupDir}（里面的“说明.txt”写着每份原来在哪）`);
  const all = [...problems, ...(opts.uninstall ? verifyUninstall(plan) : verify(plan))];
  if (all.length) { console.log(`\n回读时发现问题，没做完：\n- ${all.join("\n- ")}`); return 1; }
  if (opts.uninstall) { console.log("\n卸载好了，回读检查通过。新开的对话里就不会再用老板知识库（boss-kb）了。知识库本身一个文件都没动。"); return 0; }
  console.log(`\n装好了，回读检查通过。\n\n${nextSteps(plan)}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    const where = lastBackupDir ? `\n改之前的旧文件备份在：${lastBackupDir}` : "";
    if (e instanceof Refusal) { console.log(e.message + where); process.exitCode = 2; }
    else if (e.code === "EPERM" || e.code === "EACCES") {
      console.log(`没有权限动这里：${e.path || "（未知位置）"}\n如果是在 Codex 里运行：这是 Codex 的保护拦住了（安装要写到项目外面的用户文件夹）。请申请带权限运行（不进沙箱），弹窗里选“允许一次”，别选“始终允许”。\n如果是读文件就被拦（Mac 上常见于“文稿”“桌面”、iCloud 云盘）：去“系统设置 → 隐私与安全性 → 文件与文件夹”给 Codex 打开对应的文件夹。\n运行 --status 可以看看已经装好了哪些。${where}`);
      process.exitCode = 2;
    } else { console.log(`出错了：${e.message}\n可能只改了一部分。运行 --status 看看现在的情况，或把这段话发给 AI、帮你装的人看。${where}`); process.exitCode = 1; }
  }
}
