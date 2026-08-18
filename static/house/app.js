let salesData = [];
let chengjiaoData = [];
let offshelfData = [];
let currentTab = 'sales'; // 'sales', 'chengjiao', 'offshelf'
let filteredData = [];
let currentPage = 1;
let pageSize = 50;
let sortField = 'date';
let sortDirection = -1; // -1 for desc, 1 for asc
let selectedRecord = null;

const COUNTY_TOWN_MAP = {
    '宜蘭縣': ['宜蘭','羅東','蘇澳','頭城','礁溪','壯圍','員山','冬山','五結','三星','大同','南澳'],
    '台北市': ['台北','萬華','中正','大安','信義','松山','士林','北投','中山','大同','內湖','南港','文山'],
    '新北市': ['新北','板橋','新莊','中和','永和','土城','三重','蘆洲','汐止','三峽','鶯歌','淡水','林口','新店','樹林','深坑'],
    '桃園市': ['桃園','中壢','平鎮','八德','楊梅','大溪','龍潭','蘆竹','龜山'],
    '基隆市': ['基隆'],
    '花蓮縣': ['花蓮','壽豐','吉安','新城','鳳林','瑞穗','光復','玉里','富里'],
    '台東縣': ['台東'],
    '台中市': ['台中'],
    '台南市': ['台南'],
    '高雄市': ['高雄'],
    '新竹縣市': ['新竹','竹北','竹東'],
    '苗栗縣': ['苗栗'],
    '彰化縣': ['彰化'],
    '雲林縣': ['雲林'],
    '嘉義縣市': ['嘉義'],
    '屏東縣': ['屏東'],
    '南投縣': ['南投']
};

const ALL_TOWNS_FLAT = [];
const TOWN_TO_COUNTY = {};
for (const county in COUNTY_TOWN_MAP) {
    const towns = COUNTY_TOWN_MAP[county];
    for (const t of towns) {
        ALL_TOWNS_FLAT.push(t);
        TOWN_TO_COUNTY[t] = county;
    }
}
ALL_TOWNS_FLAT.sort((a, b) => b.length - a.length);

function detectLocation(name, location) {
    const text = (name || '') + ' ' + (location || '');
    for (const t of ALL_TOWNS_FLAT) {
        if (text.includes(t)) {
            return { county: TOWN_TO_COUNTY[t], town: t };
        }
    }
    return { county: '', town: '' };
}

function sanitizeUnitPrice(unitPrice, totalPrice, areaPing) {
    if (!totalPrice || !areaPing || areaPing <= 0 || totalPrice <= 0) {
        return (unitPrice && !isNaN(unitPrice) && unitPrice > 0) ? Math.round(unitPrice * 100) / 100 : null;
    }

    const calcUnitPrice = totalPrice / areaPing;

    if (!unitPrice || isNaN(unitPrice) || unitPrice <= 0) {
        return Math.round(calcUnitPrice * 100) / 100;
    }

    // 雙重確認 1: 原始 Excel 單位為「元/坪」而非「萬/坪」 (除以 10000 後接近 總價/坪數)
    const unitInYuan = unitPrice / 10000;
    const ratioToCalc = unitInYuan / calcUnitPrice;
    if (ratioToCalc >= 0.5 && ratioToCalc <= 2.0) {
        return Math.round(unitInYuan * 100) / 100;
    }

    // 雙重確認 2: 單價與 (總價/坪數) 差異過大 (超過 5 倍或低於 0.2 倍)，以 總價/坪數 為準
    const ratioDirect = unitPrice / calcUnitPrice;
    if (ratioDirect > 5 || ratioDirect < 0.2) {
        return Math.round(calcUnitPrice * 100) / 100;
    }

    return Math.round(unitPrice * 100) / 100;
}

// v2 架構：非物件過濾已在後端 sync_engine.js / database.json 處理完畢
// 前端直接使用資料庫內容，僅保留 sanitizeUnitPrice 作為防禦性雙重確認

function getEffectivePing(item) {
    if (!item) return null;
    if (item.build_ping && item.build_ping > 0) return item.build_ping;
    if (item.land_ping && item.land_ping > 0) return item.land_ping;
    if (item.area_ping && item.area_ping > 0) return item.area_ping;
    return null;
}

function getBrandInfo(item) {
    const code = (item.code || '').toUpperCase();
    const src = ((item.source_file || '') + ' ' + (item.id || '') + ' ' + (item.store_name || '')).toUpperCase();

    let brand = '永慶不動產';
    let brandClass = 'store-brand-yungching';
    let brandShort = '永慶';

    if (code.startsWith('UA') || src.includes('有巢')) {
        brand = '有巢氏房屋';
        brandShort = '有巢氏';
        brandClass = 'store-brand-youchao';
    } else if (code.startsWith('YA') || code.startsWith('YG') || src.includes('永義') || src.includes('YE')) {
        brand = '永義房屋';
        brandShort = '永義';
        brandClass = 'store-brand-yongyi';
    } else if (code.startsWith('HA') || code.startsWith('DA') || code.startsWith('EA') || src.includes('台慶')) {
        brand = '台慶不動產';
        brandShort = '台慶';
        brandClass = 'store-brand-taiching';
    } else if (src.includes('永慶') || src.includes('YC') || code.startsWith('AA') || code.startsWith('BA') || code.startsWith('A1')) {
        brand = '永慶不動產';
        brandShort = '永慶';
        brandClass = 'store-brand-yungching';
    }

    let rawStore = item.store_name || '';
    rawStore = rawStore.replace(/\([^\)]+\)/g, '').trim();

    if (!rawStore && item.id) {
        const parts = item.id.split('-');
        if (parts.length >= 2 && parts[0].length <= 8) {
            let p0 = parts[0].replace(/^(YE|YC|UA|HA|DA)/i, '').trim();
            if (p0) rawStore = p0;
        }
    }

    if (!rawStore) rawStore = '加盟店';

    if (!rawStore.endsWith('店') && !rawStore.endsWith('加盟')) {
        rawStore += '加盟店';
    } else if (rawStore.endsWith('加盟')) {
        rawStore += '店';
    }

    const fullStoreDisplay = `${brandShort} ${rawStore}`;

    return {
        brand,
        brandShort,
        brandClass,
        storeName: rawStore,
        fullDisplay: fullStoreDisplay
    };
}

function processLocations(list) {
    list.forEach(item => {
        const loc = detectLocation(item.name, item.location);
        item._county = loc.county;
        item._town = loc.town;
        
        // 有效坪數：建物坪數優先，其次土地坪數，最後主要參考坪數
        const effPing = getEffectivePing(item);
        item.unit_price = sanitizeUnitPrice(item.unit_price, item.total_price, effPing);
        item._brandInfo = getBrandInfo(item);
        item._searchText = ((item.name || '') + ' ' + (item.location || '') + ' ' + (item.agent || '') + ' ' + (item.code || '') + ' ' + item._brandInfo.fullDisplay + ' ' + (item.store_name || '') + ' ' + (item.status || '')).toLowerCase();
    });
}

// ═══ Netlify 雲端帳號審核與安全認證機制 (固定密碼：9081 作為管理員備用通道) ═══
const STORAGE_KEY_AUTH_PIN = 'real_estate_app_auth_pin';
const SYSTEM_PIN = '9081';

function initNetlifyIdentity() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.on('init', user => {
            if (user) handleUserLogin(user, false);
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
    localStorage.setItem(STORAGE_KEY_AUTH_PIN, SYSTEM_PIN);
    const email = user.email || '';
    localStorage.setItem('yc_user_email', email);
    const userName = (user.user_metadata && user.user_metadata.full_name) || email.split('@')[0] || '聯賣同仁';
    localStorage.setItem('yc_user_name', userName);
    
    updateUserUI(userName);
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'none';
    loadData();
}

function handleUserLogout() {
    localStorage.removeItem(STORAGE_KEY_AUTH_PIN);
    localStorage.removeItem('yc_user_email');
    localStorage.removeItem('yc_user_name');
    const authOverlay = document.getElementById('authOverlay');
    if (authOverlay) authOverlay.style.display = 'flex';
    updateUserUI('未登入');
}

function openNetlifyLogin() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.open('login');
    }
}

function openNetlifySignup() {
    if (window.netlifyIdentity) {
        window.netlifyIdentity.open('signup');
    }
}

function updateUserUI(name) {
    const label = document.getElementById('userNameLabel');
    if (label) label.textContent = name;
}

function handleUserMenu() {
    const email = localStorage.getItem('yc_user_email');
    const name = localStorage.getItem('yc_user_name') || '管理員';
    if (confirm(`👤 目前授權登入身分：\n\n使用者：${name}\n帳號：${email || '系統管理員通行碼'}\n\n是否確定要登出並鎖定系統？`)) {
        if (window.netlifyIdentity && window.netlifyIdentity.currentUser()) {
            window.netlifyIdentity.logout();
        } else {
            handleUserLogout();
        }
    }
}

function checkAuth() {
    const savedAuthPin = localStorage.getItem(STORAGE_KEY_AUTH_PIN);
    const isAuth = (savedAuthPin === SYSTEM_PIN);
    const userName = localStorage.getItem('yc_user_name') || '已授權使用者';
    updateUserUI(userName);

    const authOverlay = document.getElementById('authOverlay');
    if (isAuth) {
        if (authOverlay) authOverlay.style.display = 'none';
        loadData();
    } else {
        if (authOverlay) authOverlay.style.display = 'flex';
        const input = document.getElementById('authPasswordInput');
        if (input) setTimeout(() => input.focus(), 100);
    }
}

function verifyPassword() {
    const input = document.getElementById('authPasswordInput');
    const errorMsg = document.getElementById('authErrorMsg');
    const enteredPin = input ? input.value.trim() : '';

    if (enteredPin === SYSTEM_PIN) {
        localStorage.setItem(STORAGE_KEY_AUTH_PIN, enteredPin);
        localStorage.setItem('yc_user_name', '系統管理員');
        updateUserUI('系統管理員');
        if (errorMsg) errorMsg.style.display = 'none';
        const authOverlay = document.getElementById('authOverlay');
        if (authOverlay) authOverlay.style.display = 'none';
        loadData();
    } else {
        if (errorMsg) {
            errorMsg.style.display = 'flex';
        }
        if (input) {
            input.value = '';
            input.focus();
        }
    }
}

function logoutAuth() {
    handleUserMenu();
}

// Initialize app on load
document.addEventListener('DOMContentLoaded', () => {
    initNetlifyIdentity();
    checkAuth();
});

async function loadData() {
    showLoading();
    try {
        const isFileProtocol = window.location.protocol === 'file:';
        const salesUrl = isFileProtocol ? 'sales_data.json' : 'sales_data.json?t=' + Date.now();
        const chengjiaoUrl = isFileProtocol ? 'chengjiao_data.json' : 'chengjiao_data.json?t=' + Date.now();

        const fetchOpts = isFileProtocol ? {} : { cache: 'no-store' };
        const [salesRes, chengjiaoRes] = await Promise.all([
            fetch(salesUrl, fetchOpts).then(r => r.ok ? r.json() : []).catch(() => []),
            fetch(chengjiaoUrl, fetchOpts).then(r => r.ok ? r.json() : []).catch(() => [])
        ]);

        salesData = salesRes || [];
        chengjiaoData = chengjiaoRes || [];

        processLocations(salesData);
        processLocations(chengjiaoData);

        document.getElementById('salesBadge').textContent = salesData.length.toLocaleString();
        document.getElementById('chengjiaoBadge').textContent = chengjiaoData.length.toLocaleString();

        const latestDate = getLatestDate([...salesData, ...chengjiaoData]);
        document.getElementById('syncTime').textContent = latestDate ? `最新資料日期：${latestDate}` : '資料庫已就緒';

        populateCountySelect();
        applyTab();
    } catch (err) {
        console.error("Failed to load json datasets:", err);
        document.getElementById('tableBody').innerHTML = `
            <tr>
                <td colspan="10" class="loading-cell" style="color: #ef4444;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 載入資料庫失敗，請重試或點擊「手動更新按鈕」。
                </td>
            </tr>
        `;
    }
}

function getCurrentRawData() {
    if (currentTab === 'sales') return salesData;
    if (currentTab === 'chengjiao') return chengjiaoData;
    return salesData;
}

function populateCountySelect() {
    const countySelect = document.getElementById('countySelect');
    if (!countySelect) return;

    const rawData = getCurrentRawData();
    const countyCounts = {};

    rawData.forEach(item => {
        if (item._county) {
            countyCounts[item._county] = (countyCounts[item._county] || 0) + 1;
        }
    });

    countySelect.innerHTML = '<option value="">全部縣市</option>';
    const sortedCounties = Object.keys(countyCounts).sort((a, b) => countyCounts[b] - countyCounts[a]);

    sortedCounties.forEach(county => {
        const opt = document.createElement('option');
        opt.value = county;
        opt.textContent = `${county} (${countyCounts[county]})`;
        countySelect.appendChild(opt);
    });

    handleCountyChange();
}

function handleCountyChange() {
    const countySelect = document.getElementById('countySelect');
    const townSelect = document.getElementById('townSelect');
    if (!countySelect || !townSelect) return;

    const selectedCounty = countySelect.value;
    townSelect.innerHTML = '<option value="">全部鄉鎮</option>';

    if (selectedCounty) {
        const rawData = getCurrentRawData();
        const townCounts = {};

        rawData.forEach(item => {
            if (item._county === selectedCounty && item._town) {
                townCounts[item._town] = (townCounts[item._town] || 0) + 1;
            }
        });

        const sortedTowns = Object.keys(townCounts).sort((a, b) => townCounts[b] - townCounts[a]);
        sortedTowns.forEach(town => {
            const opt = document.createElement('option');
            opt.value = town;
            opt.textContent = `${town} (${townCounts[town]})`;
            townSelect.appendChild(opt);
        });
    }

    handleFilterChange();
}

function getLatestDate(allData) {
    if (!allData || allData.length === 0) return '';
    const sorted = [...allData].sort((a, b) => new Date(b.date) - new Date(a.date));
    return sorted[0].date || '';
}

function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tabSales').classList.toggle('active', tab === 'sales');
    document.getElementById('tabChengjiao').classList.toggle('active', tab === 'chengjiao');
    currentPage = 1;
    populateCountySelect();
    applyTab();
}

function applyTab() {
    const rawData = getCurrentRawData();
    filterAndRender(rawData);
}

function handleFilterChange() {
    currentPage = 1;
    const rawData = getCurrentRawData();
    filterAndRender(rawData);
}

function filterAndRender(rawData) {
    const search = document.getElementById('searchInput').value.trim().toLowerCase();
    const county = document.getElementById('countySelect') ? document.getElementById('countySelect').value : '';
    const town = document.getElementById('townSelect') ? document.getElementById('townSelect').value : '';
    const category = document.getElementById('categorySelect').value;
    const minPrice = parseFloat(document.getElementById('minPrice').value) || null;
    const maxPrice = parseFloat(document.getElementById('maxPrice').value) || null;
    const minArea = parseFloat(document.getElementById('minArea').value) || null;
    const maxArea = parseFloat(document.getElementById('maxArea').value) || null;

    filteredData = rawData.filter(item => {
        // Keyword Search
        if (search && (!item._searchText || !item._searchText.includes(search))) {
            return false;
        }

        // County & Town Filter
        if (county && item._county !== county) return false;
        if (town && item._town !== town) return false;

        // Category Filter
        if (category && item.category !== category) return false;

        // Price Filter
        if (minPrice !== null && (item.total_price === null || item.total_price < minPrice)) return false;
        if (maxPrice !== null && (item.total_price === null || item.total_price > maxPrice)) return false;

        // Area Filter (matches build_ping, land_ping, or area_ping)
        if (minArea !== null) {
            const pings = [item.build_ping, item.land_ping, item.area_ping].filter(v => v !== null && v !== undefined && v > 0);
            if (pings.length === 0 || !pings.some(p => p >= minArea)) return false;
        }
        if (maxArea !== null) {
            const pings = [item.build_ping, item.land_ping, item.area_ping].filter(v => v !== null && v !== undefined && v > 0);
            if (pings.length === 0 || !pings.some(p => p <= maxArea)) return false;
        }

        return true;
    });

    // Apply Sorting
    filteredData.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (sortField === 'date') {
            valA = new Date(valA || '1970-01-01').getTime();
            valB = new Date(valB || '1970-01-01').getTime();
        } else {
            valA = valA || 0;
            valB = valB || 0;
        }

        if (valA < valB) return -1 * sortDirection;
        if (valA > valB) return 1 * sortDirection;
        return 0;
    });

    updateKPIs(filteredData);
    renderTable();
}

function getPingDisplayHtml(item) {
    const hasBuild = item.build_ping && item.build_ping > 0;
    const hasLand = item.land_ping && item.land_ping > 0;

    if (hasBuild && hasLand) {
        return `
            <div class="ping-cell">
                <div class="ping-row ping-val-build"><span class="ping-tag ping-tag-build">建</span><span class="ping-num">${item.build_ping.toLocaleString()} 坪</span></div>
                <div class="ping-row ping-val-land"><span class="ping-tag ping-tag-land">地</span><span class="ping-num">${item.land_ping.toLocaleString()} 坪</span></div>
            </div>
        `;
    } else if (hasBuild) {
        return `
            <div class="ping-cell">
                <div class="ping-row ping-val-build"><span class="ping-tag ping-tag-build">建</span><span class="ping-num">${item.build_ping.toLocaleString()} 坪</span></div>
            </div>
        `;
    } else if (hasLand) {
        return `
            <div class="ping-cell">
                <div class="ping-row ping-val-land"><span class="ping-tag ping-tag-land">地</span><span class="ping-num">${item.land_ping.toLocaleString()} 坪</span></div>
            </div>
        `;
    } else if (item.area_ping) {
        return `<div class="ping-cell"><div class="ping-row"><span class="ping-num">${item.area_ping.toLocaleString()} 坪</span></div></div>`;
    }
    return '-';
}

function updateKPIs(data) {
    const totalCount = data.length;
    let totalVolume = 0;
    let totalArea = 0;
    let areaCount = 0;
    let totalUnitPrice = 0;
    let unitCount = 0;

    data.forEach(d => {
        if (d.total_price) totalVolume += d.total_price;
        if (d.area_ping) {
            totalArea += d.area_ping;
            areaCount++;
        }
        if (d.unit_price) {
            totalUnitPrice += d.unit_price;
            unitCount++;
        }
    });

    const volumeInYi = (totalVolume / 10000).toFixed(2);
    const avgUnitPrice = unitCount > 0 ? (totalUnitPrice / unitCount).toFixed(1) : 0;
    const avgArea = areaCount > 0 ? (totalArea / areaCount).toFixed(1) : 0;

    document.getElementById('kpiTotalCount').innerHTML = `${totalCount.toLocaleString()} <small>筆</small>`;
    document.getElementById('kpiTotalVolume').innerHTML = `${volumeInYi} <small>億</small>`;
    document.getElementById('kpiAvgUnitPrice').innerHTML = `${avgUnitPrice} <small>萬/坪</small>`;
    document.getElementById('kpiAvgArea').innerHTML = `${avgArea} <small>坪</small>`;
}

function getLocationDisplay(item) {
    if (!item || !item.location) return '-';
    const loc = item.location.trim();
    if (!loc) return '-';
    if (loc === item.name || loc === item.id || (item.code && loc.includes(item.code) && !/(段|\d+號|\d+地號|地號|門牌|坐落|路\d*號|街\d*號)/.test(loc))) {
        return '-';
    }
    return escapeHtml(loc);
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (filteredData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="10" class="loading-cell">
                    <i class="fa-solid fa-magnifying-glass"></i> 沒有符合條件的案件紀錄。
                </td>
            </tr>
        `;
        updatePagination(0);
        return;
    }

    const startIndex = (currentPage - 1) * pageSize;
    const pageItems = filteredData.slice(startIndex, startIndex + pageSize);

    tbody.innerHTML = pageItems.map((item, idx) => `
        <tr onclick="openDetailModal(${startIndex + idx})">
            <td><i class="fa-regular fa-calendar" style="color: #64748b; margin-right: 6px;"></i>${item.date || '-'}</td>
            <td>${getCategoryTag(item.category, item.status)}</td>
            <td class="case-name-cell">
                ${item._town ? `<span class="town-chip"><i class="fa-solid fa-location-dot"></i> ${item._town}</span>` : ''}
                <span class="case-name-title">${escapeHtml(item.name || '-')}</span>
            </td>
            <td>${escapeHtml(item.location || '-')}</td>
            <td>${getPingDisplayHtml(item)}</td>
            <td class="unit-price-cell">${item.unit_price ? `<span class="unit-price-text">${item.unit_price.toFixed(1)}</span>` : '-'}</td>
            <td style="text-align: right;" class="price-cell">
                <span class="price-text">${item.total_price ? item.total_price.toLocaleString() : '-'}</span>
                ${item.total_price ? '<span class="price-unit">萬</span>' : ''}
            </td>
            <td style="font-weight: 600;">${escapeHtml(item.agent || '-')}</td>
            <td>
                <div class="store-dual-cell">
                    <span class="store-brand-badge ${(item._brandInfo || {}).brandClass || 'store-brand-other'}">
                        <i class="fa-solid fa-store"></i> ${(item._brandInfo || {}).brand || '加盟店'}
                    </span>
                    <span class="store-name-text">${escapeHtml((item._brandInfo || {}).storeName || item.store_name || '-')}</span>
                </div>
            </td>
            <td style="text-align: center;" onclick="event.stopPropagation()">
                <button class="open-file-btn" onclick="copySinglePath('${escapeHtml(item.source_file)}')">
                    <i class="fa-solid fa-folder-open"></i> 複製檔名
                </button>
            </td>
        </tr>
    `).join('');

    updatePagination(filteredData.length);
}

function getCategoryTag(cat, status) {
    if (status === '已下架') {
        return `<span class="tag-badge tag-offshelf"><i class="fa-solid fa-ban"></i> 已下架</span>`;
    }
    let tagClass = 'tag-other';
    if (cat === '農舍') tagClass = 'tag-nongshe';
    else if (cat === '別墅') tagClass = 'tag-bieshu';
    else if (cat === '店面') tagClass = 'tag-dianmian';
    else if (cat === '建地' || cat === '農地' || cat === '農建地') tagClass = 'tag-jiandi';
    else if (cat === '華廈') tagClass = 'tag-huaxia';
    else if (cat === '透天') tagClass = 'tag-toutian';
    return `<span class="tag-badge ${tagClass}">${cat || '其他'}</span>`;
}

function updatePagination(total) {
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, total);

    document.getElementById('pageStart').textContent = start;
    document.getElementById('pageEnd').textContent = end;
    document.getElementById('totalRecords').textContent = total.toLocaleString();

    document.getElementById('pageIndicator').textContent = `${currentPage} / ${totalPages}`;
    document.getElementById('btnPrevPage').disabled = currentPage <= 1;
    document.getElementById('btnNextPage').disabled = currentPage >= totalPages;
}

function changePage(delta) {
    const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
    currentPage += delta;
    if (currentPage < 1) currentPage = 1;
    if (currentPage > totalPages) currentPage = totalPages;
    renderTable();
}

function handlePageSizeChange() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    currentPage = 1;
    renderTable();
}

function sortTable(field) {
    if (sortField === field) {
        sortDirection = sortDirection * -1;
    } else {
        sortField = field;
        sortDirection = -1;
    }
    const rawData = getCurrentRawData();
    filterAndRender(rawData);
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    if (document.getElementById('countySelect')) document.getElementById('countySelect').value = '';
    if (document.getElementById('townSelect')) document.getElementById('townSelect').innerHTML = '<option value="">全部鄉鎮</option>';
    document.getElementById('categorySelect').value = '';
    document.getElementById('minPrice').value = '';
    document.getElementById('maxPrice').value = '';
    document.getElementById('minArea').value = '';
    document.getElementById('maxArea').value = '';
    handleFilterChange();
}

function openDetailModal(idx) {
    selectedRecord = filteredData[idx];
    if (!selectedRecord) return;

    const statusPrefix = selectedRecord.status === '成交' ? '🤝 成交案件' : (selectedRecord.status === '已下架' ? '📦 已下架/到期案件' : '🏡 銷售案件');
    document.getElementById('modalTitle').textContent = `${statusPrefix} - ${selectedRecord.name}`;
    
    document.getElementById('modalBody').innerHTML = `
        <div class="detail-row"><span class="detail-label">案件狀態</span><span class="detail-val">${selectedRecord.status === '已下架' ? '<span style="color:#64748b;font-weight:700;background:#f1f5f9;padding:2px 8px;border-radius:4px;border:1px solid #cbd5e1;"><i class="fa-solid fa-ban"></i> 已下架 / 停售 / 到期</span>' : (selectedRecord.status === '成交' ? '<span style="color:#15803d;font-weight:700;background:#dcfce7;padding:2px 8px;border-radius:4px;border:1px solid #86efac;"><i class="fa-solid fa-check"></i> 已成交</span>' : '<span style="color:#2563eb;font-weight:700;background:#eff6ff;padding:2px 8px;border-radius:4px;border:1px solid #bfdbfe;"><i class="fa-solid fa-house"></i> 銷售中</span>')}</span></div>
        <div class="detail-row"><span class="detail-label">接案/異動日期</span><span class="detail-val">${selectedRecord.date || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">案件類別</span><span class="detail-val">${selectedRecord.category || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">縣市/鄉鎮</span><span class="detail-val">${selectedRecord._county || ''} ${selectedRecord._town || ''}</span></div>
        <div class="detail-row"><span class="detail-label">土地地號/門牌</span><span class="detail-val">${selectedRecord.location || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">總價 (萬元)</span><span class="detail-val" style="color: #dc2626; font-size: 18px;">${selectedRecord.total_price ? selectedRecord.total_price.toLocaleString() + ' 萬' : '-'}</span></div>
        <div class="detail-row"><span class="detail-label">單價 (萬/坪)</span><span class="detail-val">${selectedRecord.unit_price ? selectedRecord.unit_price.toFixed(1) + ' 萬/坪' : '-'}</span></div>
        <div class="detail-row"><span class="detail-label">建物權狀坪數</span><span class="detail-val" style="color: #2563eb;">${selectedRecord.build_ping ? selectedRecord.build_ping.toLocaleString() + ' 坪' : '-'}</span></div>
        <div class="detail-row"><span class="detail-label">土地總坪數</span><span class="detail-val" style="color: #16a34a;">${selectedRecord.land_ping ? selectedRecord.land_ping.toLocaleString() + ' 坪' : '-'}</span></div>
        <div class="detail-row"><span class="detail-label">開發/專案經紀人</span><span class="detail-val" style="color: #2563eb; font-weight: 700;">${selectedRecord.agent || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">所屬加盟店家/公司</span><span class="detail-val">
            <span class="store-chip ${(selectedRecord._brandInfo || {}).brandClass || 'store-brand-other'}">
                <i class="fa-solid fa-store"></i> ${escapeHtml((selectedRecord._brandInfo || {}).fullDisplay || selectedRecord.store_name || '-')}
            </span>
            ${selectedRecord.store_name ? `<span style="font-size: 12px; color: #64748b; margin-left: 8px;">(${escapeHtml(selectedRecord.store_name)})</span>` : ''}
        </span></div>
        <div class="detail-row"><span class="detail-label">物件編號</span><span class="detail-val">${selectedRecord.code || '-'}</span></div>
        <div class="detail-row"><span class="detail-label">原始檔案路徑</span><span class="detail-val" style="word-break: break-all; font-size: 12px; color: #64748b;">${selectedRecord.source_file || '-'}</span></div>
    `;

    document.getElementById('detailModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('detailModal').style.display = 'none';
}

function copyFilePath() {
    if (selectedRecord && selectedRecord.source_file) {
        copySinglePath(selectedRecord.source_file);
    }
}

function copySinglePath(pathStr) {
    navigator.clipboard.writeText(pathStr).then(() => {
        alert("已複製檔案路徑至剪貼簿！\n" + pathStr);
    }).catch(() => {
        alert("檔案路徑：\n" + pathStr);
    });
}

function exportFilteredCSV() {
    if (filteredData.length === 0) {
        alert("目前沒有可匯出的案件資料！");
        return;
    }

    let csv = "\uFEFF"; // UTF-8 BOM
    csv += "接案日期,案件狀態,縣市,鄉鎮,案件類型,案件名稱,土地地號/門牌,建物坪數(坪),土地坪數(坪),主要參考坪數(坪),單價(萬/坪),總價(萬),經紀人,所屬加盟店,物件編號,原始檔案路徑\n";

    filteredData.forEach(d => {
        const storeDisplay = (d._brandInfo || {}).fullDisplay || d.store_name || '';
        csv += `"${d.date || ''}","${d.status || '銷售'}","${d._county || ''}","${d._town || ''}","${d.category || ''}","${(d.name || '').replace(/"/g, '""')}","${(d.location || '').replace(/"/g, '""')}",${d.build_ping || ''},${d.land_ping || ''},${d.area_ping || ''},${d.unit_price || ''},${d.total_price || ''},"${d.agent || ''}","${storeDisplay.replace(/"/g, '""')}","${d.code || ''}","${(d.source_file || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${currentTab === 'sales' ? '銷售案件匯出' : '成交案件匯出'}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showLoading() {
    document.getElementById('tableBody').innerHTML = `
        <tr>
            <td colspan="10" class="loading-cell">
                <i class="fa-solid fa-circle-notch fa-spin"></i> 載入資料庫中...
            </td>
        </tr>
    `;
}

function reloadApp() {
    loadData();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
