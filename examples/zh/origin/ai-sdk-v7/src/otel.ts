// 可选的 OTel 接入:设了 OTEL_EXPORTER_OTLP_ENDPOINT 才初始化,没设则完全不生效。
//
// AI SDK v7 的原生接法:官方 @ai-sdk/otel 集成 + `registerTelemetry()`(v5 时代的
// experimental_telemetry 每次调用都要传,v7 注册一次全局生效)。注册之后每个
// streamText/generateText 调用自动产出 GenAI 语义的 spans(operation → step →
// languageModel / tool 四层),不需要改任何调用点。
import { OpenTelemetry } from "@ai-sdk/otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { registerTelemetry } from "ai";

export function setupOtel(serviceName: string): void {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  // OTLPTraceExporter 自己读 OTEL_EXPORTER_OTLP_ENDPOINT(会自动拼上 /v1/traces)。
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ "service.name": serviceName }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  registerTelemetry(new OpenTelemetry({ tracer: provider.getTracer(serviceName) }));
  process.stdout.write(`OTel tracing enabled -> ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}\n`);
}
