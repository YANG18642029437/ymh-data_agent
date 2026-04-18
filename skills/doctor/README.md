---
name: doctor
description: 诊断 Vibe Coding Agent 开发产物在开发环境（develop）或生产环境（product）运行时的问题。当用户报告应用报错、数据异常、功能不符合预期、需要查看日志、服务启动失败、接口超时/500、或需要排查生产/开发环境问题时使用本技能。通过 exec_sql 查询数据库、读取本地日志或查询生产环境日志来定位根因，给出修复建议。
---

# Doctor — 运行时问题诊断

## 安全约束（必须遵守）

| 约束 | 规则 |
|------|------|
| `product` 数据库 | 只执行 SELECT，**禁止** INSERT / UPDATE / DELETE / DDL |
| 本地日志读取 | 单次输出最多 **50 行**；**禁止** `mkdir -p /app/work/logs/bypass/`；**禁止**通配符读取（如 `*.log`） |
| 本地日志白名单 | 只可读取：`/app/work/logs/bypass/app.log`、`/app/work/logs/bypass/console.log`、`/app/work/logs/bypass/dev.log`、`/tmp/coze-logs/dev.log`（vibeMiniApp 热更新） |
| 敏感数据（PII） | 只返回统计值，不展示原始内容 |

## 可用工具

### exec_sql（数据库查询）

```
exec_sql(sql: str, env: 'develop' | 'product') -> QueryResult
```

`develop` 可读写；`product` 仅 SELECT。详细 SQL 诊断模板见 [references/sql-patterns.md](references/sql-patterns.md)。

### 本地日志（develop 环境）

**日志文件（按项目类型）：**

先执行 `echo $COZE_PROJECT_TYPE` 获取项目类型，再按下表选择日志文件：

| 文件 | 用途 | 适用项目类型 |
|------|------|------------|
| `app.log` | 主流程 + 关键错误，后端/服务问题首选 | 全部 |
| `console.log` | 浏览器控制台，前端/端侧问题首选 | `general_web` / `app` / `wechat_mini_program` |
| `dev.log` | 补充调试信息 | `general_web` |
| `/tmp/coze-logs/dev.log` | 热更新编译日志 | `wechat_mini_program` |

**按报错场景选择日志（优先级从左到右）：**

| 报错场景 | 关键词特征 | 优先读取 |
|---------|-----------|---------|
| 页面白屏 / 渲染异常 / 资源加载失败 | `fetch`、`DOM`、`render`、`WebSocket` | `console.log` → `app.log` |
| 服务启动失败 / 接口 500 / 超时 / 构建失败 | `500`、`timeout`、`connection refused`、`build` | `app.log` → `dev.log` → `console.log` |
| 热更新失效 / 编译报错（vibeMiniApp） | 代码改动后页面不更新 | `/tmp/coze-logs/dev.log` → `app.log` |
| 无法判断 | — | 默认 `app.log`（后端优先） |

**常用命令（单次 ≤ 50 行）：**

```bash
# 最新日志
tail -n 50 /app/work/logs/bypass/app.log

# 搜索错误行
grep -nE "Error|Exception|WARN|ERROR" /app/work/logs/bypass/app.log | tail -n 50

# 定点读取上下文（先 grep 拿行号，再取范围）
sed -n "<start>,<end>p" /app/work/logs/bypass/app.log
```

**新增日志规范：**
- 使用标准 logging 工具，禁止 print/println
- 包含稳定关键字（模块名 / 请求 ID / 错误码），便于 grep 定位
- 禁止输出密钥、token、密码等敏感信息
- 后台进程重定向须写入 `/app/work/logs/bypass/`，禁止写入 `/tmp` 等目录

### 生产环境日志（product 环境）

使用 `search_runtime_log` 工具查询，`project_id` 由系统自动注入，无需手动传入。

**参数：**

| 参数 | 必填 | 说明 |
|------|------|------|
| `query` | 否 | 关键词搜索 |
| `start_time` / `end_time` | 否 | 毫秒时间戳，需同时传；不传默认最近 30 分钟 |
| `limit` | 否 | 每页条数，默认 20，最大 100 |
| `cursor` | 否 | 分页游标，第一页传空，后续传上次返回的 `next_cursor` |
| `deploy_history_id` | 否 | 指定部署版本 |

**返回结构：**

```json
{
  "logs": [
    { "time": "1774332844000", "content": "...", "commit_hash_short": "abc1234" }
  ],
  "next_cursor": "<cursor_for_next_page>"
}
```

**使用要点：**
- 优先用 `query` 过滤关键词（如 `Error`、`Exception`），避免拉取全量日志
- `next_cursor` 非空时表示还有下一页，传入 `cursor` 参数继续翻页
- 单次 `limit` 不超过 **50**，分批分析

## 诊断流程

### 1. 收集现象

确认以下信息（用户已提供则跳过）：
- **问题描述**：报错信息、异常行为、预期结果
- **发生环境**：develop / product / 两者均有
- **触发条件**：哪个功能、哪类请求、是否可复现

### 2. 检查日志（报错 / 启动失败 / 500 / 超时时优先）

1. 根据报错场景和项目类型，按「本地日志」章节的优先级选择日志文件
2. 提取完整 traceback 和关键 ERROR/WARN 行，基于堆栈定位代码位置
3. product 环境：调用生产环境日志接口（见「生产环境日志」章节），用 `query` 参数过滤关键词

日志能定位根因时，直接进入第 5 步；需要进一步验证数据时继续第 3 步。

### 3. 数据诊断（数据异常 / 逻辑问题时执行）

先探索 schema，再根据现象选择查询策略（数据缺失、状态异常、关联不一致、时序分析等）。具体 SQL 模板见 [references/sql-patterns.md](references/sql-patterns.md)。

### 4. 对比环境差异（仅当两环境表现不一致时）

在 `develop` 验证假设，再到 `product` 对比数据量、状态分布、最近变更时间。

### 5. 输出诊断报告

```
## 诊断结论
**根因**：<一句话>
**证据**：
- <日志行 / 查询结果>
**影响范围**：<记录数 / 用户数 / 功能>

## 修复建议
1. **<步骤>**：<操作>

## 预防措施（可选）
- <如何避免再次发生>
```

## 常见问题速查

| 现象 | 优先方向 |
|------|---------|
| 服务启动失败 / 接口 500 / 超时 | 读日志 → 定位堆栈 → 必要时查 DB |
| 数据不展示 / 数据异常 | 查数据是否存在、状态是否正确 |
| develop 正常 product 异常 | 对比两环境数据量、最近变更 |
| 操作后数据未更新 | 查 `updated_at`、事务提交状态 |
| 性能慢 | 查数据量级、有无缺失索引 |
