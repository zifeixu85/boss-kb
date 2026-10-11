// 定期维护里“问题”这一类的体检部分（maintain.mjs 用）：用子进程跑 check.mjs --stage quick，
// 把体检报的错误、提醒一条条分开：纯格式问题进“我可以直接改的”，敏感信息、地图、缺内容、隐私和拿不准的进“要你确认的”。
// 同一件事别的类已经说了的（地图里没写的文件夹、只有说明的层、只有 README 的模块、AGENTS.md 太大、断链）这里不再说。只读。
import { spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECK_LINK = "链接指向不存在的文件";
const TOP = 5;
const nfc = (s) => String(s).normalize("NFC");

/** 跑一次体检：返回 { stats（放进 JSON 的计数和前几条）, messages: [{ level, text }] }；没跑成时 stats.ran 是 false */
export function runCheck(root, layout, reportDir) {
  const script = join(dirname(fileURLToPath(import.meta.url)), "check.mjs");
  const res = spawnSync(process.execPath, [script, root, "--stage", "quick"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 300000 });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch { /* 下面按没跑成处理 */ }
  if (!json || !Array.isArray(json.errors) || !Array.isArray(json.warnings)) {
    const why = (res.error && res.error.message) || String(res.stderr || "").trim().split("\n")[0] || "没有输出";
    return { stats: { ran: false, error: why, errors: 0, warnings: 0, counted: 1, top_errors: [], top_warnings: [] }, messages: [] };
  }
  // 维护报告自己（体检/ 文件夹）不算
  const growth = `${layout["90-持续生长"]}/`;
  const ours = (m) => String(m).includes(`${reportDir}/`) || (String(m).includes(growth) && String(m).includes("体检/"));
  const errors = json.errors.filter((m) => !ours(m)).map(String);
  const warnings = json.warnings.filter((m) => !ours(m)).map(String);
  return {
    stats: { ran: true, errors: errors.length, warnings: warnings.length, counted: 0, top_errors: errors.slice(0, TOP), top_warnings: warnings.slice(0, TOP), ...(json.summary ? { verdict: json.summary.verdict } : {}) },
    messages: [...errors.map((text) => ({ level: "错误", text })), ...warnings.map((text) => ({ level: "提醒", text }))],
  };
}

// ───── 别的类已经说了的：在“问题”里去掉 ─────
/** 体检的提醒说的是哪个文件夹没进地图、哪一层只有说明、哪个模块只有 README（other 是别的类里同一件事的文件夹集合） */
const DUPLICATES = [
  [/^顶层文件夹 (.+?)\/ 不在地图里/, "unmapped"],
  [/^(.+?)\/ 在磁盘上有，但 AGENTS\.md 地图里没有/, "unmapped"],
  [/^(?:只读|不读)文件夹 (.+?)\/ 没写进 AGENTS\.md 地图/, "unmapped"],
  [/^(.+?)\/ 还只有说明：/, "emptyLayers"],
  [/^生长模块 (.+?)\/ 已经启用，但里面除了 README 还没有文件/, "readmeOnly"],
];
function duplicated(text, other) {
  if (text.startsWith(CHECK_LINK)) return true; // 断链由维护脚本自己查（能找到新位置的会说），不重复
  if (other.agentsBig && /^AGENTS\.md 有 \d+ 字节，超过/.test(text)) return true;
  for (const [re, key] of DUPLICATES) {
    const m = text.match(re);
    if (m && other[key].has(nfc(m[1]))) return true;
  }
  return false;
}

// ───── 分类：先看能不能直接改（纯格式），其余都要老板点头 ─────
const FORMAT = "只改写法，内容不动";
const CONTENT = "缺内容：记进“下次访谈可以问”；你手上有材料就直接发我";
/** [规则, 类别, 能不能直接改, 建议]；从上往下第一条对上的算。没对上的一律“要你定”、要确认 */
const RULES = [
  // 字段写法
  [/^(开头元信息要用英文冒号|文件第 1 行要是 ---|只有‘来源’能写成多行列表|多个来源写成列表|开头元信息超过 2 KB|待办格式不对)/, "字段写法", true, FORMAT],
  [/^(来源|整理进)写从知识库根目录起的 \.md 路径，不写双链/, "字段写法", true, "把双链换成从知识库根目录起的 .md 路径，别的不动"],
  [/^缺少文件开头的元信息/, "字段写法", true, "补上开头 5 项：类型按所在的层写，更新写今天，确认写待确认，隐私拿不准写私密，来源不知道写未知"],
  [/^缺少字段 来源/, "缺内容", false, "问你这份是从哪来的（采访、聊天、你口述还是别的材料）"],
  [/^缺少字段 /, "字段写法", true, "补上这一项：类型按所在的层写，更新写今天，确认写待确认，隐私拿不准写私密"],
  // 日期写法
  [/^(“[^”]+”要写成 2026-10-25|演示日期要写成|待办的截止要写成)/, "日期写法", true, "改成 2026-10-25 这样的日期；原来的说法挪进正文，算不出日期的写“未知”或“未定”（“更新”写今天）"],
  // 索引
  [/的索引里没有 |没提到子文件夹 /, "索引漏行", true, "在 README 的索引里补一行（index.mjs 能补；05 层手工补进方法选择表）"],
  [/的索引里还有 \d+ 行写着（待补）/, "索引漏行", true, "照各文件开头补上一句稳定的定位"],
  [/的索引里还留着“（暂时没有）”/, "占位", true, "删掉这一行"],
  // 表格、占位、链接写法
  [/行的表格有 \d+ 格，表头是 \d+ 格/, "表格错列", true, FORMAT],
  [/还有没填的模板占位|的“[^”]+”是空的：删掉，或补上内容/, "占位", true, "删掉没内容的占位和空段落，不留空壳；以后有内容再加"],
  [/^用了 \[\[双链\]\]，换成普通 Markdown 链接/, "链接写法", true, "换成 [名字](相对路径.md)，指向不变"],
  // 敏感信息
  [/^疑似(密码或密钥|手机号|身份证号|银行卡号)/, "敏感信息", false, "问你：删掉、打码（如 138****5678），还是挪到别处；不经你同意不动"],
  [/^可能是银行卡号/, "敏感信息", false, "问你这是卡号还是订单号：是卡号就删掉"],
  [/^原件里有|疑似敏感原件/, "敏感信息", false, "原件不改；问你要不要挪走或删掉，整理时别抄进整理稿"],
  [/^出现了不该出现的词/, "敏感信息", false, "问你怎么改"],
  // 隐私、状态这类值：改了就等于替你拿主意
  [/^“隐私”只能是/, "隐私", false, "问你这份该标私密、内部还是可公开（拿不准先按私密）"],
  [/^“确认”只能是/, "要你定", false, "问你这份算待确认还是已确认"],
  [/^项目状态只能是/, "要你定", false, "问你项目现在是进行中、等待、暂停还是完成"],
  [/^阶段‘/, "要你定", false, "问你对应工作台的哪个阶段；说法想保留，就在 01-AI协作/README.md 加一张阶段对应表"],
  [/不在类型清单里/, "要你定", false, "问你这份算哪一类"],
  // 地图
  [/地图/, "地图", false, "问你这个文件夹装什么、地图怎么写；定了我改地图和建库档案"],
  // 缺内容（快速版收尾查的那些，和建库档案、模块里还空着的）
  [/^建库档案的“|^还没有|^快速版建议|^工作台每次都要读|还没有记了原话的采访记录|^生长模块 |还只有说明|^做内容|不能说的话|^类型“.+”缺少字段|还有 \d+ 处没填的占位|建库快照|接入清单|目录对应/, "缺内容", false, CONTENT],
];

/** 消息里提到的库内文件和文件夹（按出现的先后；文件夹是别的路径的上级时不单列） */
function pathsIn(text, known) {
  const hits = [];
  for (const p of known) {
    let at = text.indexOf(p);
    while (at >= 0) {
      const before = text[at - 1] || "";
      const after = text[at + p.length] || "";
      if (!/[A-Za-z0-9_\-./\u3400-\u9fff]/.test(before) && !/[A-Za-z0-9_\-.\u3400-\u9fff]/.test(after)) { hits.push({ p, at }); break; }
      at = text.indexOf(p, at + 1);
    }
  }
  const all = hits.map((h) => h.p);
  const paths = hits.filter((h) => !all.some((q) => q !== h.p && q.startsWith(`${h.p}/`))).sort((a, b) => a.at - b.at).map((h) => h.p);
  if (!paths.length && /建库档案/.test(text)) return ["01-AI协作/建库档案.md"];
  return paths;
}

/** 来源、常见任务表里写的文件找不到：全库只有一份同名的，就是挪到那里了 */
function movedTo(text, byName) {
  const m = text.match(/^来源文件不存在：(.+?) → (.+)$/) || text.match(/^AGENTS\.md 常见任务表里的 (.+) 不存在$/);
  if (!m) return undefined;
  const [from, target] = m.length === 3 ? [m[1], m[2]] : ["AGENTS.md", m[1]];
  const hits = (byName.get(basename(nfc(target)).toLowerCase()) || []).filter((r) => r !== nfc(from));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 体检报的每一条变成一条信号：{ kind, where, paths, why, suggest, confirm, level }。
 * ctx：known（库内文件和文件夹的相对路径）、byName（文件名 → 路径）；other：别的类里同一件事的文件夹（见 DUPLICATES）。
 * 文件在“地图里没写”的文件夹里的，先等老板定这个文件夹装什么，一律要确认。
 */
export function checkItems({ stats, messages }, ctx, other) {
  if (!stats.ran) {
    return [{ kind: "体检没跑成", where: "scripts/check.mjs", paths: [], why: `体检脚本没跑成：${stats.error}`, suggest: "单独跑一次 check.mjs 看看报什么；这次的问题只有下面这些", confirm: false }];
  }
  const out = [];
  for (const { level, text: raw } of messages) {
    const text = nfc(raw);
    if (duplicated(text, other)) continue;
    const paths = pathsIn(text, ctx.known);
    let [kind, direct, suggest] = ["要你定", false, "照体检的提示改之前先问你"];
    const moved = movedTo(text, ctx.byName);
    if (moved !== undefined) {
      [kind, direct, suggest] = moved ? ["链接挪了", true, `看起来挪到了 ${moved}，改成指向它`] : ["链接断了", false, "问你这份文件去哪了：找到就改，不要了就删掉这一条"];
    } else {
      const rule = RULES.find(([re]) => re.test(text));
      if (rule) [, kind, direct, suggest] = rule;
    }
    const pending = paths.map((p) => [...other.unmapped].find((d) => p === d || p.startsWith(`${d}/`))).find(Boolean);
    if (pending && direct) [direct, suggest] = [false, `${pending}/ 还没定装什么（见“结构建议”），定了再改：${suggest}`];
    out.push({ kind, where: paths[0] || "整个知识库", paths, why: text, suggest, confirm: !direct, level });
  }
  return out;
}
