// tsx 的 JSX 编译模式解析按调用进程的 cwd/tsconfig 上下文,不是按被编译文件自身目录逐级向上找
// tsconfig:niceeval 作为符号链接 / link 依赖被另一个项目消费时(bin/niceeval.js 里 tsx 的
// register() 发生在消费方项目的 cwd 下),这次解析找不到 niceeval 自己 tsconfig.json 里的
// "jsx": "react-jsx",esbuild 退化成 classic 变换 —— 报告文件里的 JSX(内置报告与用户自定义
// 报告都可能用到)编译成引用全局 React 的 `React.createElement(...)`,而不是
// `react/jsx-runtime` 的 `jsx(...)`。两个宿主(show 的 report.ts、view 的 web.ts)渲染报告
// 文件的 build() 之前都要吃到这次补丁,所以补丁独立成模块、被动导入(side effect),而不是各
// 宿主各写一份。只定义一次,不覆盖宿主已有的全局。
import * as React from "react";

const g = globalThis as { React?: unknown };
if (g.React === undefined) g.React = React;
