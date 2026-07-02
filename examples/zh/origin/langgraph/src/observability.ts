// LangSmith OTel-only 导出:对应 docs-site/zh/guides/connect-otel.mdx 里
// "2. 应用侧" -> "LangGraph / LangChain" tab 的说法——"零依赖路线,三个环境变量":
//   LANGSMITH_TRACING=true / LANGSMITH_OTEL_ENABLED=true / LANGSMITH_OTEL_ONLY=true
// 加上标准的 OTEL_EXPORTER_OTLP_ENDPOINT。
//
// 这句话对 Python 版 langsmith SDK 成立(import 时靠 sitecustomize 自动挂 OTel
// hook)。但当前 JS 版(langsmith 0.7.x)还没做到纯 env 驱动:@langchain/core 的
// 埋点靠全局 OTel TracerProvider,JS 没有 Python 那种导入期自动注册机制——不主动
// 调用一次 initializeOTEL(),SDK 只会打一行警告、不产生任何 span(见 langsmith 包
// dist/singletons/otel.js 里 MockTracer.startActiveSpan 的警告文案)。
// 所以本示例比文档 tab 多了这一个模块、一行 initializeOTEL() 调用(由 src/agent.ts
// 在被 Agent Server 加载时顺带 import),其余仍然是纯 env 变量驱动。
//
// env 只在进程启动时读一次(标准 OTel SDK 的限制),改了 .env 要重启 langgraphjs dev
// 才生效,热切换端点做不到。
const tracingEnabled = process.env.LANGSMITH_TRACING === "true";
const otelEnabled = process.env.LANGSMITH_OTEL_ENABLED === "true" || process.env.OTEL_ENABLED === "true";

if (tracingEnabled && otelEnabled) {
  const { initializeOTEL } = await import("langsmith/experimental/otel/setup");
  initializeOTEL();
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "https://api.smith.langchain.com/otel/v1/traces (LangSmith 云端默认)";
  process.stdout.write(`[observability] LangSmith OTel 导出已启用 -> ${endpoint}\n`);
} else {
  process.stdout.write(
    "[observability] 未设置 LANGSMITH_TRACING + LANGSMITH_OTEL_ENABLED,跳过 OTel 导出(仍可正常聊天)。\n",
  );
}
