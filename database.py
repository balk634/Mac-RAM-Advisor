"""
Database management for Mac RAM Advisor.
Uses SQLite with WAL mode for high-performance, non-blocking metrics logging.
"""

import sqlite3
import os
import time
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import sys

def get_db_file_path() -> str:
    app_dir = os.path.dirname(sys.executable) if getattr(sys, 'frozen', False) else os.path.dirname(os.path.abspath(__file__))
    local_db = os.path.join(app_dir, "ram_advisor.db")
    try:
        test_file = os.path.join(app_dir, ".write_test")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return local_db
    except Exception:
        appdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        fallback_dir = os.path.join(appdata, "MacRAMAdvisor")
        os.makedirs(fallback_dir, exist_ok=True)
        return os.path.join(fallback_dir, "ram_advisor.db")

DB_FILE = get_db_file_path()

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    # Enable WAL mode for smooth concurrent reads and writes
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Main samples table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp REAL NOT NULL,
        datetime_str TEXT NOT NULL,
        phys_total_mb REAL NOT NULL,
        phys_used_mb REAL NOT NULL,
        phys_avail_mb REAL NOT NULL,
        phys_percent REAL NOT NULL,
        commit_total_mb REAL NOT NULL,
        commit_limit_mb REAL NOT NULL,
        commit_percent REAL NOT NULL,
        swap_used_mb REAL DEFAULT 0,
        pages_per_sec REAL DEFAULT 0,
        page_faults_per_sec REAL DEFAULT 0,
        gpu_dedicated_mb REAL DEFAULT 0,
        gpu_shared_mb REAL DEFAULT 0,
        mac_equivalent_mb REAL NOT NULL,
        pressure_16gb TEXT NOT NULL,
        pressure_24gb TEXT NOT NULL,
        foreground_app TEXT,
        is_user_active INTEGER DEFAULT 1
    );
    """)

    # Indexes on samples for high-speed date range querying
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_samples_timestamp ON samples(timestamp);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_samples_mac_equiv ON samples(mac_equivalent_mb);")

    # 2. Top processes snapshot table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS process_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sample_id INTEGER NOT NULL,
        timestamp REAL NOT NULL,
        proc_name TEXT NOT NULL,
        category TEXT NOT NULL,
        instance_count INTEGER NOT NULL,
        rss_mb REAL NOT NULL,
        vms_mb REAL NOT NULL,
        FOREIGN KEY (sample_id) REFERENCES samples (id) ON DELETE CASCADE
    );
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_proc_sample_id ON process_snapshots(sample_id);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_proc_name ON process_snapshots(proc_name);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_proc_timestamp ON process_snapshots(timestamp);")

    # 3. App metadata / settings
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at REAL NOT NULL
    );
    """)

    # Seed default settings if not exists
    default_settings = {
        "sample_interval_sec": "10",
        "idle_interval_sec": "30",
        "monitoring_active": "true",
        "target_mode": "peak_3h",
        "auto_target_enabled": "false",
        "started_at": str(time.time()),
        "installed_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    for k, v in default_settings.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                       (k, v, time.time()))

    conn.commit()
    conn.close()

def save_sample(sample_data: Dict[str, Any], top_processes: List[Dict[str, Any]]) -> int:
    """Inserts a single metric sample and its top processes."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO samples (
            timestamp, datetime_str, phys_total_mb, phys_used_mb, phys_avail_mb, phys_percent,
            commit_total_mb, commit_limit_mb, commit_percent, swap_used_mb,
            pages_per_sec, page_faults_per_sec, gpu_dedicated_mb, gpu_shared_mb,
            mac_equivalent_mb, pressure_16gb, pressure_24gb, foreground_app, is_user_active
        ) VALUES (
            :timestamp, :datetime_str, :phys_total_mb, :phys_used_mb, :phys_avail_mb, :phys_percent,
            :commit_total_mb, :commit_limit_mb, :commit_percent, :swap_used_mb,
            :pages_per_sec, :page_faults_per_sec, :gpu_dedicated_mb, :gpu_shared_mb,
            :mac_equivalent_mb, :pressure_16gb, :pressure_24gb, :foreground_app, :is_user_active
        )
        """, sample_data)
        
        sample_id = cursor.lastrowid

        if top_processes:
            proc_rows = [
                (
                    sample_id,
                    sample_data["timestamp"],
                    p["name"],
                    p.get("category", "Other"),
                    p.get("count", 1),
                    p["rss_mb"],
                    p.get("vms_mb", 0)
                )
                for p in top_processes
            ]
            cursor.executemany("""
            INSERT INTO process_snapshots (
                sample_id, timestamp, proc_name, category, instance_count, rss_mb, vms_mb
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, proc_rows)

        conn.commit()
        return sample_id
    finally:
        conn.close()

def get_recent_samples(limit: int = 60) -> List[Dict[str, Any]]:
    """Retrieves recent samples for real-time live graphs."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT * FROM samples ORDER BY timestamp DESC LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]

def get_stats_for_window(days: float) -> Dict[str, Any]:
    """Retrieves statistics aggregated across a timeframe (e.g. 3 hours, 24 hours, 7, 15, 30 days)."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT MAX(timestamp) FROM samples")
    max_row = cursor.fetchone()
    latest_db_ts = max_row[0] if (max_row and max_row[0]) else time.time()
    cutoff = max(0.0, latest_db_ts - (days * 86400.0))

    cursor.execute("""
    SELECT 
        COUNT(*) as total_samples,
        MIN(timestamp) as earliest_ts,
        MAX(timestamp) as latest_ts,
        AVG(phys_used_mb) as avg_phys_used_mb,
        MAX(phys_used_mb) as max_phys_used_mb,
        AVG(commit_total_mb) as avg_commit_mb,
        MAX(commit_total_mb) as max_commit_mb,
        AVG(mac_equivalent_mb) as avg_mac_equiv_mb,
        MAX(mac_equivalent_mb) as max_mac_equiv_mb,
        AVG(gpu_dedicated_mb + gpu_shared_mb) as avg_gpu_mb,
        MAX(gpu_dedicated_mb + gpu_shared_mb) as max_gpu_mb,
        SUM(CASE WHEN pressure_16gb = 'green' THEN 1 ELSE 0 END) as p16_green_count,
        SUM(CASE WHEN pressure_16gb = 'yellow' THEN 1 ELSE 0 END) as p16_yellow_count,
        SUM(CASE WHEN pressure_16gb = 'red' THEN 1 ELSE 0 END) as p16_red_count,
        SUM(CASE WHEN pressure_24gb = 'green' THEN 1 ELSE 0 END) as p24_green_count,
        SUM(CASE WHEN pressure_24gb = 'yellow' THEN 1 ELSE 0 END) as p24_yellow_count,
        SUM(CASE WHEN pressure_24gb = 'red' THEN 1 ELSE 0 END) as p24_red_count
    FROM samples
    WHERE timestamp >= ?
    """, (cutoff,))
    row = dict(cursor.fetchone() or {})

    # Calculate 95th percentile mac_equivalent_mb
    cursor.execute("""
    SELECT mac_equivalent_mb FROM samples
    WHERE timestamp >= ?
    ORDER BY mac_equivalent_mb ASC
    """, (cutoff,))
    mac_values = [r[0] for r in cursor.fetchall()]

    p95_mac = 0.0
    p90_mac = 0.0
    p50_mac = 0.0
    if mac_values:
        idx95 = int(len(mac_values) * 0.95)
        idx90 = int(len(mac_values) * 0.90)
        idx50 = int(len(mac_values) * 0.50)
        p95_mac = mac_values[min(idx95, len(mac_values) - 1)]
        p90_mac = mac_values[min(idx90, len(mac_values) - 1)]
        p50_mac = mac_values[min(idx50, len(mac_values) - 1)]

    row["p95_mac_mb"] = p95_mac
    row["p90_mac_mb"] = p90_mac
    row["p50_mac_mb"] = p50_mac

    # Top processes aggregated across this time window
    cursor.execute("""
    SELECT 
        proc_name,
        category,
        AVG(rss_mb) as avg_rss_mb,
        MAX(rss_mb) as max_rss_mb,
        COUNT(DISTINCT sample_id) as appearance_count
    FROM process_snapshots
    WHERE timestamp >= ?
    GROUP BY proc_name
    ORDER BY avg_rss_mb DESC
    LIMIT 15
    """, (cutoff,))
    top_procs = [dict(r) for r in cursor.fetchall()]
    row["top_processes"] = top_procs

    # Group by category
    cursor.execute("""
    SELECT 
        category,
        SUM(rss_mb) as total_rss_mb
    FROM process_snapshots
    WHERE timestamp >= ?
    GROUP BY category
    ORDER BY total_rss_mb DESC
    """, (cutoff,))
    categories = [dict(r) for r in cursor.fetchall()]
    row["categories"] = categories

    conn.close()
    return row

def get_timeline_data(days: float, num_points: int = 100) -> List[Dict[str, Any]]:
    """Downsamples historical points into smooth timeline chart points."""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT MAX(timestamp) FROM samples")
    max_row = cursor.fetchone()
    latest_db_ts = max_row[0] if (max_row and max_row[0]) else time.time()
    cutoff = max(0.0, latest_db_ts - (days * 86400.0))

    # Total samples in range
    cursor.execute("SELECT COUNT(*) FROM samples WHERE timestamp >= ?", (cutoff,))
    count = cursor.fetchone()[0]

    if count <= num_points:
        cursor.execute("""
        SELECT timestamp, datetime_str, phys_used_mb, commit_total_mb, mac_equivalent_mb, 
               pressure_16gb, pressure_24gb, (gpu_dedicated_mb + gpu_shared_mb) as gpu_mb
        FROM samples
        WHERE timestamp >= ?
        ORDER BY timestamp ASC
        """, (cutoff,))
        rows = [dict(r) for r in cursor.fetchall()]
    else:
        # Downsample using strftime or grouping buckets
        step = max(1, count // num_points)
        cursor.execute(f"""
        SELECT 
            AVG(timestamp) as timestamp,
            datetime_str,
            AVG(phys_used_mb) as phys_used_mb,
            AVG(commit_total_mb) as commit_total_mb,
            AVG(mac_equivalent_mb) as mac_equivalent_mb,
            MAX(mac_equivalent_mb) as max_mac_equivalent_mb,
            AVG(gpu_dedicated_mb + gpu_shared_mb) as gpu_mb,
            pressure_16gb,
            pressure_24gb
        FROM (
            SELECT *, (ROW_NUMBER() OVER (ORDER BY timestamp ASC)) / {step} as grp
            FROM samples
            WHERE timestamp >= ?
        )
        GROUP BY grp
        ORDER BY timestamp ASC
        """, (cutoff,))
        rows = [dict(r) for r in cursor.fetchall()]

    conn.close()
    return rows

def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else default

def set_setting(key: str, value: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    """, (key, str(value), time.time()))
    conn.commit()
    conn.close()

def get_total_monitoring_duration_days() -> float:
    """Returns how many days worth of data is recorded in DB."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM samples")
    row = cursor.fetchone()
    conn.close()
    if not row or not row[0] or not row[1] or row[2] < 2:
        return 0.0
    return max(0.0, (row[1] - row[0]) / 86400.0)

def get_total_monitoring_duration_hours() -> float:
    """Returns how many hours worth of data is recorded in DB."""
    return get_total_monitoring_duration_days() * 24.0

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_FILE)
