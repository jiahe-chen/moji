"""把 AI 代理打成可以直接上传到阿里云函数计算的 zip：dist/moji-ai-server.zip

bootstrap 是启动脚本，必须保留可执行权限，所以这里手动写入 zip 的文件权限位。
包里另放一个 version.txt，是代码内容的哈希；线上 /api/health 会返回它，用来核对部署的是不是这一版。
用法（在仓库根目录）：python3 tools/pack_server.py
"""
import hashlib
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(ROOT, 'dist', 'moji-ai-server.zip')
FILES = [('bootstrap', 0o755), ('server.mjs', 0o644), ('agent.mjs', 0o644)]
data = {name: open(os.path.join(ROOT, 'server', name), 'rb').read() for name, _ in FILES}
version = hashlib.sha256(b''.join(data[name] for name, _ in FILES)).hexdigest()[:12]


def add(z, name, body, mode=0o644):
    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
    info.external_attr = (0o100000 | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, body)


os.makedirs(os.path.dirname(out), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, mode in FILES:
        add(z, name, data[name], mode)
    add(z, 'version.txt', version + '\n')
print(f'已生成 {out}（版本 {version}）')
