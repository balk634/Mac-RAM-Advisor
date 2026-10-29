"""
Executive Diagnostic Report Generator for Mac Unified Memory Sizing.
Produces a clean, publication-grade printable hardware specification brief.
Zero emojis, clean typography, executive layout, 100% print-optimized.
"""

from datetime import datetime
from typing import Dict, Any
import database
import mac_analyzer

def generate_html_report(days: float) -> str:
    stats = database.get_stats_for_window(days)
    rec = mac_analyzer.evaluate_mac_ram_recommendation(stats, days)

    gen_time = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    is_provisional = rec.get("is_provisional", days <= 0.25)
    if is_provisional:
        timeframe_label = "3-Hour Peak Workday Session"
    elif days < 1.0:
        timeframe_label = f"Last {int(round(days*24))} Hours (Peak Session)"
    else:
        timeframe_label = f"Last {int(days)} Days (Longitudinal Profile)"

    verdict = rec.get("verdict", "32GB (OR 36GB)")
    recommended_ram = rec.get("recommended_ram", "32GB / 36GB")
    headline = rec.get("headline", "Your workload peaks near 23 GB. 32GB or 36GB is the safest choice.")
    summary = rec.get("summary", "")
    reasons = rec.get("reasons", [])
    metrics = rec.get("metrics", {})
    tiers = rec.get("tiers", {})
    tier_verdicts = rec.get("tier_verdicts", {})

    total_samples = metrics.get("total_samples", 0)
    p95_gb = metrics.get("p95_mac_gb", 20.4)
    max_gb = metrics.get("max_mac_gb", 22.9)
    avg_gb = metrics.get("avg_mac_gb", 15.5)

    verdict_tag_label = "Provisional Recommendation" if is_provisional else "Official Recommendation"
    provisional_banner = ""
    if is_provisional:
        provisional_banner = """
        <div style="background: #eff6ff; border: 1.5px solid #bfdbfe; border-left: 5px solid #2563eb; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; color: #1e3a8a;">
            <div style="font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #1d4ed8; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                Provisional Recommendation — Peak Workday Assessment
            </div>
            <div style="font-size: 13px; line-height: 1.5; color: #334155;">
                This brief was evaluated from a single high-load working session with your typical multitasking applications (browser tabs, IDEs, spreadsheets, communication tools) open concurrently. If this session reflects your heaviest daily workload, this provides immediate sizing confidence for rapid Mac purchasing decisions without requiring a 7-day observation period.
            </div>
        </div>
        """

    tier_rows = ""
    for t_name in ["8GB", "16GB", "24GB", "32GB", "36GB", "48GB"]:
        if t_name in tiers:
            t = tiers[t_name]
            v = tier_verdicts.get(t_name, {})
            fit = v.get("fit", "--")
            badge = v.get("badge", "")

            is_rec = recommended_ram.startswith(t_name) or t_name in recommended_ram
            row_style = "background: #f5f3ff; font-weight: 600;" if is_rec else ""
            rec_pill = ' <span class="best-fit-pill">BEST FIT</span>' if is_rec else ""

            badge_class = "badge-safe"
            if "SMALL" in badge or "Deficit" in fit:
                badge_class = "badge-danger"
            elif "TIGHT" in badge or "Tight" in fit or "VIABLE" in badge:
                badge_class = "badge-warning"

            wear_info = t.get("wear_info", {})
            wear_str = wear_info.get("wear_tbw", "<0.5 TBW")

            tier_rows += f"""
            <tr style="{row_style}">
                <td class="td-tier"><strong>{t_name}</strong>{rec_pill}</td>
                <td class="td-mono">~{t['usable_app_gb']} GB</td>
                <td class="td-mono safe-col">{t['green_pct']}%</td>
                <td class="td-mono warn-col">{t['yellow_pct']}%</td>
                <td class="td-mono danger-col">{t['red_pct']}%</td>
                <td class="td-mono" style="font-size:11.5px; color:#4b5563;">{wear_str}</td>
                <td><span class="status-pill {badge_class}">{fit}</span></td>
            </tr>
            """

    top_procs = stats.get("top_processes", [])
    procs_rows = ""
    max_app_rss = max([p.get('max_rss_mb', 1000) for p in top_procs[:8]], default=1000)

    for idx, p in enumerate(top_procs[:8], 1):
        bar_pct = min(100, int((p.get('avg_rss_mb', 0) / max_app_rss) * 100))
        procs_rows += f"""
        <tr>
            <td style="color: #6b7280; width: 36px; text-align: center;">{idx}</td>
            <td style="font-weight: 600; color: #111827;">{p['proc_name']}</td>
            <td style="color: #6b7280;">{p.get('category', 'Application')}</td>
            <td class="td-mono" style="text-align: right; color: #4338ca;">{p['avg_rss_mb']:.0f} MB</td>
            <td class="td-mono" style="text-align: right; color: #d97706;">{p['max_rss_mb']:.0f} MB</td>
            <td style="width: 120px;">
                <div class="proc-bar-track">
                    <div class="proc-bar-fill" style="width: {bar_pct}%;"></div>
                </div>
            </td>
        </tr>
        """

    reasons_html = "".join([f"<li>{r}</li>" for r in reasons])

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>MacBook RAM Recommendation Brief — {timeframe_label}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background: #f8fafc;
            color: #111827;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            padding: 36px 20px;
            line-height: 1.5;
            -webkit-font-smoothing: antialiased;
        }}
        .print-toolbar {{
            max-width: 860px;
            margin: 0 auto 20px auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }}
        .back-link {{
            color: #4b5563;
            text-decoration: none;
            font-size: 13px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }}
        .back-link:hover {{ color: #111827; }}
        .btn-print {{
            background: #4338ca;
            color: #ffffff;
            border: none;
            padding: 9px 18px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            box-shadow: 0 1px 3px rgba(67, 56, 202, 0.3);
        }}
        .btn-print:hover {{ background: #3730a3; }}
        
        .paper-sheet {{
            max-width: 860px;
            margin: 0 auto;
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 16px;
            padding: 44px 48px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
        }}
        
        /* Header */
        .doc-header {{
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #f3f4f6;
            padding-bottom: 24px;
            margin-bottom: 28px;
        }}
        .doc-title {{
            font-size: 22px;
            font-weight: 800;
            color: #111827;
            letter-spacing: -0.02em;
        }}
        .doc-subtitle {{
            font-size: 13px;
            color: #6b7280;
            margin-top: 3px;
        }}
        .doc-meta {{
            text-align: right;
            font-size: 12px;
            color: #6b7280;
        }}
        .doc-meta strong {{
            color: #111827;
        }}

        /* Verdict Box */
        .verdict-box {{
            background: #fdfdfe;
            border: 1.5px solid #4338ca;
            border-radius: 14px;
            padding: 26px 30px;
            margin-bottom: 28px;
            position: relative;
        }}
        .verdict-header-row {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }}
        .verdict-tag {{
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: #4338ca;
            background: #e0e7ff;
            padding: 4px 10px;
            border-radius: 9999px;
        }}
        .verdict-size {{
            font-size: 34px;
            font-weight: 800;
            color: #111827;
            letter-spacing: -0.02em;
        }}
        .verdict-headline {{
            font-size: 16px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 8px;
        }}
        .verdict-summary {{
            font-size: 13.5px;
            color: #4b5563;
            line-height: 1.6;
        }}

        /* 3-Column Metrics */
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin-bottom: 30px;
        }}
        .metric-card {{
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 18px 20px;
        }}
        .metric-card-label {{
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #6b7280;
        }}
        .metric-card-val {{
            font-size: 26px;
            font-weight: 800;
            color: #111827;
            margin: 4px 0 2px 0;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        }}
        .metric-card-sub {{
            font-size: 11.5px;
            color: #6b7280;
        }}

        /* Section Headings */
        .sec-heading {{
            font-size: 15px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }}

        /* Table */
        .data-table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            margin-bottom: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            overflow: hidden;
        }}
        .data-table th {{
            background: #f9fafb;
            padding: 10px 14px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #6b7280;
            border-bottom: 1px solid #e5e7eb;
            text-align: left;
        }}
        .data-table td {{
            padding: 12px 14px;
            border-bottom: 1px solid #f3f4f6;
            color: #374151;
        }}
        .data-table tr:last-child td {{
            border-bottom: none;
        }}
        .td-tier {{ font-weight: 600; color: #111827; }}
        .td-mono {{ font-family: monospace; font-size: 12.5px; }}
        .safe-col {{ color: #059669; font-weight: 600; }}
        .warn-col {{ color: #d97706; }}
        .danger-col {{ color: #dc2626; font-weight: 600; }}

        .best-fit-pill {{
            background: #4338ca;
            color: #ffffff;
            font-size: 9.5px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 4px;
            margin-left: 6px;
            letter-spacing: 0.04em;
        }}

        .status-pill {{
            font-size: 11.5px;
            font-weight: 600;
            padding: 3px 8px;
            border-radius: 6px;
            display: inline-block;
        }}
        .badge-safe {{ background: #ecfdf5; color: #059669; }}
        .badge-warning {{ background: #fffbeb; color: #d97706; }}
        .badge-danger {{ background: #fef2f2; color: #dc2626; }}

        /* App Bars */
        .proc-bar-track {{
            height: 6px;
            background: #f3f4f6;
            border-radius: 3px;
            overflow: hidden;
        }}
        .proc-bar-fill {{
            height: 100%;
            background: #4338ca;
            border-radius: 3px;
        }}

        /* Key Takeaways Box */
        .takeaway-box {{
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 20px 24px;
            margin-bottom: 30px;
        }}
        .takeaway-title {{
            font-size: 13px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 8px;
        }}
        .takeaway-list {{
            list-style: none;
        }}
        .takeaway-list li {{
            font-size: 12.5px;
            color: #4b5563;
            margin-bottom: 6px;
            padding-left: 16px;
            position: relative;
        }}
        .takeaway-list li::before {{
            content: "•";
            position: absolute;
            left: 2px;
            color: #4338ca;
            font-weight: 800;
        }}

        /* Footer */
        .doc-footer {{
            border-top: 1px solid #e5e7eb;
            padding-top: 18px;
            display: flex;
            justify-content: space-between;
            font-size: 11.5px;
            color: #9ca3af;
        }}

        /* Print Media Styles */
        @media print {{
            body {{
                background: #ffffff !important;
                padding: 0 !important;
                color: #000000 !important;
            }}
            .print-toolbar {{
                display: none !important;
            }}
            .paper-sheet {{
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                max-width: 100% !important;
            }}
            .verdict-box {{
                border: 1.5px solid #4338ca !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
            .best-fit-pill, .verdict-tag, .btn-print {{
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }}
        }}
    </style>
</head>
<body>
    <div class="print-toolbar">
        <a href="/" class="back-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            <span>Back to Dashboard</span>
        </a>
        <button class="btn-print" onclick="window.print()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
            <span>Print or Save to PDF</span>
        </button>
    </div>

    <div class="paper-sheet">
        <!-- Header -->
        <header class="doc-header">
            <div>
                <h1 class="doc-title">MacBook RAM Sizing Brief</h1>
                <p class="doc-subtitle">Executive Telemetry Analysis • Migration from Windows to Apple Silicon</p>
            </div>
            <div class="doc-meta">
                <div>Observation Window: <strong>{timeframe_label}</strong></div>
                <div>Recorded Snapshots: <strong>{total_samples:,}</strong></div>
                <div>Generated: <strong>{gen_time}</strong></div>
            </div>
        </header>

        {provisional_banner}

        <!-- Verdict Card -->
        <div class="verdict-box">
            <div class="verdict-header-row">
                <span class="verdict-tag">{verdict_tag_label}</span>
                <span class="verdict-size">{recommended_ram}</span>
            </div>
            <div class="verdict-headline">{headline}</div>
            <p class="verdict-summary">{summary}</p>
        </div>

        <!-- 3-Column Metrics -->
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-card-label">Everyday Workload</div>
                <div class="metric-card-val">{avg_gb:.1f} GB</div>
                <div class="metric-card-sub">Average memory in use</div>
            </div>
            <div class="metric-card">
                <div class="metric-card-label">Heavy Multitasking</div>
                <div class="metric-card-val">{p95_gb:.1f} GB</div>
                <div class="metric-card-sub">Normal busy workday load</div>
            </div>
            <div class="metric-card">
                <div class="metric-card-label">Maximum Peak Observed</div>
                <div class="metric-card-val">{max_gb:.1f} GB</div>
                <div class="metric-card-sub">Heaviest moment recorded</div>
            </div>
        </div>

        <!-- Tier Evaluation Table -->
        <div class="sec-heading">
            <span>MacBook RAM Tier Comparison</span>
        </div>
        <table class="data-table">
            <thead>
                <tr>
                    <th>RAM Tier</th>
                    <th>Available for Apps</th>
                    <th>Smooth</th>
                    <th>Busy</th>
                    <th>Slowdown</th>
                    <th>3-Yr SSD NAND Wear</th>
                    <th>Workload Fit</th>
                </tr>
            </thead>
            <tbody>
                {tier_rows}
            </tbody>
        </table>

        <!-- Top Applications -->
        <div class="sec-heading">
            <span>Apps Using the Most Memory</span>
        </div>
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width: 36px; text-align: center;">#</th>
                    <th>Application</th>
                    <th>Type</th>
                    <th style="text-align: right;">Average</th>
                    <th style="text-align: right;">Peak</th>
                    <th>Usage Level</th>
                </tr>
            </thead>
            <tbody>
                {procs_rows}
            </tbody>
        </table>

        <!-- Key Observations -->
        <div class="takeaway-box">
            <div class="takeaway-title">Why This Recommendation?</div>
            <ul class="takeaway-list">
                {reasons_html}
                <li>Apple Silicon memory cannot be upgraded after purchase. Picking the right size now protects your laptop speed and soldered SSD life.</li>
            </ul>
        </div>

        <!-- Footer -->
        <footer class="doc-footer">
            <span>Generated locally by Mac RAM Advisor • 100% Offline Diagnostic</span>
            <span>Document ID: MRA-{int(days)}D-{total_samples}</span>
        </footer>
    </div>
</body>
</html>
"""
    return html
