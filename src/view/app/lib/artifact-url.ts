// 工件 fetch 的 URL:相对路径 `artifact/<rel>`。
// 本地 dev server(server.ts 的 /artifact/ 路由)和目录式静态导出(buildView 拷到 <out>/artifact/)
// 共用同一布局,前端不需要知道自己被谁托管。相对路径也保证子路径部署(如 host/foo/)不断链。
export function artifactUrl(rel: string): string {
  return "artifact/" + rel.split("/").map(encodeURIComponent).join("/");
}
