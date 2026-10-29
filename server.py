"""
FastAPI Server for Mac RAM Advisor.
Provides high-performance REST APIs and serves the modern GUI dashboard.
"""

import sys
import os
import time
from typing import Optional
from fastapi import FastAPI, Query, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import database
import mac_analyzer
import collector
import report_generator
import simulator

app = FastAPI(title="Mac RAM Advisor Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_static_dir():
    candidates = []
    if hasattr(sys, '_MEIPASS'):
        candidates.append(os.path.join(sys._MEIPASS, "static"))
    candidates.append(os.path.join(os.path.dirname(sys.executable), "static"))
    candidates.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "static"))
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[-1]

STATIC_DIR = get_static_dir()
os.makedirs(STATIC_DIR, exist_ok=True)

@app.get("/api/status")
def get_status():
    monitoring = collector.collector.is_running and not collector.collector.is_paused
    total_days = database.get_total_monitoring_duration_days()
    total_hours = total_days * 24.0
    recent = database.get_recent_samples(limit=1)
    latest_sample = recent[0] if recent else None

    # Autostart status
    startup_folder = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup")
    shortcut_path = os.path.join(startup_folder, "MacRAMAdvisor.vbs")
    autostart_enabled = os.path.exists(shortcut_path)

    target_mode = database.get_setting("target_mode", "peak_3h")
    auto_target_enabled = database.get_setting("auto_target_enabled", "false") == "true"
    if not auto_target_enabled and database.get_setting("auto_stop_7_days", "false") == "true":
        auto_target_enabled = True
        target_mode = "profile_7d"

    target_hours = 3.0 if target_mode == "peak_3h" else 168.0
    target_completed = auto_target_enabled and (total_hours >= target_hours)

    return {
        "is_running": collector.collector.is_running,
        "is_paused": collector.collector.is_paused,
        "total_days_recorded": round(total_days, 2),
        "total_hours_recorded": round(total_hours, 2),
        "target_mode": target_mode,
        "auto_target_enabled": auto_target_enabled,
        "target_hours": target_hours,
        "target_completed": target_completed,
        "autostart_enabled": autostart_enabled,
        "auto_stop_7_days": auto_target_enabled and target_mode == "profile_7d",
        "latest_sample": latest_sample
    }

@app.get("/api/live")
def get_live(limit: int = 40):
    samples = database.get_recent_samples(limit=limit)
    return {"samples": samples}

@app.get("/api/analysis")
def get_analysis(days: float = Query(7.0, ge=0.01, le=90.0)):
    stats = database.get_stats_for_window(days)
    rec = mac_analyzer.evaluate_mac_ram_recommendation(stats, days)
    return {
        "timeframe_days": days,
        "stats": stats,
        "recommendation": rec
    }

@app.get("/api/timeline")
def get_timeline(days: float = Query(7.0, ge=0.01, le=90.0), points: int = 60):
    timeline = database.get_timeline_data(days, num_points=points)
    return {"timeline": timeline}

@app.get("/report", response_class=HTMLResponse)
def get_html_report(days: float = Query(7.0, ge=0.01, le=90.0)):
    html = report_generator.generate_html_report(days)
    return HTMLResponse(content=html)

@app.post("/api/export_desktop")
def export_desktop_report(days: Optional[float] = Query(None, ge=0.01, le=90.0)):
    """Generates the printable HTML report and saves it directly to the user's Desktop."""
    if days is None:
        mode = database.get_setting("target_mode", "peak_3h")
        days = 0.125 if mode == "peak_3h" else 7.0

    desktop_candidates = [
        os.path.join(os.environ.get("USERPROFILE", ""), "OneDrive", "Desktop"),
        os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
        os.path.expanduser("~/Desktop")
    ]
    desktop_dir = next((d for d in desktop_candidates if os.path.exists(d)), desktop_candidates[0])
    target_file = os.path.join(desktop_dir, "Mac_RAM_Sizing_Report.html")

    html = report_generator.generate_html_report(days)
    with open(target_file, "w", encoding="utf-8") as f:
        f.write(html)

    return {
        "success": True,
        "path": target_file,
        "message": f"Report saved directly to your Desktop as Mac_RAM_Sizing_Report.html"
    }

@app.post("/api/target_mode")
def toggle_target_mode(
    enabled: Optional[bool] = Query(None),
    mode: Optional[str] = Query(None)
):
    if mode in ("peak_3h", "profile_7d"):
        database.set_setting("target_mode", mode)
    if enabled is not None:
        database.set_setting("auto_target_enabled", "true" if enabled else "false")
        current_mode = database.get_setting("target_mode", "peak_3h")
        if enabled and current_mode == "profile_7d":
            database.set_setting("auto_stop_7_days", "true")
        else:
            database.set_setting("auto_stop_7_days", "false")

    current_mode = database.get_setting("target_mode", "peak_3h")
    is_enabled = database.get_setting("auto_target_enabled", "false") == "true"
    return {
        "success": True,
        "target_mode": current_mode,
        "auto_target_enabled": is_enabled,
        "auto_stop_7_days": is_enabled and current_mode == "profile_7d"
    }

@app.post("/api/simulate")
def post_simulate(days: int = Query(7, ge=1, le=30), clear_existing: bool = False):
    added_count = simulator.generate_simulated_history(days=days, clear_existing=clear_existing)
    return {
        "success": True,
        "message": f"Successfully generated {added_count} telemetry samples over {days} days.",
        "samples_added": added_count
    }

@app.post("/api/collector/toggle")
def toggle_collector():
    if collector.collector.is_paused:
        collector.collector.resume()
        status = "resumed"
    else:
        collector.collector.pause()
        status = "paused"
    return {"success": True, "status": status}

@app.post("/api/collector/sample_now")
def force_sample():
    sample = collector.collector.sample_now()
    return {"success": True, "sample": sample}

@app.post("/api/collector/clear")
def clear_data():
    simulator.clear_all_data()
    collector.collector.reset_target_state()
    return {"success": True, "message": "All historical records have been reset."}

@app.post("/api/autostart")
def toggle_autostart():
    startup_folder = os.path.join(os.environ.get("APPDATA", ""), r"Microsoft\Windows\Start Menu\Programs\Startup")
    shortcut_path = os.path.join(startup_folder, "MacRAMAdvisor.vbs")
    
    app_dir = os.path.dirname(os.path.abspath(__file__))
    target_exe = os.path.join(app_dir, "MacRAMAdvisor.exe")

    if os.path.exists(shortcut_path):
        os.remove(shortcut_path)
        return {"enabled": False, "message": "Disabled autostart on Windows boot."}
    else:
        with open(shortcut_path, "w", encoding="utf-8") as f:
            f.write(f'CreateObject("WScript.Shell").Run """{target_exe}""", 0, False\n')
        return {"enabled": True, "message": "Enabled autostart on Windows boot."}

# Mount static folder for GUI assets
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

def start_server(host: str = "127.0.0.1", port: int = 24816):
    config = uvicorn.Config(app=app, host=host, port=port, log_level="warning")
    server = uvicorn.Server(config)
    server.run()

if __name__ == "__main__":
    start_server()
