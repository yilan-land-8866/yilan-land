"""
土地產權資料查詢系統 — Flask 伺服器
提供：
1. 四級順序連動選單 (1. 事務所 ➜ 2. 轄區鄉鎮市 ➜ 3. 地段 ➜ 4. 地號)
2. 全縣舊地段地號 ➔ 重測後新地段新地號精確源頭對照
3. 跨所所有權人名下不動產彙總與歸戶清冊
4. 全域關鍵字搜尋
"""

import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

import sqlite3
import os
import re
import ssl
import urllib.request
import urllib.parse
from bs4 import BeautifulSoup
import webbrowser
import threading
import json
import time
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, send_file, session

# 基礎路徑：優先使用環境變數 (桌面版打包)，否則用腳本目錄
_BASE_DIR = os.environ.get('LAND_APP_BASE_DIR', os.path.dirname(os.path.abspath(__file__)))

app = Flask(__name__, template_folder=os.path.join(_BASE_DIR, 'templates'))
app.secret_key = os.environ.get('SECRET_KEY', 'yilan_land_secret_key_2026_auth_sec_9981')

# 雲端 HTTPS 與行動裝置相容性 Session Cookie 安全配置
_is_cloud_https = bool(os.environ.get('RENDER') or os.environ.get('RAILWAY_ENVIRONMENT') or os.environ.get('FLY_APP_NAME') or os.environ.get('PORT'))
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=_is_cloud_https,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30)
)

DB_PATH = os.path.join(_BASE_DIR, 'land_data.db')
CONFIG_PATH = os.path.join(_BASE_DIR, 'config.json')
PAGE_SIZE = 50

# 全形轉半形對照表與字串正規化
FULL_TO_HALF = str.maketrans(
    '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ　',
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '
)

def normalize_query_text(s):
    if not s:
        return ''
    return str(s).translate(FULL_TO_HALF).strip()

def parse_address_tokens(q):
    normalized = normalize_query_text(q)
    if ' ' in normalized:
        return [t.strip() for t in normalized.split() if t.strip()]
    if any(k in normalized for k in ('路', '街', '巷', '弄', '號', '村', '里', '鄰', '鄉', '鎮', '市', '區')):
        pattern = r'([^縣市鄉鎮區村里路街段巷弄鄰號樓]+[縣市鄉鎮區村里路街段巷弄鄰號樓]?)'
        tokens = re.findall(pattern, normalized)
        tokens = [t.strip() for t in tokens if len(t.strip()) >= 2 or (t.strip() and t.strip()[-1] in '號樓')]
        if tokens:
            return tokens
    return [normalized]


# Auto-unzip / version sync land_data.zip for Cloud Deployment
CURRENT_DB_VERSION = '2026_08_18_halfwidth_v2'
_zip_p = os.path.join(_BASE_DIR, 'land_data.zip')
_lock_p = os.path.join(_BASE_DIR, 'unzip.lock')
_ver_p = os.path.join(_BASE_DIR, 'db_version.txt')

_should_extract = False
if not os.path.exists(DB_PATH):
    _should_extract = True
else:
    if os.path.exists(_ver_p):
        try:
            with open(_ver_p, 'r', encoding='utf-8') as _vf:
                if _vf.read().strip() != CURRENT_DB_VERSION:
                    _should_extract = True
        except Exception:
            _should_extract = True
    else:
        _should_extract = True

if _should_extract and os.path.exists(_zip_p):
    import zipfile
    import time
    if not os.path.exists(_lock_p):
        try:
            with open(_lock_p, 'w') as _lf:
                _lf.write(str(os.getpid()))
            print(f'[*] 正在更新解壓縮最新版本資料庫 ({CURRENT_DB_VERSION})...')
            with zipfile.ZipFile(_zip_p, 'r') as _zf:
                _zf.extractall(_BASE_DIR)
            with open(_ver_p, 'w', encoding='utf-8') as _vf:
                _vf.write(CURRENT_DB_VERSION)
            print('[*] 最新版本 land_data.db 解壓縮與升級完成！')
        finally:
            if os.path.exists(_lock_p):
                try:
                    os.remove(_lock_p)
                except Exception:
                    pass
    else:
        for _ in range(30):
            if os.path.exists(DB_PATH) and not os.path.exists(_lock_p):
                break
            time.sleep(1)




def get_auth_password():
    """取得系統保護密碼 (優先讀取 config.json，次選環境變數，預設為 9081)"""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return str(data.get('app_password', '9081')).strip()
        except Exception:
            pass
    return os.environ.get('APP_PASSWORD', '9081').strip()


def set_auth_password(new_pwd):
    """更新系統保護密碼至 config.json"""
    data = {}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = {}
    data['app_password'] = str(new_pwd).strip()
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.before_request
def check_authentication():
    """全域安全防護：未通過密碼驗證者禁止存取任何土地產權敏感資料"""
    allowed_paths = [
        '/', '/api/login', '/api/auth_status', '/api/ping',
        '/static/html2canvas.min.js', '/manifest.json',
        '/apple-touch-icon.png', '/static/apple-touch-icon.png',
        '/favicon.ico'
    ]
    if request.path.startswith('/static/'):
        return None
    if request.path in allowed_paths:
        return None
    
    # 攔截所有未授權 API 存取
    if request.path.startswith('/api/'):
        if not session.get('authenticated'):
            return jsonify({'error': 'Unauthorized', 'message': '🔒 系統受密碼保護，請先解鎖登入'}), 401
    return None


@app.after_request
def add_security_headers(response):
    """資安強化：注入 HTTP 資安防護標頭，防止點擊劫持、XSS 攻擊與 MIME 數據偽造"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response

# ========== 效能優化：連線池與快取 ==========
_conn_pool_lock = threading.Lock()
_conn_pool = []  # 連線池
_MAX_POOL_SIZE = 2

# 預計算快取
_section_count_cache = {}   # {(section_no, source): count}
_global_stats_cache = {}    # {'total': N, 'yilan': N, 'luodong': N}


@app.route('/static/html2canvas.min.js')
def serve_html2canvas():
    templates_dir = app.template_folder
    js_path = os.path.join(templates_dir, 'html2canvas.min.js')
    if os.path.exists(js_path):
        return send_file(js_path, mimetype='application/javascript')
    return '', 404


@app.route('/manifest.json')
def serve_manifest():
    manifest_path = os.path.join(_BASE_DIR, 'static', 'manifest.json')
    if os.path.exists(manifest_path):
        return send_file(manifest_path, mimetype='application/json')
    return '', 404


@app.route('/apple-touch-icon.png')
@app.route('/static/apple-touch-icon.png')
def serve_apple_icon():
    icon_path = os.path.join(_BASE_DIR, 'static', 'apple-touch-icon.png')
    if os.path.exists(icon_path):
        return send_file(icon_path, mimetype='image/png')
    return '', 404

# 宜蘭縣各地政事務所官方法定轄區鄉鎮
YILAN_OFFICE_TOWNS = ['宜蘭市', '礁溪鄉', '員山鄉', '壯圍鄉', '頭城鎮']
LUODONG_OFFICE_TOWNS = ['羅東鎮', '五結鄉', '冬山鄉', '三星鄉', '蘇澳鎮', '大同鄉', '南澳鄉']


def _create_connection():
    """建立一個經過效能調校且記憶體輕量的 SQLite 連線"""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    conn.execute('PRAGMA cache_size=-8000')   # 8 MB page cache (低記憶體佔用)
    conn.execute('PRAGMA temp_store=MEMORY')
    conn.execute('PRAGMA mmap_size=33554432')  # 32 MB memory-mapped I/O
    conn.execute('PRAGMA query_only=ON')      # 唯讀加速
    return conn



def get_db():
    """從連線池取得連線，大幅減少連線建立開銷"""
    with _conn_pool_lock:
        if _conn_pool:
            return _conn_pool.pop()
    return _create_connection()


def release_db(conn):
    """將連線歸還至連線池"""
    with _conn_pool_lock:
        if len(_conn_pool) < _MAX_POOL_SIZE:
            _conn_pool.append(conn)
        else:
            conn.close()


def get_writable_db():
    """取得可寫入的連線 (用於快取寫入等場景)"""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA synchronous=NORMAL')
    return conn


def _preload_caches():
    """啟動時預載統計快取，避免重複查詢"""
    global _section_count_cache, _global_stats_cache
    if not os.path.exists(DB_PATH):
        return
    conn = get_db()
    try:
        # 載入段號計數快取
        try:
            rows = conn.execute('SELECT section_no, source, cnt FROM section_count_cache').fetchall()
            for r in rows:
                _section_count_cache[(r['section_no'], r['source'])] = r['cnt']
        except Exception:
            # 若快取表不存在，即時計算
            rows = conn.execute('SELECT section_no, source, COUNT(*) as cnt FROM land_ownership GROUP BY section_no, source').fetchall()
            for r in rows:
                _section_count_cache[(r['section_no'], r['source'])] = r['cnt']

        # 載入全域統計快取
        try:
            rows = conn.execute('SELECT key, value FROM global_stats_cache').fetchall()
            for r in rows:
                _global_stats_cache[r['key']] = r['value']
        except Exception:
            rows_cnt = conn.execute('SELECT COUNT(*) FROM land_ownership').fetchone()
            _global_stats_cache['total'] = rows_cnt[0] if rows_cnt else 0
            yilan_cnt = conn.execute("SELECT COUNT(*) FROM land_ownership WHERE source='宜蘭所'").fetchone()
            _global_stats_cache['yilan'] = yilan_cnt[0] if yilan_cnt else 0
            luodong_cnt = conn.execute("SELECT COUNT(*) FROM land_ownership WHERE source='羅東所'").fetchone()
            _global_stats_cache['luodong'] = luodong_cnt[0] if luodong_cnt else 0
    except Exception as e:
        print('[!] _preload_caches error:', e)
    finally:
        release_db(conn)


# Auto-preload caches on module import (for Gunicorn / WSGI production servers)
try:
    _preload_caches()
except Exception as _e:
    pass


def _get_cached_section_count(section_nos, source='all'):
    """從記憶體快取取得段號的資料筆數"""
    if not _section_count_cache:
        try:
            _preload_caches()
        except Exception:
            pass

    total = 0
    for sec_no in section_nos:
        if source == 'all':
            for key, cnt in _section_count_cache.items():
                if key[0] == sec_no:
                    total += cnt
        else:
            total += _section_count_cache.get((sec_no, source), 0)
    return total


def get_effective_section_nos(conn, section_no):
    """嚴格以原始正確地段資料為準，不進行混淆合併"""
    if not section_no:
        return []
    return [section_no]


def format_land_no(land_no_str):
    """將 8 位數地號 (如 00010000 -> 1地號, 02250001 -> 225-1地號) 簡化顯示"""
    if not land_no_str:
        return '—'
    s = str(land_no_str).zfill(8)
    try:
        mother = int(s[:4])
        child = int(s[4:])
        if child > 0:
            return f"{mother}-{child}地號"
        else:
            return f"{mother}地號"
    except ValueError:
        return land_no_str


TOWN_TO_SITEAREA = {
    '羅東鎮': 'GA-06', '五結鄉': 'GA-07', '冬山鄉': 'GA-08', '蘇澳鎮': 'GA-09',
    '三星鄉': 'GA-10', '大同鄉': 'GA-11', '南澳鄉': 'GA-12', '宜蘭市': 'GB-01',
    '頭城鎮': 'GB-02', '礁溪鄉': 'GB-03', '壯圍鄉': 'GB-04', '員山鄉': 'GB-05'
}


def lookup_live_parcel_mapping(conn, town_name, section_no, land_no_str):
    """
    查詢 / 快取 宜蘭地政得來速 oldnew.jsp 重測單筆地號 1對1 對照
    """
    if not section_no or not land_no_str:
        return None
        
    s_land = str(land_no_str).zfill(8)
    m = s_land[:4]
    c = s_land[4:]

    q_key = f"{section_no}_{s_land}"
    cached = conn.execute("SELECT * FROM parcel_mapping_cache WHERE query_key = ?", (q_key,)).fetchone()
    if cached:
        return dict(cached)

    site_area = TOWN_TO_SITEAREA.get(town_name, '')
    sec_row = conn.execute("SELECT section_name, town_name FROM section_mapping WHERE section_no = ?", (section_no,)).fetchone()
    sec_name_str = sec_row['section_name'] if sec_row and sec_row['section_name'] else ''
    if not site_area and sec_row and sec_row['town_name']:
        site_area = TOWN_TO_SITEAREA.get(sec_row['town_name'], '')

    if not site_area:
        return None

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    url = "https://drivethru.e-land.gov.tw/query/oldnew.jsp?menu=true&type=R"

    for type_on in ['N', 'O']:
        post_data = urllib.parse.urlencode({
            'action': 'Query1',
            'r': 'G',
            'SiteArea': site_area,
            'R48': section_no,
            'TypeCF': 'C',
            'NUM1': m,
            'NUM2': c,
            'TypeON': type_on,
            'button1': '查詢'
        }).encode('utf-8')

        req = urllib.request.Request(url, data=post_data, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': url
        })

        try:
            html = urllib.request.urlopen(req, context=ctx, timeout=4).read().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(html, 'html.parser')
            for t in soup.find_all('table'):
                for tr in t.find_all('tr'):
                    tds = [td.text.strip() for td in tr.find_all('td')]
                    if len(tds) == 8 and tds[0] and tds[4]:
                        old_town, old_sec_code, old_sec_name, old_land, new_town, new_sec_code, new_sec_name, new_land = tds
                        
                        mapping_res = {
                            'query_key': q_key,
                            'old_sec_code': old_sec_code,
                            'old_sec_name': old_sec_name,
                            'old_land': old_land,
                            'new_sec_code': new_sec_code,
                            'new_sec_name': new_sec_name,
                            'new_land': new_land
                        }
                        
                        # 使用可寫入連線快取結果
                        try:
                            wconn = get_writable_db()
                            wconn.execute('''
                                INSERT OR REPLACE INTO parcel_mapping_cache 
                                (query_key, old_sec_code, old_sec_name, old_land, new_sec_code, new_sec_name, new_land)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            ''', (q_key, old_sec_code, old_sec_name, old_land, new_sec_code, new_sec_name, new_land))
                            wconn.commit()
                            wconn.close()
                        except Exception:
                            pass

                        return mapping_res
        except Exception:
            pass

    return None


def get_exact_new_parcel(section_no, section_name, land_no, formatted_land, new_sec_names):
    """
    源頭對照邏輯：根據舊地段號與地號，推算對應的重測後【新地段名與新地號】
    """
    EXACT_1TO1_SECTIONS = {
        '0021': '新群一段',  # 羅群段 -> 新群一段
        '0020': '新群一段',  # 新群段 -> 新群一段
        '0383': '大州一段',  # 大州段 -> 大州一段
        '0162': '三星段',    # 三星段破布烏小段 -> 三星段
        '0151': '阿里史段',  # 中溪洲段 -> 阿里史段
        '0308': '延平段',    # 壯四段 -> 延平段
        '0301': '金六結一段',
        '0302': '七結段',
        '0303': '復興段',
        '0305': '慈安段',
        '0306': '思源段',
        '0307': '和睦段',
        '0609': '新公園段',  # 公園段 -> 新公園段
        '0323': '梅洲段',    # 一結段二結小段 -> 梅洲段
    }

    if section_no in EXACT_1TO1_SECTIONS:
        new_sec = EXACT_1TO1_SECTIONS[section_no]
        return f"{new_sec} {formatted_land}"

    if new_sec_names:
        clean_new = new_sec_names.split('/')[0].replace('(舊)', '').replace('(新)', '').strip()
        if clean_new:
            return f"{clean_new} {formatted_land}"

    return None


@app.after_request
def add_security_and_no_cache_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


@app.route('/')
def index():
    """主頁面"""
    return render_template('index.html')


@app.route('/api/towns')
def get_towns():
    """根據事務所來源 (all / 宜蘭所 / 羅東所) 取得嚴格法定轄區鄉鎮市清單 (Step 2)"""
    source = request.args.get('source', 'all').strip()
    
    if source == '宜蘭所':
        towns = YILAN_OFFICE_TOWNS
    elif source == '羅東所':
        towns = LUODONG_OFFICE_TOWNS
    else:
        towns = YILAN_OFFICE_TOWNS + LUODONG_OFFICE_TOWNS

    return jsonify({'towns': towns})


@app.route('/api/sections')
def get_sections():
    """根據事務所來源與鄉鎮市名稱取得完整地段清單 (Step 3，包含已對照之新舊地段) — 效能優化版"""
    source = request.args.get('source', 'all').strip()
    town_name = request.args.get('town_name', '').strip()

    conn = get_db()
    try:
        conditions = []
        params = []

        if town_name:
            conditions.append("s.town_name = ?")
            params.append(town_name)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        sql = f'''
            SELECT s.section_no, 
                   s.section_name, 
                   s.town_name, 
                   s.office_name,
                   s.old_mapping_info,
                   s.is_old_section,
                   s.new_section_names,
                   s.old_section_nos
            FROM section_mapping s
            {where_clause}
            ORDER BY s.town_name, s.section_name, s.section_no
        '''
        rows = conn.execute(sql, params).fetchall()

        sections = []
        for r in rows:
            sec_name = r['section_name'] or ''
            t_name = r['town_name'] or ''
            sec_no = r['section_no']
            office = r['office_name'] or ''

            # 檢查事務所來源限制
            if source == '宜蘭所' and t_name not in YILAN_OFFICE_TOWNS:
                continue
            elif source == '羅東所' and t_name not in LUODONG_OFFICE_TOWNS:
                continue

            sec_nos = get_effective_section_nos(conn, sec_no)
            cnt = _get_cached_section_count(sec_nos, source)

            # ⚡ 若資料庫中產權登記筆數為 0，直接隱藏過濾，確保選單中所有地段皆有地號
            if cnt == 0:
                continue

            display_label = f"{sec_no}"
            if sec_name:
                display_label += f" ({t_name} {sec_name})"

            sections.append({
                'section_no': sec_no,
                'section_name': sec_name,
                'town_name': t_name,
                'office_name': office,
                'old_mapping_info': r['old_mapping_info'] or '',
                'is_old_section': r['is_old_section'] or 0,
                'new_section_names': r['new_section_names'] or '',
                'source': source if source != 'all' else ('宜蘭所' if t_name in YILAN_OFFICE_TOWNS else '羅東所'),
                'count': cnt,
                'display_label': display_label
            })
    finally:
        release_db(conn)
    return jsonify({'sections': sections})


@app.route('/api/lands')
def get_lands():
    """根據指定地段號與來源取得所有地號 (Step 4)"""
    section_no = request.args.get('section_no', '').strip()
    source = request.args.get('source', 'all').strip()

    if not section_no:
        return jsonify({'lands': []})

    conn = get_db()
    sec_nos = get_effective_section_nos(conn, section_no)
    ph = ','.join(['?'] * len(sec_nos))
    conditions = [f'section_no IN ({ph})']
    params = list(sec_nos)

    if source != 'all':
        conditions.append('source = ?')
        params.append(source)

    where = ' AND '.join(conditions)
    sql = f'''
        SELECT DISTINCT land_no 
        FROM land_ownership 
        WHERE {where}
        ORDER BY land_no
    '''
    rows = conn.execute(sql, params).fetchall()
    release_db(conn)

    lands = []
    for r in rows:
        l_no = r['land_no']
        lands.append({
            'land_no': l_no,
            'formatted_land_no': format_land_no(l_no)
        })

    return jsonify({'lands': lands})


@app.route('/api/owner_summary')
def owner_summary():
    """取得指定所有權人的全縣跨所名下所有不動產歸戶清單"""
    name = normalize_query_text(request.args.get('name', ''))
    unified_no = normalize_query_text(request.args.get('unified_no', ''))

    if not name:
        return jsonify({'total': 0, 'properties': []})


    conn = get_db()
    
    if unified_no and unified_no != '—':
        sql = '''
            SELECT l.source, l.section_no, s.section_name, s.town_name, s.old_mapping_info,
                   s.is_old_section, s.new_section_names,
                   l.land_no, l.reg_order, l.reg_date, l.reg_reason,
                   l.right_type, l.right_denominator, l.right_numerator,
                   l.declared_price, l.owner_name, l.owner_unified_no, l.address, l.unified_no
            FROM land_ownership l
            LEFT JOIN section_mapping s ON l.section_no = s.section_no
            WHERE l.owner_name = ? AND (l.owner_unified_no = ? OR l.unified_no = ?)
            ORDER BY l.source, l.section_no, l.land_no
        '''
        rows = conn.execute(sql, (name, unified_no, unified_no)).fetchall()
    else:
        sql = '''
            SELECT l.source, l.section_no, s.section_name, s.town_name, s.old_mapping_info,
                   s.is_old_section, s.new_section_names,
                   l.land_no, l.reg_order, l.reg_date, l.reg_reason,
                   l.right_type, l.right_denominator, l.right_numerator,
                   l.declared_price, l.owner_name, l.owner_unified_no, l.address, l.unified_no
            FROM land_ownership l
            LEFT JOIN section_mapping s ON l.section_no = s.section_no
            WHERE l.owner_name = ?
            ORDER BY l.source, l.section_no, l.land_no
        '''
        rows = conn.execute(sql, (name,)).fetchall()

    release_db(conn)

    properties = []
    yilan_count = 0
    luodong_count = 0
    matched_unified_no = unified_no

    for r in rows:
        if r['source'] == '宜蘭所':
            yilan_count += 1
        elif r['source'] == '羅東所':
            luodong_count += 1

        if not matched_unified_no:
            matched_unified_no = r['owner_unified_no'] or r['unified_no'] or ''

        formatted_land = format_land_no(r['land_no'])
        exact_new_parcel = get_exact_new_parcel(
            r['section_no'], r['section_name'], r['land_no'], formatted_land, r['new_section_names']
        )

        properties.append({
            'source': r['source'],
            'section_no': r['section_no'],
            'section_name': r['section_name'] or '',
            'town_name': r['town_name'] or '',
            'old_mapping_info': r['old_mapping_info'] or '',
            'is_old_section': r['is_old_section'] or 0,
            'new_section_names': r['new_section_names'] or '',
            'exact_new_parcel': exact_new_parcel,
            'land_no': r['land_no'],
            'formatted_land_no': formatted_land,
            'reg_order': r['reg_order'],
            'reg_date': r['reg_date'],
            'reg_reason': r['reg_reason'],
            'right_type': r['right_type'],
            'right_denominator': r['right_denominator'],
            'right_numerator': r['right_numerator'],
            'declared_price': r['declared_price'],
            'owner_name': r['owner_name'],
            'owner_unified_no': r['owner_unified_no'] or r['unified_no'] or '',
            'address': r['address'],
            'unified_no': r['unified_no']
        })

    return jsonify({
        'owner_name': name,
        'owner_unified_no': matched_unified_no,
        'total': len(properties),
        'yilan_count': yilan_count,
        'luodong_count': luodong_count,
        'properties': properties
    })


@app.route('/api/search')
def search():
    """
    全域搜尋 API
    支援：
    1. 四級連動選擇 (事務所 -> 鄉鎮 -> 地段 -> 地號)
    2. 源頭對照舊地段地號 ➔ 新地段名與新地號
    """
    q = normalize_query_text(request.args.get('q', ''))
    selected_town = request.args.get('town_name', '').strip()
    selected_section = request.args.get('section_no', '').strip()
    selected_land = request.args.get('land_no', '').strip()
    source = request.args.get('source', 'all')
    field = request.args.get('field', 'all')
    page = int(request.args.get('page', 1))

    if not q and not selected_section and not selected_land and not selected_town:
        return jsonify({'results': [], 'total': 0, 'page': 1, 'pages': 0})

    conn = get_db()
    conditions = []
    params = []

    # 來源篩選 (Step 1) — 若使用者在搜尋欄輸入全域關鍵字且未鎖定地段，自動跨全縣搜尋以避免遺漏
    if source != 'all':
        if not q or selected_town or selected_section:
            conditions.append('l.source = ?')
            params.append(source)


    # 鄉鎮市篩選 (Step 2) — ⚡ 效能優化：運用段號 IN 索引，免除 88 萬筆大表 JOIN 掃描
    if selected_town:
        if not selected_section:
            town_sec_rows = conn.execute("SELECT section_no FROM section_mapping WHERE town_name = ?", (selected_town,)).fetchall()
            town_sec_nos = [r['section_no'] for r in town_sec_rows]
            if town_sec_nos:
                ph = ','.join(['?'] * len(town_sec_nos))
                conditions.append(f'l.section_no IN ({ph})')
                params.extend(town_sec_nos)
            else:
                conditions.append('s.town_name = ?')
                params.append(selected_town)
        else:
            conditions.append('s.town_name = ?')
            params.append(selected_town)

    # 精確段號篩選 (Step 3)
    if selected_section:
        sec_nos = get_effective_section_nos(conn, selected_section)
        ph = ','.join(['?'] * len(sec_nos))
        conditions.append(f'l.section_no IN ({ph})')
        params.extend(sec_nos)

    # 精確地號篩選 (Step 4)
    if selected_land:
        conditions.append('l.land_no = ?')
        params.append(selected_land)

    # 關鍵字過濾
    if q:
        tokens = q.split()
        addr_tokens = parse_address_tokens(q)
        is_address_query = field in ('all', 'address') and (len(addr_tokens) >= 2 or any(k in q for k in ('路', '街', '巷', '弄', '號', '村', '里', '鄰')))
        
        # 情境 1: 地址多詞辨識 (如: '冬山鄉 興安路 27巷 37號' 或 '宜蘭縣廣興村15鄰冬山鄉興安路27巷37號')
        if is_address_query and len(addr_tokens) >= 2 and field in ('all', 'address'):
            addr_conds = []
            for tok in addr_tokens:
                if tok in ('宜蘭縣', '宜蘭'):
                    continue
                addr_conds.append('l.address LIKE ?')
                params.append(f'%{tok}%')
            if addr_conds:
                conditions.append('(' + ' AND '.join(addr_conds) + ')')
            else:
                conditions.append('l.address LIKE ?')
                params.append(f'%{q}%')

        # 情境 2: 輸入地段 + 地號 (如: '0021 1' 或 '羅群 1地號')
        elif len(tokens) >= 2 and field in ('all', 'section', 'land'):
            sec_part = tokens[0]
            land_part = ' '.join(tokens[1:])
            
            sec_term = f'%{sec_part}%'
            conditions.append('(l.section_no LIKE ? OR s.section_name LIKE ? OR s.town_name LIKE ? OR s.old_mapping_info LIKE ? OR s.new_section_names LIKE ?)')
            params.extend([sec_term, sec_term, sec_term, sec_term, sec_term])
            
            match = re.search(r'(\d{1,4})(?:[─\-\_之\s]+(\d{1,4}))?', land_part)
            if match:
                m = int(match.group(1))
                c = int(match.group(2)) if match.group(2) else 0
                full_8 = f"{m:04d}{c:04d}"
                m_prefix = f"{m:04d}%"
                conditions.append('(l.land_no = ? OR l.land_no LIKE ? OR l.land_no LIKE ?)')
                params.extend([full_8, m_prefix, f'%{land_part}%'])
            else:
                conditions.append('l.land_no LIKE ?')
                params.append(f'%{land_part}%')
                
        # 情境 3: 單一關鍵字搜尋
        else:
            search_term = f'%{q}%'
            
            match = re.search(r'^(\d{1,4})(?:[─\-\_之\s]+(\d{1,4}))?地?號?$', q)
            if match and field in ('all', 'land'):
                m = int(match.group(1))
                c = int(match.group(2)) if match.group(2) else 0
                full_8 = f"{m:04d}{c:04d}"
                m_prefix = f"{m:04d}%"
                
                conditions.append('(l.land_no = ? OR l.land_no LIKE ? OR l.section_no LIKE ? OR s.section_name LIKE ? OR s.town_name LIKE ? OR s.new_section_names LIKE ? OR l.owner_name LIKE ? OR l.owner_unified_no LIKE ? OR l.unified_no LIKE ? OR l.address LIKE ?)')
                params.extend([full_8, m_prefix, search_term, search_term, search_term, search_term, search_term, search_term, search_term, search_term])
            elif field == 'section':
                conditions.append('(l.section_no LIKE ? OR s.section_name LIKE ? OR s.town_name LIKE ? OR s.old_mapping_info LIKE ? OR s.new_section_names LIKE ?)')
                params.extend([search_term] * 5)
            elif field == 'land':
                conditions.append('l.land_no LIKE ?')
                params.append(search_term)
            elif field == 'owner':
                conditions.append('l.owner_name LIKE ?')
                params.append(search_term)
            elif field == 'unified_no':
                conditions.append('(l.owner_unified_no LIKE ? OR l.unified_no LIKE ?)')
                params.extend([search_term, search_term])
            elif field == 'address':
                conditions.append('l.address LIKE ?')
                params.append(search_term)
            else:
                conditions.append('(l.section_no LIKE ? OR s.section_name LIKE ? OR s.town_name LIKE ? OR s.old_mapping_info LIKE ? OR s.new_section_names LIKE ? OR l.land_no LIKE ? OR l.owner_name LIKE ? OR l.owner_unified_no LIKE ? OR l.unified_no LIKE ? OR l.address LIKE ?)')
                params.extend([search_term] * 10)


    where = ' AND '.join(conditions)

    # 計算總筆數
    count_sql = f'''
        SELECT COUNT(*) 
        FROM land_ownership l
        LEFT JOIN section_mapping s ON l.section_no = s.section_no
        WHERE {where}
    '''
    total = conn.execute(count_sql, params).fetchone()[0]

    # 分頁
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(1, min(page, total_pages))
    offset = (page - 1) * PAGE_SIZE

    sort_by = request.args.get('sort_by', 'default').strip()

    order_clause = 'ORDER BY l.section_no, l.land_no, l.reg_order'
    if sort_by == 'land_asc':
        order_clause = 'ORDER BY l.land_no ASC, l.section_no, l.reg_order'
    elif sort_by == 'land_desc':
        order_clause = 'ORDER BY l.land_no DESC, l.section_no, l.reg_order'
    elif sort_by == 'price_desc':
        order_clause = 'ORDER BY l.declared_price DESC, l.section_no, l.land_no'
    elif sort_by == 'price_asc':
        order_clause = 'ORDER BY l.declared_price ASC, l.section_no, l.land_no'
    elif sort_by == 'date_desc':
        order_clause = 'ORDER BY l.reg_date DESC, l.section_no, l.land_no'
    elif sort_by == 'owner':
        order_clause = 'ORDER BY l.owner_name ASC, l.section_no, l.land_no'
    elif sort_by == 'section':
        order_clause = 'ORDER BY s.town_name ASC, s.section_name ASC, l.land_no ASC'

    # 取得當頁紀錄
    query_sql = f'''
        SELECT l.source, l.section_no, s.section_name, s.town_name, s.old_mapping_info,
               s.is_old_section, s.new_section_names,
               l.land_no, l.reg_order, l.reg_date,
               l.reg_reason, l.reg_reason_date, l.owner_unified_no,
               l.right_type, l.right_denominator, l.right_numerator,
               l.cert_info, l.declared_price, l.unified_no, l.owner_name, l.address
        FROM land_ownership l
        LEFT JOIN section_mapping s ON l.section_no = s.section_no
        WHERE {where}
        {order_clause}
        LIMIT ? OFFSET ?
    '''
    query_params = list(params)
    query_params.extend([PAGE_SIZE, offset])

    rows = conn.execute(query_sql, query_params).fetchall()

    # 人名跨所統計
    owner_stats = None
    if q and field in ('all', 'owner'):
        exact_owner_count = conn.execute(
            "SELECT COUNT(*), SUM(CASE WHEN source='宜蘭所' THEN 1 ELSE 0 END), SUM(CASE WHEN source='羅東所' THEN 1 ELSE 0 END) FROM land_ownership WHERE owner_name = ?", (q,)
        ).fetchone()
        if exact_owner_count and exact_owner_count[0] > 0:
            owner_stats = {
                'name': q,
                'total': exact_owner_count[0],
                'yilan': exact_owner_count[1],
                'luodong': exact_owner_count[2]
            }

    results = []
    for row in rows:
        formatted_land = format_land_no(row['land_no'])
        owner_name = row['owner_name'] or ''
        sec_no = row['section_no']

        results.append({
            'source': row['source'],
            'section_no': sec_no,
            'section_name': row['section_name'] or '',
            'town_name': row['town_name'] or '',
            'old_mapping_info': row['old_mapping_info'] or '',
            'is_old_section': row['is_old_section'] or 0,
            'new_section_names': row['new_section_names'] or '',
            'land_no': row['land_no'],
            'formatted_land_no': formatted_land,
            'reg_order': row['reg_order'],
            'reg_date': row['reg_date'],
            'reg_reason': row['reg_reason'],
            'reg_reason_date': row['reg_reason_date'],
            'owner_unified_no': row['owner_unified_no'],
            'right_type': row['right_type'],
            'right_denominator': row['right_denominator'],
            'right_numerator': row['right_numerator'],
            'cert_info': row['cert_info'],
            'declared_price': row['declared_price'],
            'unified_no': row['unified_no'],
            'owner_name': owner_name,
            'address': row['address'],
        })

    release_db(conn)

    return jsonify({
        'results': results,
        'total': total,
        'page': page,
        'pages': total_pages,
        'owner_stats': owner_stats
    })


@app.route('/api/stats')
def stats():
    """統計資料 — ⚡ 效能優化：從記憶體快取直接回傳，若未載入則自動預載"""
    if not _global_stats_cache or _global_stats_cache.get('total', 0) == 0:
        _preload_caches()
    return jsonify({
        'total': _global_stats_cache.get('total', 0),
        'yilan': _global_stats_cache.get('yilan', 0),
        'luodong': _global_stats_cache.get('luodong', 0),
    })


@app.route('/api/ping')
def api_ping():
    """輕量防休眠探針 (Keep-Alive Ping)"""
    return jsonify({'status': 'alive', 'time': time.time()})


@app.route('/api/auth_status')
def api_auth_status():
    """查詢當前連線驗證狀態"""
    return jsonify({
        'authenticated': session.get('authenticated') is True
    })


@app.route('/api/login', methods=['POST'])
def api_login():
    """系統密碼驗證登入"""
    data = request.get_json(silent=True) or {}
    password = str(data.get('password', '')).strip()
    remember = bool(data.get('remember', True))
    
    correct_password = get_auth_password()
    if password == correct_password:
        session['authenticated'] = True
        session.permanent = remember
        return jsonify({'success': True, 'message': '驗證通過，歡迎使用'})
    else:
        return jsonify({'success': False, 'message': '密碼錯誤，請重新輸入'}), 401


@app.route('/api/logout', methods=['POST'])
def api_logout():
    """安全登出並清除 Session"""
    session.pop('authenticated', None)
    return jsonify({'success': True, 'message': '已安全鎖定系統'})


@app.route('/api/change_password', methods=['POST'])
def api_change_password():
    """修改系統存取密碼"""
    if not session.get('authenticated'):
        return jsonify({'success': False, 'message': '請先解鎖登入系統'}), 401
    
    data = request.get_json(silent=True) or {}
    old_pwd = str(data.get('old_password', '')).strip()
    new_pwd = str(data.get('new_password', '')).strip()
    
    if old_pwd != get_auth_password():
        return jsonify({'success': False, 'message': '目前舊密碼輸入不正確'}), 400
    if len(new_pwd) < 4:
        return jsonify({'success': False, 'message': '新密碼長度至少需為 4 個字元'}), 400
    
    set_auth_password(new_pwd)
    return jsonify({'success': True, 'message': '密碼修改成功！下次登入請使用新密碼'})


def open_browser():
    """延遲開啟瀏覽器"""
    import time
    time.sleep(1.5)
    webbrowser.open('http://127.0.0.1:5000')


def start_server(port=5000):
    """供桌面版 (desktop_app.py) 呼叫的伺服器啟動函數"""
    _preload_caches()
    app.run(host='127.0.0.1', port=port, debug=False, use_reloader=False)


if __name__ == '__main__':
    if not os.path.exists(DB_PATH):
        print('[X] 找不到資料庫 land_data.db!')
        print('    請先執行 convert_to_db.py 進行轉檔')
        sys.exit(1)

    is_desktop = os.environ.get('LAND_APP_DESKTOP_MODE', '') == '1'

    print('[*] 土地產權資料查詢系統 (源頭對照舊地段號 ➔ 新地段名與新地號)')
    print('    正在啟動伺服器...')
    print('    ⚡ 預載效能快取...')
    _preload_caches()
    print('    ✅ 快取載入完成')

    if not is_desktop:
        print('    瀏覽器將自動開啟 http://127.0.0.1:5000')
        threading.Thread(target=open_browser, daemon=True).start()

    print('    按 Ctrl+C 停止伺服器')

    app.run(host='127.0.0.1', port=5000, debug=False)
