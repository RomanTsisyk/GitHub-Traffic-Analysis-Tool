// ==================== Configuration ====================
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 5; // Number of parallel API requests
const REFERRERS_REPO_COUNT = 5; // Top repos to fetch referrers for
const MAX_REFERRERS_SHOWN = 8;

// ==================== State ====================
let allRepoData = [];
let referrerData = [];
let referrersLoaded = false;
let currentFilter = 'all';
let searchQuery = '';

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeUI();
    checkLoginState();
});

// ==================== Theme Management ====================
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);

    // Update charts for new theme
    updateChartsTheme();
}

function updateThemeIcon(theme) {
    const icon = document.querySelector('.theme-icon');
    if (icon) {
        icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
}

function updateChartsTheme() {
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim();

    Chart.defaults.color = textColor;
    Chart.defaults.borderColor = gridColor;

    // Redraw charts if they exist
    ['viewsChart', 'overallViewsChart', 'clonesChart', 'overallClonesChart', 'weekdayChart', 'referrersChart'].forEach(id => {
        const chart = Chart.getChart(id);
        if (chart) {
            chart.options.scales.x.ticks.color = textColor;
            chart.options.scales.y.ticks.color = textColor;
            chart.options.scales.x.grid.color = gridColor;
            chart.options.scales.y.grid.color = gridColor;
            chart.update();
        }
    });
}

// ==================== UI Helpers ====================
function showLoading(message = 'Loading...', subtext = '') {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingText').textContent = message;
    document.getElementById('loadingSubtext').textContent = subtext;
    overlay.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function updateProgress(current, total) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('progressBar').style.width = `${percent}%`;
    document.getElementById('loadingSubtext').textContent = `${current} of ${total} repositories`;
}

function showError(message) {
    const el = document.getElementById('errorMessage');
    el.textContent = message;
    el.classList.remove('hidden');
}

function hideError() {
    document.getElementById('errorMessage').classList.add('hidden');
}

let toastTimeout;
function showToast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => el.classList.add('hidden'), 5000);
}

function showLoginScreen() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('dashboardScreen').classList.add('hidden');
}

function showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
}

// ==================== UI Initialization ====================
function initializeUI() {
    // Login
    document.getElementById('loginButton').addEventListener('click', handleLogin);
    document.getElementById('tokenInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('tokenInput').addEventListener('input', hideError);

    // Dashboard
    document.getElementById('logoutButton').addEventListener('click', handleLogout);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    document.getElementById('refreshBtn').addEventListener('click', () => refreshData());
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    document.getElementById('exportJsonBtn').addEventListener('click', exportToJSON);

    // Search & Filter
    document.getElementById('repoSearch').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        applyFilters();
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            applyFilters();
        });
    });
}

// ==================== Authentication ====================
function checkLoginState() {
    const token = localStorage.getItem('github_token');
    const userData = localStorage.getItem('github_user');

    if (token && userData) {
        try {
            const user = JSON.parse(userData);
            updateUserUI(user);
            showDashboard();
            loadData(token);
        } catch (error) {
            handleLogout();
        }
    }
}

async function handleLogin() {
    const token = document.getElementById('tokenInput').value.trim();

    if (!validateToken(token)) return;

    showLoading('Connecting to GitHub...');

    try {
        const user = await fetchUserData(token);

        localStorage.setItem('github_token', token);
        localStorage.setItem('github_user', JSON.stringify(user));

        hideError();
        updateUserUI(user);
        showDashboard();
        loadData(token);
    } catch (error) {
        showError(`Authentication failed: ${error.message}`);
        hideLoading();
    }
}

function handleLogout() {
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_user');
    localStorage.removeItem('traffic_cache');
    clearCharts();
    showLoginScreen();
}

function validateToken(token) {
    if (!token) {
        showError('Please enter your GitHub Personal Access Token');
        return false;
    }
    if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
        showError('Invalid token format. GitHub tokens start with "ghp_" or "github_pat_"');
        return false;
    }
    return true;
}

function updateUserUI(user) {
    document.getElementById('username').textContent = user.login;
    const avatar = document.getElementById('userAvatar');
    avatar.src = user.avatar_url;
    avatar.style.display = 'block';
}

// ==================== Data Loading ====================
async function loadData(token) {
    // Check cache first
    const cache = getCache();
    if (cache && !isCacheExpired(cache)) {
        console.log('Using cached data');
        referrerData = cache.referrers || [];
        referrersLoaded = referrerData.length > 0;
        processData(cache.repos);
        renderReferrersChart();
        updateCacheInfo(cache.timestamp);
        hideLoading();

        // Referrers missing from cache? Fetch them in background.
        if (!referrersLoaded) {
            loadReferrers(token, cache.repos).catch(() => {});
        }
        return;
    }

    await refreshData();
}

async function refreshData() {
    let token, userData;
    try {
        token = localStorage.getItem('github_token');
        userData = JSON.parse(localStorage.getItem('github_user'));
    } catch {
        handleLogout();
        return;
    }

    if (!token || !userData) {
        handleLogout();
        return;
    }

    showLoading('Fetching repositories...');

    try {
        // Fetch all repos (includes private ones the token can access)
        const repos = await fetchAllRepos(token);

        if (repos.length === 0) {
            hideLoading();
            showToast('No repositories found.');
            return;
        }

        showLoading('Fetching traffic data...', `0 of ${repos.length} repositories`);

        // Fetch traffic data in parallel batches
        const repoData = await fetchTrafficDataParallel(token, repos);

        // Cache the data
        referrerData = [];
        referrersLoaded = false;
        setCache(repoData, []);
        updateCacheInfo(Date.now());

        // Process and display
        processData(repoData);
        renderReferrersChart();
        hideLoading();

        // Load referrers in background
        loadReferrers(token, repoData).catch(() => {});

    } catch (error) {
        console.error('Error fetching data:', error);
        hideLoading();

        // Fall back to cached data if available
        const cache = getCache();
        if (cache && cache.repos && cache.repos.length) {
            referrerData = cache.referrers || [];
            referrersLoaded = referrerData.length > 0;
            processData(cache.repos);
            renderReferrersChart();
            updateCacheInfo(cache.timestamp);
            showToast(`Failed to refresh: ${error.message}. Showing cached data.`);
        } else {
            showToast(`Failed to fetch data: ${error.message}`);
        }
    }
}

// ==================== API Calls ====================
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function githubRequest(url, token, retries = 2) {
    try {
        return await axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}` },
            timeout: 30000
        });
    } catch (error) {
        const status = error.response?.status;
        if ((status === 403 || status === 429) && retries > 0) {
            const retryAfterSec = parseInt(error.response?.headers?.['retry-after'] || '10', 10);
            const waitMs = Math.min(Math.max(retryAfterSec, 1), 60) * 1000;
            console.warn(`Rate limited (HTTP ${status}), retrying in ${waitMs / 1000}s...`);
            await sleep(waitMs);
            return githubRequest(url, token, retries - 1);
        }
        throw error;
    }
}

async function fetchUserData(token) {
    const response = await githubRequest('https://api.github.com/user', token);
    return response.data;
}

async function fetchAllRepos(token) {
    const repos = [];
    let page = 1;

    while (true) {
        const response = await githubRequest(`https://api.github.com/user/repos?per_page=100&page=${page}`, token);

        repos.push(...response.data);

        if (response.data.length < 100) break;
        page++;
    }

    return repos;
}

async function fetchTrafficDataParallel(token, repos) {
    const results = [];
    const total = repos.length;

    // Process in batches
    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
        const batch = repos.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async (repo) => {
            const emptyViews = { count: 0, uniques: 0, views: [] };
            const emptyClones = { count: 0, uniques: 0, clones: [] };

            try {
                const [viewsRes, clonesRes] = await Promise.all([
                    githubRequest(`https://api.github.com/repos/${repo.full_name}/traffic/views`, token)
                        .catch(() => ({ data: emptyViews })),
                    githubRequest(`https://api.github.com/repos/${repo.full_name}/traffic/clones`, token)
                        .catch(() => ({ data: emptyClones }))
                ]);

                return {
                    name: repo.name,
                    full_name: repo.full_name,
                    views: viewsRes.data,
                    clones: clonesRes.data
                };
            } catch (error) {
                return {
                    name: repo.name,
                    full_name: repo.full_name,
                    views: emptyViews,
                    clones: emptyClones
                };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        updateProgress(Math.min(i + BATCH_SIZE, total), total);
    }

    return results;
}

async function loadReferrers(token, repos) {
    const top = [...repos]
        .filter(r => (r.views?.count || 0) > 0)
        .sort((a, b) => (b.views?.count || 0) - (a.views?.count || 0))
        .slice(0, REFERRERS_REPO_COUNT);

    if (top.length === 0) {
        referrersLoaded = true;
        renderReferrersChart();
        return;
    }

    const perRepo = await Promise.all(top.map(async repo => {
        try {
            const response = await githubRequest(
                `https://api.github.com/repos/${repo.full_name}/traffic/popular/referrers`, token);
            return { name: repo.name, referrers: response.data || [] };
        } catch {
            return { name: repo.name, referrers: [] };
        }
    }));

    const aggregated = {};
    perRepo.forEach(({ referrers }) => {
        referrers.forEach(ref => {
            if (!aggregated[ref.referrer]) {
                aggregated[ref.referrer] = { referrer: ref.referrer, count: 0, uniques: 0 };
            }
            aggregated[ref.referrer].count += ref.count;
            aggregated[ref.referrer].uniques += ref.uniques;
        });
    });

    referrerData = Object.values(aggregated)
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_REFERRERS_SHOWN);
    referrersLoaded = true;

    updateCacheReferrers(referrerData);
    renderReferrersChart();
}

// ==================== Caching ====================
function getCache() {
    try {
        const cache = JSON.parse(localStorage.getItem('traffic_cache'));
        if (!cache) return null;
        // Support legacy cache format ({ data: [...] })
        return {
            timestamp: cache.timestamp,
            repos: cache.repos || cache.data || [],
            referrers: cache.referrers || []
        };
    } catch {
        return null;
    }
}

function setCache(repos, referrers = []) {
    const cache = {
        timestamp: Date.now(),
        repos: repos,
        referrers: referrers
    };
    localStorage.setItem('traffic_cache', JSON.stringify(cache));
}

function updateCacheReferrers(referrers) {
    try {
        const cache = JSON.parse(localStorage.getItem('traffic_cache'));
        if (!cache) return;
        cache.referrers = referrers;
        localStorage.setItem('traffic_cache', JSON.stringify(cache));
    } catch {
        // ignore cache update failures
    }
}

function isCacheExpired(cache) {
    return Date.now() - cache.timestamp > CACHE_DURATION;
}

function updateCacheInfo(timestamp) {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString();
    document.getElementById('cacheInfo').textContent =
        `Last updated: ${timeStr} • Data cached for 30 minutes • Click 🔄 to refresh`;
}

// ==================== Data Processing ====================
function processData(repos) {
    allRepoData = repos;

    // Calculate totals
    let totalViews = 0, uniqueVisitors = 0, totalClones = 0;

    repos.forEach(repo => {
        totalViews += repo.views?.count || 0;
        uniqueVisitors += repo.views?.uniques || 0;
        totalClones += repo.clones?.count || 0;
    });

    // Update stats cards
    document.getElementById('totalViews').textContent = formatNumber(totalViews);
    document.getElementById('uniqueVisitors').textContent = formatNumber(uniqueVisitors);
    document.getElementById('totalClones').textContent = formatNumber(totalClones);
    document.getElementById('totalRepos').textContent = repos.length;

    // Apply filters, show top repos and create charts
    applyFilters();
}

function displayTopRepos(repos) {
    const grid = document.getElementById('topReposGrid');

    // Sort by total views
    const sorted = [...repos]
        .map(r => ({
            name: r.name,
            fullName: r.full_name,
            views: r.views?.count || 0,
            clones: r.clones?.count || 0
        }))
        .filter(r => r.views > 0 || r.clones > 0)
        .sort((a, b) => b.views - a.views)
        .slice(0, 5);

    if (sorted.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted); padding: 20px;">No traffic data available yet.</p>';
        return;
    }

    grid.innerHTML = sorted.map((repo, i) => {
        const repoName = repo.fullName
            ? `<a class="repo-name" href="https://github.com/${escapeHtml(repo.fullName)}" target="_blank" rel="noopener noreferrer">${escapeHtml(repo.name)}</a>`
            : `<div class="repo-name">${escapeHtml(repo.name)}</div>`;

        return `
        <div class="top-repo-card">
            <span class="repo-rank">#${i + 1}</span>
            <div class="repo-info">
                ${repoName}
                <div class="repo-stats">
                    <span>👁️ ${repo.views} views</span>
                    <span>📥 ${repo.clones} clones</span>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function applyFilters() {
    let filtered = [...allRepoData];

    // Apply search
    if (searchQuery) {
        filtered = filtered.filter(r => r.name.toLowerCase().includes(searchQuery));
    }

    // Apply filter
    if (currentFilter === 'views') {
        filtered = filtered.filter(r => (r.views?.count || 0) > 0);
    } else if (currentFilter === 'clones') {
        filtered = filtered.filter(r => (r.clones?.count || 0) > 0);
    }

    // Update top repos and charts with filtered data
    displayTopRepos(filtered);
    clearCharts();
    createAllCharts(filtered);
    renderReferrersChart();
}

// ==================== Charts ====================
function clearCharts() {
    ['viewsChart', 'overallViewsChart', 'clonesChart', 'overallClonesChart', 'weekdayChart', 'referrersChart'].forEach(id => {
        const chart = Chart.getChart(id);
        if (chart) chart.destroy();
    });
}

window.resetZoom = function(chartId) {
    const chart = Chart.getChart(chartId);
    if (chart) chart.resetZoom();
};

window.exportChartPNG = function(chartId) {
    const chart = Chart.getChart(chartId);
    if (!chart) {
        showToast('Chart not available yet');
        return;
    }

    const a = document.createElement('a');
    a.href = chart.toBase64Image();
    a.download = `${chartId}-${new Date().toISOString().split('T')[0]}.png`;
    a.click();
};

const chartColors = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
];

const zoomOptions = {
    pan: { enabled: true, mode: 'xy' },
    zoom: {
        wheel: { enabled: true },
        pinch: { enabled: true },
        mode: 'xy'
    }
};

function createAllCharts(repos) {
    const { viewsByRepo, clonesByRepo, allViewDates, allCloneDates } = processChartData(repos);

    const sortedViewDates = Array.from(allViewDates).sort();
    const sortedCloneDates = Array.from(allCloneDates).sort();

    createLineChart('viewsChart', sortedViewDates, viewsByRepo, 'Views');
    createOverallChart('overallViewsChart', sortedViewDates, viewsByRepo, 'Total Views', '#3b82f6');
    createLineChart('clonesChart', sortedCloneDates, clonesByRepo, 'Clones');
    createOverallChart('overallClonesChart', sortedCloneDates, clonesByRepo, 'Total Clones', '#22c55e');
    createWeekdayChart(repos);
}

function processChartData(repos) {
    const viewsByRepo = {};
    const clonesByRepo = {};
    const allViewDates = new Set();
    const allCloneDates = new Set();

    repos.forEach(repo => {
        if (repo.views?.views) {
            viewsByRepo[repo.name] = {};
            repo.views.views.forEach(v => {
                const date = v.timestamp.split('T')[0];
                viewsByRepo[repo.name][date] = v.count;
                allViewDates.add(date);
            });
        }

        if (repo.clones?.clones) {
            clonesByRepo[repo.name] = {};
            repo.clones.clones.forEach(c => {
                const date = c.timestamp.split('T')[0];
                clonesByRepo[repo.name][date] = c.count;
                allCloneDates.add(date);
            });
        }
    });

    return { viewsByRepo, clonesByRepo, allViewDates, allCloneDates };
}

function createLineChart(canvasId, dates, dataByRepo, label) {
    if (dates.length === 0) return;

    const datasets = Object.keys(dataByRepo).map((repo, i) => ({
        label: repo,
        data: dates.map(d => dataByRepo[repo][d] || 0),
        borderColor: chartColors[i % chartColors.length],
        backgroundColor: chartColors[i % chartColors.length],
        fill: false,
        tension: 0.3,
        pointRadius: 3
    }));

    const ctx = document.getElementById(canvasId).getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12 } },
                zoom: zoomOptions
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true }
            }
        }
    });
}

function createOverallChart(canvasId, dates, dataByRepo, label, color) {
    if (dates.length === 0) return;

    const totals = dates.map(date => {
        let sum = 0;
        Object.values(dataByRepo).forEach(repo => {
            sum += repo[date] || 0;
        });
        return sum;
    });

    const ctx = document.getElementById(canvasId).getContext('2d');
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label,
                data: totals,
                borderColor: color,
                backgroundColor: color + '20',
                fill: true,
                tension: 0.4,
                pointRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                zoom: zoomOptions
            },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true }
            }
        }
    });
}

function createWeekdayChart(repos) {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const views = new Array(7).fill(0);
    const clones = new Array(7).fill(0);

    repos.forEach(repo => {
        (repo.views?.views || []).forEach(v => {
            views[new Date(v.timestamp).getUTCDay()] += v.count;
        });
        (repo.clones?.clones || []).forEach(c => {
            clones[new Date(c.timestamp).getUTCDay()] += c.count;
        });
    });

    if (views.every(v => v === 0) && clones.every(c => c === 0)) return;

    const ctx = document.getElementById('weekdayChart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayNames,
            datasets: [
                { label: 'Views', data: views, backgroundColor: 'rgba(59, 130, 246, 0.6)' },
                { label: 'Clones', data: clones, backgroundColor: 'rgba(34, 197, 94, 0.6)' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true }
            }
        }
    });
}

function renderReferrersChart() {
    const existing = Chart.getChart('referrersChart');
    if (existing) existing.destroy();

    const canvas = document.getElementById('referrersChart');
    const note = document.getElementById('referrersNote');

    if (referrerData.length === 0) {
        canvas.style.display = 'none';
        note.classList.remove('hidden');
        note.textContent = referrersLoaded ? 'No referrer data available.' : 'Loading referrer data...';
        return;
    }

    canvas.style.display = 'block';
    note.classList.add('hidden');

    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: referrerData.map(r => r.referrer),
            datasets: [{
                label: 'Views',
                data: referrerData.map(r => r.count),
                backgroundColor: 'rgba(139, 92, 246, 0.6)'
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true },
                y: { grid: { display: false } }
            }
        }
    });
}

// ==================== Export ====================
function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

function dateStamp() {
    return new Date().toISOString().split('T')[0];
}

function csvEscape(value) {
    let s = String(value ?? '');
    // Prevent CSV formula injection
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function exportToCSV() {
    if (allRepoData.length === 0) {
        showToast('No data to export');
        return;
    }

    const rows = [['Repository', 'Total Views', 'Unique Visitors', 'Total Clones', 'Unique Cloners']];

    allRepoData.forEach(repo => {
        rows.push([
            csvEscape(repo.name),
            csvEscape(repo.views?.count || 0),
            csvEscape(repo.views?.uniques || 0),
            csvEscape(repo.clones?.count || 0),
            csvEscape(repo.clones?.uniques || 0)
        ]);
    });

    const csv = rows.map(r => r.join(',')).join('\n');
    downloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `github-traffic-${dateStamp()}.csv`);
    showToast('CSV exported');
}

function exportToJSON() {
    if (allRepoData.length === 0) {
        showToast('No data to export');
        return;
    }

    const payload = allRepoData.map(repo => ({
        repository: repo.name,
        full_name: repo.full_name,
        total_views: repo.views?.count || 0,
        unique_visitors: repo.views?.uniques || 0,
        total_clones: repo.clones?.count || 0,
        unique_cloners: repo.clones?.uniques || 0,
        daily_views: repo.views?.views || [],
        daily_clones: repo.clones?.clones || []
    }));

    const json = JSON.stringify(payload, null, 2);
    downloadFile(new Blob([json], { type: 'application/json' }), `github-traffic-${dateStamp()}.json`);
    showToast('JSON exported');
}

// ==================== Utilities ====================
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
