# 老板知识库（boss-kb）

一问一答的采访，把你的生意、客户、项目、做事方法和判断，整理成一个“文件夹 + Markdown”的知识库。Codex、Claude Code 和[老板工作台](https://github.com/zifeixu85/boss-workbench)都能读。

> An Agent Skill that interviews a business owner and builds a plain-folder Markdown knowledge base that Codex / Claude Code can navigate. Docs are in Chinese.

适合有业务、有工作的人：老板、一人公司、自由职业者、团队负责人。不用会写代码，也不一定要用 Obsidian。

## 能做什么

- **快速建库**：先说清隐私，再问“哪些东西不放进来”，接着 11 个问题一题一题问，大约 60—90 分钟，可以分两次。问完先复述给你核对，你说“确认”才写文件。之后可以分几次补访，补成完整版。
- **接入已有资料**：Obsidian 库、Notion 导出、自己的文件夹都行。原来的文件不搬家、不改，只写一张“地图”。每个文件夹由你勾选：正常接入、只读、不读。
- **Obsidian 写法可选**：建库时问你用不用 Obsidian；用的话文件之间用双链，结构和规矩不变。
- **在别的项目里也能用**：记下知识库在哪以后，在客户方案、内容项目里问“某某上次聊到哪了”，AI 会去知识库找、带出处回答，写回时只追加、先问你。
- **定期维护**：每周体检，查冗余、过期、积压、断链、隐私标错；每月给出结构建议；生意变了再访谈一次，调整结构。可以交给 Codex App 的定时任务跑，自动跑时只新建报告，不改你的文件。
- **把怎么拿主意记下来**：报价、接单、选题这类判断，记成“场景 · 判断 · 为什么 · 适用条件”的样本，攒够了再提成规则。
- **深度版（可选）**：想让 AI 更懂你，再分几次聊经历、看重什么、和 AI 怎么配合。建库时不做，以后随时补。

## 知识库长什么样

```text
你的知识库/
├── AGENTS.md          ← 入口：地图和规矩（CLAUDE.md 一行导入它）
├── 00-收件箱/          随手丢进来的材料
├── 01-AI协作/          建库档案、协作偏好、任务手册
├── 02-关于我/          基本情况、做事与决策方式、说话方式、边界
├── 03-生意/            生意总览、产品与价格、团队、品牌与口吻
├── 04-客户/            一家一份
├── 05-方法与判断/      一类工作一个文件夹：做法、判断样本、判断规则
├── 06-项目/            一个项目一份、近期要事
├── 1x-按生意长的模块/  如 渠道与经营、内容与作品、达人库
├── 90-持续生长/        AI 的发现、复盘、维护报告
└── 99-原始材料/        采访原话、聊天、原件
```

每份整理过的文件，开头都写清类型、更新日期、确认状态（待确认 / 已确认 / 已过期）、隐私级别（私密 / 内部 / 可公开）和来源。AI 写的一律先标“待确认”。

## 安装

要求：Node.js 18 以上、git。命令里写 `"$HOME/..."`，Mac 的终端和 Windows 的 PowerShell 都认（PowerShell 不会把 `~` 展开给 git、node）。

**Codex**：

```bash
git clone https://github.com/zifeixu85/boss-kb.git "$HOME/.agents/skills/boss-kb"
```

**Claude Code**：

```bash
git clone https://github.com/zifeixu85/boss-kb.git "$HOME/.claude/skills/boss-kb"
```

装好以后**新开一个对话**，输入 `$boss-kb`（Claude Code 里是 `/boss-kb`），说“帮我建知识库”。

想在别的项目里也用这个知识库，建好以后在知识库文件夹里运行下面这条，在全局规则里记下知识库在哪（先预演，什么都不改）：

```bash
node "$HOME/.agents/skills/boss-kb/scripts/install.mjs" --kb "<你的知识库文件夹>" --dry-run
```

预演没问题，去掉 `--dry-run` 再跑一次。详细说明和卸载见 [references/安装与全局规则.md](references/安装与全局规则.md)。

用 `git clone` 装的，卸载就两步：删掉全局规则文件（Codex 是 `~/.codex/AGENTS.md`，Claude Code 是 `~/.claude/CLAUDE.md`）里 `<!-- boss-kb 老板知识库 开始 -->` 到 `<!-- boss-kb 老板知识库 结束 -->` 这一段，再删掉 `boss-kb` 这个文件夹。你的知识库一个文件都不会动。

## 常用说法

| 你说 | 它做什么 |
|---|---|
| 帮我建知识库 | 空文件夹：快速建库；已有资料：只写地图接入 |
| 继续建库 / 补访我的报价判断 | 接着上次的进度问，一次一题 |
| 整理一下 | 把收件箱里的材料归位，先列清单再写 |
| 知识库体检 / 知识库维护 | 只读检查，给出“已经好的 / 我可以直接改的 / 要你确认的” |
| 本周复盘 | 从记录里找规律，写成待你确认的发现 |
| 深度采访我 | 可选的深度版 |
| 记下我的知识库在哪 | 写全局规则，别的项目也能用 |

## 现在的状态

- 版本：`老板知识库/2 2026-10-12`。
- 脚本只用 Node 自带功能，自动测试 183 项：`node --test scripts/tests/*.test.mjs`。
- 用虚构老板的资料从头模拟建库，测过多轮。**真人老板、Windows、干净电脑都还没实测**；用到的问题欢迎提 issue。

## 搭配使用

[老板工作台（boss-workbench）](https://github.com/zifeixu85/boss-workbench)：读这个知识库，在本机搭一个个人工作台网页，首页是你的客户、待办和生意数据。

## 许可与署名

[Apache License 2.0](LICENSE)。转发、修改或二次分发时请保留 [NOTICE.md](NOTICE.md)，注明出处：A梦 · <https://ameng.blog>。
