# 加密音乐还原源码子模块

`extensions/music-restore` 是独立 Git 仓库和 Go 工程；运行时安装目录仍为 `modules/music-restore`。主程序不引用解锁算法，不要求模块源码存在。模块工程可以单独克隆、测试和构建，无法访问播放器数据库。

## 本地验证状态

拆分验证时使用相邻目录的 `luma-tune-music-restore.local.git` 作为本地 Git 远端。验证完成后，模块已推送至 `https://cnb.cool/tdh6/LunaNahida-music-unlock` 的 `main` 分支，主仓库 `.gitmodules` 和模块 origin 已切换至该地址。本地仓库保留作为验证快照；主仓库历史未改写。

模块源码已建立独立提交，主仓库通过 gitlink 固定该提交。源码迁出、依赖清理、测试、构建脚本、`.gitmodules` 与 gitlink 作为整组拆分改动一同提交，避免只更新子模块配置而遗漏其余调整。旧路径原始文件的本地备份位于忽略的 `bin/split-work/originals`，不参与构建。

本地模块提交为 `984c953c4094d7803d9774705ef669f0ef0d4bd7`。验证结果：

| 检查 | 结果 |
| --- | --- |
| 干净检出，不初始化子模块；准备前端资源后运行 `go test ./...` | 通过 |
| 未初始化模块时生成精简发布 ZIP | 通过；包内没有还原 EXE |
| 未初始化模块时尝试独立模块、完整发布、完整桌面构建 | 明确报错，停止打包 |
| 从本地远端单独克隆模块，测试并构建 EXE | 通过，无播放器源码依赖 |
| 模块自身测试与上游 `go test ./algo/...` | 通过 |
| QMC、NCM MP3/FLAC 黑盒集成，含入库、备份、标签、封面、独立使用与冲突 | 通过 |
| 验证副本中播放器 1.0.0 与模块 9.8.7 的打包及黑盒集成 | 通过；原模块版本保持 1.0.0 |
| ZIP 文件清单、文件及压缩包 SHA-256、模块包含关系和上游许可证 | 通过 |
| 前端单元测试 | 103 项通过 |
| 模块 `go vet ./...`；主仓库涉及修改的 backend、release-pack、restoreprotocol 静态检查 | 通过 |

主仓库完整 `go vet ./...` 仍报告 `internal/systemfonts/list_windows.go:27` 的 `unsafe.Pointer` 用法；该代码在拆分前已存在，本次未修改。当前本机凭据已验证可读取和推送指定模块远端；其他开发者与 CI 的权限仍需分别配置和检查。

干净播放器检出位于 `bin/split-validation/clean-player`，独立模块检出位于 `bin/split-validation/standalone-module`。验证副本和产物均被主仓库忽略。常规 1.0.0 的精简版、完整版和独立模块包位于 `bin/releases/1.0.0`。

## 开发和验证

未初始化子模块时，主仓库正常执行 `go test ./...`、`corepack pnpm build:desktop`、`corepack pnpm build:release:lean`。包含模块的构建会明确报错，不自动生成冒充完整版的精简包。

首次干净检出仍需先安装播放器前端依赖并执行 `corepack pnpm build`，生成 Go 嵌入的 `dist/assets`；这是播放器原有的构建前提，与子模块无关。

有访问权限的开发者初始化指定提交：

```powershell
git submodule update --init -- extensions/music-restore
```

历史验证副本仍使用本地文件地址，需要单次命令 `git -c protocol.file.allow=always submodule update --init -- extensions/music-restore`，仅为本地验证允许文件传输，不修改全局 Git 设置。当前主仓库已使用 HTTPS 远端，使用上面的普通命令。

进入子模块执行 `go test ./...` 和 `node scripts/build-converter.mjs`。上游解码器是模块仓库中的普通目录，不再引入嵌套子模块；其测试需在 `third_party/unlock-music` 执行 `go test ./algo/...`。

主仓库的 `corepack pnpm test:converter:integration` 构建 EXE，由模块测试导出测试文件，再通过 EXE 验证 QMC、NCM MP3/FLAC 的真实还原、入库、备份、标签、独立命令行及重名保护。默认主仓库测试仅使用中性模拟文件，真实还原测试不被静默替换成模拟测试。

协议示例、限制、后缀和分类版本见 `music-restore-contract.json`。两个工程分别测试序列化字段和分类规则；集成构建检查两份契约快照一致。修改公开契约时同步更新双方并调整协议或分类版本，再固定新的子模块提交。

模块产品版本独立管理。播放器只核对模块标识、操作、协议和分类版本；打包校验模块自身 Windows 版本资源。模块 ZIP、MANIFEST 使用模块版本，release.json 同时记录主程序版本、模块版本、源码提交及未提交状态。

## 远端关联与提交顺序

1. 已将验证的模块提交推送到指定远端；后续模块修改先在模块仓库提交并推送，确认目标提交可访问。
2. 主仓库已通过 `git submodule set-url` 和 `git submodule sync` 切换地址。若再次更换仓库，需同步更新 `.gitmodules`、本地配置和独立克隆的 origin。
3. 在另一份干净检出中验证默认构建不需要私有权限；再以授权 Git 凭据初始化模块，验证完整构建。
4. 先推送模块提交，再提交和推送主仓库整组改动及指向该提交的 gitlink。发布不使用自动跟随最新分支的 `submodule update --remote`。

Git 凭据由开发者或 CI 配置，不写入 `.gitmodules`。此方案通过本地 Git 检出构建，不通过 Go 拉取私有模块，无需为它额外配置 GOPRIVATE。CI 在模块源码提交不存在或不可访问时明确失败；精简构建无需该凭据。

迁移不会删除主仓库历史中的解锁源码，也不保证分发 EXE 中的算法无法被分析。上游 MIT 版权与许可声明保留在模块源码和模块包的 LICENSES 中。
