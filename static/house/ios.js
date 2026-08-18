/**
 * 永慶聯賣案件管理系統 - iOS / Mobile Native Web Engine
 * 專為 iPhone 視網膜螢幕與行動手勢操作打造
 */

// ─── 狀態管理 ───────────────────────────────────────────────
const AUTH_PASSWORD = "9081";
let salesData = [];
let chengjiaoData = [];
let filteredData = [];
function safeGetItem(key, defVal = '') {
    try { return localStorage.getItem(key) || defVal; } catch(e) { return defVal; }
}
function safeSetItem(key, val) {
    try { localStorage.setItem(key, val); } catch(e) {}
}

let favorites = [];
try { favorites = JSON.parse(safeGetItem('yc_ios_favs', '[]')); } catch(e) { favorites = []; }

let currentSegment = 'sales'; // 'sales' | 'chengjiao'
let currentView = 'list';     // 'list' | 'fav' | 'stats'
let currentTown = '';
let currentCategory = '';
let currentSearch = '';
let minPrice = null;
let maxPrice = null;
let minArea = null;
let maxArea = null;
let currentSort = 'date-desc';

let currentPage = 1;
const PAGE_SIZE = 25;
let currentDetailItem = null;

// ─── 初始化 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initNetlifyIdentity();
    initAuth();
    updateFavBadge();
});

// ─── Netlify 雲端帳號審核身分驗證 ────────────────────────────
function initNetlifyIdentity() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.on('init', user => {
            if (user) {
                handleUserLogin(user, false);
            }
        });
        window.netlifyIdentity.on('login', user => {
            handleUserLogin(user, true);
            window.netlifyIdentity.close();
        });
        window.netlifyIdentity.on('logout', () => {
            handleUserLogout();
        });
    }
}

function handleUserLogin(user, showNotice) {
    safeSetItem('yc_ios_authed', 'true');
    const email = user.email || '';
    safeSetItem('yc_user_email', email);
    const userName = (user.user_metadata && user.user_metadata.full_name) || email.split('@')[0] || '聯賣同仁';
    safeSetItem('yc_user_name', userName);
    
    updateUserUI(userName);
    const overlay = document.getElementById('passwordOverlay');
    if (overlay) overlay.style.display = 'none';
    if (showNotice) showToast(`👤 歡迎，${userName}`);
    loadDatasets();
}

function handleUserLogout() {
    safeSetItem('yc_ios_authed', 'false');
    safeSetItem('yc_user_email', '');
    safeSetItem('yc_user_name', '');
    const overlay = document.getElementById('passwordOverlay');
    if (overlay) overlay.style.display = 'flex';
    updateUserUI('未登入');
    showToast('已安全登出');
}

function openNetlifyLogin() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.open('login');
    } else {
        showToast('請使用通行密碼登入');
    }
}

function openNetlifySignup() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.open('signup');
    } else {
        showToast('請聯繫管理員開通權限');
    }
}

function updateUserUI(name) {
    const label = document.getElementById('userNameLabel');
    if (label) label.textContent = name;
}

function handleUserMenu() {
    const email = safeGetItem('yc_user_email');
    const name = safeGetItem('yc_user_name') || '管理員';
    if (confirm(`👤 目前授權登入身分：\n\n使用者：${name}\n帳號：${email || '系統管理員通行碼'}\n\n是否確定要登出並鎖定系統？`)) {
        if (window.netlifyIdentity && window.netlifyIdentity.currentUser()) {
            window.netlifyIdentity.logout();
        } else {
            handleUserLogout();
        }
    }
}

// ─── 密碼與權限存取驗證 ────────────────────────────────────
function initAuth() {
    const isAuthed = safeGetItem('yc_ios_authed') === 'true';
    const overlay = document.getElementById('passwordOverlay');
    const userName = safeGetItem('yc_user_name') || '已授權';
    updateUserUI(userName);

    if (isAuthed) {
        if (overlay) overlay.style.display = 'none';
        loadDatasets();
    } else {
        if (overlay) overlay.style.display = 'flex';
        const pwInput = document.getElementById('accessPassword');
        if (pwInput) setTimeout(() => pwInput.focus(), 100);
    }
}

function checkAuth() {
    const input = document.getElementById('accessPassword');
    const val = input ? input.value.trim() : '';
    const errorMsg = document.getElementById('authErrorMsg');
    if (val === AUTH_PASSWORD) {
        safeSetItem('yc_ios_authed', 'true');
        safeSetItem('yc_user_name', '系統管理員');
        updateUserUI('系統管理員');
        const overlay = document.getElementById('passwordOverlay');
        if (overlay) overlay.style.display = 'none';
        showToast('🔓 歡迎使用 iPhone 專用版');
        loadDatasets();
    } else {
        if (errorMsg) errorMsg.textContent = '❌ 密碼錯誤，請重新輸入';
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

document.getElementById('accessPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkAuth();
});

// ─── 載入資料庫 (含自動重試與容錯備援機制) ────────────────────
async function fetchJsonWithRetry(url, maxRetries = 2) {
    for (let i = 0; i <= maxRetries; i++) {
        try {
            const reqUrl = i === 0 ? (url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()) : url;
            const res = await fetch(reqUrl);
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) return data;
            }
        } catch(err) {
            console.warn(`Fetch ${url} attempt ${i + 1} failed:`, err);
        }
        if (i < maxRetries) await new Promise(r => setTimeout(r, 400));
    }
    return [];
}

async function loadDatasets() {
    try {
        const [sRes, cRes] = await Promise.all([
            fetchJsonWithRetry('sales_data.json'),
            fetchJsonWithRetry('chengjiao_data.json')
        ]);

        if (sRes && sRes.length > 0) salesData = sRes;
        if (cRes && cRes.length > 0) chengjiaoData = cRes;

        const countSales = document.getElementById('salesSegCount');
        const countSold = document.getElementById('soldSegCount');
        if (countSales) countSales.textContent = salesData.length.toLocaleString();
        if (countSold) countSold.textContent = chengjiaoData.length.toLocaleString();

        applyFilterAndRender();
        renderStats();

        if (salesData.length === 0) {
            showToast('⚠️ 資料庫正在連線中...');
        }
    } catch(e) {
        console.error('Failed to load datasets:', e);
        showToast('連線中，請點擊右上角重試');
    }
}

function refreshData() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    loadDatasets().then(() => {
        setTimeout(() => icon.classList.remove('fa-spin'), 600);
        showToast('✅ 資料庫已同步至最新');
    });
}

// ─── 切換分段 (銷售中 / 已成交) ───────────────────────────
function switchSegment(seg) {
    currentSegment = seg;
    document.getElementById('tabSalesBtn').classList.toggle('active', seg === 'sales');
    document.getElementById('tabSoldBtn').classList.toggle('active', seg === 'chengjiao');
    currentPage = 1;
    applyFilterAndRender();
}

// ─── 搜尋與快速標籤篩選 ───────────────────────────────────
function handleSearchInput() {
    currentSearch = document.getElementById('searchInput').value.trim();
    document.getElementById('clearSearchBtn').style.display = currentSearch ? 'block' : 'none';
    currentPage = 1;
    applyFilterAndRender();
}

function clearSearch() {
    document.getElementById('searchInput').value = '';
    document.getElementById('clearSearchBtn').style.display = 'none';
    currentSearch = '';
    currentPage = 1;
    applyFilterAndRender();
}

function selectTownPill(btn, town) {
    document.querySelectorAll('#townPills .pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTown = town;
    currentPage = 1;
    applyFilterAndRender();
}

function selectCategoryPill(btn, cat) {
    document.querySelectorAll('#categoryPills .pill-btn-sm').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = cat;
    currentPage = 1;
    applyFilterAndRender();
}

// ─── 核心篩選與排序引擎 ────────────────────────────────────
function applyFilterAndRender() {
    const rawData = currentSegment === 'sales' ? salesData : chengjiaoData;
    const q = currentSearch.toLowerCase();

    filteredData = rawData.filter(item => {
        // 1. 關鍵字搜尋 (案名, 地段, 門牌, 經紀人, 物件編號, 店名)
        if (q) {
            const matchName = (item.name || '').toLowerCase().includes(q);
            const matchLoc = (item.location || '').toLowerCase().includes(q);
            const matchAgent = (item.agent || '').toLowerCase().includes(q);
            const matchCode = (item.code || '').toLowerCase().includes(q);
            const matchStore = (item.store_name || '').toLowerCase().includes(q);
            if (!matchName && !matchLoc && !matchAgent && !matchCode && !matchStore) return false;
        }

        // 2. 鄉鎮篩選
        if (currentTown) {
            const loc = item.location || '';
            const nm = item.name || '';
            if (!loc.includes(currentTown) && !nm.includes(currentTown)) return false;
        }

        // 3. 類別篩選
        if (currentCategory && item.category !== currentCategory) {
            return false;
        }

        // 4. 總價區間
        const price = item.total_price;
        if (minPrice !== null && (price === null || price < minPrice)) return false;
        if (maxPrice !== null && (price === null || price > maxPrice)) return false;

        // 5. 坪數區間
        const ping = item.area_ping || item.build_ping || item.land_ping;
        if (minArea !== null && (ping === null || ping < minArea)) return false;
        if (maxArea !== null && (ping === null || ping > maxArea)) return false;

        return true;
    });

    // 排序
    sortData(filteredData, currentSort);

    // 更新計數
    document.getElementById('resultCount').textContent = filteredData.length.toLocaleString();

    // 渲染卡片
    renderCardList();
}

function sortData(list, sortType) {
    list.sort((a, b) => {
        if (sortType === 'date-desc') return (b.date || '').localeCompare(a.date || '');
        if (sortType === 'price-asc') return (a.total_price || 0) - (b.total_price || 0);
        if (sortType === 'price-desc') return (b.total_price || 0) - (a.total_price || 0);
        if (sortType === 'unit-asc') return (a.unit_price || 0) - (b.unit_price || 0);
        if (sortType === 'area-desc') {
            const pA = a.area_ping || a.build_ping || a.land_ping || 0;
            const pB = b.area_ping || b.build_ping || b.land_ping || 0;
            return pB - pA;
        }
        return 0;
    });
}

// ─── 渲染卡片列表 (Fluid Cards) ───────────────────────────
function renderCardList() {
    const container = document.getElementById('cardListContainer');
    const paginationBar = document.getElementById('paginationBar');

    if (filteredData.length === 0) {
        container.innerHTML = `
            <div class="ios-empty-state">
                <i class="fa-solid fa-folder-open"></i>
                <p>找不到符合條件的案件</p>
                <span>請嘗試更換鄉鎮標籤或調整篩選條件</span>
            </div>
        `;
        paginationBar.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const endIdx = Math.min(startIdx + PAGE_SIZE, filteredData.length);
    const pageItems = filteredData.slice(startIdx, endIdx);

    let html = '';
    pageItems.forEach((item) => {
        const isFav = favorites.some(f => f.code === item.code && f.name === item.name);
        const catClass = `cat-${item.category || '其他'}`;
        const effPingVal = item.area_ping || item.build_ping || item.land_ping;
        const effPing = (effPingVal && !isNaN(effPingVal)) ? (Math.round(parseFloat(effPingVal) * 100) / 100) : '--';
        const buildPing = (item.build_ping && !isNaN(item.build_ping)) ? (Math.round(parseFloat(item.build_ping) * 100) / 100) : 0;
        const landPing = (item.land_ping && !isNaN(item.land_ping)) ? (Math.round(parseFloat(item.land_ping) * 100) / 100) : 0;
        const unitPrice = item.unit_price ? `${item.unit_price}萬/坪` : '--';
        const agentName = item.agent || '永慶聯賣';
        const firstChar = agentName.charAt(0);

        html += `
            <div class="ios-property-card" onclick="openDetailSheet('${encodeURIComponent(JSON.stringify(item))}')">
                <div class="card-top-row">
                    <span class="card-category-tag ${catClass}">${item.category || '其他'}</span>
                    <h3 class="card-title">${item.name}</h3>
                    <button class="card-fav-btn ${isFav ? 'active' : ''}" onclick="toggleFav(event, '${encodeURIComponent(JSON.stringify(item))}')">
                        <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                    </button>
                </div>

                <div class="card-location-row">
                    <i class="fa-solid fa-location-dot"></i>
                    <span>${item.location || '宜蘭地區'}</span>
                </div>

                <div class="card-metrics-grid">
                    <div class="metric-item">
                        <span class="metric-label">總坪數</span>
                        <span class="metric-val">${effPing}${effPing !== '--' ? '坪' : ''}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">建坪 / 地坪</span>
                        <span class="metric-val">${buildPing} / ${landPing}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">單價</span>
                        <span class="metric-val">${unitPrice}</span>
                    </div>
                </div>

                <div class="card-bottom-row">
                    <div class="card-agent-badge">
                        <span class="agent-avatar">${firstChar}</span>
                        <span>${agentName}</span>
                    </div>
                    <div class="card-price-badge">
                        <span class="price-num">${item.total_price ? item.total_price.toLocaleString() : '--'}</span>
                        <span class="price-unit">萬</span>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // 分頁條
    if (totalPages > 1) {
        paginationBar.style.display = 'flex';
        document.getElementById('pageIndicator').textContent = `${currentPage} / ${totalPages}`;
        document.getElementById('btnPrevPage').disabled = currentPage === 1;
        document.getElementById('btnNextPage').disabled = currentPage === totalPages;
    } else {
        paginationBar.style.display = 'none';
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderCardList();
        document.getElementById('mainScroll').scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
    if (currentPage < totalPages) {
        currentPage++;
        renderCardList();
        document.getElementById('mainScroll').scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ─── 案件詳情底部抽屜 (Bottom Sheet) ─────────────────────
function openDetailSheet(encodedItem) {
    const item = JSON.parse(decodeURIComponent(encodedItem));
    currentDetailItem = item;

    document.getElementById('sheetCategory').textContent = item.category || '其他';
    document.getElementById('sheetCategory').className = `sheet-category-badge cat-${item.category || '其他'}`;
    document.getElementById('sheetTitle').textContent = item.name;
    document.getElementById('sheetPrice').textContent = item.total_price ? item.total_price.toLocaleString() : '--';
    document.getElementById('sheetUnitPrice').textContent = item.unit_price ? `單價：約 ${item.unit_price} 萬/坪` : '單價：--';
    
    document.getElementById('sheetArea').textContent = item.area_ping ? `${item.area_ping} 坪` : '--';
    document.getElementById('sheetBuild').textContent = item.build_ping ? `${item.build_ping} 坪` : '--';
    document.getElementById('sheetLand').textContent = item.land_ping ? `${item.land_ping} 坪` : '--';
    document.getElementById('sheetCode').textContent = item.code || '--';

    document.getElementById('sheetLocation').textContent = item.location || '宜蘭地區';
    document.getElementById('sheetAgent').textContent = item.agent || '永慶聯賣';
    document.getElementById('sheetStore').textContent = item.store_name || '永慶不動產加盟體系';
    document.getElementById('sheetDate').textContent = item.date || '--';

    // 收藏按鈕狀態
    const isFav = favorites.some(f => f.code === item.code && f.name === item.name);
    const favBtn = document.getElementById('btnSheetFav');
    favBtn.className = `action-btn btn-fav ${isFav ? 'active' : ''}`;
    favBtn.innerHTML = `<i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i> <span>${isFav ? '已收藏' : '加入收藏'}</span>`;

    document.getElementById('detailBackdrop').classList.add('active');
    document.getElementById('detailSheet').classList.add('active');
}

function closeDetailSheet() {
    document.getElementById('detailBackdrop').classList.remove('active');
    document.getElementById('detailSheet').classList.remove('active');
}

// ─── 業務 1 鍵功能：複製 LINE 格式 ───────────────────────
function copyLineFormat() {
    if (!currentDetailItem) return;
    const r = currentDetailItem;
    const effPing = r.area_ping || r.build_ping || r.land_ping || '--';

    const text = `🏡【永慶聯賣嚴選案件】
🏷️ 案名：${r.name}
💰 開價：${r.total_price ? r.total_price + ' 萬' : '面議'}${r.unit_price ? '（單價約 ' + r.unit_price + ' 萬/坪）' : ''}
🏠 類型：${r.category || '不動產'}
📐 坪數：權狀約 ${effPing} 坪${r.build_ping ? ' (建坪 ' + r.build_ping + '坪)' : ''}${r.land_ping ? ' (地坪 ' + r.land_ping + '坪)' : ''}
📍 坐落：${r.location || '宜蘭地區'}
👤 接案同仁：${r.agent || '永慶聯賣'}
🏪 所屬店別：${r.store_name || '永慶不動產加盟體系'}
🔢 物件編號：${r.code || '--'}

歡迎預約帶看或同行調件聯賣配對！`;

    navigator.clipboard.writeText(text).then(() => {
        showToast('📋 已複製 LINE 客戶傳送格式！');
    }).catch(() => {
        showToast('複製失敗，請手動複製');
    });
}

// ─── 業務 1 鍵功能：地圖導航 ─────────────────────────────
function openMapNavigation() {
    if (!currentDetailItem || !currentDetailItem.location) {
        showToast('無明確坐落地址可供導航');
        return;
    }
    const loc = encodeURIComponent(currentDetailItem.location);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
        window.open(`maps://?q=${loc}`, '_blank');
    } else {
        window.open(`https://www.google.com/maps/search/?api=1&query=${loc}`, '_blank');
    }
}

// ─── 業務 1 鍵功能：iPhone 原生分享 ──────────────────────
function shareListing() {
    if (!currentDetailItem) return;
    const r = currentDetailItem;
    if (navigator.share) {
        navigator.share({
            title: r.name,
            text: `${r.name} - 開價 ${r.total_price}萬 / ${r.location}`,
            url: window.location.href
        }).catch(() => {});
    } else {
        copyLineFormat();
    }
}

// ─── 收藏功能管理 ────────────────────────────────────────
function toggleFav(e, encodedItem) {
    e.stopPropagation();
    const item = JSON.parse(decodeURIComponent(encodedItem));
    const idx = favorites.findIndex(f => f.code === item.code && f.name === item.name);
    if (idx >= 0) {
        favorites.splice(idx, 1);
        showToast('已取消收藏');
    } else {
        favorites.push(item);
        showToast('⭐ 已加入我的收藏');
    }
    localStorage.setItem('yc_ios_favs', JSON.stringify(favorites));
    updateFavBadge();
    renderCardList();
    if (currentView === 'fav') renderFavList();
}

function toggleSheetFav() {
    if (!currentDetailItem) return;
    const item = currentDetailItem;
    const idx = favorites.findIndex(f => f.code === item.code && f.name === item.name);
    const favBtn = document.getElementById('btnSheetFav');
    if (idx >= 0) {
        favorites.splice(idx, 1);
        favBtn.className = 'action-btn btn-fav';
        favBtn.innerHTML = '<i class="fa-regular fa-star"></i> <span>加入收藏</span>';
        showToast('已取消收藏');
    } else {
        favorites.push(item);
        favBtn.className = 'action-btn btn-fav active';
        favBtn.innerHTML = '<i class="fa-solid fa-star"></i> <span>已收藏</span>';
        showToast('⭐ 已加入我的收藏');
    }
    localStorage.setItem('yc_ios_favs', JSON.stringify(favorites));
    updateFavBadge();
    renderCardList();
    if (currentView === 'fav') renderFavList();
}

function updateFavBadge() {
    document.getElementById('favBadge').textContent = favorites.length;
    document.getElementById('favTotalCount').textContent = `${favorites.length} 筆`;
}

function renderFavList() {
    const container = document.getElementById('favCardList');
    if (favorites.length === 0) {
        container.innerHTML = `
            <div class="ios-empty-state">
                <i class="fa-regular fa-star"></i>
                <p>尚未收藏任何案件</p>
                <span>在案件卡片點擊 ⭐ 即可加入收藏便於客戶帶看</span>
            </div>
        `;
        return;
    }

    let html = '';
    favorites.forEach(item => {
        const catClass = `cat-${item.category || '其他'}`;
        const effPing = item.area_ping || item.build_ping || item.land_ping || '--';
        const unitPrice = item.unit_price ? `${item.unit_price}萬/坪` : '--';
        const agentName = item.agent || '永慶聯賣';
        const firstChar = agentName.charAt(0);

        html += `
            <div class="ios-property-card" onclick="openDetailSheet('${encodeURIComponent(JSON.stringify(item))}')">
                <div class="card-top-row">
                    <span class="card-category-tag ${catClass}">${item.category || '其他'}</span>
                    <h3 class="card-title">${item.name}</h3>
                    <button class="card-fav-btn active" onclick="toggleFav(event, '${encodeURIComponent(JSON.stringify(item))}')">
                        <i class="fa-solid fa-star"></i>
                    </button>
                </div>
                <div class="card-location-row">
                    <i class="fa-solid fa-location-dot"></i>
                    <span>${item.location || '宜蘭地區'}</span>
                </div>
                <div class="card-metrics-grid">
                    <div class="metric-item">
                        <span class="metric-label">總坪數</span>
                        <span class="metric-val">${effPing}${effPing !== '--' ? '坪' : ''}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">單價</span>
                        <span class="metric-val">${unitPrice}</span>
                    </div>
                    <div class="metric-item">
                        <span class="metric-label">業務同仁</span>
                        <span class="metric-val">${agentName}</span>
                    </div>
                </div>
                <div class="card-bottom-row">
                    <div class="card-agent-badge">
                        <span class="agent-avatar">${firstChar}</span>
                        <span>${item.store_name ? item.store_name.slice(0, 8) + '...' : '永慶聯賣'}</span>
                    </div>
                    <div class="card-price-badge">
                        <span class="price-num">${item.total_price ? item.total_price.toLocaleString() : '--'}</span>
                        <span class="price-unit">萬</span>
                    </div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ─── 底部標籤導覽視圖切換 ─────────────────────────────────
function switchView(view) {
    currentView = view;
    document.getElementById('navTabList').classList.toggle('active', view === 'list');
    document.getElementById('navTabFav').classList.toggle('active', view === 'fav');
    document.getElementById('navTabStats').classList.toggle('active', view === 'stats');

    document.getElementById('mainScroll').style.display = view === 'list' ? 'block' : 'none';
    document.getElementById('favoritesView').style.display = view === 'fav' ? 'block' : 'none';
    document.getElementById('statsView').style.display = view === 'stats' ? 'block' : 'none';

    if (view === 'fav') renderFavList();
    if (view === 'stats') renderStats();
}

// ─── 行情統計儀表 ─────────────────────────────────────────
function renderStats() {
    const list = salesData;
    if (list.length === 0) return;

    document.getElementById('kpiSalesTotal').textContent = `${salesData.length} 筆`;
    document.getElementById('kpiSoldTotal').textContent = `${chengjiaoData.length} 筆`;

    let sumUnit = 0, countUnit = 0, sumTotal = 0, countTotal = 0;
    const townCounts = {};
    const catCounts = {};

    list.forEach(r => {
        if (r.unit_price && r.unit_price > 0) {
            sumUnit += r.unit_price;
            countUnit++;
        }
        if (r.total_price && r.total_price > 0) {
            sumTotal += r.total_price;
            countTotal++;
        }
        const m = (r.location || '').match(/^(羅東鎮|冬山鄉|五結鄉|三星鄉|宜蘭市|蘇澳鎮|礁溪鄉|員山鄉|壯圍鄉|頭城鎮)/);
        const t = m ? m[1] : '其他地區';
        townCounts[t] = (townCounts[t] || 0) + 1;

        const c = r.category || '其他';
        catCounts[c] = (catCounts[c] || 0) + 1;
    });

    document.getElementById('kpiAvgUnitPrice').textContent = countUnit ? `${(sumUnit / countUnit).toFixed(1)} 萬` : '--';
    document.getElementById('kpiAvgTotalPrice').textContent = countTotal ? `${Math.round(sumTotal / countTotal).toLocaleString()} 萬` : '--';

    // 鄉鎮排名
    const townEntries = Object.entries(townCounts).sort((a, b) => b[1] - a[1]);
    let townHtml = '';
    townEntries.forEach(([t, count]) => {
        const pct = ((count / list.length) * 100).toFixed(1);
        townHtml += `
            <div class="stat-row-item">
                <span><b>${t}</b></span>
                <span>${count} 筆 (${pct}%)</span>
            </div>
        `;
    });
    document.getElementById('townStatsList').innerHTML = townHtml;

    // 類別排名
    const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    let catHtml = '';
    catEntries.forEach(([c, count]) => {
        const pct = ((count / list.length) * 100).toFixed(1);
        catHtml += `
            <div class="stat-row-item">
                <span><b>${c}</b></span>
                <span>${count} 筆 (${pct}%)</span>
            </div>
        `;
    });
    document.getElementById('catStatsList').innerHTML = catHtml;
}

// ─── 篩選與排序抽屜 ───────────────────────────────────────
function openFilterSheet() {
    document.getElementById('minPriceInput').value = minPrice || '';
    document.getElementById('maxPriceInput').value = maxPrice || '';
    document.getElementById('minAreaInput').value = minArea || '';
    document.getElementById('maxAreaInput').value = maxArea || '';

    document.getElementById('filterBackdrop').classList.add('active');
    document.getElementById('filterSheet').classList.add('active');
}

function closeFilterSheet() {
    document.getElementById('filterBackdrop').classList.remove('active');
    document.getElementById('filterSheet').classList.remove('active');
}

function setSortOption(btn, sortVal) {
    document.querySelectorAll('.sort-opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSort = sortVal;
}

function resetFilters() {
    minPrice = null;
    maxPrice = null;
    minArea = null;
    maxArea = null;
    currentSort = 'date-desc';
    document.getElementById('minPriceInput').value = '';
    document.getElementById('maxPriceInput').value = '';
    document.getElementById('minAreaInput').value = '';
    document.getElementById('maxAreaInput').value = '';
    document.querySelectorAll('.sort-opt-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'date-desc'));
    closeFilterSheet();
    applyFilterAndRender();
    showToast('篩選條件已重設');
}

function applyAdvancedFilter() {
    minPrice = parseFloat(document.getElementById('minPriceInput').value) || null;
    maxPrice = parseFloat(document.getElementById('maxPriceInput').value) || null;
    minArea = parseFloat(document.getElementById('minAreaInput').value) || null;
    maxArea = parseFloat(document.getElementById('maxAreaInput').value) || null;
    closeFilterSheet();
    currentPage = 1;
    applyFilterAndRender();
    showToast('已套用進階篩選條件');
}

// ─── 排序選單 Sheet ───────────────────────────────────────
function openSortSheet() {
    document.getElementById('sortBackdrop').classList.add('active');
    document.getElementById('sortSheet').classList.add('active');
}

function closeSortSheet() {
    document.getElementById('sortBackdrop').classList.remove('active');
    document.getElementById('sortSheet').classList.remove('active');
}

function selectSort(sortVal, label) {
    currentSort = sortVal;
    document.getElementById('currentSortLabel').textContent = label;
    closeSortSheet();
    currentPage = 1;
    applyFilterAndRender();
    showToast(`已切換為：${label}`);
}

// ─── iOS Toast 提示 ────────────────────────────────────────
let toastTimeout = null;
function showToast(msg) {
    const toast = document.getElementById('iosToast');
    toast.textContent = msg;
    toast.classList.add('active');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
    }, 2200);
}
