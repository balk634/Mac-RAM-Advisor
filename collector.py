"""
Background telemetry collection daemon for Mac RAM Advisor.
Gathers high-precision Windows memory, commit charge, GPU usage, and active apps.
"""

import threading
import time
import ctypes
import os
import subprocess
from datetime import datetime
from typing import Dict, Any, List, Optional
import psutil

import database
import mac_analyzer
import report_generator

# Win32 Structures for CTypes
class MEMORYSTATUSEX(ctypes.Structure):
    _fields_ = [
        ('dwLength', ctypes.c_ulong),
        ('dwMemoryLoad', ctypes.c_ulong),
        ('ullTotalPhys', ctypes.c_ulonglong),
        ('ullAvailPhys', ctypes.c_ulonglong),
        ('ullTotalPageFile', ctypes.c_ulonglong),
        ('ullAvailPageFile', ctypes.c_ulonglong),
        ('ullTotalVirtual', ctypes.c_ulonglong),
        ('ullAvailVirtual', ctypes.c_ulonglong),
        ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
    ]

class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [('cbSize', ctypes.c_uint), ('dwTime', ctypes.c_uint)]

class MemoryCollector:
    def __init__(self, interval_sec: int = 2, idle_interval_sec: int = 10):
        self.interval_sec = interval_sec
        self.idle_interval_sec = idle_interval_sec
        self.is_running = False
        self.is_paused = False
        self._thread: Optional[threading.Thread] = None
        self._last_gpu_check = 0.0
        self._cached_gpu = {"dedicated_mb": 0.0, "shared_mb": 0.0}
        self.has_nvidia = True
        self._auto_exported = False

    def start(self):
        if self.is_running:
            return
        database.init_db()
        self.is_running = True
        self.is_paused = False
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="MacRAMCollectorThread")
        self._thread.start()

    def stop(self):
        self.is_running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)

    def reset_target_state(self):
        self._auto_exported = False

    def pause(self):
        self.is_paused = True

    def resume(self):
        self.is_paused = False

    def _get_idle_seconds(self) -> float:
        try:
            lii = LASTINPUTINFO()
            lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
            ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii))
            millis = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
            return max(0.0, millis / 1000.0)
        except Exception:
            return 0.0

    def _get_foreground_app(self) -> str:
        try:
            hwnd = ctypes.windll.user32.GetForegroundWindow()
            if not hwnd:
                return "Desktop"
            pid = ctypes.c_ulong()
            ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if pid.value > 0:
                p = psutil.Process(pid.value)
                return p.name()
        except Exception:
            pass
        return "Desktop"

    def _query_gpu_usage(self) -> Dict[str, float]:
        now = time.time()
        if now - self._last_gpu_check < 20.0:
            return self._cached_gpu

        self._last_gpu_check = now
        dedicated_mb = 0.0
        shared_mb = 0.0

        if self.has_nvidia:
            try:
                res = subprocess.run(
                    ['nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits'],
                    capture_output=True, text=True, timeout=1.2
                )
                if res.returncode == 0:
                    for line in res.stdout.strip().splitlines():
                        val = line.strip()
                        if val and val.replace('.', '', 1).isdigit():
                            dedicated_mb += float(val)
                else:
                    self.has_nvidia = False
            except Exception:
                self.has_nvidia = False

        self._cached_gpu = {"dedicated_mb": dedicated_mb, "shared_mb": shared_mb}
        return self._cached_gpu

    def _get_top_processes(self, limit: int = 8) -> List[Dict[str, Any]]:
        proc_map = {}
        for p in psutil.process_iter(['name', 'memory_info']):
            try:
                info = p.info
                name = info['name']
                mem = info['memory_info']
                if not name or not mem:
                    continue
                rss = mem.rss / (1024 * 1024)
                vms = getattr(mem, 'vms', 0) / (1024 * 1024)

                if name not in proc_map:
                    proc_map[name] = {
                        "name": name,
                        "category": mac_analyzer.categorize_process(name),
                        "count": 0,
                        "rss_mb": 0.0,
                        "vms_mb": 0.0
                    }
                proc_map[name]["count"] += 1
                proc_map[name]["rss_mb"] += rss
                proc_map[name]["vms_mb"] += vms
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue

        sorted_procs = sorted(proc_map.values(), key=lambda x: x["rss_mb"], reverse=True)
        for p in sorted_procs[:limit]:
            p["rss_mb"] = round(p["rss_mb"], 1)
            p["vms_mb"] = round(p["vms_mb"], 1)
        return sorted_procs[:limit]

    def sample_now(self) -> Optional[Dict[str, Any]]:
        try:
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))

            total_phys_mb = stat.ullTotalPhys / (1024 * 1024)
            avail_phys_mb = stat.ullAvailPhys / (1024 * 1024)
            used_phys_mb = total_phys_mb - avail_phys_mb
            phys_percent = stat.dwMemoryLoad

            commit_limit_mb = stat.ullTotalPageFile / (1024 * 1024)
            commit_avail_mb = stat.ullAvailPageFile / (1024 * 1024)
            commit_total_mb = commit_limit_mb - commit_avail_mb
            commit_percent = round((commit_total_mb / max(1.0, commit_limit_mb)) * 100, 1)

            swap = psutil.swap_memory()
            swap_used_mb = swap.used / (1024 * 1024)

            gpu_info = self._query_gpu_usage()
            gpu_ded_mb = gpu_info.get("dedicated_mb", 0.0)
            gpu_sh_mb = gpu_info.get("shared_mb", 0.0)

            idle_sec = self._get_idle_seconds()
            is_active = 1 if idle_sec < 180 else 0
            fg_app = self._get_foreground_app()

            mac_mb, press_16, press_24 = mac_analyzer.calculate_mac_equivalent_demand(
                phys_used_mb=used_phys_mb,
                commit_total_mb=commit_total_mb,
                gpu_dedicated_mb=gpu_ded_mb,
                gpu_shared_mb=gpu_sh_mb
            )

            now_ts = time.time()
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            sample_dict = {
                "timestamp": now_ts,
                "datetime_str": now_str,
                "phys_total_mb": round(total_phys_mb, 1),
                "phys_used_mb": round(used_phys_mb, 1),
                "phys_avail_mb": round(avail_phys_mb, 1),
                "phys_percent": float(phys_percent),
                "commit_total_mb": round(commit_total_mb, 1),
                "commit_limit_mb": round(commit_limit_mb, 1),
                "commit_percent": commit_percent,
                "swap_used_mb": round(swap_used_mb, 1),
                "pages_per_sec": 0.0,
                "page_faults_per_sec": 0.0,
                "gpu_dedicated_mb": round(gpu_ded_mb, 1),
                "gpu_shared_mb": round(gpu_sh_mb, 1),
                "mac_equivalent_mb": round(mac_mb, 1),
                "pressure_16gb": press_16,
                "pressure_24gb": press_24,
                "foreground_app": fg_app,
                "is_user_active": is_active
            }

            top_procs = self._get_top_processes(limit=8)
            database.save_sample(sample_dict, top_procs)

            # Check auto-stop condition for 3-Hour Peak Workday or 7-Day Profiling
            target_mode = database.get_setting("target_mode", "peak_3h")
            auto_target = database.get_setting("auto_target_enabled", "false") == "true"
            if not auto_target and database.get_setting("auto_stop_7_days", "false") == "true":
                auto_target = True
                target_mode = "profile_7d"

            if auto_target and not self._auto_exported:
                duration_days = database.get_total_monitoring_duration_days()
                duration_hours = duration_days * 24.0

                target_met = False
                report_days = 7.0
                if target_mode == "peak_3h" and duration_hours >= 3.0:
                    target_met = True
                    report_days = 0.125
                elif target_mode == "profile_7d" and duration_days >= 7.0:
                    target_met = True
                    report_days = 7.0

                if target_met:
                    self._auto_exported = True
                    self.pause()
                    # Export report to desktop
                    try:
                        desktop_candidates = [
                            os.path.join(os.environ.get("USERPROFILE", ""), "OneDrive", "Desktop"),
                            os.path.join(os.environ.get("USERPROFILE", ""), "Desktop"),
                            os.path.expanduser("~/Desktop")
                        ]
                        desktop_dir = next((d for d in desktop_candidates if os.path.exists(d)), desktop_candidates[0])
                        target = os.path.join(desktop_dir, "Mac_RAM_Sizing_Report.html")
                        html = report_generator.generate_html_report(report_days)
                        with open(target, "w", encoding="utf-8") as f:
                            f.write(html)
                    except Exception:
                        pass

            return sample_dict

        except Exception as e:
            return None

    def _run_loop(self):
        while self.is_running:
            if not self.is_paused:
                self.sample_now()

            idle_sec = self._get_idle_seconds()
            sleep_sec = self.idle_interval_sec if idle_sec > 300 else self.interval_sec

            for _ in range(max(1, int(sleep_sec))):
                if not self.is_running:
                    break
                time.sleep(1.0)

collector = MemoryCollector(interval_sec=2)
