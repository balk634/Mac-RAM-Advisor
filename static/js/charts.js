/**
 * Chart.js routines with dynamic Light & Dark mode adaptation.
 * Visualizes memory demand against 8GB, 16GB, 24GB, 32GB, and 48GB hardware ceilings.
 */

window.timelineChart = null;

function initTimelineChart() {
    const ctx = document.getElementById('timelineCanvas');
    if (!ctx) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? '#1e222e' : '#f1f5f9';
    const textColor = isDark ? '#64748b' : '#94a3b8';

    window.timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Mac Demand (GB)',
                    data: [],
                    borderColor: '#4338ca',
                    backgroundColor: 'rgba(67, 56, 202, 0.08)',
                    fill: true,
                    tension: 0.25,
                    borderWidth: 2.2,
                    pointRadius: 1
                },
                {
                    label: '8GB Ceiling',
                    data: [],
                    borderColor: '#dc2626',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: '16GB Ceiling',
                    data: [],
                    borderColor: '#d97706',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: '24GB Ceiling',
                    data: [],
                    borderColor: '#059669',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: '32GB Ceiling',
                    data: [],
                    borderColor: '#4338ca',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                },
                {
                    label: '48GB Ceiling',
                    data: [],
                    borderColor: '#2563eb',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { maxTicksLimit: 8, color: textColor }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: v => v + ' GB' },
                    suggestedMin: 6,
                    suggestedMax: 50
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1a1d26' : '#ffffff',
                    titleColor: isDark ? '#ffffff' : '#0f172a',
                    bodyColor: isDark ? '#cbd5e1' : '#475569',
                    borderColor: isDark ? '#282d3c' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    usePointStyle: true
                }
            }
        }
    });
}

function updateTimelineChart(timeline) {
    if (!window.timelineChart || !timeline || timeline.length === 0) return;

    const labels = timeline.map(t => {
        const parts = t.datetime_str.split(' ');
        if (parts.length > 1) {
            const dateParts = parts[0].split('-');
            return `${dateParts[1]}/${dateParts[2]} ${parts[1].substring(0, 5)}`;
        }
        return t.datetime_str;
    });

    window.timelineChart.data.labels = labels;
    window.timelineChart.data.datasets[0].data = timeline.map(t => (t.mac_equivalent_mb / 1024).toFixed(2));
    window.timelineChart.data.datasets[1].data = timeline.map(() => 8.0);
    window.timelineChart.data.datasets[2].data = timeline.map(() => 16.0);
    window.timelineChart.data.datasets[3].data = timeline.map(() => 24.0);
    window.timelineChart.data.datasets[4].data = timeline.map(() => 32.0);
    window.timelineChart.data.datasets[5].data = timeline.map(() => 48.0);
    window.timelineChart.update();
}

function updateChartTheme(theme) {
    if (!window.timelineChart) return;
    const isDark = theme === 'dark';
    const gridColor = isDark ? '#1e222e' : '#f1f5f9';
    const textColor = isDark ? '#64748b' : '#94a3b8';

    window.timelineChart.options.scales.x.grid.color = gridColor;
    window.timelineChart.options.scales.x.ticks.color = textColor;
    window.timelineChart.options.scales.y.grid.color = gridColor;
    window.timelineChart.options.scales.y.ticks.color = textColor;

    window.timelineChart.options.plugins.tooltip.backgroundColor = isDark ? '#1a1d26' : '#ffffff';
    window.timelineChart.options.plugins.tooltip.titleColor = isDark ? '#ffffff' : '#0f172a';
    window.timelineChart.options.plugins.tooltip.bodyColor = isDark ? '#cbd5e1' : '#475569';
    window.timelineChart.options.plugins.tooltip.borderColor = isDark ? '#282d3c' : '#e2e8f0';

    window.timelineChart.update('none');
}
