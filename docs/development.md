# 开发与构建

## 环境

- Go 1.26.8，版本要求见 `go.mod`。
- Node.js 22.15+，需支持 `--experimental-transform-types` 和 `import.meta.dirname`。
- pnpm 10.14.0，可通过 Corepack 调用；若 Node 环境没有 Corepack，请先安装 Corepack 或对应版本 pnpm。
- Windows 桌面运行需要 WebView2。Windows 构建需安装与项目匹配的 Wails CLI：

```powershell
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.26
```

确保 Go 的可执行文件目录位于 `PATH`，能够调用 `wails3`。

## 本地运行

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

前端地址为 `http://127.0.0.1:8080`，Go API 默认在 `127.0.0.1:8787`。`dev:api` 和 `dev:ui` 可分别启动两部分。桌面运行通过 Wails 提供本地接口，不额外监听网络 API 端口。

浏览器选择的文件用于临时播放；后端曲库、扫描和整理使用 Go 服务可访问的路径。独立浏览器模式的运行与部署见 [Web 模式](web-mode.md)。

## 构建播放器

| 命令 | 输出 |
| --- | --- |
| `corepack pnpm build:desktop` | `bin/LunaNahida.exe` 与 `bin/search-dict` |
| `corepack pnpm build:portable` | `bin/portable`，含运行环境与字典 |
| `corepack pnpm build:release:lean` | `bin/releases/<版本>/lean-only`，含精简版 ZIP、清单与校验值 |
| `corepack pnpm build:web` | `dist` 静态网页 |

上述命令不需要格式还原子模块源码。字典与许可证会随构建复制，分发时请保留 `search-dict`。

便携版构建需要 Windows x64，并预先将 WebView2 Fixed Version Runtime（Windows x64）的完整目录放入 `resources/WebView2`。该运行环境不纳入 Git。便携包整体移动，首次运行创建 `userdata`，更新时保留用户数据。

## 可选模块

格式还原源码通过独立子模块关联，访问需要该仓库权限。仅在有权限且需要构建该模块时执行：

```powershell
git submodule update --init -- extensions/music-restore
corepack pnpm build:converter
```

模块输出到 `bin/converter/modules/music-restore`，安装方法见 [格式还原模块](music-restore.md)。

| 命令 | 输出 |
| --- | --- |
| `corepack pnpm build:desktop:full` | 桌面播放器、字典与还原模块 |
| `corepack pnpm build:portable:full` | 便携播放器与还原模块 |
| `corepack pnpm build:release` | 精简版、完整版和独立模块 ZIP |
| `corepack pnpm build:release:portable` | 上述包及两种便携版 ZIP |

发布包包含安装说明与 `MANIFEST.json`；发布目录提供 `SHA256SUMS.txt` 和 `release.json`。`docs/music-restore-contract.json` 是构建与测试所需的接口契约，保留在主仓库。

## 版本与检查

播放器版本来自 `internal/buildinfo/VERSION`，修改后运行 `corepack pnpm build:version` 同步资源。模块版本独立管理，兼容性依据协议判断。

```powershell
corepack pnpm check:version
corepack pnpm exec tsc --noEmit -p tsconfig.app.json
corepack pnpm lint
corepack pnpm test:frontend
go test ./...
```

Web 验证先安装浏览器，再运行检查：

```powershell
corepack pnpm exec playwright install chromium
corepack pnpm test:web
```

可通过 `PLAYWRIGHT_CHANNEL=msedge` 使用本机 Edge。`test:web` 验证浏览器行为并模拟桌面接口，不能代替 Windows 原生窗口验证。真实模块集成检查使用 `corepack pnpm test:converter:integration`，需先初始化模块源码。

## Windows 构建 CI

GitHub Actions 工作流位于 [windows-build.yml](../.github/workflows/windows-build.yml)，在推送 `main`、推送 `v*` 标签、向 `main` 提交 Pull Request 时运行，也可在 GitHub 的 **Actions → Windows build → Run workflow** 中手动启动。

工作流使用 Windows x64、Node.js 24、`package.json` 指定的 pnpm，以及 `go.mod` 指定的 Go 和 Wails CLI。依次执行版本检查、TypeScript 检查、Lint、前端测试、Go 测试和 Windows 构建，并校验各版本的产物内容。便携版所需的 WebView2 Fixed Version Runtime x64 会从微软官方页面下载，展开后验证运行程序的微软数字签名。

默认构建桌面版和便携版，不需要子模块仓库权限。若在主仓库的 **Settings → Secrets and variables → Actions** 中配置 `MUSIC_RESTORE_TOKEN`，推送和手动构建会额外生成两个带 unlock-music 插件的版本，并运行模块测试和真实转换器集成测试。该 Secret 应是拥有 `tdh62/lumanahida_unlock_music` 仓库 **Contents: Read-only** 权限的 GitHub Token；工作流按主仓库记录的子模块提交检出，不跟随子模块最新分支。Pull Request 仅构建不带插件的桌面版和便携版。

手动运行时，勾选 `include_converter` 会要求必须能构建带插件版本；缺少 Token 时会明确失败。未勾选时仍会在 Token 已配置的情况下构建带插件版本。无法构建插件时，工作流会输出警告。

成功后，在该次运行的 **Artifacts** 中分别下载以下产物，保存 14 天：

| 产物名称（均以 `-<提交 SHA>` 结尾） | 内容 |
| --- | --- |
| `LunaNahida-windows-x64` | `LunaNahida.exe`、`search-dict/` |
| `LunaNahida-windows-x64-portable` | 上述文件及 `WebView2/` |
| `LunaNahida-windows-x64-unlock-music` | 桌面版及 `modules/music-restore/` |
| `LunaNahida-windows-x64-portable-unlock-music` | 便携版及 `modules/music-restore/` |

GitHub 为每个产物生成单层下载 ZIP，内部没有再次打包的 ZIP，也不附加 README、安装说明、发布清单或校验文件。字典 manifest、字典及插件的许可证、WebView2 原始运行文件保留。包内不包含 `userdata`。工作流不自动创建 GitHub Release。本地 `build:release*` 命令仍使用上文所述的发布打包方式。

## 数据目录

标准桌面版默认使用 `%LOCALAPPDATA%/LunaNahida`。开发时可设置 `LUNANAHIDA_DATA_DIR` 指向独立目录，避免使用日常曲库。便携版固定使用 EXE 旁的 `userdata`，忽略该覆盖变量。
