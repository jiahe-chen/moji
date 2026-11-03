# 字体与授权

| 目录 | 字体 | 用途 | 授权 |
|---|---|---|---|
| `liujianmaocao/` | 刘建毛草 Liu Jian Mao Cao | 正文草书 | SIL Open Font License 1.1，见目录内 `OFL.txt` |
| `zhimangxing/` | 智芒行 Zhi Mang Xing | 重复字换用的行书写法 | SIL Open Font License 1.1，见目录内 `OFL.txt` |
| `mashanzheng/` | 马善政 Ma Shan Zheng | 落款楷书 | SIL Open Font License 1.1，见目录内 `OFL.txt` |
| `chongxi/` | 崇羲篆體 Chong Xi Small Seal | 印章小篆 | CC BY-ND 3.0 TW，见下 |

## OFL 字体

三款 OFL 字体取自 [google/fonts](https://github.com/google/fonts)，协议里没有声明保留字体名。为了在国内也能快速加载，`tools/build_fonts.py` 把它们按 unicode-range 切成约 18KB 一片的 WOFF2，浏览器只下载页面上用到的那几片。字体名和版权信息保持原样。

## 崇羲篆體

- 著作权人：中央研究院（Academia Sinica）。
- 原始发布页：https://xiaoxue.iis.sinica.edu.tw/chongxi/
- 授权：[创用 CC 姓名标示-禁止改作 3.0 台湾及其后版本（CC BY-ND 3.0 TW）](https://creativecommons.org/licenses/by-nd/3.0/tw/)。允许重制、散布、传输，包括商业使用；使用时须标示原作者；不得修改。

因为禁止改作，本项目**原样附带**这个字体文件（`ChongXiSmallSeal.otf`，约 21MB），没有做切分、子集化或格式转换。网页在后台加载它，只用来渲染印章上的篆字。
