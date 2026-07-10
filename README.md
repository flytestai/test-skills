# market-screenshot-compare

这是一个用于对比行情截图的 skill 仓库，重点检查两张截图中相同字段里的数值、行情数据和排序是否一致。

## 主要能力

- 对比新旧行情截图
- 对比不同软件的行情截图
- 对两张截图中所有相同字段的数值、行情数据和排序进行对比
- 忽略背景颜色、样式和排版差异
- 自动区分盘中和盘后
- 输出适合开发和测试使用的精简问题标题

## 核心规则

- 只关注两张截图共同拥有的字段
- 不只是对比字段名，还要对比字段里的实际数值、行情数据和排序
- 盘后要求同字段完全一致
- 盘中允许实时字段出现合理的小幅波动
- 一边有值、另一边没值，默认就是问题
- 如果是重复 bug，先按用户要求决定是否重复报

## 安装

把 `market-screenshot-compare` 目录复制到对应 skill 目录即可使用。

## 使用

```text
Use $market-screenshot-compare to compare these two screenshots.
Use $market-screenshot-compare to summarize mismatched fields.
Use $market-screenshot-compare to output only new issue titles.
```
