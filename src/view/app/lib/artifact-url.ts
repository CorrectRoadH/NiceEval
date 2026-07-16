// artifact fetch 的 URL:以「页面所在目录」为基底的路径 `<页面目录>/artifact/<rel>`。
// 本地 dev server(server.ts 的 /artifact/ 路由)和目录式静态导出(buildView 拷到 <out>/artifact/)
// 共用同一布局:artifact/ 恒为 index.html 的同级目录。基底不能交给浏览器的相对解析——
// 静态托管常把 <dir>/index.html 服务在无尾斜杠的 <dir> 路径上(反代 rewrite、cleanUrls),
// 此时相对路径 `artifact/...` 会解析到上一级目录断链。这里自己算目录:pathname 末段带 `.`
// 视为文件名去掉(直接打开 .../index.html),否则整个 pathname 就是目录(含无尾斜杠形态)。
export function artifactUrl(rel: string): string {
  const tail = "artifact/" + rel.split("/").map(encodeURIComponent).join("/");
  if (typeof location === "undefined") return tail; // 非浏览器环境(测试直调)保持相对形态
  return pageDir(location.pathname) + tail;
}

/** 页面 pathname → 它所在目录(恒以 `/` 结尾)。 */
export function pageDir(pathname: string): string {
  if (/\.[^/]*$/.test(pathname)) return pathname.replace(/[^/]*$/, "");
  return pathname.endsWith("/") ? pathname : pathname + "/";
}
