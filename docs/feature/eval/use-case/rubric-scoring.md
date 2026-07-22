# 计分制：五步走完三步挣 3 分

## 解决什么问题

通过制回答「做没做对」，但有两类题的答案是「做到了几成」：长链条任务（安装五步走完三步不该和一步没走同为 0）、rubric 大题（正确性、代码精简、说明质量各值不同的分）。这类题用 **`defineScoreEval`** 定义，给分词汇叠加挣分：分从 0 往上累加、分值非负、**不声明满分**——同一条 eval 的代码对每个 experiment 是同一把尺子，模型 A 挣 3 分、模型 B 挣 1 分，结论不需要分母。契约单源见[计分粒度](../../experiments/score-points.md#计分制叠加给分没有上限声明)。

## 全流程

1. **检查点给分用 `.points(n)`**：挂在任何断言上的条件给分，通过挣 `n` 分、不过挣 0。互相独立，挂一条不连坐后面：

   ```typescript
   import { defineScoreEval } from "niceeval";

   export default defineScoreEval({
     description: "安装并启动 DB-GPT",
     async test(t) {
       await t.send("把 DB-GPT 装起来并通过健康检查。");

       t.sandbox.fileChanged("db-gpt/.env").points(1);                          // 配置了环境
       t.calledTool("shell", { input: { command: /pip install/ } }).points(1);  // 装了依赖
       t.calledTool("shell", { input: { command: /dbgpt start/ } }).points(1);  // 启动了服务
       const health = await t.sandbox.runShell("curl -s localhost:5670/health");
       t.check(health, commandSucceeded()).points(1);                           // 健康检查通过
       t.check(health.stdout, includes("ok")).points(1);                        // 返回内容正确
     },
   });
   ```

2. **前置条件用 `t.require`**：repo 都没 clone 下来，后面五步无从谈起——`require` 不过即中止，后面的给分代码不执行，那些分自然没挣到。**中止挣 0 是 agent 的责任，成立**；这和基础设施故障的 `null` 是两回事（见边界）：

   ```typescript
   await t.require(t.sandbox.file("db-gpt/README.md"), exists());  // 挂了强制结束
   // ↓ 下面的给分点位在中止后不执行,挣 0 分
   ```

3. **rubric 大题按分值给分**：分值作者自定，gate 可以兼计分——`.points` 管分数面、severity 管判定面，正交：

   ```typescript
   const test = await t.sandbox.runCommand("npm", ["test"]);
   t.check(test, commandSucceeded()).points(60);   // 正确性 60 分;同时是 gate,没挣到 verdict 也 failed
   ```

4. **自己算的分用 `t.score(label, n)` 直接累加**：判定条件复杂到断言词汇装不下时的出口，`label` 进报告：

   ```typescript
   const lines = countLines(t.sandbox.diff.get("src/legacy.js"));
   t.score("代码精简", lines <= 50 ? 20 : lines <= 80 ? 15 : lines <= 120 ? 10 : 5);
   t.score("覆盖率", coverage * 20);                // 连续换算也可以
   ```

5. **judge 按连续分比例挣**：`.points(20)` 挂在 judge 上，挣 `20 × judge分`：

   ```typescript
   t.judge.autoevals.closedQA("重构说明是否讲清动机与风险?", {
     on: t.sandbox.diff.get("NOTES.md"),
   }).points(20);
   ```

6. **用 `t.group` 给分数命名维度**：组内挣分聚成对比里的得分点（「正确性挣 45 分」），跨 eval 组名一致就能横向对比：

   ```typescript
   await t.group("正确性", async () => {
     t.check(test, commandSucceeded()).points(60);
   });
   await t.group("代码质量", async () => {
     t.score("代码精简", tierPoints);
     t.judge.autoevals.closedQA("说明是否清晰?").points(20);
   });
   ```

## 边界

- **叠加不扣分**：分值非负（`.points(n)` 要求 `n > 0`，`t.score` 要求 `n ≥ 0`）。「做了坏事」不用负分——要一票否决写 gate，要「没做坏事算得分项」写正向检查点（`t.notCalledTool(...).points(1)`）。
- **中止的 0 和基础设施的 `null` 严格分开**：`require` 挂了后面挣 0 分是 agent 的责任；沙箱炸了、judge 没 key 是 `errored`，整题分数 `null`、不折成 0——评不了不是 agent 差。
- **verdict 照旧**：计分制不改判定面。带 `.points` 的 gate 挂了 verdict 就是 failed；「没满分 = 没全过」成立且直观。榜单在计分制下多一列总分，通过率列仍在。
- **题型即定义函数**：`defineScoreEval` 的 `t` 才有 `.points` / `t.score`，在 `defineEval` 里写给分是类型错误。一个 experiment 选中的 eval 必须同型——通过率和总分不能相加，混型是启动期配置错误，两类都要跑就写两个实验文件。
- 检查点是**独立可跑的题目**时不要用计分制，拆成多个 eval（[数据集扇出](dataset-fanout.md)）——粒度来自更多的题，不是更细的分。

## 相关阅读

- [计分粒度](../../experiments/score-points.md) —— 通过制 / 计分制的完整契约与横截面聚合规则（契约单源）。
- [过程与成本](process-and-cost.md) —— 检查点断言本身的匹配写法。
- [裁判评质量](judge-quality.md) —— judge 入口与阈值语义。
- [Severity 与 Verdict](../../scoring/architecture/severity-and-verdict.md) —— 判定面的折叠规则，与分数面正交。
