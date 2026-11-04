# 墨迹 moji

输入一句诗，代码替你写成一幅行草书法，落款、小篆印章、宣纸纹理一应俱全。

**在线使用：https://jiahe-chen.github.io/moji/**

- 同一个链接打开，永远是同一幅字。所有参数都写在网址里，发到微信就能分享。
- 浏览器里直接下载 300dpi 高清 PNG 和 PDF，可以拿去打印装裱。
- 说一句话，AI 来写：比如「送给刚升职的张三，我是李四，挂办公室」。DeepSeek V4.1 会识别出赠给、署名和风格，选好句子、上网核对原文后直接写出来。版式你说了横的、竖的就照办，没说就自动排。AI 只写适合送人的内容，有争议、敏感的内容和让它「忽略规则」之类的话都会婉拒，也不表达立场。之后接着说「署名改成王五」「换成竖的」「再狂一点」「换一句」，AI 直接改。
- 版式默认自动：条幅、斗方、横披都排一遍，挑字最饱满、断句最自然的那种。
- 面向国内用户：字体全部自托管，不依赖 Google Fonts。
- 只做匿名统计：网页打开、下载、分享时往代理发一个计数，不用 cookie，不记 IP，也不记用户写的内容。

## 它是怎么写字的

字形取自开源书法字体，其余部分全部由算法生成，没有用 AI 画图模型：

1. **字形**：用字体画出字，再随机倾斜、缩放，做出欹侧和行气。
2. **笔势**：用结构张量算出每一笔的走向。
3. **飞白**：笔毛纹理顺着笔势做线积分卷积（LIC）。蘸一次墨连写几个字，墨快用尽、写到收笔时，才零星露出飞白；笔画交叉的地方不出。
4. **章法**：按每个字的实际高度排字，左右摆动按随机游走累积，上下字之间偶尔带牵丝。同一个字第二次出现，换用行书写法。
5. **落款与印章**：落款用楷书，自动生成干支日期（如「丙午秋」）。名章是小篆白文，简体名字自动转繁体（「陈」→「陳」）。印面边缘做旧：四边起伏、缺口、印泥不匀，钤印时略微歪斜。
6. **宣纸**：纸面颗粒、纤维和暗角都由噪声生成。

引擎在 `src/engine.js`，不依赖 DOM，浏览器和 Node 共用同一份代码。

## 分享链接参数

| 参数 | 含义 | 例 |
|---|---|---|
| `t` | 正文（可带标点；用换行 `%0A` 指定分行） | `长风破浪会有时，直挂云帆济沧海` |
| `to` | 赠给 | `张三` |
| `from` | 署名，也刻在名章上 | `李四` |
| `src` | 出处，落款里写成「录××」 | `李白行路难句` |
| `date` | 日期，默认按今天的干支和季节 | `丙午秋` |
| `lead` | 引首章，1–2 个字 | `长风` |
| `fmt` | 版式：`auto` 自动（默认）、`tiaofu` 条幅、`doufang` 斗方、`hengpi` 横披 | `auto` |
| `w` | 放纵度 0–100，越大越欹侧 | `50` |
| `s` | 随机种子 | `102` |

## 本地开发

```bash
npm install
npm run serve
```

然后打开 http://localhost:8080 。

命令行出图，用的是和网页同一个引擎：

```bash
npm run render -- --text "长风破浪会有时，直挂云帆济沧海" --src 李白行路难句 --to 张三 --from 李四 --lead 长风 --format tiaofu --scale 3 --out 李四赠张三.png --pdf 李四赠张三.pdf
```

第一次运行之前，先生成字体分片：

```bash
uvx --from fonttools --with brotli python tools/build_fonts.py
```

这一步会顺带把原始 TTF 下载到 `tools/.cache/`，命令行出图要用。

页面底部「灵感集市」里的示例作品，参数写在 `gallery/works.json`（每幅的正文、出处、落款、种子）。改完运行 `node tools/build_gallery.mjs` 重新生成缩略图；加 `--seeds 1,2,3 --out 目录` 可以先用几个种子各写一张，挑好看的。

## AI 选句代理（`server/`）

网页里的「说一句，AI 来写」会调用一个代理服务。网页把用户的话和当前各字段一起发过去，代理返回要改的字段和候选句子。代理用站长的 DeepSeek Key 运行这个助手：模型是 `deepseek-flash`（DeepSeek-V4.1-Flash），对话走 Messages 接口，并用 DeepSeek 官方 Search 接口核对原文。协议和 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 一致。代理只开放搜索这一个工具，不能读写文件，也不能执行命令。

```bash
DEEPSEEK_API_KEY=sk-... npm run agent      # 本地启动，监听 8787，网页在 localhost 上会自动连它
```

部署到阿里云函数计算（国内能访问）：

1. 打包：`python3 tools/pack_server.py`，得到 `dist/moji-ai-server.zip`。包里的 `bootstrap` 是启动脚本，用平台内置的 Node.js 20 在 9000 端口启动代理。
2. 在函数计算控制台新建「Web 函数」：
   - 运行环境：选「自定义运行时」。
   - 代码：「通过 ZIP 包上传代码」，选上一步的 zip。
   - 启动命令：留空（会自动用 `bootstrap`）。
   - 监听端口：`9000`。
   - 执行超时时间：改成 `120` 秒，选句时要上网核对，一次大约 20–60 秒。
3. 在「更多配置 → 环境变量」里填：
   - `DEEPSEEK_API_KEY`：你的 Key
   - `ALLOWED_ORIGINS`：`https://jiahe-chen.github.io`
   - 按需设置 `PER_IP_PER_HOUR`（默认 10）和 `DAILY_LIMIT`（默认 300）
4. 在函数的「触发器」页签确认有一个 HTTP 触发器，认证方式选「无需认证」，请求方式包含 POST 和 OPTIONS。复制公网访问地址，加上 `/api/suggest`，填进 `src/config.js` 的 `ONLINE`。
5. 在 DeepSeek 后台给这个 Key 设置消费上限，作为最后一道保险。

函数建好以后，改了代理代码不用再进控制台，一条命令就能更新：

```bash
npm run deploy
```

它会打包、用[阿里云 CLI](https://help.aliyun.com/zh/cli/) 把代码传上去、等函数计算部署完，再请求线上的 `/api/health`，看到新版本号才算成功。只换代码，环境变量和触发器都不动。部署前后会核对环境变量，少了一个就报错。函数名和地域默认是 `noji-ai`、`cn-hangzhou`，可以用环境变量 `FC_FUNCTION`、`FC_REGION` 改。加 `--dry-run` 只打印要发的请求，不真的部署。

第一次用之前，装好 CLI 并登录一次：

```bash
curl -sSL https://aliyuncli.alicdn.com/aliyun-cli-linux-latest-amd64.tgz | tar xz -C ~/.local/bin aliyun
```

```bash
aliyun configure --mode OAuth
```

macOS 把下载地址里的 `linux` 换成 `macosx`。登录走浏览器授权，不用创建 AccessKey，地域填 `cn-hangzhou`。如果用 RAM 子账号登录，需要主账号先在 RAM 控制台的「集成 → OAuth 应用」里授权阿里云 CLI。

`server/test/mock-deepseek.mjs` 是一个模拟的 DeepSeek，没有 Key 也能把整个流程测一遍：

```bash
node server/test/mock-deepseek.mjs &
DEEPSEEK_API_KEY=test DEEPSEEK_BASE_URL=http://127.0.0.1:8799 npm run agent
```

## 用 DeepSeek Harness 对话式创作

仓库带了一个技能 `.agents/skills/moji/`。在仓库目录里启动 dsh，就能用对话完成选句、核对、出图、导出 PDF 的全过程：

```bash
DEEPSEEK_API_KEY=sk-... npx @deepseek-ai/dsh web
```

dsh 的标准预设自带 `web_search` 和命令行工具，会按技能里的流程调用 `npm run render`。Claude Code 也能读这个技能。

## 授权

- 代码：MIT。
- 字体各有授权，见 [fonts/README.md](fonts/README.md)：
  - 刘建毛草、智芒行、马善政：SIL OFL 1.1。
  - 崇羲篆體 © 中央研究院：CC BY-ND 3.0 TW，原样附带，没有修改。
- 简繁对照（`src/s2t.js`）来自 [OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）。
