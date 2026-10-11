// 体检的入口检查：AGENTS.md 的知识库标记段、工作台段、行数和大小、地图位置、路由路径；CLAUDE.md 只放 @AGENTS.md（check.mjs 用）。只读。
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_MAX_BYTES, MARK_START, V1_MARK, WORKBENCH_START, WORKBENCH_END, read, unique, routePaths, blockPaths } from "./lib.mjs";
import { NO_MARK, NO_END, MUST_READ, mustReadPath, managedRange, lineCount, lineAt, indexesOf } from "./check-rules.mjs";

export const TITLE_LIKE = /^(?:\s*|#{1,6}\s.*|>.*)$/;
/** AGENTS.md 太大：说清先挪哪一节 */
export const sizeWarning = (text) => `AGENTS.md 有 ${Buffer.byteLength(text)} 字节，超过 ${AGENTS_MAX_BYTES / 1024} KB（Codex 读入口文件连全局规则一共只读 32 KiB，超了后面的会被截掉）：先把知识库那段的“文件开头”一节换成一句“开头格式见 01-AI协作/README.md”，再把“怎么写”里的细则挪进 01-AI协作/README.md；地图、常见任务、怎么读、隐私不挪。工作台段太长交给 boss-workbench 精简；你自己写的部分，问过你再精简`;
/** 入口：标记段只能有一个、要有结束；工作台段成对、在知识库段外面；旧段；行数分段算；标记位置；地图位置；路由路径（C19、C17） */
export function checkEntry(root, agentsText, { structure, layout, onManifest, deferred }, errors, warnings) {
  const range = managedRange(agentsText);
  if (!range) {
    if (!deferred) errors.push(NO_MARK); // 暂缓追加的（就地建图）由调用方报那一条“入口没接上”
    if (lineCount(agentsText) > 100) warnings.push(`AGENTS.md 一共 ${lineCount(agentsText)} 行，其中你原来写的有 ${lineCount(agentsText)} 行；AI 每次都会读全文，建议精简你自己写的部分`);
    if (Buffer.byteLength(agentsText) > AGENTS_MAX_BYTES) warnings.push(sizeWarning(agentsText));
    return { format: null, routes: [] };
  }
  const format = `老板知识库/${agentsText.match(MARK_START)[1]}`;
  const marks = indexesOf(agentsText, MARK_START).length;
  if (marks > 1) errors.push(`AGENTS.md 里有 ${marks} 个知识库标记段，只能留一个`);
  if (!range.closed) errors.push(NO_END);
  const wbStart = indexesOf(agentsText, WORKBENCH_START);
  const wbEnd = indexesOf(agentsText, WORKBENCH_END);
  if (wbStart.length !== wbEnd.length || [...wbStart, ...wbEnd].some((i) => i > range.start && i < range.end)) {
    warnings.push("工作台段的标记不成对（或放进了知识库段里），交给 boss-workbench 修");
  }
  if (V1_MARK.test(agentsText)) warnings.push("旧版‘知识库规则’段还在，和新规矩冲突；先把 check 跑通，老板同意后删掉");

  const startLine = lineAt(agentsText, range.start);
  const managed = lineAt(agentsText, range.end) - startLine + 1;
  let workbench = 0;
  if (wbStart.length === wbEnd.length) {
    wbStart.forEach((s, i) => {
      const n = lineAt(agentsText, wbEnd[i]) - lineAt(agentsText, s) + 1;
      workbench += n;
      if (n > 8) warnings.push(`工作台段有 ${n} 行，交给 boss-workbench 精简`);
    });
  }
  const total = lineCount(agentsText);
  if (managed > 90) warnings.push(`知识库 Skill 维护的那段有 ${managed} 行，超过 90 行：细则挪进 01-AI协作/README.md`);
  else if (total > 100) warnings.push(`AGENTS.md 一共 ${total} 行，其中你原来写的有 ${Math.max(0, total - managed - workbench)} 行；AI 每次都会读全文，建议精简你自己写的部分`);
  if (Buffer.byteLength(agentsText) > AGENTS_MAX_BYTES) warnings.push(sizeWarning(agentsText));

  // 追加在老板原有 AGENTS.md 后面的（段里的标题是“## …的知识库”）不要求在第 1 行
  const blockLines = range.text.split("\n");
  const appended = /^##\s.*的知识库/.test(blockLines.slice(1).find((l) => l.trim()) || "") || onManifest.has("AGENTS.md");
  const before = agentsText.slice(0, range.start).split("\n").slice(0, -1);
  if (structure !== "就地建图" && startLine > 1 && !appended && before.length <= 10 && before.every((l) => TITLE_LIKE.test(l))) {
    warnings.push("AGENTS.md 第 1 行应是 <!-- 老板知识库 v2… -->，标题和说明放进标记段（段外的会被当成老板自己写的，Skill 改不了）");
  }
  for (const [heading, label] of [["## 地图", "地图"], ["## 常见任务先读哪里", "常见任务表"]]) {
    const at = blockLines.findIndex((l) => l.startsWith(heading));
    if (at + 1 > 60) {
      warnings.push(`AGENTS.md 的${label}在${startLine > 10 ? "知识库那段的" : ""}第 ${at + 1} 行，太靠后：AI 和工作台都先看开头，地图和常见任务表放在前 60 行内；精简前面的内容，或把细则挪进 01-AI协作/README.md`);
      break;
    }
  }
  const mustRead = new Set(MUST_READ.map(([id, name]) => mustReadPath(layout, id, name)));
  const routes = routePaths(range.text);
  for (const p of unique(routes)) {
    if (!existsSync(join(root, p)) && !mustRead.has(p)) errors.push(`AGENTS.md 常见任务表里的 ${p} 不存在`);
  }
  // 段里别处提到的 00—99 路径：常见任务表里的上面已经按错误报过；必读四份由 --stage 查；品牌与口吻那句写明了“还没建就先问我”
  const known = new Set([...mustRead, ...routes, `${layout["03-生意"]}/品牌与口吻.md`]);
  for (const p of blockPaths(range.text)) {
    if (!known.has(p) && !existsSync(join(root, p))) warnings.push(`AGENTS.md 里提到的 ${p} 还不存在：建好再写进地图，或先删掉`);
  }
  return { format, routes, range };
}

export const claudeExtra = (text) => text.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^@\.?\/?AGENTS\.md$/.test(l));
/** CLAUDE.md 只放 @AGENTS.md；老板原有的部分（原件清单记了原长度）不管（C16） */
export function checkClaude(root, manifest, warnings) {
  const tip = "Codex 和工作台看不到这里；要长期照做的规矩挪进 AGENTS.md 最后的‘我加的规矩’（老板原来就有的设置不用管）";
  const own = (manifest || []).find((m) => m.path === "CLAUDE.md");
  const main = join(root, "CLAUDE.md");
  if (existsSync(main)) {
    const buf = readFileSync(main);
    const added = own && own.size !== null ? buf.subarray(Math.min(own.size, buf.length)).toString("utf8") : buf.toString("utf8");
    if (claudeExtra(added).length) warnings.push(`CLAUDE.md 里除了 @AGENTS.md 还写了别的。${tip}`);
  }
  for (const name of [".claude/CLAUDE.md", "CLAUDE.local.md"]) {
    const p = join(root, name);
    if (existsSync(p) && statSync(p).isFile() && claudeExtra(read(p)).length) warnings.push(`${name} 里写了规矩。${tip}`);
  }
}
