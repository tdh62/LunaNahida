# LunaNahida

LunaNahida 是一款 Go+React 的依赖 WebView2 运行的桌面音乐播放器。

## 功能

- **曲库与歌单**：文件导入、文件夹监听、收藏、标签、播放历史。
- **搜索与筛选**：歌曲、歌手、专辑搜索，组合筛选和排序。
- **播放与歌词**：播放队列、内嵌与外置歌词。
- **声音与外观**：均衡器、自定义频率公式与增益曲线、实时频谱、主题和迷你播放器。
- **网络音乐**：播放在线音频。
- **工具箱**：曲库整理、白／粉红／褐噪音、计时器与睡眠定时。

加密音乐格式还原由可选模块提供，普通播放和曲库管理不需要安装该模块。

## 开始使用

桌面版需要 Windows 和 WebView2 运行环境；便携版附带运行环境，目前面向 Windows x64。

1. 解压播放器包，保留 `search-dict` 等随包目录，运行 `LunaNahida.exe`。
2. 首次启动曲库为空。通过文件选择或拖放添加音乐，选择临时播放、加入曲库或监听所在文件夹。
3. 在设置中调整扫描方式、声音、外观与备份选项。

便携版请将整个目录放在可写位置。数据保存在 EXE 旁的 `userdata` 中，升级时保留该目录。标准桌面版的数据默认保存在 `%LOCALAPPDATA%/LunaNahida`；音乐文件仍保留在原位置。曲库备份不包含音频文件。

详细操作见 [使用指南](docs/user-guide.md)。

## 使用文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/user-guide.md) | 导入、搜索、歌单、歌词、网络音乐与备份 |
| [自定义音效](docs/custom-effects/README.md) | 频率公式、时间响应、延迟与配置示例 |
| [增益曲线](docs/gain-curve.md) | 绘制、撤销、试听与专业调音 |
| [迷你播放器](docs/mini-mode.md) | 窗口切换、置顶与播放控制 |
| [曲库整理](docs/music-organizer.md) | 重命名、归档、去重、合并与文件恢复 |
| [噪音发生器](docs/noise-generator.md) | 噪音类型、后台播放与音乐切换 |
| [计时器](docs/work-timer.md) | 正计时、倒计时、暂停与结束提醒 |
| [Web 模式](docs/web-mode.md) | 浏览器支持范围与静态部署 |
| [格式还原模块](docs/music-restore.md) | 可选模块安装、使用与中断恢复 |
| [页面切换与交互性能](docs/responsive-navigation.md) | 页面状态保留、加载反馈与队列性能 |
| [开发与构建](docs/development.md) | 环境准备、运行、测试与打包 |

## 从源码运行

项目使用 React、TypeScript、Go、SQLite 和 Wails v3。准备 Go 1.26.8、Node.js 22.15+ 和 pnpm 10.14.0，具体环境要求见 [开发与构建](docs/development.md)，依赖版本以 `go.mod` 和 `package.json` 为准。

```powershell
git clone https://cnb.cool/tdh6/LunaNahida
cd LunaNahida
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

打开 `http://127.0.0.1:8080` 预览界面，本地 Go 服务使用 `127.0.0.1:8787`。浏览器选择或拖入的文件仅用于当前会话；管理后端曲库时，请使用 Go 服务可访问的文件夹路径。

**主播放器可独立开发、测试和构建，无需初始化子模块。** 完整版的格式还原源码需要额外仓库访问权限；公开检出可使用 `build:desktop` 或 `build:release:lean`。

仅运行浏览器播放器：

```powershell
corepack pnpm dev:web
```

## 许可

本项目采用 [Apache License 2.0](LICENSE) 许可，SPDX 标识为 `Apache-2.0`。

第三方依赖、随包字典、WebView2 运行环境及独立格式还原子模块按各自的许可或使用条款分发，本项目许可不替代这些条款。分发时请保留相关许可文件。