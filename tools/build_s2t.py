"""生成 src/s2t.js：简体字 → 繁体字，只收篆字字体（崇羲篆體）里查不到简体、但查得到繁体的字。

数据来自 OpenCC 的 STCharacters.txt（Apache-2.0）。印章用篆字，篆书没有简体，
所以“陈”要先转成“陳”再去字体里找字形。

用法（在仓库根目录）：
    uvx --from fonttools python tools/build_s2t.py
"""
import json
import os
import urllib.request

from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/STCharacters.txt'

cmap = TTFont(os.path.join(ROOT, 'fonts', 'chongxi', 'ChongXiSmallSeal.otf')).getBestCmap()
mapping = {}
for line in urllib.request.urlopen(URL).read().decode('utf-8').splitlines():
    if not line.strip() or line.startswith('#'):
        continue
    simp, trads = line.split('\t')
    if ord(simp) in cmap:
        continue
    for t in trads.split():
        if len(t) == 1 and ord(t) in cmap:
            mapping[simp] = t
            break

header = ('// 由 tools/build_s2t.py 生成，勿手改。简→繁对照取自 OpenCC（Apache-2.0，https://github.com/BYVoid/OpenCC），\n'
          '// 只收崇羲篆體里缺简体、有繁体的字，供印章篆字使用。\n')
with open(os.path.join(ROOT, 'src', 's2t.js'), 'w', encoding='utf-8') as f:
    f.write(header + 'export default ' + json.dumps(mapping, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(mapping), '个字')
