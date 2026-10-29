"""
Historical Data Simulator for Mac RAM Advisor.
Generates realistic multi-day system usage based on the user's actual installed and running apps,
allowing instant preview of 7-day, 15-day, and 30-day diagnostic reports.
"""

import time
import random
from datetime import datetime, timedelta
from typing import List, Dict, Any

import database
import collector
from mac_analyzer import calculate_mac_equivalent_demand

def generate_simulated_history(days: int = 7, clear_existing: bool = False):
    """
    Synthesizes realistic historical telemetry over N days, reflecting typical diurnal
    patterns (morning startup, afternoon peak multitasking, evening relaxation/media, night idle).
    """
    conn = database.get_db_connection()
    cursor = conn.cursor()

    if clear_existing:
        cursor.execute("DELETE FROM process_snapshots")
        cursor.execute("DELETE FROM samples")
        conn.commit()

    # Base memory metrics derived from the user's actual current system
    cur_sample = collector.collector.sample_now()
    if not cur_sample:
        cur_sample = {
            "phys_total_mb": 24576.0,
            "phys_used_mb": 13500.0,
            "commit_total_mb": 16500.0,
            "commit_limit_mb": 30000.0,
        }

    total_phys_mb = cur_sample["phys_total_mb"]
    cur_used_mb = cur_sample["phys_used_mb"]
    cur_commit_mb = cur_sample["commit_total_mb"]

    # Active top processes currently running
    current_procs = collector.collector._get_top_processes(limit=10)
    if not current_procs:
        current_procs = [
            {"name": "chrome.exe", "category": "Web Browser", "rss_mb": 5800.0, "vms_mb": 6100.0, "count": 28},
            {"name": "node.exe", "category": "Development & Runtime", "rss_mb": 750.0, "vms_mb": 900.0, "count": 4},
            {"name": "Antigravity.exe", "category": "AI Assistant & IDE", "rss_mb": 850.0, "vms_mb": 600.0, "count": 6},
            {"name": "msedge.exe", "category": "Web Browser", "rss_mb": 680.0, "vms_mb": 400.0, "count": 8},
            {"name": "OpenWhispr.exe", "category": "AI & Audio Processing", "rss_mb": 510.0, "vms_mb": 350.0, "count": 4},
            {"name": "svchost.exe", "category": "Windows System Services", "rss_mb": 1600.0, "vms_mb": 500.0, "count": 80},
        ]

    now = time.time()
    start_ts = now - (days * 86400)

    # We generate a sample every 15 minutes (96 samples/day) to give smooth multi-day resolution
    sample_interval = 900  # 15 minutes in seconds
    num_samples = int((days * 86400) / sample_interval)

    sample_batch = []
    proc_batch = []

    for i in range(num_samples):
        ts = start_ts + (i * sample_interval)
        dt = datetime.fromtimestamp(ts)
        hour = dt.hour
        is_weekend = dt.weekday() >= 5

        # Diurnal multiplier: Work hours (9 AM - 6 PM) have higher load
        if 9 <= hour <= 18:
            # Active working hours
            load_factor = random.uniform(0.95, 1.25)
            is_active = 1
            fg_app = random.choice(["chrome.exe", "code.exe", "msedge.exe", "Antigravity.exe"])
        elif 19 <= hour <= 23:
            # Evening media / browsing
            load_factor = random.uniform(0.75, 1.05)
            is_active = 1
            fg_app = random.choice(["chrome.exe", "spotify.exe", "discord.exe"])
        else:
            # Late night / idle
            load_factor = random.uniform(0.50, 0.70)
            is_active = 0
            fg_app = "Desktop / Background"

        # Occasional heavy multi-tasking spike (e.g. video rendering, lots of tabs)
        if random.random() < 0.08 and is_active:
            load_factor *= 1.35

        sim_used_mb = min(total_phys_mb * 0.92, max(6000.0, cur_used_mb * load_factor))
        sim_avail_mb = total_phys_mb - sim_used_mb
        sim_percent = round((sim_used_mb / total_phys_mb) * 100, 1)

        sim_commit_mb = min(cur_sample["commit_limit_mb"] * 0.85, max(8000.0, cur_commit_mb * load_factor))
        sim_commit_pct = round((sim_commit_mb / cur_sample["commit_limit_mb"]) * 100, 1)

        sim_gpu_mb = random.uniform(400.0, 1800.0) if is_active else 200.0

        mac_mb, press_16, press_24 = calculate_mac_equivalent_demand(
            phys_used_mb=sim_used_mb,
            commit_total_mb=sim_commit_mb,
            gpu_dedicated_mb=sim_gpu_mb,
            gpu_shared_mb=0.0
        )

        sample_row = (
            ts,
            dt.strftime("%Y-%m-%d %H:%M:%S"),
            round(total_phys_mb, 1),
            round(sim_used_mb, 1),
            round(sim_avail_mb, 1),
            sim_percent,
            round(sim_commit_mb, 1),
            round(cur_sample["commit_limit_mb"], 1),
            sim_commit_pct,
            0.0,  # swap
            0.0,  # pages/sec
            0.0,  # page faults
            round(sim_gpu_mb, 1),
            0.0,
            round(mac_mb, 1),
            press_16,
            press_24,
            fg_app,
            is_active
        )
        sample_batch.append(sample_row)

    # Insert samples in batches
    cursor.executemany("""
    INSERT INTO samples (
        timestamp, datetime_str, phys_total_mb, phys_used_mb, phys_avail_mb, phys_percent,
        commit_total_mb, commit_limit_mb, commit_percent, swap_used_mb,
        pages_per_sec, page_faults_per_sec, gpu_dedicated_mb, gpu_shared_mb,
        mac_equivalent_mb, pressure_16gb, pressure_24gb, foreground_app, is_user_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, sample_batch)

    # Fetch inserted sample IDs for process snapshot generation
    cursor.execute("SELECT id, timestamp FROM samples WHERE timestamp >= ? ORDER BY id ASC", (start_ts,))
    saved_samples = cursor.fetchall()

    for sid, sts in saved_samples:
        # Every 4th sample, attach process breakdown
        if sid % 4 == 0:
            for p in current_procs:
                var = random.uniform(0.85, 1.2)
                proc_batch.append((
                    sid,
                    sts,
                    p["name"],
                    p.get("category", "Other"),
                    p.get("count", 1),
                    round(p["rss_mb"] * var, 1),
                    round(p.get("vms_mb", 0) * var, 1)
                ))

    if proc_batch:
        cursor.executemany("""
        INSERT INTO process_snapshots (
            sample_id, timestamp, proc_name, category, instance_count, rss_mb, vms_mb
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, proc_batch)

    conn.commit()
    conn.close()
    return len(sample_batch)

def clear_all_data():
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM process_snapshots")
    cursor.execute("DELETE FROM samples")
    conn.commit()
    conn.close()

if __name__ == "__main__":
    count = generate_simulated_history(days=7, clear_existing=False)
    print(f"Generated {count} realistic simulation samples over 7 days.")
