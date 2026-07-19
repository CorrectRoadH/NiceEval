// AttemptError:结构化 error 明细。没有 error 时零输出(docs/feature/reports/library/attempt-detail.md)。
// 字段标签是低层技术标识,与终端 `niceeval show` 一样保持英文,不进 view 的 i18n 词典。

import type { ReactElement } from "react";
import { Fragment } from "react";
import type { AttemptErrorData } from "../types.ts";
import { cx } from "./format.ts";

export function AttemptError({ data, className }: { data: AttemptErrorData | null; className?: string }): ReactElement | null {
  if (data === null) return null;
  const rows: [string, string][] = [
    ["phase", data.phase],
    ["code", data.code],
    ["message", data.message],
  ];
  if (data.cause) rows.push(["cause", data.cause.name ? `${data.cause.name} · ${data.cause.message}` : data.cause.message]);
  const stack = data.stack?.replace(/\n+$/, "") ?? "";
  return (
    <div className={cx("nre", "nre-attempt-error", className)}>
      <dl className="nre-attempt-error-fields">
        {rows.map(([k, v]) => (
          <Fragment key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </Fragment>
        ))}
      </dl>
      {stack ? <pre className="nre-attempt-error-stack">{stack}</pre> : null}
    </div>
  );
}
