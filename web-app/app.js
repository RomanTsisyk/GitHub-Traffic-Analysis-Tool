// ==================== Configuration ====================
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const BATCH_SIZE = 5; // Number of parallel API requests

// ==================== State ====================
let allRepoData = [];
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
    ['viewsChart', 'overallViewsChart', 'clonesChart', 'overallClonesChart'].forEach(id => {
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
    document.getElementById('refreshBtn').addEventListener('click', () => refreshData(true));
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);

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
            loadData(token, user.login);
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

        updateUserUI(user);
        showDashboard();
        loadData(token, user.login);
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
async function loadData(token, username) {
    // Check cache first
    const cache = getCache();
    if (cache && !isCacheExpired(cache)) {
        console.log('Using cached data');
        processData(cache.data);
        updateCacheInfo(cache.timestamp);
        hideLoading();
        return;
    }

    await refreshData(false);
}

async function refreshData(forceRefresh = false) {
    const token = localStorage.getItem('github_token');
    const userData = JSON.parse(localStorage.getItem('github_user'));

    if (!token || !userData) {
        handleLogout();
        return;
    }

    showLoading('Fetching repositories...');

    try {
        // Fetch all repos
        const repos = await fetchAllRepos(token, userData.login);

        if (repos.length === 0) {
            hideLoading();
            showError('No repositories found.');
            return;
        }

        showLoading('Fetching traffic data...', `0 of ${repos.length} repositories`);

        // Fetch traffic data in parallel batches
        const repoData = await fetchTrafficDataParallel(token, userData.login, repos);

        // Cache the data
        setCache(repoData);
        updateCacheInfo(Date.now());

        // Process and display
        processData(repoData);
        hideLoading();

    } catch (error) {
        console.error('Error fetching data:', error);
        hideLoading();
        showError(`Failed to fetch data: ${error.message}`);
    }
}

// ==================== API Calls ====================
async function fetchUserData(token) {
    const response = await axios.get('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data;
}

async function fetchAllRepos(token, username) {
    const repos = [];
    let page = 1;

    while (true) {
        const response = await axios.get(`https://api.github.com/users/${username}/repos`, {
            headers: { 'Authorization': `Bearer ${token}` },
            params: { per_page: 100, page }
        });

        repos.push(...response.data);

        if (response.data.length < 100) break;
        page++;
    }

    return repos;
}

async function fetchTrafficDataParallel(token, username, repos) {
    const results = [];
    const total = repos.length;

    // Process in batches
    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
        const batch = repos.slice(i, i + BATCH_SIZE);

        const batchPromises = batch.map(async (repo) => {
            try {
                const [viewsRes, clonesRes] = await Promise.all([
                    axios.get(`https://api.github.com/repos/${username}/${repo.name}/traffic/views`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ data: { count: 0, uniques: 0, views: [] } })),
                    axios.get(`https://api.github.com/repos/${username}/${repo.name}/traffic/clones`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    }).catch(() => ({ data: { count: 0, uniques: 0, clones: [] } }))
                ]);

                return {
                    name: repo.name,
                    views: viewsRes.data,
                    clones: clonesRes.data
                };
            } catch (error) {
                return {
                    name: repo.name,
                    views: { count: 0, uniques: 0, views: [] },
                    clones: { count: 0, uniques: 0, clones: [] }
                };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        updateProgress(Math.min(i + BATCH_SIZE, total), total);
    }

    return results;
}

// ==================== Caching ====================
function getCache() {
    try {
        const cache = localStorage.getItem('traffic_cache');
        return cache ? JSON.parse(cache) : null;
    } catch {
        return null;
    }
}

function setCache(data) {
    const cache = {
        timestamp: Date.now(),
        data: data
    };
    localStorage.setItem('traffic_cache', JSON.stringify(cache));
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

    // Show top repositories
    displayTopRepos(repos);

    // Apply filters and create charts
    applyFilters();
}

function displayTopRepos(repos) {
    const grid = document.getElementById('topReposGrid');

    // Sort by total views
    const sorted = [...repos]
        .map(r => ({
            name: r.name,
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

    grid.innerHTML = sorted.map((repo, i) => `
        <div class="top-repo-card">
            <span class="repo-rank">#${i + 1}</span>
            <div class="repo-info">
                <div class="repo-name">${repo.name}</div>
                <div class="repo-stats">
                    <span>👁️ ${repo.views} views</span>
                    <span>📥 ${repo.clones} clones</span>
                </div>
            </div>
        </div>
    `).join('');
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

    // Create charts with filtered data
    createAllCharts(filtered);
}

// ==================== Charts ====================
function clearCharts() {
    ['viewsChart', 'overallViewsChart', 'clonesChart', 'overallClonesChart'].forEach(id => {
        const chart = Chart.getChart(id);
        if (chart) chart.destroy();
    });
}

window.resetZoom = function(chartId) {
    const chart = Chart.getChart(chartId);
    if (chart) chart.resetZoom();
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
    clearCharts();

    const { viewsByRepo, clonesByRepo, allViewDates, allCloneDates } = processChartData(repos);

    const sortedViewDates = Array.from(allViewDates).sort();
    const sortedCloneDates = Array.from(allCloneDates).sort();

    createLineChart('viewsChart', sortedViewDates, viewsByRepo, 'Views');
    createOverallChart('overallViewsChart', sortedViewDates, viewsByRepo, 'Total Views', '#3b82f6');
    createLineChart('clonesChart', sortedCloneDates, clonesByRepo, 'Clones');
    createOverallChart('overallClonesChart', sortedCloneDates, clonesByRepo, 'Total Clones', '#22c55e');
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

// ==================== Export ====================
function exportToCSV() {
    if (allRepoData.length === 0) {
        alert('No data to export');
        return;
    }

    const rows = [['Repository', 'Total Views', 'Unique Visitors', 'Total Clones', 'Unique Cloners']];

    allRepoData.forEach(repo => {
        rows.push([
            repo.name,
            repo.views?.count || 0,
            repo.views?.uniques || 0,
            repo.clones?.count || 0,
            repo.clones?.uniques || 0
        ]);
    });

    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `github-traffic-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();

    URL.revokeObjectURL(url);
}

// ==================== Utilities ====================
function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}
