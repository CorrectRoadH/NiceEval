// Docker 沙箱后端:用 dockerode 把容器当隔离工作区跑 eval。
// 改编自 agent-eval 的 docker-sandbox.ts,签名对齐 ../types.ts 的 Sandbox 契约
//(runShell/runCommand 的 opts 一律是选项对象,不再用位置参数)。

import Docker from "dockerode";
import * as tar from "tar-stream";
import type {
  Sandbox,
  CommandResult,
  CommandOptions,
  SandboxFile,
  SourceFile,
  SourceFiles,
  ReadSourceFilesOptions,
} from "../types.ts";
import { makeSourceFiles } from "./source-files.ts";

const DEFAULT_SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx"];
const DEFAULT_IGNORE_DIRS = [".git", ".next", "node_modules", "dist", "build", "coverage"];
const DEFAULT_IGNORE_FILES = ["EVAL.ts", "PROMPT.md"];
// 行首哨兵:源码文件几乎不可能出现这一串,用来切分单次 shell 输出里的多份文件。
const SOURCE_FILE_MARKER = "::FE-SRC-7b3f9c::";

// 各 Node 运行时对应的镜像。用 -slim 变体下载更快、兼容性够用。
const DOCKER_IMAGES: Record<string, string> = {
  node20: "node:20-slim",
  node24: "node:24-slim",
};

// 单条命令默认超时(10 分钟)。
const DEFAULT_TIMEOUT = 600_000;

// 容器内工作目录。
const CONTAINER_WORKDIR = "/home/sandbox/workspace";

// 容器「主日志」文件:PID1 tail 它 → `docker logs` 实时显示;agent 命令的 stream 输出 tee 进来。
const CONTAINER_LOG = "/tmp/fastevals-agent.log";

/** 单引号包裹 + 转义,把一个参数安全嵌进 shell 命令串。 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// 非 root 用户:安全 + 兼容(如 Claude Code 在 root 下拒绝 --dangerously-skip-permissions)。
// node:*-slim 镜像自带 UID/GID 1000 的 node 用户。
const SANDBOX_UID = 1000;
const SANDBOX_GID = 1000;

// npm 全局包安装目录(非 root 可写)。
const NPM_GLOBAL_DIR = "/home/node/.npm-global";

// 命令执行时注入的 PATH:把 npm 全局 bin 放最前。
const SANDBOX_PATH = `${NPM_GLOBAL_DIR}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;

/** 创建 Docker 沙箱的选项。 */
export interface DockerSandboxOptions {
  /** 单条命令超时(毫秒)。 */
  timeout?: number;
  /** Node 运行时。 */
  runtime?: "node20" | "node24";
}

/**
 * Docker 沙箱:为每次运行起一个隔离容器。
 * 实现 ../types.ts 的 Sandbox 接口。
 */
export class DockerSandbox implements Sandbox {
  private docker: Docker;
  private container: Docker.Container | null = null;
  private _containerId = "";
  private timeout: number;
  private runtime: string;
  private _workingDirectory: string = CONTAINER_WORKDIR;

  constructor(options: DockerSandboxOptions = {}) {
    this.docker = new Docker();
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.runtime = options.runtime ?? "node24";
  }

  /** 创建并启动一个 Docker 沙箱。 */
  static async create(options: DockerSandboxOptions = {}): Promise<DockerSandbox> {
    const sandbox = new DockerSandbox(options);
    await sandbox.initialize();
    return sandbox;
  }

  /** 拉镜像、起容器、装基础工具、备好工作区与 npm 前缀。 */
  private async initialize(): Promise<void> {
    const imageName = DOCKER_IMAGES[this.runtime];
    if (!imageName) {
      throw new Error(`Unsupported runtime: ${this.runtime}`);
    }

    // 确保镜像在本地。
    await this.ensureImage(imageName);

    // 起容器(先以 root 做初始化,之后命令切到非 root 用户)。
    // PID1 改成 tail 一个日志文件(而非 sleep infinity):这样容器「主日志」= 这个文件,
    // `docker logs` / Docker UI 的 Logs 标签页能实时显示我们 appendLog 进去的 agent 逐轮活动。
    // 文件先 touch + chmod 666,好让之后以 1000 用户跑的 exec 也能往里 append。
    this.container = await this.docker.createContainer({
      Image: imageName,
      Cmd: [
        "sh",
        "-c",
        `touch ${CONTAINER_LOG}; chmod 666 ${CONTAINER_LOG}; exec tail -n +1 -F ${CONTAINER_LOG}`,
      ],
      WorkingDir: CONTAINER_WORKDIR,
      Tty: true,
      HostConfig: {
        AutoRemove: true, // 停止即清理
        // 容器经 host.docker.internal 回连宿主上的 OTLP 接收器(tracing agent 用)。
        // Docker Desktop 自带这个名字;Linux 需显式映到 host-gateway,这里统一加上。
        ExtraHosts: ["host.docker.internal:host-gateway"],
      },
    });

    this._containerId = this.container.id;

    await this.container.start();

    // slim 镜像可能缺 CA 证书和 git,补装。
    await this.runCommandAsRoot("bash", [
      "-c",
      "apt-get update -qq && apt-get install -y -qq ca-certificates git curl > /dev/null 2>&1",
    ]);

    // 工作目录交给非 root 用户(node:node)。node 用户(UID 1000)在 slim 镜像里已存在。
    await this.runCommandAsRoot("mkdir", ["-p", CONTAINER_WORKDIR]);
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, CONTAINER_WORKDIR]);

    // 为非 root 全局安装准备 npm 目录。
    await this.runCommandAsRoot("mkdir", ["-p", NPM_GLOBAL_DIR]);
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, NPM_GLOBAL_DIR]);

    // 让 npm 用这个目录当全局前缀。
    await this.runCommand("npm", ["config", "set", "prefix", NPM_GLOBAL_DIR]);
  }

  /** 确保镜像在本地,缺了就拉。 */
  private async ensureImage(imageName: string): Promise<void> {
    try {
      const image = this.docker.getImage(imageName);
      await image.inspect();
    } catch {
      // 镜像不存在,拉取。
      console.log(`Pulling Docker image: ${imageName}...`);
      await this.pullImage(imageName);
      console.log(`Docker image ready: ${imageName}`);
    }
  }

  /** 拉取镜像并跟进度。 */
  private async pullImage(imageName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker.modem.followProgress(
          stream,
          (followErr: Error | null) => {
            if (followErr) {
              reject(followErr);
            } else {
              resolve();
            }
          },
          // 进度回调(可在此挂进度条)。
          () => {},
        );
      });
    });
  }

  /** 容器短 ID(像 Docker CLI 那样取前 12 位)。 */
  get sandboxId(): string {
    return this._containerId.slice(0, 12);
  }

  /** 以非 root 用户在容器里跑一条命令。 */
  async runCommand(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    // stream:把本命令输出也接到容器主日志(PID1 tail 它)→ Docker Logs 看到原始输出。
    // 实现:把 cmd+args 安全拼成 shell 串,经 runShell 走 tee(只 tee stdout,保留 stderr 分离 + 退出码)。
    if (opts.stream) {
      const joined = [cmd, ...args].map(shellQuote).join(" ");
      return this.runShell(joined, { env: opts.env, cwd: opts.cwd, stream: true });
    }

    // 保证 npm 全局 bin 在 PATH 里;固定 HOME/USER,让 codex(~/.codex)、npm 全局、
    // bash 的 ~ 展开都落在 node 用户家目录,不依赖 docker exec 是否注入 HOME。
    const env = {
      HOME: "/home/node",
      USER: "node",
      LOGNAME: "node",
      ...opts.env,
      PATH: SANDBOX_PATH,
    };

    return this.execCommand(cmd, args, {
      env,
      cwd: opts.cwd,
      user: `${SANDBOX_UID}:${SANDBOX_GID}`,
    });
  }

  /** 以 root 跑命令(仅内部初始化用)。 */
  private async runCommandAsRoot(
    cmd: string,
    args: string[] = [],
    opts: CommandOptions = {},
  ): Promise<CommandResult> {
    return this.execCommand(cmd, args, {
      env: opts.env,
      cwd: opts.cwd,
      user: "root",
    });
  }

  /** 真正在容器里 exec 一条命令,demux stdout/stderr 并带超时。 */
  private async execCommand(
    cmd: string,
    args: string[] = [],
    opts: { env?: Record<string, string>; cwd?: string; user?: string } = {},
  ): Promise<CommandResult> {
    if (!this.container) {
      throw new Error("Container not initialized");
    }

    const fullCmd = [cmd, ...args];
    const env = opts.env
      ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
      : undefined;

    const exec = await this.container.exec({
      Cmd: fullCmd,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: opts.cwd ?? this._workingDirectory,
      Env: env,
      User: opts.user,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    return new Promise<CommandResult>((resolve, reject) => {
      // Docker 把 stdout/stderr 复用在同一条流里,需手动 demux。
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => {
        // Docker 流格式:8 字节头 + 载荷。
        // 头:[stream_type(1B), 0, 0, 0, size(4B 大端)]。
        // stream_type:1 = stdout,2 = stderr。
        let offset = 0;
        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) {
            // 头不完整,剩余当 stdout。
            stdoutChunks.push(chunk.subarray(offset));
            break;
          }

          const streamType = chunk[offset];
          const size = chunk.readUInt32BE(offset + 4);

          if (offset + 8 + size > chunk.length) {
            // 载荷不完整,剩余当 stdout。
            stdoutChunks.push(chunk.subarray(offset + 8));
            break;
          }

          const payload = chunk.subarray(offset + 8, offset + 8 + size);
          if (streamType === 1) {
            stdoutChunks.push(payload);
          } else if (streamType === 2) {
            stderrChunks.push(payload);
          } else {
            // 未知类型,当 stdout。
            stdoutChunks.push(payload);
          }

          offset += 8 + size;
        }
      });

      // 超时:杀流并 reject。
      const timeoutId = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command timed out after ${this.timeout}ms`));
      }, this.timeout);

      stream.on("end", async () => {
        clearTimeout(timeoutId);
        const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
        const stderr = Buffer.concat(stderrChunks).toString("utf-8");

        try {
          const inspection = await exec.inspect();
          resolve({
            stdout,
            stderr,
            exitCode: inspection.ExitCode ?? 0,
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.on("error", (error: Error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  /** 经 bash -c 跑一段 shell 脚本。opts 为选项对象。 */
  async runShell(script: string, opts: CommandOptions = {}): Promise<CommandResult> {
    if (opts.stream) {
      // 只 tee stdout 到容器主日志:保留 stderr 分离(解析器要)+ pipefail 保留命令退出码。
      const wrapped = `set -o pipefail; { ${script} ; } | tee -a ${CONTAINER_LOG}`;
      return this.runCommand("bash", ["-c", wrapped], { env: opts.env, cwd: opts.cwd });
    }
    return this.runCommand("bash", ["-c", script], opts);
  }

  /** 追加一行到容器主日志(PID1 在 tail)→ Docker 的 Logs 标签页实时可见。 */
  async appendLog(line: string): Promise<void> {
    const esc = line.replace(/'/g, "'\\''");
    await this.runCommand("sh", ["-c", `printf '%s\\n' '${esc}' >> ${CONTAINER_LOG}`]);
  }

  /** 读容器里的文件。 */
  async readFile(path: string): Promise<string> {
    const result = await this.runCommand("cat", [path]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file ${path}: ${result.stderr}`);
    }
    return result.stdout;
  }

  /** 判断容器里某文件是否存在。 */
  async fileExists(path: string): Promise<boolean> {
    const result = await this.runCommand("test", ["-f", path]);
    return result.exitCode === 0;
  }

  /**
   * 一次 shell 往返读全部源码文件。find 按目录名(任意深度)剪枝、按扩展名收,
   * 每份文件前打一行哨兵 + 相对路径,再 cat 内容;在宿主侧按哨兵切分。
   */
  async readSourceFiles(opts: ReadSourceFilesOptions = {}): Promise<SourceFiles> {
    const extensions = opts.extensions ?? DEFAULT_SOURCE_EXTENSIONS;
    const ignoreDirs = opts.ignoreDirs ?? DEFAULT_IGNORE_DIRS;
    const ignoreFiles = new Set(opts.ignoreFiles ?? DEFAULT_IGNORE_FILES);

    const dirPrune = ignoreDirs.map((d) => `-name '${d}'`).join(" -o ");
    const nameTests = extensions.map((e) => `-name '*.${e}'`).join(" -o ");
    const script =
      `find . \\( -type d \\( ${dirPrune} \\) \\) -prune -o -type f \\( ${nameTests} \\) -print | ` +
      `while IFS= read -r f; do printf '%s%s\\n' '${SOURCE_FILE_MARKER}' "$f"; cat "$f"; printf '\\n'; done`;
    const result = await this.runShell(script);

    const files: SourceFile[] = [];
    for (const chunk of result.stdout.split(SOURCE_FILE_MARKER)) {
      const newline = chunk.indexOf("\n");
      if (newline < 0) continue; // 第一段(哨兵前的空串)或畸形段
      const path = chunk.slice(0, newline).trim().replace(/^\.\//, "");
      if (!path || ignoreFiles.has(path.split("/").at(-1) ?? "")) continue;
      // 去掉我们额外追加的那个结尾换行,还原文件原始内容。
      const body = chunk.slice(newline + 1);
      const content = body.endsWith("\n") ? body.slice(0, -1) : body;
      files.push({ path, content });
    }
    return makeSourceFiles(files);
  }

  /** 批量写文件(路径 -> 文本内容)。 */
  async writeFiles(files: Record<string, string>): Promise<void> {
    const sandboxFiles: SandboxFile[] = Object.entries(files).map(([path, content]) => ({
      path,
      content: Buffer.from(content, "utf-8"),
    }));

    await this.uploadFiles(sandboxFiles);
  }

  /** 用 tar 归档把文件灌进容器。 */
  async uploadFiles(files: SandboxFile[]): Promise<void> {
    if (!this.container) {
      throw new Error("Container not initialized");
    }

    if (files.length === 0) {
      return;
    }

    // 打 tar 包。
    const pack = tar.pack();

    for (const file of files) {
      const content =
        typeof file.content === "string" ? Buffer.from(file.content, "utf-8") : file.content;

      pack.entry({ name: file.path }, content);
    }

    pack.finalize();

    // putArchive 以 root 身份解包到工作区。
    await this.container.putArchive(pack, { path: CONTAINER_WORKDIR });

    // 修正属主:putArchive 上传成 root,改回 node 用户,agent 才能编辑。
    await this.runCommandAsRoot("chown", ["-R", `${SANDBOX_UID}:${SANDBOX_GID}`, CONTAINER_WORKDIR]);
  }

  /** 取当前工作目录。 */
  getWorkingDirectory(): string {
    return this._workingDirectory;
  }

  /** 设当前工作目录。 */
  setWorkingDirectory(path: string): void {
    this._workingDirectory = path;
  }

  /** 停止并清理容器(AutoRemove 负责销毁)。 */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 0 }); // 立即停止
      } catch {
        // 容器可能已停止或被移除,忽略。
      }
      this.container = null;
    }
  }
}
