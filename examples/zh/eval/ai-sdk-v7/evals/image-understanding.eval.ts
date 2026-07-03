import { defineEval } from "niceeval";
import { MODELS, modelSupportsVision } from "../src/backend/models.ts";

// 实验没钉 model 时,实际用的模型和 chat() 的兜底保持一致(含 AGENT_MODEL)。
const DEFAULT_MODEL = process.env.AGENT_MODEL ?? "deepseek-v4-flash";

// 【多模态 + 按模型跳过】t.sendFile 把本地图片(蓝底中间一个白方块)base64 后经
// adapter 交给多模态模型。不支持视觉的模型用 t.skip 显式跳过 —— 比让断言必挂干净。
export default defineEval({
  description: "多模态:发送真实图片,断言描述出图中的具体特征",

  async test(t) {
    const model = t.model ?? DEFAULT_MODEL;
    if (!modelSupportsVision(model)) {
      t.skip(`模型 ${model} 不支持视觉输入,跳过图片理解`);
    }
    // 环境限制而非模型能力:自建 OPENAI_BASE_URL 网关转 Responses API 时不认 data URL,
    // 传图会被拒("Expected a valid URL")。跳过写在 eval 侧,不去改应用的模型元数据;
    // 直连 OpenAI 或换个支持图像输入的网关后删掉这段。
    if (process.env.OPENAI_BASE_URL && MODELS.find((m) => m.id === model)?.provider === "openai") {
      t.skip(`当前 OPENAI_BASE_URL 网关不支持图像输入,跳过 ${model} 的图片理解`);
    }

    const turn = await t.sendFile("evals/fixtures/sample.png", "这张图片里有什么?主要是什么颜色?");
    turn.expectOk();

    await t.group("描述出图片的两个具体特征", () => {
      // 必须同时提到蓝色背景和白色方块,而不是任一宽泛关键词就算数。
      t.messageIncludes(/蓝|blue/i);
      t.messageIncludes(/白|方块|square/i);
    });

    t.judge.autoevals
      .closedQA("助手是否描述了这张图片的内容(蓝色背景、中间一个白色方块),而不是答非所问?")
      .gate(0.7);
  },
});
