# Zero Dial

Zero Dial 是一个基于 Manifest V3 的 Chrome 新标签页快速拨号扩展。

## 项目背景

本项目源于对旧版 Speed Dial 2 本地快速拨号体验的认可。随着 Chrome 内核和扩展平台持续更新，旧版所依赖的技术架构已无法适配现代 Chrome，因此本项目借助 AI 辅助开发，重新实现相近的本地使用体验。

Zero Dial 是独立的社区实现，与原 Speed Dial 2 服务及其开发者没有关联，也未获得其认可或授权。本项目不接入原服务提供的账号、云同步或其他在线服务。

## 功能

- 网站和分组管理
- 拖拽排序及跨分组移动
- 本地搜索与访问统计
- 自动截图、上传图片及图片 URL 缩略图
- Chrome 书签、历史记录、最近关闭标签页和常用网站集成
- 可配置的布局、外观、背景和侧栏
- JSON 备份与恢复
- 导出到 Chrome 书签
- 使用 IndexedDB 和 `chrome.storage.local` 保存数据

本项目不包含账号、云同步、支付、广告、推荐、Analytics、遥测或远程可执行代码。扩展不会向项目维护者或自有服务器上传书签、历史记录、截图、设置或其他用户数据。

## 安装

1. 从最新 GitHub Release 下载并解压安装包。
2. 打开 `chrome://extensions/`。
3. 启用“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择包含 `manifest.json` 的解压目录；直接使用仓库源码时请选择 `extension/`。

## 开发

项目不需要构建步骤，也没有第三方运行时依赖。

运行校验：

```bash
node scripts/validate.mjs
```

扩展使用 Chrome 的书签、历史记录、会话、常用网站、标签页和网页访问权限实现对应的本地浏览器集成功能，以及用户主动请求的网页截图。扩展数据保存在当前 Chrome Profile 中，只有用户主动导出备份时才会写出 JSON 文件。

## 分支与发布

- `dev` 为开发分支。
- `master` 为发布分支。

推送至两个分支时都会自动校验并打包；推送至 `master` 时还会自动递增补丁版本并创建 GitHub Release。

安装包命名为 `zero-dial-<版本>.zip`，其根目录包含 `manifest.json`，解压后可以直接侧载。

## 许可证

本项目采用 [MIT License](LICENSE)。
