# 部署到 Vercel，拿到可分享给同事的链接

按下面步骤做一遍，**最后一步** Vercel 会给你一个 `https://xxx.vercel.app` 的链接，那就是你要的网站，直接发给同事即可。

---

## 第一步：在 GitHub 新建仓库

1. 打开 **https://github.com/new**
2. **Repository name** 填：`ai-tool`（或任意英文名）
3. 选 **Public**，**不要**勾选 “Add a README file”
4. 点 **Create repository**
5. 记下页面上的仓库地址，类似：`https://github.com/你的用户名/ai-tool.git`

---

## 第二步：在本机终端推送代码

在终端执行（**把下面两处改成你的**：`你的GitHub用户名` 和 `ai-tool` 若你改了仓库名也要改）：

```bash
cd "/Users/chenxiu/Downloads/AI chenxiu"

# 若从未初始化过 Git，执行：
git init
git add .
git commit -m "init"

# 分支与远程（替换成你的仓库地址）
git branch -M main
git remote add origin https://github.com/你的GitHub用户名/ai-tool.git

# 推送（会提示你登录 GitHub 或输入 Token）
git push -u origin main
```

- 若提示未配置用户，先执行：
  ```bash
  git config user.email "你的邮箱@example.com"
  git config user.name "你的名字"
  ```
  再重新 `git add .` 和 `git commit -m "init"`。
- 若 `git push` 要密码，请用 **Personal Access Token**（GitHub → Settings → Developer settings → Personal access tokens）当密码使用。

---

## 第三步：在 Vercel 部署

1. 打开 **https://vercel.com**，用 **GitHub 账号登录**
2. 点 **Add New…** → **Project**
3. 在列表里选你刚推送的 **ai-tool**（或你的仓库名），点 **Import**
4. 直接点 **Deploy**，不要改任何配置
5. 等 1～2 分钟，页面会显示 **Congratulations!** 和一条访问链接

---

## 第四步：拿到最终链接

部署成功后，在 Vercel 项目页会看到：

- **Visit** 或 **Domains** 下的地址，形如：  
  **https://ai-tool-xxxx.vercel.app**

**这个链接就是你要的“网站”**，复制后发给同事即可。同事打开后各自在页面里填自己的 API Key 就能用。

以后你只要把代码推送到同一仓库的 `main` 分支，Vercel 会自动重新部署，链接不变。
