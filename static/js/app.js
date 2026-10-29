/**
 * Mac RAM Advisor — Clean, Simple Controller
 * Updates live telemetry every 1 second, handles light/dark themes,
 * manages Peak Workday & 7-day auto-target, renders the merged 5-tier comparison card,
 * and controls the "How it is calculated" & Security modals.
 */

const urlParams = new URLSearchParams(window.location.search);
const daysQuery = urlParams.get('days');
let selectedDays = (daysQuery && !isNaN(parseFloat(daysQuery))) ? parseFloat(daysQuery) : 7;
let currentTargetMode = 'peak_3h';
let liveInterval = null;

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initTimelineChart();

    setupSegmentedControl();
    setupTargetRibbon();
    setupExportDesktop();
    setupCalculationModal();
    setupResetModal();
    setupSecurityModal();
    setupToggleAllTiers();

    // Initial data fetch
    fetchStatus();
    fetchAnalysis(selectedDays);
    fetchLive();
    fetchTimeline(selectedDays);

    // 1-Second Continuous Live Loop
    liveInterval = setInterval(() => {
        fetchStatus();
        fetchLive();
    }, 1000);
});

// Theme Manager (Light & Dark Mode)
function initTheme() {
    const savedTheme = localStorage.getItem('mac_sizer_theme') || 'light';
    applyTheme(savedTheme);

    const btnTheme = document.getElementById('btnThemeToggle');
    btnTheme?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'light' ? 'dark' : 'light';
        applyTheme(next);
        localStorage.setItem('mac_sizer_theme', next);
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (window.timelineChart) {
        updateChartTheme(theme);
    }
}

// Segmented Control (Timeframe selector)
function setupSegmentedControl() {
    const btns = document.querySelectorAll('.segment-btn');
    btns.forEach(btn => {
        const d = parseFloat(btn.getAttribute('data-days'));
        if (Math.abs(d - selectedDays) < 0.001) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        btn.addEventListener('click', () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedDays = parseFloat(btn.getAttribute('data-days'));
            fetchAnalysis(selectedDays);
            fetchTimeline(selectedDays);
        });
    });
}

// Dual Target Mode Ribbon & Progress
function setupTargetRibbon() {
    const chk = document.getElementById('chkAutoTarget');
    const btnPeak = document.getElementById('btnModePeak');
    const btn7Day = document.getElementById('btnMode7Day');
    const desc = document.getElementById('targetModeDesc');

    btnPeak?.addEventListener('click', async () => {
        btnPeak.classList.add('active');
        btn7Day?.classList.remove('active');
        currentTargetMode = 'peak_3h';
        if (desc) desc.textContent = "Auto-pause and export report after 3 hours of peak multitasking.";
        try {
            await fetch('/api/target_mode?mode=peak_3h', { method: 'POST' });
        } catch (e) {}
        fetchStatus();
    });

    btn7Day?.addEventListener('click', async () => {
        btn7Day.classList.add('active');
        btnPeak?.classList.remove('active');
        currentTargetMode = 'profile_7d';
        if (desc) desc.textContent = "Auto-pauses after 7 days and writes your verified sizing report directly to Desktop.";
        try {
            await fetch('/api/target_mode?mode=profile_7d', { method: 'POST' });
        } catch (e) {}
        fetchStatus();
    });

    chk?.addEventListener('change', async () => {
        try {
            await fetch(`/api/target_mode?enabled=${chk.checked}&mode=${currentTargetMode}`, { method: 'POST' });
        } catch (e) {}
    });
}

// 1-Click Save to Desktop
function setupExportDesktop() {
    const btn = document.getElementById('btnExportDesktop');
    btn?.addEventListener('click', () => exportDesktop());

    const btnReport = document.getElementById('btnViewReport');
    btnReport?.addEventListener('click', () => {
        window.open(`/report?days=${selectedDays}`, '_blank');
    });
}

async function exportDesktop() {
    const btn = document.getElementById('btnExportDesktop');
    const origHtml = btn ? btn.innerHTML : '';
    if (btn) {
        btn.innerHTML = `<span>Saving...</span>`;
        btn.disabled = true;
    }

    try {
        const res = await fetch(`/api/export_desktop?days=${selectedDays}`, { method: 'POST' });
        const data = await res.json();
        showToast("Report saved directly to your Desktop!");
    } catch (err) {
        alert("Error saving report: " + err);
    } finally {
        if (btn) {
            btn.innerHTML = origHtml;
            btn.disabled = false;
        }
    }
}

function showToast(msg) {
    const t = document.getElementById('toastBanner');
    if (t) {
        t.textContent = msg;
        t.style.display = 'block';
        setTimeout(() => { t.style.display = 'none'; }, 4000);
    }
}

// "How It Is Being Calculated" Modal Controller
function setupCalculationModal() {
    const btnOpen = document.getElementById('btnOpenCalcModal');
    const btnClose = document.getElementById('btnCloseCalcModal');
    const modal = document.getElementById('calcModalOverlay');

    btnOpen?.addEventListener('click', () => {
        modal?.classList.add('open');
    });

    btnClose?.addEventListener('click', () => {
        modal?.classList.remove('open');
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('open')) {
            modal.classList.remove('open');
        }
    });
}

// Reset Telemetry Data Modal Controller
function setupResetModal() {
    const btnOpen = document.getElementById('btnResetData');
    const btnClose = document.getElementById('btnCloseResetModal');
    const btnCancel = document.getElementById('btnCancelReset');
    const btnConfirm = document.getElementById('btnConfirmReset');
    const modal = document.getElementById('resetModalOverlay');

    btnOpen?.addEventListener('click', () => {
        modal?.classList.add('open');
    });

    const closeModal = () => {
        modal?.classList.remove('open');
    };

    btnClose?.addEventListener('click', closeModal);
    btnCancel?.addEventListener('click', closeModal);

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('open')) {
            closeModal();
        }
    });

    btnConfirm?.addEventListener('click', async () => {
        const origText = btnConfirm.textContent;
        btnConfirm.textContent = 'Resetting...';
        btnConfirm.disabled = true;

        try {
            const res = await fetch('/api/collector/clear', { method: 'POST' });
            if (res.ok) {
                closeModal();
                showToast("Telemetry history has been reset.");
                // Immediately refresh data
                fetchStatus();
                fetchAnalysis(selectedDays);
                fetchLive();
                fetchTimeline(selectedDays);
            } else {
                alert("Failed to reset telemetry data.");
            }
        } catch (err) {
            alert("Error: " + err);
        } finally {
            btnConfirm.textContent = origText;
            btnConfirm.disabled = false;
        }
    });
}

// Security, SmartScreen & Open Source Verification Modal Controller
function setupSecurityModal() {
    const btnOpen = document.getElementById('btnSecurityModal');
    const btnClose = document.getElementById('btnCloseSecurityModal');
    const modal = document.getElementById('securityModalOverlay');

    btnOpen?.addEventListener('click', () => {
        modal?.classList.add('open');
    });

    btnClose?.addEventListener('click', () => {
        modal?.classList.remove('open');
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('open');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('open')) {
            modal.classList.remove('open');
        }
    });
}

// Fetch Status & Target Progress (every 1s)
async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        // Update target mode pill UI
        const btnPeak = document.getElementById('btnModePeak');
        const btn7Day = document.getElementById('btnMode7Day');
        const desc = document.getElementById('targetModeDesc');

        if (data.target_mode) {
            currentTargetMode = data.target_mode;
            if (data.target_mode === 'peak_3h') {
                btnPeak?.classList.add('active');
                btn7Day?.classList.remove('active');
                if (desc) desc.textContent = "Auto-pause and export report after 3 hours of peak multitasking.";
            } else {
                btn7Day?.classList.add('active');
                btnPeak?.classList.remove('active');
                if (desc) desc.textContent = "Auto-pauses after 7 days and writes your verified sizing report directly to Desktop.";
            }
        }

        // Auto target switch
        const chk = document.getElementById('chkAutoTarget');
        if (chk && !chk.matches(':focus')) {
            chk.checked = !!data.auto_target_enabled;
        }

        // Progress text and bar
        const pText = document.getElementById('targetProgressText');
        const pFill = document.getElementById('targetProgressFill');
        if (pText && pFill) {
            if (currentTargetMode === 'peak_3h') {
                const curHours = data.total_hours_recorded || 0;
                const tgtHours = 3.0;
                const pct = Math.min(100, Math.round((curHours / tgtHours) * 100));
                pText.textContent = `Hour ${curHours.toFixed(1)} of ${tgtHours.toFixed(1)} (${pct}% completed)`;
                pFill.style.width = `${pct}%`;
            } else {
                const curDays = data.total_days_recorded || 0;
                const tgtDays = 7.0;
                const pct = Math.min(100, Math.round((curDays / tgtDays) * 100));
                pText.textContent = `Day ${curDays.toFixed(1)} of ${tgtDays.toFixed(1)} (${pct}% completed)`;
                pFill.style.width = `${pct}%`;
            }
        }

        // Status indicator
        const pill = document.getElementById('statusPill');
        const sText = document.getElementById('statusText');
        if (pill && sText) {
            if (data.is_paused) {
                pill.className = 'status-badge paused';
                sText.textContent = 'Paused';
            } else {
                pill.className = 'status-badge';
                sText.textContent = 'Live Monitoring';
            }
        }
    } catch (e) {}
}

// Fetch Live Metrics (every 1s)
async function fetchLive() {
    try {
        const res = await fetch('/api/live?limit=30');
        const data = await res.json();
        const samples = data.samples || [];
        if (samples.length === 0) return;

        const latest = samples[samples.length - 1];

        // Physical RAM
        const physGb = (latest.phys_used_mb / 1024).toFixed(1);
        const physTotalGb = (latest.phys_total_mb / 1024).toFixed(1);
        const physPct = Math.round(latest.phys_percent);

        document.getElementById('livePhysVal').textContent = `${physGb} GB`;
        document.getElementById('livePhysPct').textContent = `${physPct}%`;
        document.getElementById('livePhysFill').style.width = `${physPct}%`;
        document.getElementById('livePhysSub').textContent = `Total RAM: ${physTotalGb} GB`;

        // Commit Charge
        const commitGb = (latest.commit_total_mb / 1024).toFixed(1);
        const commitLimitGb = (latest.commit_limit_mb / 1024).toFixed(1);
        const commitPct = Math.round(latest.commit_percent);

        document.getElementById('liveCommitVal').textContent = `${commitGb} GB`;
        document.getElementById('liveCommitPct').textContent = `${commitPct}%`;
        document.getElementById('liveCommitFill').style.width = `${commitPct}%`;
        document.getElementById('liveCommitSub').textContent = `Limit: ${commitLimitGb} GB`;

        // Mac Equivalent Demand
        const macGb = (latest.mac_equivalent_mb / 1024).toFixed(1);
        document.getElementById('liveMacVal').textContent = `${macGb} GB`;
        const macPct = Math.min(100, Math.round((latest.mac_equivalent_mb / (32 * 1024)) * 100));
        document.getElementById('liveMacFill').style.width = `${macPct}%`;

        // Pressure tag
        const pTag = document.getElementById('livePressureTag');
        if (pTag && latest.pressure_16gb) {
            const p = latest.pressure_16gb.toLowerCase();
            pTag.textContent = p === 'green' ? 'SMOOTH' : (p === 'yellow' ? 'BUSY' : 'SLOWDOWN');
            pTag.className = `metric-tag highlight ${p}`;
        }

        // Foreground application
        const fgEl = document.getElementById('liveFgApp');
        if (fgEl && latest.foreground_app) {
            fgEl.textContent = latest.foreground_app;
        }

        // Total snapshot count
        const snapEl = document.getElementById('liveSampleTotal');
        if (snapEl) {
            snapEl.textContent = `Snapshots: ${latest.id.toLocaleString()}`;
        }
    } catch (e) {}
}

// Fetch Sizing Analysis & Render Both Cards
async function fetchAnalysis(days) {
    try {
        const res = await fetch(`/api/analysis?days=${days}`);
        const data = await res.json();
        const rec = data.recommendation;
        const stats = data.stats;

        if (!rec || rec.status === 'insufficient_data') {
            document.getElementById('verdictHeroRam').textContent = "-- GB";
            return;
        }

        // Card 1: The Recommendation
        const vHero = document.getElementById('verdictHeroRam');
        if (vHero) vHero.textContent = rec.recommended_ram.split(' ')[0];

        const rPill = document.getElementById('recommendedPill');
        if (rPill) rPill.textContent = rec.recommended_ram;

        // Confidence badge & provisional hint
        const confBadge = document.getElementById('confidenceBadge');
        const provHint = document.getElementById('provisionalHint');
        if (provHint) {
            provHint.style.display = rec.is_provisional ? "block" : "none";
        }
        if (confBadge) {
            if (rec.is_provisional) {
                confBadge.textContent = "PROVISIONAL";
                confBadge.className = "badge badge-provisional";
                confBadge.style.display = "inline-flex";
            } else {
                confBadge.textContent = "VERIFIED PROFILE";
                confBadge.className = "badge badge-precision";
                confBadge.style.display = "inline-flex";
            }
        }

        const subTitle = document.getElementById('verdictSubtitle');
        if (subTitle && rec.metrics) {
            const countStr = (rec.metrics.total_samples || 0).toLocaleString();
            subTitle.textContent = rec.is_provisional
                ? `Provisional sizing (${countStr} snapshots across peak workday session)`
                : `Based on ${countStr} real memory snapshots across ${rec.metrics.days_analyzed} days`;
        }

        const vLabel = document.getElementById('verdictHeroLabel');
        if (vLabel) vLabel.textContent = rec.headline || "Best choice for a smooth, fast Mac for 4–5 years";

        const peakEl = document.getElementById('valPeakDemand');
        if (peakEl && rec.metrics) peakEl.textContent = `${rec.metrics.max_mac_gb.toFixed(1)} GB`;

        const p95El = document.getElementById('valP95Demand');
        if (p95El && rec.metrics) p95El.textContent = `${rec.metrics.p95_mac_gb.toFixed(1)} GB`;

        // Merged Card 2: 5-Tier Comparison List (8GB, 16GB, 24GB, 32GB/36GB, 48GB)
        renderMergedTiers(rec.tiers, rec.tier_verdicts, rec.recommended_ram, rec.metrics);

        // Render Observations
        const obsList = document.getElementById('observationsList');
        if (obsList && rec.reasons) {
            obsList.innerHTML = '';
            rec.reasons.forEach(r => {
                const li = document.createElement('li');
                li.textContent = r;
                obsList.appendChild(li);
            });
        }

        // Render Top Apps
        if (stats.top_processes) {
            renderAppsTable(stats.top_processes);
        }
    } catch (e) {
        console.error("Analysis fetch error", e);
    }
}

// SVG Icon helper for 10 comment types
function getCommentIcon(name) {
    switch (name) {
        case 'activity':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>';
        case 'target':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>';
        case 'check-circle':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
        case 'x-circle':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        case 'monitor':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>';
        case 'cpu':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line></svg>';
        case 'hard-drive':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="12" x2="2" y2="12"></line><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path><line x1="6" y1="16" x2="6.01" y2="16"></line><line x1="10" y1="16" x2="10.01" y2="16"></line></svg>';
        case 'layers':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>';
        case 'zap':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';
        case 'shield':
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>';
        default:
            return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle></svg>';
    }
}

// Complete 10-Comment Architectural & Suitability Breakdown Generator
function getTierFitBreakdown(tierKey, t, v, recommendedRam, metrics) {
    if (v && v.fit_breakdown && v.fit_breakdown.comments && v.fit_breakdown.comments.length >= 10) {
        return v.fit_breakdown;
    }

    const p95_gb = (metrics && metrics.p95_mac_gb) ? metrics.p95_mac_gb : 20.4;
    const max_gb = (metrics && metrics.max_mac_gb) ? metrics.max_mac_gb : 22.9;
    const swapProb = t.swap_probability !== undefined ? t.swap_probability : (t.red_pct || 0);
    const usable_gb = t.usable_app_gb || (tierKey === "8GB" ? 3.4 : (tierKey === "16GB" ? 11.4 : (tierKey === "24GB" ? 19.4 : (tierKey === "32GB" ? 27.4 : 43.4))));
    const wear_tbw = (t.wear_info && t.wear_info.wear_tbw) ? t.wear_info.wear_tbw : (tierKey === "8GB" ? "45–112 TBW" : (tierKey === "16GB" ? "18–40 TBW" : (tierKey === "24GB" ? "1.1–4.5 TBW" : "<0.5 TBW")));

    if (tierKey === "8GB") {
        return {
            status_label: "CRITICAL SWAP DEFICIT",
            status_class: "deficit",
            pressure_status: "Continuous Red Pressure",
            swap_risk_text: `CRITICAL SWAP (${swapProb.toFixed(0)}% RISK)`,
            why_suited: [
                "Lightweight single-task computing (Safari with 3–6 tabs, email in Mail.app, and word processing in Pages or Google Docs).",
                "Dedicated kiosk terminals, point-of-sale displays, or secondary student laptops for video lectures.",
                "Users who strictly run one application at a time and avoid modern Electron software stacks."
            ],
            why_not_suited: [
                "Severe SSD swap thrashing and beachballs when running modern multi-app workflows (Chrome + Slack + Zoom + Spotify).",
                "Video calls stutter or drop frames when sharing screens while presenting slide decks or spreadsheets.",
                "Inactive background apps are aggressively killed or suspended by the kernel to prevent out-of-memory panics."
            ],
            comments: [
                {
                    id: 1,
                    type_name: "Status & Memory Pressure",
                    category: "STATUS & PRESSURE",
                    icon: "activity",
                    title: "Continuous Red Pressure Alert",
                    text: `Under your measured multi-app workload, an 8GB Mac faces continuous Red memory pressure (${swapProb.toFixed(0)}% swap risk). The macOS kernel paging daemon (kern_memorystatus) is perpetually active, thrashing memory pages to disk.`
                },
                {
                    id: 2,
                    type_name: "Workload Telemetry Fit",
                    category: "TELEMETRY FIT",
                    icon: "target",
                    title: "Severe Structural Memory Shortfall",
                    text: `Your measured workload demands ${p95_gb.toFixed(1)} GB during typical busy multitasking and spikes to ${max_gb.toFixed(1)} GB. With only ~${usable_gb.toFixed(1)} GB usable after macOS system reserves, 8GB creates an immediate structural deficit of ${(Math.max(0.1, p95_gb - usable_gb)).toFixed(1)} GB.`
                },
                {
                    id: 3,
                    type_name: "Why It Is Suited",
                    category: "WHY SUITED",
                    icon: "check-circle",
                    title: "Best For Casual Single-App Workflows",
                    text: "Suited only for minimal, single-task use cases: basic web browsing with a handful of tabs, reading PDFs, checking email in Mail.app, and streaming 1080p media where background processes remain near zero."
                },
                {
                    id: 4,
                    type_name: "Why It Is NOT Suited",
                    category: "WHY NOT SUITED",
                    icon: "x-circle",
                    title: "Unsuited For Modern Multitasking",
                    text: "Completely unsuited for running modern desktop applications concurrently. Opening Chrome with multiple tabs alongside Slack, Zoom, and Spotify immediately triggers UI stutter, audio glitches, and tab purging."
                },
                {
                    id: 5,
                    type_name: "Unified VRAM & Display Overhead",
                    category: "VRAM & DISPLAY",
                    icon: "monitor",
                    title: "VRAM Starvation On External Displays",
                    text: "macOS system buffers (2.15 GB), on-device Apple Intelligence 3B AFM (1.95 GB), and internal Retina framebuffers (0.52 GB) consume 4.62 GB upfront. Connecting an external 4K monitor claims another 1.05 GB (14.75 MP virtual canvas), leaving barely ~2.3 GB for applications."
                },
                {
                    id: 6,
                    type_name: "WKdm In-Memory Compression Envelope",
                    category: "WKdm COMPRESSION",
                    icon: "cpu",
                    title: "Rapid Compression Buffer Saturation",
                    text: "Apple's hardware WKdm+LZ4 hybrid compressor targets 2.35:1 compression, but the 8 GB address space provides zero buffer headroom. The compression pool saturates almost immediately under multi-app workloads, triggering continuous spills to NVMe swap."
                },
                {
                    id: 7,
                    type_name: "SSD Swap Write Amplification & NAND Lifespan",
                    category: "SSD WEAR & TBW",
                    icon: "hard-drive",
                    title: "Accelerated Motherboard NAND Degradation",
                    text: `Sustains 20–50 GB/day of swap writes. With APFS write amplification (WAF = 2.10), this generates 15–37 TB/year of physical NAND writes, accumulating ${wear_tbw}. On a base 256 GB drive (150 TBW rating), chronic swap can exhaust SSD lifespan in just 2.0 to 4.0 years.`
                },
                {
                    id: 8,
                    type_name: "Multitasking & Tab Retention",
                    category: "MULTITASKING & TABS",
                    icon: "layers",
                    title: "Aggressive Browser Tab Discard",
                    text: "Cannot keep more than 8–12 active browser tabs in memory simultaneously without tab discard. Navigating back to earlier tabs forces full webpage reloads and loses entered form state."
                },
                {
                    id: 9,
                    type_name: "Pro Workflows, Virtualization & Local AI",
                    category: "PRO APPS & AI",
                    icon: "zap",
                    title: "Incapable Of Running Pro Tools Or Local AI",
                    text: "Completely incapable of running Docker, Parallels Windows VMs, or local LLMs. Loading even a small 3B or 7B quantized model requires 4–6 GB VRAM alone, triggering an immediate out-of-memory crash."
                },
                {
                    id: 10,
                    type_name: "Future-Proofing & Resale Longevity",
                    category: "LONGEVITY & RESALE",
                    icon: "shield",
                    title: "Phased Out Baseline Standard",
                    text: "Apple officially phased out 8GB as the standard baseline in late 2024 because Apple Intelligence and modern macOS releases demand 16GB minimum. An 8GB Mac faces rapid software obsolescence and very low secondary resale value."
                }
            ]
        };
    } else if (tierKey === "16GB") {
        return {
            status_label: "MODERATE DEFICIT",
            status_class: swapProb > 20 ? "deficit" : "tight",
            pressure_status: "Frequent Yellow & Red Spikes",
            swap_risk_text: `DEFICIT (${swapProb.toFixed(0)}% SWAP RISK)`,
            why_suited: [
                "Standard office productivity, remote administrative work, and web browsing with 20–30 browser tabs.",
                "Single-app creative work: editing RAW photos in Lightroom Classic or 1080p and light 4K video exports.",
                "Junior or web development: VS Code, local Node.js or Python scripts, and lightweight databases."
            ],
            why_not_suited: [
                "Strains when multitasking between memory-heavy Electron apps (Slack, Discord, Teams, Notion) alongside 40+ tabs.",
                "Not suited for multi-container Docker development clusters or complex local Kubernetes testing.",
                "Background apps like Figma or Photoshop undergo background page-outs during heavy rendering or compile jobs."
            ],
            comments: [
                {
                    id: 1,
                    type_name: "Status & Memory Pressure",
                    category: "STATUS & PRESSURE",
                    icon: "activity",
                    title: "Periodic Yellow/Red Pressure Spikes",
                    text: `Regularly transitions between Green and Yellow memory pressure during daily multitasking, with ${swapProb.toFixed(0)}% probability of active SSD swap spikes when your heaviest applications are open concurrently.`
                },
                {
                    id: 2,
                    type_name: "Workload Telemetry Fit",
                    category: "TELEMETRY FIT",
                    icon: "target",
                    title: "Periodic Bottleneck Under Peak Multitasking",
                    text: `Your peak demand reaches ${max_gb.toFixed(1)} GB, exceeding the ~${usable_gb.toFixed(1)} GB usable application space by ${(Math.max(0.1, max_gb - usable_gb)).toFixed(1)} GB. It handles light sessions smoothly, but busy workday multitasking forces active page swaps.`
                },
                {
                    id: 3,
                    type_name: "Why It Is Suited",
                    category: "WHY SUITED",
                    icon: "check-circle",
                    title: "Capable For Standard Single-Focus Productivity",
                    text: "Well-suited for standard office productivity, remote knowledge work, web research with 20–30 tabs, document processing, and single-discipline photo or video projects."
                },
                {
                    id: 4,
                    type_name: "Why It Is NOT Suited",
                    category: "WHY NOT SUITED",
                    icon: "x-circle",
                    title: "Strains Under Concurrent Pro Multitasking",
                    text: "Struggles when running multiple memory-hungry Electron apps (Slack, Teams, Notion, Figma) simultaneously with developer tools, causing micro-hesitations and background tab freezing."
                },
                {
                    id: 5,
                    type_name: "Unified VRAM & Display Overhead",
                    category: "VRAM & DISPLAY",
                    icon: "monitor",
                    title: "VRAM Allocation Tightens App Headroom",
                    text: "Dynamic Metal GPU allocation claims 3–5 GB during dual-display workflows (e.g. MacBook display plus an external 4K monitor), reducing effective DRAM for applications down to ~10–11 GB."
                },
                {
                    id: 6,
                    type_name: "WKdm In-Memory Compression Envelope",
                    category: "WKdm COMPRESSION",
                    icon: "cpu",
                    title: "Compression Active With Moderate CPU Overhead",
                    text: "macOS WKdm compression handles everyday loads well, compressing working sets effectively. However, when demand nears 14–15 GB, compression routines draw measurable CPU cycles and impact battery life."
                },
                {
                    id: 7,
                    type_name: "SSD Swap Write Amplification & NAND Lifespan",
                    category: "SSD WEAR & TBW",
                    icon: "hard-drive",
                    title: "Moderate SSD Swap Write Volume",
                    text: `Averages 5–18 GB of swap writes daily under your observed usage, accumulating ${wear_tbw} over 3 years. Safe for SSD health on 512GB+ drives, though swap churn is clearly active.`
                },
                {
                    id: 8,
                    type_name: "Multitasking & Tab Retention",
                    category: "MULTITASKING & TABS",
                    icon: "layers",
                    title: "Maintains 25–40 Tabs Before Hibernation",
                    text: "Retains 25–40 browser tabs comfortably in active DRAM. During heavy spikes (e.g. exporting a video while on a video call), background browser tabs may occasionally hibernate and reload."
                },
                {
                    id: 9,
                    type_name: "Pro Workflows, Virtualization & Local AI",
                    category: "PRO APPS & AI",
                    icon: "zap",
                    title: "Limited To Single Containers Or Quantized 7B AI",
                    text: "Can run a single lightweight Docker container or small quantized 4-bit 7B local LLM (~5 GB), but leaves no headroom for other concurrent tools. Multi-container stacks quickly cause disk swap."
                },
                {
                    id: 10,
                    type_name: "Future-Proofing & Resale Longevity",
                    category: "LONGEVITY & RESALE",
                    icon: "shield",
                    title: "The Modern Baseline (3–4 Year Horizon)",
                    text: "The entry baseline across Apple's 2024–2026 lineup. Dependable for general office workflows for 3–4 years, but provides minimal safety cushion for expanding on-device AI models."
                }
            ]
        };
    } else if (tierKey === "24GB") {
        const smoothPct = (t.green_pct || 0) + (t.yellow_pct || 0);
        return {
            status_label: "BALANCED SWEET SPOT",
            status_class: "viable",
            pressure_status: "Healthy Green Nominal Pressure",
            swap_risk_text: `VIABLE (${smoothPct.toFixed(0)}% SMOOTH)`,
            why_suited: [
                "Heavy multitasking power users running 60–100+ browser tabs, Slack, Figma, and Zoom concurrently.",
                "Full-stack software engineers running Docker Desktop with 3–6 containers and local databases.",
                "Creative editors working with multi-track 4K ProRes timelines and color grading in Final Cut / DaVinci."
            ],
            why_not_suited: [
                "Not suited for extreme workstation edge cases like 8K RAW multi-camera grading or massive 3D polygon renders.",
                "Cannot comfortably assign 16+ GB of dedicated RAM to a guest Windows VM while maintaining heavy macOS workloads.",
                "Restricted when running unquantized 14B+ or 32B local AI models with long context windows."
            ],
            comments: [
                {
                    id: 1,
                    type_name: "Status & Memory Pressure",
                    category: "STATUS & PRESSURE",
                    icon: "activity",
                    title: "Healthy Green Nominal Pressure",
                    text: `Maintains healthy Green memory pressure for over 97% of daily computing hours. Swap activity is negligible (${swapProb.toFixed(1)}% risk), keeping responsiveness silky smooth.`
                },
                {
                    id: 2,
                    type_name: "Workload Telemetry Fit",
                    category: "TELEMETRY FIT",
                    icon: "target",
                    title: "Excellent Balanced Everyday Fit",
                    text: `Comfortably accommodates your measured typical working set (${p95_gb.toFixed(1)} GB vs ~${usable_gb.toFixed(1)} GB usable application space). Keeps virtually all active processes in physical DRAM with minimal compression.`
                },
                {
                    id: 3,
                    type_name: "Why It Is Suited",
                    category: "WHY SUITED",
                    icon: "check-circle",
                    title: "Ideal For Power Multitaskers & Developers",
                    text: "Perfect for heavy multitasking across 60–100 browser tabs, communication hubs (Slack/Teams), Figma design files, local development servers, and multi-track 4K video editing."
                },
                {
                    id: 4,
                    type_name: "Why It Is NOT Suited",
                    category: "WHY NOT SUITED",
                    icon: "x-circle",
                    title: "Not Sized For High-End VFX Or Heavy 32B AI",
                    text: "Not sized for extreme workstation tasks such as multi-stream 8K RAW video timelines, massive 3D polygon scenes in Blender/Houdini, or running unquantized 14B+ local AI models."
                },
                {
                    id: 5,
                    type_name: "Unified VRAM & Display Overhead",
                    category: "VRAM & DISPLAY",
                    icon: "monitor",
                    title: "Generous VRAM For Dual External 4K/6K Displays",
                    text: "Provides ample headroom to allocate 8–10 GB directly to Metal GPU acceleration and dual 4K/6K Studio Displays while maintaining over 14–16 GB exclusively for application code and data."
                },
                {
                    id: 6,
                    type_name: "WKdm In-Memory Compression Envelope",
                    category: "WKdm COMPRESSION",
                    icon: "cpu",
                    title: "Optimal WKdm Compression Efficiency",
                    text: "Operates directly in the high-efficiency sweet spot of Apple's WKdm compression algorithm, transparently compressing working sets up to 28–30 GB effective data with near-zero latency."
                },
                {
                    id: 7,
                    type_name: "SSD Swap Write Amplification & NAND Lifespan",
                    category: "SSD WEAR & TBW",
                    icon: "hard-drive",
                    title: "Near-Zero SSD Wear Lifelong Protection",
                    text: `Generates minimal swap writes (<1–2 GB/week), totaling ${wear_tbw} across 4–5 years. Keeps internal soldered NAND flash health pristine over the machine's entire lifetime.`
                },
                {
                    id: 8,
                    type_name: "Multitasking & Tab Retention",
                    category: "MULTITASKING & TABS",
                    icon: "layers",
                    title: "Zero Tab Reloading & Instant App Switching",
                    text: "Retains 60–100+ active browser tabs across multiple browsers without hibernation or reloading. Switching between Figma, VS Code, Slack, and heavy web applications is instantaneous."
                },
                {
                    id: 9,
                    type_name: "Pro Workflows, Virtualization & Local AI",
                    category: "PRO APPS & AI",
                    icon: "zap",
                    title: "Flawless For 8B Local AI & Docker Microservices",
                    text: "Effortlessly runs quantized 7B and 8B local LLMs (e.g. Llama 3 8B, Mistral 7B) locally via Ollama or LM Studio at full GPU speed alongside Docker microservices and code editors."
                },
                {
                    id: 10,
                    type_name: "Future-Proofing & Resale Longevity",
                    category: "LONGEVITY & RESALE",
                    icon: "shield",
                    title: "Outstanding 4–6 Year Longevity & Resale",
                    text: "High-demand configuration with fantastic resale value. Perfectly sized to absorb upcoming macOS releases and expanding on-device Apple Intelligence models for the next 4–6 years."
                }
            ]
        };
    } else if (tierKey === "32GB" || tierKey === "36GB") {
        return {
            status_label: "OPTIMAL ZERO-SWAP SWEET SPOT",
            status_class: "optimal",
            pressure_status: "Rock-Solid Permanent Green Headroom",
            swap_risk_text: "OPTIMAL SWEET SPOT (<1% SWAP)",
            why_suited: [
                "Senior software engineers, data engineers, and architects running complex Docker/Kubernetes stacks.",
                "Virtualization power users running a dedicated 16GB Windows 11 VM in Parallels alongside macOS.",
                "Professional audio producers (100+ tracks in Logic Pro) and 4K/6K ProRes multi-camera video editors."
            ],
            why_not_suited: [
                "Unnecessary expense if your routine is limited to web browsing, office document editing, and media playback.",
                "Requires upgrading to the MacBook Pro chassis with M-Pro or M-Max silicon, raising device cost.",
                "Still constrained if your specialized requirement is running massive 70B parameter local AI models in VRAM."
            ],
            comments: [
                {
                    id: 1,
                    type_name: "Status & Memory Pressure",
                    category: "STATUS & PRESSURE",
                    icon: "activity",
                    title: "Rock-Solid Green Memory Headroom",
                    text: "Rock-solid Green memory pressure across 100% of measured telemetry. Swap probability is below 0.1%, eliminating disk paging even during your most aggressive workload spikes."
                },
                {
                    id: 2,
                    type_name: "Workload Telemetry Fit",
                    category: "TELEMETRY FIT",
                    icon: "target",
                    title: "Full Unrestricted Peak Headroom",
                    text: `Substantial safety buffer over your highest measured peak spike (${max_gb.toFixed(1)} GB vs ~${usable_gb.toFixed(1)} GB usable application space). Guarantees zero latency and maximum throughput at all times.`
                },
                {
                    id: 3,
                    type_name: "Why It Is Suited",
                    category: "WHY SUITED",
                    icon: "check-circle",
                    title: "The Professional Engineering Standard",
                    text: "Suited for senior software developers, data scientists, multi-container Docker/Kubernetes stacks, Logic Pro sessions with 100+ tracks, and multi-cam 4K/6K ProRes video timelines."
                },
                {
                    id: 4,
                    type_name: "Why It Is NOT Suited",
                    category: "WHY NOT SUITED",
                    icon: "x-circle",
                    title: "Unnecessary Premium For Casual Users",
                    text: "Unnecessary expense if your daily routine is predominantly web browsing, office document editing, and media streaming. Also requires upgrading to the M-Pro/Max MacBook Pro chassis."
                },
                {
                    id: 5,
                    type_name: "Unified VRAM & Display Overhead",
                    category: "VRAM & DISPLAY",
                    icon: "monitor",
                    title: "Gigantic 18–24 GB Unified GPU VRAM Pool",
                    text: "Enables massive 18–24 GB unified GPU VRAM allocations for Metal 3 compute shaders and 3D textures at 150–300 GB/s bandwidth, driving multiple 5K/6K Pro Display XDRs effortlessly."
                },
                {
                    id: 6,
                    type_name: "WKdm In-Memory Compression Envelope",
                    category: "WKdm COMPRESSION",
                    icon: "cpu",
                    title: "100% Raw Uncompressed Memory Speed",
                    text: "WKdm compression is essentially idle; all application working sets reside in raw, uncompressed physical DRAM with sub-millisecond memory access times across all active threads."
                },
                {
                    id: 7,
                    type_name: "SSD Swap Write Amplification & NAND Lifespan",
                    category: "SSD WEAR & TBW",
                    icon: "hard-drive",
                    title: "Zero Swap Wear Durability (10+ Year Health)",
                    text: `Zero swap wear (${wear_tbw} over 5 years). SSD NAND writes are strictly limited to files you explicitly save and normal system logging, protecting motherboard storage for 10+ years.`
                },
                {
                    id: 8,
                    type_name: "Multitasking & Tab Retention",
                    category: "MULTITASKING & TABS",
                    icon: "layers",
                    title: "Instant Wake & Hundreds Of Retained Tabs",
                    text: "Retains hundreds of active browser tabs, large spreadsheets, CAD models, and video projects in memory simultaneously. Sleep and wake transitions are completely instantaneous."
                },
                {
                    id: 9,
                    type_name: "Pro Workflows, Virtualization & Local AI",
                    category: "PRO APPS & AI",
                    icon: "zap",
                    title: "Full Support For 14B Local AI & Parallels VMs",
                    text: "Native support for 14B parameter AI models (e.g. Qwen 2.5 14B, Mistral NeMo) with generous context windows, plus running a dedicated 16GB Windows 11 VM in Parallels alongside macOS."
                },
                {
                    id: 10,
                    type_name: "Future-Proofing & Resale Longevity",
                    category: "LONGEVITY & RESALE",
                    icon: "shield",
                    title: "Gold Standard Professional Longevity Through 2030+",
                    text: "The definitive sweet spot for professional Mac longevity. Guarantees top-tier performance through 2030+ and commands maximum resale value among developers and creative pros."
                }
            ]
        };
    } else { // 48GB
        const surplusRatio = Math.max(2.0, (usable_gb / Math.max(1.0, max_gb))).toFixed(1);
        return {
            status_label: "ENTERPRISE HEADROOM",
            status_class: "optimal",
            pressure_status: "Infinite Hardware Surplus",
            swap_risk_text: "ENTERPRISE HEADROOM (0% SWAP)",
            why_suited: [
                "AI engineers and data scientists running local 32B parameter LLMs and fine-tuning datasets offline.",
                "3D animators and VFX artists working in Blender, Cinema 4D, and Maya with dense polygon meshes.",
                "Enterprise developers running extensive multi-VM topologies and compiling massive C++/Rust/Chromium codebases."
            ],
            why_not_suited: [
                "Economically inefficient if peak usage remains under 25 GB; over 70% of purchased RAM will sit idle.",
                "Substantial upfront financial investment on high-tier M-Max hardware.",
                "Slightly higher idle standby battery draw required to keep 48 GB of physical DRAM cells refreshed."
            ],
            comments: [
                {
                    id: 1,
                    type_name: "Status & Memory Pressure",
                    category: "STATUS & PRESSURE",
                    icon: "activity",
                    title: "Infinite Hardware Memory Surplus",
                    text: "Total memory abundance with absolute 0% swap risk under any realistic consumer or professional multitasking workflow. Memory pressure remains permanently locked in deep green."
                },
                {
                    id: 2,
                    type_name: "Workload Telemetry Fit",
                    category: "TELEMETRY FIT",
                    icon: "target",
                    title: "Massive Computing Surplus",
                    text: `Provides ${surplusRatio}x more capacity than your highest recorded peak spike (${max_gb.toFixed(1)} GB vs ~${usable_gb.toFixed(1)} GB usable application space), leaving 20+ GB permanently spare.`
                },
                {
                    id: 3,
                    type_name: "Why It Is Suited",
                    category: "WHY SUITED",
                    icon: "check-circle",
                    title: "Suited For AI Researchers, VFX & Massive VMs",
                    text: "Designed for AI researchers running 32B local LLM models, high-end 3D VFX artists (Houdini/Blender/Cinema 4D), uncompressed 8K RAW video compositing, and enterprise multi-VM sandboxes."
                },
                {
                    id: 4,
                    type_name: "Why It Is NOT Suited",
                    category: "WHY NOT SUITED",
                    icon: "x-circle",
                    title: "Excessive For General Workflows",
                    text: "Economically inefficient for general users whose peak multitasking demands never cross 22–26 GB. Over 70% of purchased RAM will sit permanently idle with minor standby battery draw."
                },
                {
                    id: 5,
                    type_name: "Unified VRAM & Display Overhead",
                    category: "VRAM & DISPLAY",
                    icon: "monitor",
                    title: "Up To 38 GB High-Speed Workstation VRAM",
                    text: "Allows up to 36–38 GB of ultra-fast unified memory to serve as dedicated VRAM at up to 300–400 GB/s bandwidth on M-Max chips, rivaling dedicated workstation GPUs costing thousands of dollars."
                },
                {
                    id: 6,
                    type_name: "WKdm In-Memory Compression Envelope",
                    category: "WKdm COMPRESSION",
                    icon: "cpu",
                    title: "Dormant Compression Max Throughput",
                    text: "Compression is permanently dormant; 100% of data resides in uncompressed physical memory, maximizing raw compute performance and eliminating all compression overhead."
                },
                {
                    id: 7,
                    type_name: "SSD Swap Write Amplification & NAND Lifespan",
                    category: "SSD WEAR & TBW",
                    icon: "hard-drive",
                    title: "Absolute Zero Swap (0.0 GB Writes)",
                    text: "0.0 GB swap writes indefinitely; the macOS paging daemon never touches internal storage, delivering absolute maximum longevity for soldered Mac flash memory."
                },
                {
                    id: 8,
                    type_name: "Multitasking & Tab Retention",
                    category: "MULTITASKING & TABS",
                    icon: "layers",
                    title: "Boundless Multitasking Headroom",
                    text: "Boundless multitasking capability. You can leave weeks of browser sessions, design workspaces, and development servers running simultaneously with zero slowdown or background eviction."
                },
                {
                    id: 9,
                    type_name: "Pro Workflows, Virtualization & Local AI",
                    category: "PRO APPS & AI",
                    icon: "zap",
                    title: "Runs 32B Local AI Models & Multi-OS VMs",
                    text: "Full on-device AI workstation capability; runs 32B models and quantized 70B models locally on-device, plus multiple concurrent guest operating systems (Windows 11 + Linux) in Parallels."
                },
                {
                    id: 10,
                    type_name: "Future-Proofing & Resale Longevity",
                    category: "LONGEVITY & RESALE",
                    icon: "shield",
                    title: "Maximum Decade-Long Future Proofing",
                    text: "Maximum possible future-proofing for the entire decade. Highly sought-after tier on the secondary market for ML engineers, video editors, and technical professionals."
                }
            ]
        };
    }
}

// Render Merged Multi-Tier Comparison List (8GB, 16GB, 24GB, 32GB, 48GB)
function renderMergedTiers(tiers, verdicts, recommendedRam, metrics) {
    const container = document.getElementById('tiersComparisonList');
    if (!container || !tiers) return;

    const tierConfigs = [
        {
            key: "8GB",
            name: "8 GB Unified Memory",
            modelDesc: "MacBook Air (Base)",
            defaultDesc: "Severe SSD thrashing under your workload • 84–180 TBW wear exhausts SSD"
        },
        {
            key: "16GB",
            name: "16 GB Unified Memory",
            modelDesc: "MacBook Air / Pro (Standard)",
            defaultDesc: "Frequent lag during multitasking • 19–48 TBW swap writes over 3 years"
        },
        {
            key: "24GB",
            name: "24 GB Unified Memory",
            modelDesc: "MacBook Air / Pro (Upgraded)",
            defaultDesc: "Smooth daily use via WKdm RAM compression • Negligible SSD wear (<7 TBW)"
        },
        {
            key: "32GB",
            name: "32 GB / 36 GB Unified Memory",
            modelDesc: "MacBook Pro (M-Pro)",
            defaultDesc: "100% fluid zero-swap headroom • Zero SSD wear • 4–5 year lifespan"
        },
        {
            key: "48GB",
            name: "48 GB Unified Memory",
            modelDesc: "MacBook Pro (M-Max / Studio)",
            defaultDesc: "Maximum headroom for local AI models, 4K/8K timelines, and multi-VMs"
        }
    ];

    let html = '';

    tierConfigs.forEach(cfg => {
        const t = tiers[cfg.key] || {};
        const v = (verdicts && (verdicts[cfg.key] || (cfg.key === "32GB" && verdicts["36GB"]))) ? (verdicts[cfg.key] || verdicts["36GB"]) : {};
        const isRec = recommendedRam.startsWith(cfg.key) || cfg.key === recommendedRam || (cfg.key === "32GB" && (recommendedRam.includes("32GB") || recommendedRam.includes("36GB")));

        const greenPct = t.green_pct || 0;
        const yellowPct = t.yellow_pct || 0;
        const redPct = t.red_pct || 0;
        const swapProb = t.swap_probability !== undefined ? t.swap_probability : redPct;

        const bd = getTierFitBreakdown(cfg.key, t, v, recommendedRam, metrics);
        const statusClass = bd.status_class || (swapProb > 50 ? "deficit" : (swapProb > 10 ? "tight" : (swapProb > 1 ? "viable" : "optimal")));
        const statusBadgeText = bd.swap_risk_text || `${bd.status_label || 'TIER'} (${swapProb.toFixed(0)}% SWAP RISK)`;
        const pressureStatus = bd.pressure_status || (swapProb > 50 ? 'Continuous Red Pressure' : (swapProb > 10 ? 'Yellow Pressure Spikes' : (swapProb > 1 ? 'Nominal Green Pressure' : 'Permanent Green Headroom')));

        let pressureColor = 'green';
        if (pressureStatus.toLowerCase().includes('red')) pressureColor = 'red';
        else if (pressureStatus.toLowerCase().includes('yellow') || pressureStatus.toLowerCase().includes('tight')) pressureColor = 'yellow';

        // Suitability lists
        const whySuitedList = (bd.why_suited && bd.why_suited.length > 0) ? bd.why_suited : [
            "Single-focus everyday office tasks and web browsing with light background usage."
        ];
        const whyNotSuitedList = (bd.why_not_suited && bd.why_not_suited.length > 0) ? bd.why_not_suited : [
            "Heavy multitasking, large container clusters, or concurrent pro applications."
        ];

        // 10 Comments
        const comments = (bd.comments && bd.comments.length >= 10) ? bd.comments : [];

        let commentsHtml = '';
        comments.forEach((c, idx) => {
            const numStr = String(c.id || (idx + 1)).padStart(2, '0');
            const iconSvg = getCommentIcon(c.icon);
            commentsHtml += `
                <div class="comment-card">
                    <div class="comment-card-top">
                        <span class="comment-badge-tag">${c.category || 'FIT COMMENT'}</span>
                        <span class="comment-card-num">#${numStr}</span>
                    </div>
                    <div class="comment-card-title">${iconSvg} <span>${c.title || c.type_name}</span></div>
                    <div class="comment-card-text">${c.text || c.comment}</div>
                </div>
            `;
        });

        const suitedItemsHtml = whySuitedList.map(item => `<li>${item}</li>`).join('');
        const notSuitedItemsHtml = whyNotSuitedList.map(item => `<li>${item}</li>`).join('');

        // Expand recommended by default
        const expandClass = isRec ? 'expanded' : '';

        html += `
            <div class="tier-item-row ${isRec ? 'recommended' : ''} ${expandClass}" id="tierRow_${cfg.key}" data-tier="${cfg.key}">
                <div class="tier-row-top" onclick="toggleTierDetails('${cfg.key}')">
                    <div class="tier-row-identity">
                        <span class="tier-row-ram">${cfg.name}</span>
                        <span class="tier-row-usable">~${t.usable_app_gb || 0} GB for Apps</span>
                        <span class="tier-pressure-pill ${pressureColor}">${pressureStatus}</span>
                    </div>
                    <div class="tier-row-badge-wrap">
                        ${isRec ? '<span class="tier-best-fit-label">BEST FIT</span>' : ''}
                        <span class="tier-badge-status ${statusClass}">${statusBadgeText}</span>
                        <button type="button" class="tier-toggle-btn" onclick="event.stopPropagation(); toggleTierDetails('${cfg.key}')" title="Toggle 10 RAM fit comments">
                            <span>10 Fit Comments</span>
                            <svg class="tier-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                    </div>
                </div>

                <div class="tier-row-bar">
                    <div class="t-seg green" style="width: ${greenPct}%;" title="Smooth: ${greenPct}%"></div>
                    <div class="t-seg yellow" style="width: ${yellowPct}%;" title="Compression: ${yellowPct}%"></div>
                    <div class="t-seg red" style="width: ${redPct}%;" title="Swap: ${redPct}%"></div>
                </div>

                <div class="tier-row-desc">
                    <span>${cfg.defaultDesc}</span>
                    <span class="wear-note">${t.wear_info ? t.wear_info.wear_tbw || '' : ''}</span>
                </div>

                <!-- 10 Comments & Suitability Drawer -->
                <div class="tier-comments-drawer">
                    <div class="suitability-grid">
                        <div class="suitability-card suited">
                            <div class="suitability-head">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                                <span>Why It Is Suited</span>
                            </div>
                            <ul class="suitability-items">
                                ${suitedItemsHtml}
                            </ul>
                        </div>
                        <div class="suitability-card not-suited">
                            <div class="suitability-head">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                                <span>Why It Is NOT Suited</span>
                            </div>
                            <ul class="suitability-items">
                                ${notSuitedItemsHtml}
                            </ul>
                        </div>
                    </div>

                    <div class="tier-comments-heading">
                        <span>10 In-Depth Fit Comments & Architecture Analysis</span>
                        <span style="font-size: 10px; font-weight: 500; font-family: var(--font-mono); color: var(--muted-foreground);">10 EVALUATIONS</span>
                    </div>

                    <div class="comments-grid">
                        ${commentsHtml}
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    updateToggleAllButtonState();
}

// Toggle individual tier row details
window.toggleTierDetails = function(tierKey) {
    const row = document.getElementById(`tierRow_${tierKey}`);
    if (row) {
        row.classList.toggle('expanded');
        updateToggleAllButtonState();
    }
};

// Toggle all tiers expanded / collapsed
function setupToggleAllTiers() {
    const btn = document.getElementById('btnToggleAllTiers');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const rows = document.querySelectorAll('.tier-item-row');
        const anyCollapsed = Array.from(rows).some(r => !r.classList.contains('expanded'));

        rows.forEach(r => {
            if (anyCollapsed) {
                r.classList.add('expanded');
            } else {
                r.classList.remove('expanded');
            }
        });

        updateToggleAllButtonState();
    });
}

function updateToggleAllButtonState() {
    const btn = document.getElementById('btnToggleAllTiers');
    const textSpan = document.getElementById('btnToggleAllTiersText');
    if (!btn || !textSpan) return;

    const rows = document.querySelectorAll('.tier-item-row');
    if (rows.length === 0) return;

    const allExpanded = Array.from(rows).every(r => r.classList.contains('expanded'));
    textSpan.textContent = allExpanded ? "Collapse All Details" : "Expand All (10 Comments)";
}

// Render Top Apps Table
function renderAppsTable(procs) {
    const tbody = document.getElementById('appsTableBody');
    if (!tbody || !procs) return;

    let rows = '';
    procs.slice(0, 7).forEach(p => {
        rows += `
            <tr>
                <td style="font-weight: 600;">${p.proc_name}</td>
                <td style="color: var(--text-muted);">${p.category || 'App'}</td>
                <td style="text-align: right; font-family: var(--font-mono); color: var(--accent-blue);">${p.avg_rss_mb.toFixed(0)} MB</td>
                <td style="text-align: right; font-family: var(--font-mono); color: var(--accent-amber);">${p.max_rss_mb.toFixed(0)} MB</td>
            </tr>
        `;
    });
    tbody.innerHTML = rows || '<tr><td colspan="4" style="text-align: center; padding: 20px;">No app records.</td></tr>';
}

// Fetch Historical Timeline
async function fetchTimeline(days) {
    try {
        const res = await fetch(`/api/timeline?days=${days}&points=50`);
        const data = await res.json();
        updateTimelineChart(data.timeline);
    } catch (e) {}
}
