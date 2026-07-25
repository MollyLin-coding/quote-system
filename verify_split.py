# -*- coding: utf-8 -*-
"""拆檔重構驗證：證明「純搬家、一行邏輯都沒改」。

把 assets/app.css 與 js/*.js 按 index.html 的引用順序串接回去，
與拆檔前那個 commit 的 index.html 內 <style> / <script> 內容逐字元比對。
用法：python3 verify_split.py [拆檔前的 commit，預設 f99a0d1]
"""
import io, re, subprocess, sys, difflib

BEFORE = sys.argv[1] if len(sys.argv) > 1 else 'f99a0d1'
old = subprocess.check_output(['git', 'show', '%s:index.html' % BEFORE]).decode('utf-8')
oldl = old.split('\n')

def seg(a, b):
    return '\n'.join(oldl[a-1:b])

def read(path):
    """讀檔並只去掉「檔尾那一個換行」——空白行是原檔內容，不能一起吃掉，
    否則會把真正的差異藏起來。"""
    t = io.open(path, encoding='utf-8').read()
    return t[:-1] if t.endswith('\n') else t

ok = True
def cmp(name, expect, got):
    global ok
    if expect == got:
        print('  ✓ %s 完全一致（%d 字元）' % (name, len(expect)))
    else:
        ok = False
        print('  ✗ %s 不一致！' % name)
        d = list(difflib.unified_diff(expect.split('\n'), got.split('\n'), 'before', 'after', n=1))
        print('\n'.join(d[:40]))

# 1) CSS：原 <style>(12) … </style>(405) 之間 = 13~404 行
cmp('assets/app.css', seg(13, 404),
    read('assets/app.css'))

# 2) vendor QR：原第 9 行 <script> 之後的註解 + 第 10 行
cmp('js/00_qrcode.js', oldl[8][len('<script>'):] + '\n' + oldl[9],
    read('js/00_qrcode.js'))

# 3) 主 script：原 <script>(1356) … </script>(5821) 之間 = 1357~5820 行
#    vs 現在 index.html 內 js/0*.js + js/99_boot.js 依引用順序串接
now = io.open('index.html', encoding='utf-8').read()
srcs = [m for m in re.findall(r'<script src="(js/[^"?]+)', now) if m != 'js/00_qrcode.js']
print('  引用順序：' + ' → '.join(srcs))
joined = '\n'.join(read(p) for p in srcs)
cmp('主 script 串接', seg(1357, 5820), joined)

# 4) HTML 版面：原 406~1355 行應原封不動留在 index.html
body_old = seg(406, 1355)
if body_old in now:
    print('  ✓ HTML 版面（原 406~1355 行）原封不動留在 index.html')
else:
    ok = False
    print('  ✗ HTML 版面有變動！')

print('\n' + ('純搬家驗證通過：拆出來的檔案串回去 = 拆檔前的內容，一個字元都沒差。'
              if ok else '驗證失敗，有內容被改到。'))
sys.exit(0 if ok else 1)
