import { defineEval } from "niceeval";
import { DEFAULT_MODEL, modelSupportsVision } from "../agent/models.ts";

// 【多模态 + 按模型跳过】t.sendFile 把本地图片(蓝底中间一个白方块)base64 后经
// adapter 交给多模态模型。不支持视觉的模型用 t.skip 显式跳过 —— 比让断言必挂干净。
export default defineEval({
  description: "多模态:发送真实图片,断言描述出图中的具体特征",

  async test(t) {
    if (!modelSupportsVision(t.model ?? DEFAULT_MODEL)) {
      t.skip(`模型 ${t.model ?? DEFAULT_MODEL} 不支持视觉输入,跳过图片理解`);
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
