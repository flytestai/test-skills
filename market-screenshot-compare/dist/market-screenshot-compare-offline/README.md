# market-screenshot-compare

`market-screenshot-compare` 是一个可复用的截图对比技能，适用于行情页、列表页、买卖盘口、席位追踪窗口，以及其他金融场景界面的截图比对。

## 功能说明

- 对比两张展示同一对象或同一页面的截图
- 对齐相同行与字段
- 穷举检查所有共享可见字段
- 汇总可见的不一致项
- 判断差异更像正常刷新，还是展示/逻辑异常
- 将结论压缩为简短的问题标题
- 在用户要求时自动忽略已知 bug 类型
- 使用 skill 内置的 OCR 自举运行时增强字段识别能力

## 安装方法

将本技能目录复制到目标运行时的技能目录中。

### Codex

```text
%USERPROFILE%/.codex/skills/market-screenshot-compare/
```

### OpenClaw

```text
<openclaw-home>/skills/market-screenshot-compare/
```

### Hermes

```text
<hermes-home>/skills/market-screenshot-compare/
```

## 必要文件

```text
market-screenshot-compare/
  SKILL.md
  README.md
  agents/
    openai.yaml
  scripts/
    compare_with_paddleocr.py
    build_offline_bundle.py
```

## OCR 增强安装

说明：

- 不需要让使用者手动安装 PaddleOCR。
- 首次运行 `scripts/compare_with_paddleocr.py` 时，脚本会自动在当前 skill 目录下创建本地虚拟环境并安装 `paddleocr`、`paddlepaddle`、`pillow` 等依赖。
- 后续再次运行时会直接复用本地运行时。
- OCR 结果不是“数学意义的 100%”，但相比纯视觉阅读更适合做字段穷举检查。
- 首次运行需要联网下载依赖包，且 PaddleOCR 仍会按其自身机制下载模型文件。

## 离线分发版

如果你希望“别人只复制 skill 就能直接用 OCR”，请先在一台可联网机器上构建离线分发包：

```text
python scripts/build_offline_bundle.py --zip
```

构建完成后会得到一个预热好的 skill 包，里面包含：

- `scripts/.runtime/` 本地 Python 运行时
- `scripts/.paddle-models/` OCR 模型缓存
- skill 原始说明和脚本

把这个离线包发给别人后，对方解压并放入 skill 目录即可直接使用，不需要再手动安装 PaddleOCR，也不需要首次联网下载模型。

## 使用方法

调用示例：

```text
Use $market-screenshot-compare to compare these two screenshots.
Use $market-screenshot-compare to summarize mismatched fields.
Use $market-screenshot-compare to output only new issue titles.
Use $market-screenshot-compare to suppress bug types that were already reported before.
```

### OCR 辅助脚本示例

```text
python scripts/compare_with_paddleocr.py 新行情.png 老行情.png
```

如果需要过滤已知问题类型：

```text
python scripts/compare_with_paddleocr.py 新行情.png 老行情.png --known-issue "市值字段不一致" --known-issue "脏数据展示"
```

如果只想预热本地模型缓存：

```text
python scripts/compare_with_paddleocr.py --prepare-models-only
```

## 默认规则

- 先枚举两张截图中所有共享可见字段，再逐字段比对
- 不允许默认跳过字段；看不清的字段必须明确标记为“未能确认”
- 默认忽略右下角系统时间
- 默认忽略背景颜色、黑白主题、皮肤和纯样式差异
- 当已知 bug 已记录时，按问题类型去重
- 同一种旧 bug 即使在新截图里再次出现，也不重复提报
- 去重后只输出本次新增的问题类型
- 只关注两张截图相同字段的差异
- 优先用简体中文输出，适合直接发给开发或测试

## 常见去重示例

该技能会抑制重复提报的问题类型，例如：

- 数量标识不一致
- 排名统计不一致
- 流值 / 总股本 / 总市值不一致
- `nan` / `--` 这类空值显示不一致
- 脏数据或空白记录展示问题

## 校验方法

校验命令示例：

```text
python <skill-creator>/scripts/quick_validate.py market-screenshot-compare
```
