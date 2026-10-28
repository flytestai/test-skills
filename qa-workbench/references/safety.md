# 安全边界与批量写操作

本工作台默认只读。任何 Bug 写操作都必须遵守下面的边界；拿不准时先只读查询，不要执行写入。

## 1. 读写范围

- **读取范围**：`openedBy` 或 `assignedTo` 为当前账号的 Bug，可按产品分组展示。
- **写入范围**：仅 `assignedTo` 等于当前账号的 Bug。
- `openedBy` 是当前账号、但 `assignedTo` 是他人时，不得修改。
- 已关闭 Bug 的 `assignedTo` 会变成 `closed`，无法从当前字段判断原负责人；归属必须在关闭前确认，不能用关闭后的字段反推。
- 当前账号不明确时先只读确认：优先 `ZENTAO_ACCOUNT`，其次 `zentao profile --format=json`，再其次工作台的 `tester.account`。

## 2. 批量关闭：两阶段确认

### 第一阶段：只读生成清单

```bash
# 单个产品
node scripts/plan-bulk-close.mjs --product 13 --status resolved --output close-plan.csv

# 多个产品
node scripts/plan-bulk-close.mjs --product 13 --product 52 --status resolved --output close-plan.csv

# 用户明确要求“全部产品”时才使用
node scripts/plan-bulk-close.mjs --all-products --status resolved --output close-plan.csv
```

脚本只保留 `assignedTo` 为当前账号的 Bug，CSV 列包括：Bug ID、标题、当前状态、当前指派、解决方案、链接。

- 默认超过 100 条时退出码为 3，清单仍会生成。
- 必须把清单交给用户核对；用户明确回复“确认执行”后，才可加 `--allow-large` 重新生成或继续关闭。
- 用户修改筛选条件后，重新生成清单并再次确认。

### 第二阶段：只关闭确认清单内的 ID

```bash
# 只使用用户确认过的 ID，不要临时追加
zentao bug close <id1>,<id2>,... --format=json
```

- 不得关闭清单外的 Bug。
- 不得使用“先全量关闭、出错再回滚”的方式。
- 批量结果中的 `success`、`failed`、`skipped` 分别报告，不要整体重试。

## 3. 执行后复核

逐条或按批重新读取：

```bash
zentao bug <id> --pick=id,status,assignedTo,resolution --format=json
```

- 状态应符合预期（如 `resolved` 或 `closed`）。
- 关闭后 `assignedTo=closed` 属正常，不要据此判断越权。
- 发现动到非本人 Bug 时立即停止，报告影响范围；未经确认不得继续批量回滚或扩大操作。

## 4. 归属校验工具

```bash
# 指定 ID
node scripts/check-bug-owner.mjs 123 456 --require-all-owned

# 按产品 + 状态
node scripts/check-bug-owner.mjs --product 13 --status resolved --require-all-owned

# 从文件读取 ID
node scripts/check-bug-owner.mjs --ids-file ids.txt --require-all-owned
```

退出码：

- `0`：校验完成。
- `2`：存在非本人 Bug，或存在 `closed` 无法确认归属的 Bug。
- `1`：参数、网络或 CLI 错误。

## 5. 操作记录

禅道 CLI 和标准 API 没有删除 action 历史记录的入口。操作记录属于审计日志，不建议直接改数据库删除；如确需清理，应由禅道管理员在完整备份后处理。
