# Backend Audit Work Report

- Generated at: `2026-04-25`
- Branch: `main`
- Scope: `backend/docs/governance only`
- Frontend touched: `no`
- Verdict: `completed_with_bounded_scope`

## 改了什么

1. 收敛根目录一次性审计产物：
   - moved `backend-final-audit-report.md`
   - moved `backend-final-audit-report.json`
   - moved `backend-frontend-global-audit-report.md`
   - moved `backend-frontend-global-audit-report.json`
   - destination: `docs/architecture/archive/audits/`
2. 删除根目录本地切片交接产物：
   - removed `slice_report_*.json`
3. 修订项目入口文档：
   - `README.md` 增加“当前项目文档真源”与后端维护手册入口
4. 修订维护手册边界：
   - `docs/architecture/backend-frontend-modular-maintenance-handbook.md`
   - 明确当前默认以后端/API/存储维护为主，前端仅做归属映射与兼容检查
5. 修订系统审计文档：
   - `docs/architecture/system-optimization-audit.md`
   - 增补审计产物归档/临时产物治理规则
6. 更新变更记录：
   - `docs/CHANGELOG.md`

## 为什么这么改

- 当前仓库根目录累积了阶段性审计报告与切片交接 JSON，增加检索噪音，不利于长期维护。
- 这些文件更适合作为历史档案或本地产物，而不是项目根目录的常驻入口。
- 本轮目标是“后端大审计前的基础治理”，优先把文档真源、维护入口和仓库结构理顺，再做更深的代码级优化。
- 由于 `apps/dsa-web/` 当前已有进行中的未提交改动，本次严格避免前端改造，防止交叉污染。

## 验证情况

- `python3 scripts/check_ai_assets.py`
  - PASS
- `PYTHONPYCACHEPREFIX=/tmp/dsa-pyc python3 -m py_compile scripts/check_ai_assets.py api/app.py tests/test_api_app_health.py`
  - PASS
- `python3 -m pytest tests/test_api_app_health.py -q`
  - PASS

## 未验证项

- 未运行 `./scripts/ci_gate.sh`
- 未运行前端 `npm run lint` / `npm run build`
- 未运行浏览器验证
- 未进行大范围后端性能 benchmark 或重复 helper 合并

## 风险点

- 本次主要是仓库治理与文档收敛，不等于完成整仓后端代码级性能审计。
- 历史审计报告已移动到归档目录；若有外部脚本硬编码根目录路径，需要同步改为新路径。
- 由于本次故意避开前端，README 中与产品功能有关的旧表述仍可能存在后续需继续修订的内容。

## 回滚方式

1. 将 `docs/architecture/archive/audits/` 下四个审计报告移回仓库根目录。
2. 从 git 恢复 `slice_report_*.json`（如需要保留历史版本）。
3. 回退以下文件：
   - `README.md`
   - `docs/architecture/backend-frontend-modular-maintenance-handbook.md`
   - `docs/architecture/system-optimization-audit.md`
   - `docs/CHANGELOG.md`

## 下一阶段建议

1. 基于 `docs/architecture/system-optimization-audit.md` 建立“后端审计 backlog”，按服务层逐个做重复 helper / 简化表达式 / 删除失活入口。
2. 先从低风险高收益区域开始：
   - `src/storage.py`
   - `src/services/market_scanner_service.py`
   - `src/services/portfolio_service.py`
   - API 健康检查与 smoke 脚本入口统一性复核
3. 对测试/文档产物建立分层：
   - 运行期必须文档
   - 长期维护手册
   - 可归档历史报告
   - 本地临时 smoke 输出
