# 图轴值域:呼吸边距与 bounds 钳制

## 契约(已定稿,docs 先行)

- `docs/feature/reports/library/metric-views.md`「图轴值域」——值域 = 数据极值两端各扩数据跨度 5%,数据极值点不落在绘图框线上;零跨度 fallback(值绝对值的 5%,值为 0 取 1);声明了 `bounds` 的轴钳到边界(贴边数据点如实落框线,如通过率 100%);`MetricLine` x 轴(NumericAxis)无 bounds 只扩不钳;边距是呈现,不改数据不产假刻度,反向轴先扩后反;text 面共用同一份值域按字符粒度取整。
- `docs/feature/reports/library/metrics.md`——`Metric.bounds?: { min?: number; max?: number }`(TSDoc 见 docs 注释)与 `MetricColumn.bounds`;内置指标:三个通过率与 `examScore` 是 `{min:0,max:1}`,其余七个 `{min:0}`。
- 覆盖规范已声明:`docs/engineering/testing/unit/reports.md`「纯函数布局算法」条(值域推定纯函数,直接断言 `[min,max]`)。

## 执行项

1. **类型与内置指标**:`Metric`/`MetricColumn` 加 `bounds`(带 TSDoc,公开面变更),内置指标实例逐个声明;`*Data` 计算函数把 bounds 投影进 `MetricColumn`(可序列化)。
2. **值域推定纯函数**:落在 `src/report/components/metric-views/` 的 chart-math 一侧(与点标签布局同类),输入数据极值 + bounds,输出扩后 `[min,max]`;MetricScatter 两轴与 MetricLine 两轴共用,web SVG 与 text 字符坐标图消费同一份结果,渲染层不重算。
3. **测试**:按 reports.md 已声明的覆盖类别写——5% 边距、零跨度两档 fallback、钳制/不钳制、反向轴顺序,各配有区分力的 fixture。
4. **同步义务**:`pnpm run build:report`(dist 预编译,link 消费项目才看得到);公开面变了跑 `pnpm docs:reference`;`pnpm run typecheck` + `pnpm test`。

## 验证

真实 eval repo(如 `/Users/ctrdh/Code/MemoryBench`)跑 `pnpm exec niceeval view`,散点图极值点不再压框线;通过率 100% / 总分贴 0 的点落在框线上(bounds 钳制生效)。
