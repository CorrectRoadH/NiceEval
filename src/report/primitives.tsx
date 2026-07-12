// 排版原语 Row / Col / Section / Text / Style / Table:六个内置双面组件,没有特殊机制。
// web 面是普通 React 渲染;text 面用 ctx.render(child, 子宽) 显式传宽,
// Row 分栏、宽度不足降级纵向。Style 给自定义组件带样式:web 面吐 <style> 标签,
// text 面渲染为空 —— 静态导出不打包用户代码,className 引用的 CSS 靠它随树走。
// Table 是自定义表的标准件,官方表状组件的 text 面也建在它上面(见 ./text/table.ts)。

import type { ReactNode } from "react";
import type { AttemptLocator } from "../results/locator.ts";
import { defineComponent, type ReportNode } from "./tree.ts";
import { localeText, type ReportLocale } from "./locale.ts";
import { indentBlock, joinColumns, wrapDisplay, type ColumnAlign } from "./text/layout.ts";
import { renderTableText } from "./text/table.ts";

function childArray(children: ReportNode): ReportNode[] {
  if (children === null || children === undefined || typeof children === "boolean") return [];
  return Array.isArray(children) ? children : [children];
}

function cx(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export interface LayoutProps {
  children?: ReportNode;
  className?: string;
}

/** 纵向依次排列:网页是块级堆叠,终端是逐块输出(块间空一行)。 */
export const Col = defineComponent<LayoutProps>({
  web({ children, className }) {
    return <div className={cx("nre", "nre-col", className)}>{children as ReactNode}</div>;
  },
  text({ children }, ctx) {
    return childArray(children)
      .map((child) => ctx.render(child))
      .filter((block) => block.length > 0)
      .join("\n\n");
  },
});
Col.displayName = "Col";

// Row 的每栏至少留这个宽度,不硬挤;不够就降级纵向
const MIN_COLUMN_WIDTH = 24;
const COLUMN_SEPARATOR = " │ ";

/** 并排:网页横向排布,终端字符分栏;终端宽度不够时自动降级为纵向。 */
export const Row = defineComponent<LayoutProps>({
  web({ children, className }) {
    return <div className={cx("nre", "nre-row", className)}>{children as ReactNode}</div>;
  },
  text({ children }, ctx) {
    const blocks = childArray(children).filter(
      (child) => child !== null && child !== undefined && typeof child !== "boolean",
    );
    if (blocks.length === 0) return "";
    if (blocks.length === 1) return ctx.render(blocks[0]);
    const columnWidth = Math.floor(
      (ctx.width - COLUMN_SEPARATOR.length * (blocks.length - 1)) / blocks.length,
    );
    if (columnWidth < MIN_COLUMN_WIDTH) {
      // 宽度不足:降级纵向,与 Col 同一形态
      return blocks
        .map((child) => ctx.render(child))
        .filter((block) => block.length > 0)
        .join("\n\n");
    }
    const rendered = blocks.map((child) => ctx.render(child, columnWidth));
    return joinColumns(rendered, rendered.map(() => columnWidth), COLUMN_SEPARATOR);
  },
});
Row.displayName = "Row";

export interface SectionProps extends LayoutProps {
  title: string;
}

/** 带标题的块:网页是标题层级,终端是标题行加缩进。 */
export const Section = defineComponent<SectionProps>({
  web({ title, children, className }) {
    return (
      <section className={cx("nre", "nre-section", className)}>
        <h2 className="nre-section-title">{title}</h2>
        {children as ReactNode}
      </section>
    );
  },
  text({ title, children }, ctx) {
    const body = childArray(children)
      .map((child) => ctx.render(child, ctx.width - 2))
      .filter((block) => block.length > 0)
      .join("\n\n");
    return body.length > 0 ? `${title}\n${indentBlock(body, "  ")}` : title;
  },
});
Section.displayName = "Section";

/** 说明文字:网页是段落,终端是折行文本。 */
export const Text = defineComponent<LayoutProps>({
  web({ children, className }) {
    return <p className={cx("nre", "nre-text", className)}>{children as ReactNode}</p>;
  },
  text({ children }, ctx) {
    return wrapDisplay(ctx.render(children), ctx.width).join("\n");
  },
});
Text.displayName = "Text";

export interface StyleProps {
  children?: string;
}

/** 自定义组件的样式随树带走:web 面吐 <style> 标签,text 面渲染为空。 */
export const Style = defineComponent<StyleProps>({
  web({ children }) {
    return <style>{children}</style>;
  },
  text() {
    return "";
  },
});
Style.displayName = "Style";

/** 一列的定义:取哪个 cells 键、表头写什么、往哪边对齐。 */
export interface TableColumn {
  /** 取 `row.cells[key]` 的键。 */
  key: string;
  /** 表头文案,两个面都原样渲染。 */
  header: string;
  /** 对齐方向,默认 `"left"`;`"right"` 按显示宽度右对齐,数字列用。 */
  align?: ColumnAlign;
}

/** 一行的数据:身份键、已格式化的格子、可选的 attempt locator。 */
export interface TableRow {
  /** 行身份。 */
  key: string;
  /** 已格式化的显示值;`null`(或缺这个键)渲染成 `—`,不补 0。 */
  cells: Record<string, string | null>;
  /** 带上就多一列 attempt:web 面链到证据室,text 面列出 locator。 */
  locator?: AttemptLocator;
}

export interface TableProps {
  /** 列定义;数组顺序即渲染顺序。 */
  columns: TableColumn[];
  /** 行数据;数组顺序即渲染顺序,组件不重排也不过滤。 */
  rows: TableRow[];
  /** 组件自带文案(attempt 表头、丢列提示)的语言;省略时随宿主。 */
  locale?: ReportLocale;
  /** web 面挂到 `<table>` 上。 */
  className?: string;
}

const MISSING_MARK = "—";

/**
 * 自定义表的标准件:列由报告作者定,格子是算好的显示值,两个面各自排整齐。
 *
 * text 面列宽按**显示宽度**算(CJK / 全角记 2 列),所以中文列不会撕歪;总宽超过
 * `ctx.width` 时先折最宽的左对齐列(右对齐列是数字,折行读不了),压到下限仍放不下
 * 就从右侧丢列并在表下如实报丢了几列。web 面是 `<table>` + `<thead>` / `<tbody>`,
 * 右对齐落成 `nre-align-right` 类,不用内联样式。
 *
 * 官方的 `MetricTable` / `MetricMatrix` / `Scoreboard` / `DeltaTable` 的 text 面就建在
 * 这个组件上:自定义表和官方表用同一把尺子。
 */
export const Table = defineComponent<TableProps>({
  web({ columns, rows, locale, className }, ctx) {
    const chrome = locale ?? ctx.locale;
    const hasLocator = rows.some((row) => row.locator !== undefined);
    const alignClass = (align?: ColumnAlign) => (align === "right" ? "nre-align-right" : undefined);
    return (
      <table className={cx("nre", "nre-table", className)}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={alignClass(column.align)}>
                {column.header}
              </th>
            ))}
            {hasLocator ? <th scope="col">{localeText(chrome, "table.attempt")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column) => {
                const value = row.cells[column.key];
                const missing = value === null || value === undefined;
                return (
                  <td key={column.key} className={alignClass(column.align)}>
                    {missing ? <span className="nre-missing">{MISSING_MARK}</span> : value}
                  </td>
                );
              })}
              {hasLocator ? (
                <td>
                  {row.locator ? (
                    <a className="nre-locator" href={ctx.attemptHref(row.locator)}>
                      {row.locator}
                    </a>
                  ) : (
                    <span className="nre-missing">{MISSING_MARK}</span>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
  text: renderTableText,
});
Table.displayName = "Table";
