"""把三款 OFL 书法字体切成按 unicode-range 分片的 WOFF2，并生成 fonts/fonts.css。

国内打不开 Google Fonts，所以字体由本站自己托管。整套中文字体每款 4–6 MB，
切成小分片后，浏览器只下载页面上实际用到的那几片。

用法（在仓库根目录）：
    uvx --from fonttools --with brotli python tools/build_fonts.py

崇羲篆體是 CC BY-ND 授权，禁止修改，不能切分或转格式，原样放在 fonts/chongxi/。
"""
import io
import os
import urllib.request

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
CHUNK = 48  # 每片字数：书法字形复杂，一片约 20–40 KB

FAMILIES = [
    # (CSS 字体名, 目录名, google/fonts 里的路径)
    ('Liu Jian Mao Cao', 'liujianmaocao', 'ofl/liujianmaocao/LiuJianMaoCao-Regular.ttf'),
    ('Zhi Mang Xing', 'zhimangxing', 'ofl/zhimangxing/ZhiMangXing-Regular.ttf'),
    ('Ma Shan Zheng', 'mashanzheng', 'ofl/mashanzheng/MaShanZheng-Regular.ttf'),
]


def fetch(path):
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, os.path.basename(path))
    if not os.path.exists(local):
        url = 'https://github.com/google/fonts/raw/main/' + path
        print('下载', url)
        urllib.request.urlretrieve(url, local)
    return local


def ranges(cps):
    """把排好序的码位压成 unicode-range 写法。"""
    out, start, prev = [], cps[0], cps[0]
    for cp in cps[1:] + [None]:
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        out.append(f'U+{start:X}' if start == prev else f'U+{start:X}-{prev:X}')
        if cp is not None:
            start = prev = cp
    return ','.join(out)


def main():
    css = ['/* 由 tools/build_fonts.py 生成，勿手改。字体协议见 fonts/README.md */']
    for family, slug, path in FAMILIES:
        src = fetch(path)
        data = open(src, 'rb').read()
        cps = sorted(cp for cp in TTFont(io.BytesIO(data)).getBestCmap() if cp > 0x7F)
        outdir = os.path.join(ROOT, 'fonts', slug)
        os.makedirs(outdir, exist_ok=True)
        for old in os.listdir(outdir):
            if old.endswith('.woff2'):
                os.remove(os.path.join(outdir, old))
        # OFL 要求再分发时附上协议原文
        urllib.request.urlretrieve('https://github.com/google/fonts/raw/main/' + os.path.dirname(path) + '/OFL.txt',
                                   os.path.join(outdir, 'OFL.txt'))
        for n, i in enumerate(range(0, len(cps), CHUNK)):
            part = cps[i:i + CHUNK]
            font = TTFont(io.BytesIO(data))
            opts = Options()
            opts.flavor = 'woff2'
            opts.layout_features = ['*']
            sub = Subsetter(opts)
            sub.populate(unicodes=part)
            sub.subset(font)
            name = f'{n:03d}.woff2'
            font.flavor = 'woff2'
            font.save(os.path.join(outdir, name))
            css.append(f'@font-face{{font-family:"{family}";src:url({slug}/{name}) format("woff2");'
                       f'font-display:block;unicode-range:{ranges(part)}}}')
        print(family, len(cps), '字，', (len(cps) + CHUNK - 1) // CHUNK, '片')
    css.append('@font-face{font-family:"ChongXi Seal";src:url(chongxi/ChongXiSmallSeal.otf) format("opentype");font-display:block}')
    open(os.path.join(ROOT, 'fonts', 'fonts.css'), 'w', encoding='utf-8').write('\n'.join(css) + '\n')


if __name__ == '__main__':
    main()
