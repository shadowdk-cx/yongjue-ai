# 涌觉商贸AI图文视频制作工具

Web 端半自动化工具（Vercel 部署用一次提交触发构建）：产品解析、SEO 文案生成、场景图生成、图生视频/文生视频。用户自行配置 API Key，按量使用。

## 不会安装 Node / 没有 npm？（简易版，可先做图文与生图）

在 Finder 中进入本项目文件夹，**双击运行 `启动网页版-无需npm.command`**（若提示安全限制：按住 Control 点文件 → **打开**）。  
脚本会优先用 Mac 自带的 **Python3**，没有则用 **Ruby** 在 **http://127.0.0.1:8765** 打开精简网页版，**无需** `npm install`。  
同文件夹里的 **`请先看-如何启动.txt`** 是给你打印或发给同事看的步骤说明。  
**注意**：批量垫图、视频生成、历史记录等完整功能仍需下方「安装 Node + start.sh」。

---

## 如何打开页面（解决「无法访问此网站 / localhost 拒绝连接」）

1. **安装 Node.js**（若未安装）  
   打开 [https://nodejs.org/](https://nodejs.org/) 下载并安装 LTS 版本。

2. **在终端里启动项目**（任选一种方式）  
   - **方式 A**：在 Cursor 里按 `` Ctrl+` `` 打开终端，或菜单「终端 → 新建终端」，执行：
     ```bash
     cd "/Users/chenxiu/Downloads/AI chenxiu"
     npm install
     npm run dev
     ```
   - **方式 B（Mac）**：在 Finder 里双击 **`双击我启动.command`**（或 `启动完整版-稳定模式.command`）。**不要双击 `start.sh`**——在 Mac 上通常不会执行。或在终端执行：
     ```bash
     cd "/Users/chenxiu/Downloads/AI chenxiu"
     chmod +x start.sh
     ./start.sh
     ```

3. 终端里出现 **「Ready on http://localhost:3000」** 后，用浏览器打开：**http://localhost:3000**。

若仍提示「localhost 拒绝了我们的连接请求」，说明开发服务器未在运行，请确认上述命令是在**本机**终端执行且没有报错。

### 白屏且出现 `missing required error components, refreshing...`

说明你用了 **`npm run dev`（开发模式）**。本仓库**默认已改为稳定启动**：

- **双击 `双击我启动.command`**（或 `启动完整版-稳定模式.command`）：会先构建再 `next start`，**不要**再单独跑 `npm run dev`。
- 仅在你改代码要调试时，才用：`./start.sh --dev`

**建议**：Chrome 不要对 `localhost` 开启整页翻译。  
用稳定模式时，改代码后需**再双击一次 `双击我启动.command`** 才会看到更新。

### 页面错乱 / 刷新后没样式 / 打不开

常见原因：**同时开了多个 `npm run dev`**、或 `.next` 缓存损坏，导致 `layout.css` 加载失败。

在项目目录终端依次执行：

```bash
cd "/Users/chenxiu/Downloads/AI chenxiu"
chmod +x start.sh
./start.sh --kill-ports   # 释放 3000–3010 端口
./start.sh --clean        # 删除 .next
./start.sh                # 再启动
```

启动后看终端里显示的地址（可能是 `http://localhost:3000` 或 `3001`…），用浏览器打开**终端里那一行**，并 **Cmd+Shift+R** 强制刷新。

**给同事共用**：见下方「给同事共用（生成网站）」一节，可用局域网 IP 或部署成公网网站。

## 功能

- **图文工作区**：输入产品原始标题/卖点/描述，AI 解析产品画像（卖点、人群、场景、痛点等），一键生成平台化、多语种标题、Bullet Points、详情描述；支持自定义提示词模板与保存到文件。
- **图像生成**：根据产品信息自动生成生图 Prompt；支持 **Gemini 生图**（如 Nano Banana）与 **DALL-E**；支持产品垫图。**图片精修**：在已生成图基础上用自然语言说明做光影/去污/文字等优化（仅 Gemini），结果加入「单张生成」列表。
- **视频生成**：图生视频（上传产品图 + 可选动作描述）、文生视频（输入脚本/描述），支持 **Gemini Veo** 与 Runway 等。**Veo 返回的 MP4 会保存到 `public/generated-videos/` 并以短链接返回**，避免整段 base64 塞进 JSON 导致浏览器长时间卡在「生成中」。

## 技术栈

- Next.js 14 (App Router)、React 18、TailwindCSS、TypeScript
- 文本/图像：OpenAI API（GPT、DALL-E）
- 视频：Runway API（image_to_video、text_to_video）

## 使用前准备

**仅用 Gemini 即可完成图文全部功能**（推荐）：在配置栏选择服务商「Gemini」，填入 [Google AI Studio](https://aistudio.google.com/apikey) 获取的 **Gemini API Key**，即可使用：产品解析、标题/卖点/详情生成、生图 Prompt、AI 生图。无需 OpenAI。

- **Gemini API Key**：用于文案解析、文案生成、生图 Prompt、Gemini 生图。在配置栏选择「Gemini」后填入。
- **OpenAI API Key**（可选）：若选择服务商「OpenAI」，用于 GPT 文案与 DALL-E 生图。
- **Runway API Key**（可选，仅视频）：图生视频/文生视频需在「视频 API Key」中填写 [Runway](https://docs.dev.runwayml.com/) Key。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)，在页面底部配置栏填入 API Key 与模型后即可使用。

## 给同事共用（生成网站）

本工具本身就是网页应用，有两种方式让同事在浏览器里使用：

### 方式一：同一局域网内共用（最快）

在你本机或一台大家能访问的电脑上运行，让同事通过内网 IP 打开页面。

1. **启动并允许局域网访问**（任选其一）：
   ```bash
   npm run dev:share
   ```
   或先构建再以生产模式共享：
   ```bash
   npm run build
   npm run start:share
   ```

2. 终端会显示类似：`Ready on http://0.0.0.0:3000`。  
   查看本机 IP（如 `192.168.1.100`），**同事在浏览器打开**：`http://你的IP:3000`（例如 `http://192.168.1.100:3000`）。

3. 每人浏览器里**各自填写自己的 API Key**，Key 只存在各自浏览器，不会存到服务器。

**注意**：关闭电脑或停止命令后，同事就访问不了了；本机需放行 3000 端口（公司网络/防火墙若有限制需单独开放）。

---

### 方式二：部署成公网网站（长期、远程可访问）

把项目部署到云上，生成一个固定网址（如 `https://xxx.vercel.app`），任何人随时用浏览器打开。

**推荐：Vercel（免费、简单）**

1. 将代码推到 **GitHub**（新建仓库并 push 本项目）。
2. 打开 [vercel.com](https://vercel.com)，用 GitHub 登录，点击 **Add New → Project**，导入该仓库。
3. 直接点 **Deploy**，等几分钟即可得到 `https://你的项目名.vercel.app`。
4. 把该链接发给同事即可；每人打开后在自己浏览器里填写各自的 API Key。

**注意**：
- 视频生成接口可能跑 1–2 分钟，Vercel 免费版有执行时间限制；若经常用视频功能，可考虑 Vercel Pro 或自建 Node 服务器。
- API Key 仅在前端与 Next 接口间传输，不会写入 Vercel 或数据库；仍建议不要将 Key 写进代码或提交到仓库。

**其他部署**：也可部署到任意支持 Node 的服务器（如 `npm run build && npm run start`），或公司内网服务器，同事通过内网域名访问。

## 构建与部署

```bash
npm run build
npm start
```

可部署到 Vercel、Node 主机等。视频生成接口会轮询 Runway/Veo 任务，耗时可能 1–2 分钟，部署时请将 Serverless 超时调大（如 Vercel 需 Pro 或自建 Node 服务）。

## 注意事项

- API Key 仅在前端与 Next.js API 路由间传递，不写入数据库；请勿将 Key 提交到代码库。
- 生图支持 Gemini（含垫图、精修）与 OpenAI DALL-E；精修功能需选择服务商 **Gemini**。
- 视频生成依赖 Runway，需在配置中填写 Runway API Key；可灵(Kling) 等可后续按同样方式接入。
