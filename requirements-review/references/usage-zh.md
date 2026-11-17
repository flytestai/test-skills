# 独立使用说明

这是本地运行的 Skill，不需要 TestX、服务器、数据库、登录账号或专用模型 API。

支持 Skill 的 Agent 可加载 requirements-review；其他 Agent 可读取本包 SKILL.md 作为任务指令，并使用自己的文件阅读、视觉和脚本执行能力。

推荐调用：

> 使用 requirements-review 评审这份需求文档，结合全部文字和图片。仅评审产品业务需求，不要求补充接口字段或技术实现。区分已确认问题、待澄清和可选建议，核验原文证据后评分，输出本地 HTML 和 JSON，说明未完成的核验项。不要访问任何服务器。

运行命令（在 Skill 目录下）：

```sh
python scripts/local_review.py prepare /path/to/requirements.docx /path/to/new-review-run
```

准备后由 Agent 阅读 source.json 和 assets 图片，逐模块填写 review.json，包括核验意见、24 项评分依据、图片核验记录与运行信息。草稿不代表评审完成，不能只运行脚本就获得专业结论。

```sh
python scripts/local_review.py export /path/to/new-review-run --source /path/to/requirements.docx
```

结果是本地 report.html 和 result.json，无需启动 Web 服务。评分计算使用同一份逻辑。每页默认 10 条问题，可切换 20/50 条，支持维度筛选及原文证据跳转。

Word 可选依赖 python-docx；PDF 可选依赖 PyMuPDF。缺依赖会报错，不会自动下载。图片内容由当前 Agent 的视觉能力识别；没有视觉能力时必须明确不完整，不能声称已完成图文评审。

具体数据格式、能力边界和生产质量门槛见 contract.md、local-run.md、production.md。示例测试只验证程序行为，不代表已经证明对所有需求文档都能准确评审。
