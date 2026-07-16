// cases: docs/engineering/unit-tests/reports/cases.md
// 「Attempt 详情」:事件流按条目校验、按条目容错;skill.loaded 是一等回复条目。
// bug: memory/view-unknown-event-type-drops-whole-transcript.md
import { describe, expect, it } from "vitest";
import { asEvents } from "./guards.ts";
import { indexTurns, locKey } from "./transcript-data.tsx";
import type { TranscriptEvent } from "../types.ts";

const send: TranscriptEvent = {
  type: "message",
  role: "user",
  text: "Migrate every route",
  loc: { file: "evals/m.eval.ts", line: 37, column: 8 },
};

describe("asEvents 按条目容错", () => {
  it("含 skill.loaded 的 events 数组不被判空,全部事件保留", () => {
    const raw = [
      send,
      { type: "skill.loaded", skill: "pdf-export", callId: "c1" },
      { type: "message", role: "assistant", text: "done" },
    ];
    const events = asEvents(raw);
    expect(events).toHaveLength(3);
  });

  it("未知事件类型包成 view.raw 原样保留,其余事件照常", () => {
    const unknown = { type: "future.event", payload: 1 };
    const events = asEvents([send, unknown, { type: "thinking", text: "hm" }]);
    expect(events?.map((e) => e.type)).toEqual(["message", "view.raw", "thinking"]);
    expect(events?.[1]).toEqual({ type: "view.raw", raw: unknown });
  });

  it("形状不合的已知类型同样包成 view.raw,不静默丢", () => {
    const malformed = { type: "message", role: "assistant" }; // 缺 text
    const events = asEvents([malformed]);
    expect(events).toEqual([{ type: "view.raw", raw: malformed }]);
  });

  it("非对象条目丢弃;非数组载荷整体拒绝", () => {
    expect(asEvents(["junk", 42, send])).toHaveLength(1);
    expect(asEvents({ events: [] })).toBeNull();
    expect(asEvents("nope")).toBeNull();
  });
});

describe("skill.loaded 聚合进 send 的回复", () => {
  it("indexTurns 聚出 kind: skill 回复并保留 Skill 名", () => {
    const turns = indexTurns([
      send,
      { type: "skill.loaded", skill: "pdf-export", callId: "c1" },
      { type: "message", role: "assistant", text: "done" },
    ]);
    const turn = turns.byKey.get(locKey("evals/m.eval.ts", 37));
    expect(turn?.replies).toEqual([
      { kind: "skill", skill: "pdf-export" },
      { kind: "text", text: "done" },
    ]);
  });

  it("view.raw 条目聚成 kind: raw 回复,原始载荷不丢", () => {
    const turns = indexTurns([send, { type: "view.raw", raw: { type: "future.event", payload: 1 } }]);
    const turn = turns.byKey.get(locKey("evals/m.eval.ts", 37));
    expect(turn?.replies).toEqual([{ kind: "raw", raw: { type: "future.event", payload: 1 } }]);
  });
});

describe("轮归属按 loc 判定,无 loc 的 user 消息不开新轮", () => {
  it("send 后紧跟的同文本无 loc 回显被吃掉,回复仍全部聚到 send 行", () => {
    const turns = indexTurns([
      send,
      { type: "message", role: "user", text: send.text },
      { type: "thinking", text: "plan" },
      { type: "message", role: "assistant", text: "done" },
    ]);
    const turn = turns.byKey.get(locKey("evals/m.eval.ts", 37));
    expect(turn?.replies).toEqual([
      { kind: "thinking", text: "plan" },
      { kind: "text", text: "done" },
    ]);
    expect(turns.noloc).toHaveLength(0);
  });

  it("轮中段的 stop-hook 反馈成为 kind: user 回复,其后的 assistant 回复不脱轮", () => {
    const turns = indexTurns([
      send,
      { type: "message", role: "user", text: send.text },
      { type: "message", role: "assistant", text: "first" },
      { type: "message", role: "user", text: "Stop hook feedback: save notes" },
      { type: "message", role: "assistant", text: "saved" },
    ]);
    const turn = turns.byKey.get(locKey("evals/m.eval.ts", 37));
    expect(turn?.replies).toEqual([
      { kind: "text", text: "first" },
      { kind: "user", text: "Stop hook feedback: save notes" },
      { kind: "text", text: "saved" },
    ]);
  });

  it("流首无 loc 的 user 消息(旧工件)仍开 noloc 轮", () => {
    const turns = indexTurns([
      { type: "message", role: "user", text: "hi" },
      { type: "message", role: "assistant", text: "hello" },
    ]);
    expect(turns.noloc).toHaveLength(1);
    expect(turns.noloc[0]?.replies).toEqual([{ kind: "text", text: "hello" }]);
  });
});
