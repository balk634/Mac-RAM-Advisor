"""
Mac RAM Advisor — Headless Telemetry & API Backend Service.
Runs the background metric collector and serves the FastAPI web dashboard.
"""

import sys
import os
import uvicorn

# Protect against None stdout/stderr in windowed mode
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import database
import collector
import server

APP_PORT = 24816

def main():
    database.init_db()
    collector.collector.start()

    config = uvicorn.Config(
        app=server.app,
        host="127.0.0.1",
        port=APP_PORT,
        log_level="error",
        access_log=False
    )
    s = uvicorn.Server(config)
    try:
        s.run()
    finally:
        collector.collector.stop()

if __name__ == "__main__":
    import multiprocessing
    import traceback
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as e:
        with open("backend_crash.log", "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
