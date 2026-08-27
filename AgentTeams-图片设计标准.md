# AgentTeams 图片设计标准（V2 头像图集）

> 用途：替换 `/Users/jade/Desktop/dsh-experimental-agent-team-web/assets/agent-team-web/` 下的 15 张图片。
> 全部图片以 PNG 形式由插件静态服务（`/plugins/agent-team-web/assets/`）提供，页面通过 `object-fit: contain` 等比缩放展示。

---

## 1. 图片清单（15 张）

### 1.1 队长头像（1 张）
| 文件名 | 含义 | 显示尺寸 |
|---|---|---|
| `team-lead-v2.png` | 队长（captain）鲸鱼 | 44×44（活动面板）/ 30×30（对话卡片） |

### 1.2 成员头像（8 张）— 按角色关键词自动匹配
| 文件名 | 对应角色（关键词匹配） | 显示尺寸 |
|---|---|---|
| `member-researcher-v2.png` | 研究员（researcher / 研究 / 调查 / 探索） | 40×40 / 24×24 |
| `member-engineer-v2.png` | 工程师（engineer / dev / 后端 / 工程 / 代码） | 40×40 / 24×24 |
| `member-qa-v2.png` | QA/测试（qa / test / 质量 / 验证） | 40×40 / 24×24 |
| `member-designer-v2.png` | 设计师（design / ui / ux / 前端 / 设计） | 40×40 / 24×24 |
| `member-security-v2.png` | 安全（security / audit / 安全 / 审计） | 40×40 / 24×24 |
| `member-docs-v2.png` | 文档/写作（docs / writer / 文案 / 文档） | 40×40 / 24×24 |
| `member-data-v2.png` | 数据分析（data / analys / 数据 / 分析） | 40×40 / 24×24 |
| `member-operator-v2.png` | 运维/发布（ops / release / deploy / 运维 / 发布） | 40×40 / 24×24 |

### 1.3 状态小图标（6 张）— 叠加在成员头像右下角
| 文件名 | 含义 | 显示尺寸 |
|---|---|---|
| `action-working-v2.png` | 工作中（working，悬浮动画） | 22×22 角标 |
| `action-sleeping-v2.png` | 空闲（idle，呼吸动画） | 22×22 角标 |
| `action-thinking-v2.png` | 思考中（unknown，脉动动画） | 22×22 角标 |
| `action-celebrating-v2.png` | 庆祝（预留） | 22×22 角标 |
| `action-reporting-v2.png` | 汇报（预留） | 22×22 角标 |
| `action-sending-v2.png` | 发送消息（预留） | 22×22 角标 |

---

## 2. 尺寸规格

| 类型 | 建议源文件尺寸 | 最小尺寸 | 画布比例 |
|---|---|---|---|
| 队长头像 `team-lead-v2.png` | **256×256 px** | 128×128 px | 1:1 正方形 |
| 成员头像 `member-*-v2.png`（8 张） | **256×256 px** | 128×128 px | 1:1 正方形 |
| 状态图标 `action-*-v2.png`（6 张） | **128×128 px** | 64×64 px | 1:1 正方形 |

说明：
- 页面以 `contain` 缩放，**非正方形图片会左右/上下留白**，观感差，务必使用 1:1 画布。
- 显示尺寸只有 22–44px，源图 ≥128px 即可保证清晰度（2x Retina 也够用），无需超大文件。
- 建议控制单张文件体积 < 200KB（页面一次性加载 15 张）。

---

## 3. 格式要求

- **格式**：PNG（`.png`），RGBA。
- **背景**：**透明背景**（当前 V2 图集全部为透明底插画）。
- **无内边距问题**：主体内容应占画布约 70–90%，四周留少量呼吸空间，避免贴边或过小。

---

## 4. 风格要求

- **统一画风**：15 张图保持同一插画风格（当前为“鲸鱼”拟人化吉祥物风格：圆润、扁平插画、柔和配色）。
- **成员头像**：每张是同一只鲸鱼角色的不同“身份装扮/道具”：
  - researcher → 放大镜/眼镜/研究道具
  - engineer → 扳手/齿轮/代码符号
  - qa → 勾选清单/放大镜/盾牌
  - designer → 画笔/色板/圆规
  - security → 盾牌/锁
  - docs → 文档/钢笔/书本
  - data → 图表/柱状图
  - operator → 火箭/齿轮/部署按钮
- **队长头像**：与成员同风格，但更醒目（如加披风/皇冠/领带），与其他成员区分。
- **状态图标**：小尺寸下仍需可辨识（22px 显示），用简洁符号：
  - working → 闪电/沙漏/齿轮转动
  - sleeping → 月亮/Zzz
  - thinking → 气泡/问号/星星
  - celebrating → 彩带/星星/欢呼
  - reporting → 喇叭/文档箭头
  - sending → 纸飞机/发送箭头
- **配色**：与 DSH 主题协调（浅色模式为主）；避免大面积纯黑/纯白边缘。

---

## 5. 替换说明（供参考）

- 目标目录：`/Users/jade/Desktop/dsh-experimental-agent-team-web/assets/agent-team-web/`
- 文件名必须与上表**完全一致**（代码中有白名单校验，文件名不匹配的图片不会展示）。
- 替换后需刷新 Web GUI 页面（图片带 `max-age=86400` 缓存，极端情况下需强刷）。
- 插件服务白名单（`src/index.ts`）已包含以上 15 个文件名；新增文件不会生效，必须复用现有文件名。

---

## 6. 交付方式（三选一）

1. **最佳：15 张独立 PNG**，按上述文件名命名，放入一个文件夹，交给代理按文件名一一覆盖。
2. **可接受：规整网格拼图**（3×5 或 5×3，格子间有明显缝隙），由代理自动切分。
3. **不推荐：无网格整图**（无法可靠定位 15 个子图）。
