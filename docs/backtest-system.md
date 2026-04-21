# Backtest System

## 服务归属

- 标准历史分析评估接口由 `src/services/backtest_service.py` 负责：
  - `POST /api/v1/backtest/run`
  - `POST /api/v1/backtest/prepare-samples`
  - `GET /api/v1/backtest/results`
  - `GET /api/v1/backtest/sample-status`
  - `GET /api/v1/backtest/runs`
  - `GET /api/v1/backtest/performance`
  - `GET /api/v1/backtest/performance/{code}`
  - `POST /api/v1/backtest/samples/clear`
  - `POST /api/v1/backtest/results/clear`
- 规则回测接口由 `src/services/rule_backtest_service.py` 负责：
  - `POST /api/v1/backtest/rule/parse`
  - `POST /api/v1/backtest/rule/run`
  - `POST /api/v1/backtest/rule/compare`
  - `GET /api/v1/backtest/rule/runs`
  - `GET /api/v1/backtest/rule/runs/{run_id}`
  - `GET /api/v1/backtest/rule/runs/{run_id}/status`
  - `POST /api/v1/backtest/rule/runs/{run_id}/cancel`

## 异步 / 后台任务

- `POST /api/v1/backtest/rule/run` 默认异步提交，立即返回 `queued / parsing / running / summarizing / completed / failed / cancelled` 之一。
- 若传入 `wait_for_completion=true`，接口会同步执行并直接返回完整结果。
- `GET /api/v1/backtest/rule/runs/{run_id}/status` 提供轻量状态轮询，不必每次拉取完整详情。
- `POST /api/v1/backtest/rule/runs/{run_id}/cancel` 提供 best-effort cancel：对尚未完成的任务会标记为 `cancelled`；若任务已结束，则返回当前最终状态而不覆盖结果。
- `POST /api/v1/backtest/rule/compare` 提供 compare-runs 的第一版 stored-first 读路径：它只读取已持久化的已完成运行，不会重新执行回测；当前返回最小可信对比面，包含 metadata、`parsed_strategy`、核心 metrics、benchmark summary、`execution_model` 以及每条运行自身的 `result_authority`。
- `GET /api/v1/backtest/rule/runs/{run_id}` 继续作为完整详情接口，包含 `execution_trace`、交易明细和审计数据。
- detail/history 返回里的 `result_authority` 现会额外暴露 replay/audit reopen 诊断：`replay_payload_source` / `replay_payload_completeness` / `replay_payload_missing_sections` 以及 `audit_rows_source` / `daily_return_series_source` / `exposure_curve_source`，用于区分“直接读取已持久化 payload”“基于持久化 audit rows 修补缺失 section”“仅基于已存 run artifacts 回补 legacy payload”“未读取 detail / unavailable”等状态。
- `execution_model` reopen 同样遵循 stored-first：优先读取 `summary.execution_model`，其次回退到已持久化的 `summary.request.execution_model`，两者都不存在时才从已存 assumptions / row/request 派生兼容配置。`result_authority` 会同步暴露 `execution_model_source` / `execution_model_completeness` / `execution_model_missing_fields`，用来区分“直接命中持久化 snapshot”“基于持久化 snapshot 修补缺字段”“仅从 legacy assumptions 派生”的不同来源。
- `trade_rows` reopen 现在也显式遵循 stored-first：detail 读取会优先消费已持久化的 `rule_backtest_trades`，并在 `result_authority` 中新增 `trade_rows_source` / `trade_rows_completeness` / `trade_rows_missing_fields`。历史存量交易行若缺少 `entry_rule_json` / `exit_rule_json` / `notes` 等兼容字段，会返回稳定 shape 的 `trades` 列表并显式标记 `stored_rule_backtest_trades+compat_repair` / `stored_partial_repaired`；若 run row 声明存在交易但持久化 trade rows 已丢失，则会明确返回 `unavailable`，不再把空交易列表伪装成完整重开结果。
- 为了让 detail/history 的 authority 诊断形状更稳定，`result_authority` 现在还会包含版本化的归一化域视图：`contract_version` + `domains`。`domains.<name>` 统一使用 `source` / `completeness` / `state` / `missing` / `missing_kind` 五个字段表达各诊断域，旧的扁平字段仍保留以兼容既有消费者。

## P5 Web 可用性收口

- `/backtest` 继续作为配置与发起页，不改动现有标准回测与规则回测的后端执行链路；本轮主要收口输入分组、按钮文案和状态提示，减少“要先做什么、下一步会发生什么”的理解成本。
- `/backtest/results/:runId` 会优先展示运行状态卡，再展示结果摘要与图表工作区。运行中页面使用 `GET /api/v1/backtest/rule/runs/{run_id}/status` 做轻量轮询，进入 `completed / failed / cancelled` 后自动停止刷新。
- 规则回测运行中会明确展示 `parsing / queued / running / summarizing / completed / cancelled / failed` 状态，并在可取消阶段暴露 `取消运行`。取消仍复用既有 `POST /api/v1/backtest/rule/runs/{run_id}/cancel`，不会改写已完成结果。
- 结果页首屏优先展示用户更容易理解的摘要指标：总收益、相对基准或买入持有、最大回撤、交易次数、胜率、期末权益；原始参数、执行假设、技术说明和历史结果下沉到标签页或 disclosure。
- `execution_trace` 继续来自既有结果详情响应，但 Web 端默认先显示“关键节点”视图，只突出买卖动作、fallback 与异常说明；完整逐行轨迹仍可切换查看，并继续支持 CSV / JSON 导出。
- Historical Evaluation 现在会用更直接的产品文案说明本次数据来自 `LocalParquet` 还是 fallback 路径；`requested_mode / resolved_source / fallback_used` 这类诊断字段仍保留，但默认折叠在“查看数据源诊断”中，避免干扰主流程。

## 本地 US parquet 优先级

- 美股日线优先读取 `LOCAL_US_PARQUET_DIR`。
- 若未设置 `LOCAL_US_PARQUET_DIR`，兼容回退到 `US_STOCK_PARQUET_DIR`。
- 若本地 parquet 命中，`resolved_source` 会显示为 `LocalParquet`，不会触发在线抓取。
- 若本地 parquet 缺失或损坏，当前 backtest 流程会沿用既有数据抓取 fallback，并在响应里暴露 `requested_mode / resolved_source / fallback_used`。

## 本地运行 API

```bash
.venv/bin/uvicorn api.app:app --host 127.0.0.1 --port 8000
```

可选环境变量：

```bash
export LOCAL_US_PARQUET_DIR=/path/to/local/us/parquet
# 仅兼容旧配置时再使用
export US_STOCK_PARQUET_DIR=/path/to/local/us/parquet
```

## 冒烟脚本

- 当前仓库内可直接复用的已提交冒烟脚本会自动：
  - 启动临时 uvicorn
  - 关闭管理认证
  - 创建临时数据库
  - 准备本地 `LOCAL_US_PARQUET_DIR` fixture
  - 运行断言并自动清理临时文件

- 标准 backtest API 冒烟：

```bash
python3 scripts/smoke_backtest_standard.py
```

- 规则 backtest API 冒烟：

```bash
python3 scripts/smoke_backtest_rule.py
```

- 合并运行：

```bash
python3 scripts/smoke_backtest_standard.py && python3 scripts/smoke_backtest_rule.py
```

## 已知假设与限制

- 生产环境真实读取本地 parquet 仍依赖 `pyarrow` 或 `fastparquet`；若环境缺少 parquet engine，仓库内 smoke 脚本会注入测试用 shim 来验证 `LOCAL_US_PARQUET_DIR` 优先路径与异步接口行为。
- 规则回测的同步执行依赖本地数据库中已有行情，或依赖既有数据源 fallback 成功。
- `execution_trace` 的详情、CSV、JSON 导出以持久化 `audit_rows` 为真源；历史旧记录缺少该字段时，会在读取时回补并标记 `trace_rebuilt`。
- `execution_model` 详情字段现在也会在 reopen 时统一规范为稳定形状；历史记录若只保留了部分 execution-model snapshot，会显式标记 `stored_partial_repaired` 并列出缺失字段，而不是返回形状不完整的 payload。
- `trade_rows` 详情字段现在也会在 reopen 时统一规范为稳定形状；历史记录若只保留了部分 trade-row 辅助 JSON，会显式标记 `stored_partial_repaired` 并列出缺失字段；若 run row 指示存在交易但持久化交易行缺失，则会标记 `unavailable`，避免把“空列表”误读成“完整但零交易”。
- replay 可视化 reopen 同样遵循 stored-first：非空的已持久化 `summary.visualization.audit_rows` / `daily_return_series` / `exposure_curve` 会优先复用；若历史运行只存了部分或空数组，会显式标记 `stored_partial_repaired`、`derived_from_stored_run_artifacts` 或 `unavailable`，避免把 reopen 时的临时重建结果伪装成完整持久化 payload。
