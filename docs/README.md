# ⚡ niceeval 文档索引

内部设计与实现协作文档的索引,全部用中文书写。产品定位与心智模型见 [Vision](vision.md)、[Concepts](concepts.md)、[Architecture](architecture.md);从零上手见 [Getting Started](getting-started.md);把设计行为定位到源码见 [Source Map](source-map.md)。

**功能文档**回答"niceeval 给用户提供的功能是什么、怎么用"——可以是 Library、CLI,或者两者都有,读者是用这个能力的实现者/用户侧协作者,一个功能一个子目录,物理归在 `docs/feature/`,新开一个从 [`feature/_template/`](feature/_template/README.md) 起步。**工程文档**回答"niceeval 这个 repo 自己怎么被验证、维护、跑分"——比如 e2e 测试、benchmark,或者文档、示例的维护方案,不是给用户的能力说明,物理归在 `docs/engineering/`,新开一个从 [`engineering/_template/`](engineering/_template/README.md) 起步。还没定为当前契约的功能提案物理归在 `docs/roadmap/`。仍有一部分功能文档暂时按文档类型平铺在 `docs/` 下,尚未拆进 `feature/`,见下方清单。

索引只画到二级目录,子目录里具体拆了哪几篇进各自的 `README.md` 看:

```text
docs/
├── README.md                            入口:项目定位 + 快速开始 + 本导航
├── getting-started.md                   新手向导
├── source-map.md                        设计行为 → 源码文件的映射表
│
├── feature/                             当前功能契约 —— niceeval 能做什么、怎么用
│   ├── _template/                       新开功能子目录的起始模板
│   ├── adapters/                        连 AI / 接 agent
│   ├── eval/                            编写 eval:`defineEval`
│   ├── experiments/                     怎么跑这批 eval:`defineExperiment`
│   ├── sandbox/                         在哪里跑:隔离环境
│   ├── scoring/                         评分器与判定
│   ├── results/                         结果的磁盘格式与读写库
│   ├── reports/                         自己搭报告页的积木
│   ├── view/                            本地结果查看器(`niceeval view`)
│   └── show/                            终端读结果(`niceeval show`)
│
├── roadmap/                             还没定为当前契约的提案
│   ├── multi-agent/                     多 agent eval 的三种场景
│   └── view-enhancements.md             view 的 Compare、Eval 目录页
│
├── engineering/                         niceeval 自身怎么被验证、维护、跑分
│   ├── _template/                       新开工程主题子目录的起始模板
│   ├── e2e-ci/                          全链路 e2e 测试方案
│   ├── phase-timings/                   attempt 阶段计时与 sandbox × adapter 安装基准
│   └── tier-sync/                       examples origin→tier 同步维护工具
│
└── 功能文档(暂平铺在 docs/ 下,逐步迁入 feature/) ── niceeval 能做什么、怎么用
    ├── vision.md                        心智模型:为什么叫 fast
    ├── concepts.md                      心智模型:术语表
    ├── architecture.md                  心智模型:核心边界
    ├── assertions.md                    断言参考(作用域 + 来源)
    ├── origin-integration.md            Origin 应用接入手册(五个应用的接入记录)
    ├── capabilities-by-construction.md  能力由构造证明
    ├── observability.md                 Observability(含 OTel trace 瀑布图)
    ├── runner.md                        跑与看:执行引擎
    ├── cli.md                           跑与看:CLI 入口的内部架构(Effect-TS 调度核心)
    └── references.md                    背景调研:从其它项目学到什么
```

## 关于这些文档

这些是**内部设计与实现协作文档**:记录 niceeval 的目标 DX、架构边界和实现协作约定,全部用中文书写。[Source Map](source-map.md) 把设计行为定位到源码。功能文档([Feature](feature/README.md))先于代码定稿是正常流程,代码后续跟上;正文不写实现状态。未列入当前契约的提案放 [Roadmap](roadmap/README.md),同样只写"要什么、是什么"。
