using System;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;
using System.Threading;
using System.IO;
using System.Net;

public class MacTrayApp : ApplicationContext {
    private NotifyIcon trayIcon;
    private ContextMenuStrip trayMenu;
    private Process backendProcess;
    private static Mutex singleInstanceMutex;

    [STAThread]
    public static void Main(string[] args) {
        try {
            bool isNewInstance = true;
            try {
                singleInstanceMutex = new Mutex(true, "MacRAMAdvisor_Unique_Instance_Mutex", out isNewInstance);
            } catch {
                isNewInstance = true;
            }

            if (!isNewInstance) {
                OpenUrl("http://127.0.0.1:24816");
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try {
                Application.Run(new MacTrayApp());
            } finally {
                if (singleInstanceMutex != null) {
                    try { singleInstanceMutex.ReleaseMutex(); } catch {}
                    singleInstanceMutex.Dispose();
                }
            }
        } catch (Exception ex) {
            File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tray_crash.log"), ex.ToString());
        }
    }

    public MacTrayApp() {
        // 1. Ensure Telemetry Backend is alive and ready
        EnsureBackendRunning();

        // 2. Build Context Menu
        trayMenu = new ContextMenuStrip();
        trayMenu.RenderMode = ToolStripRenderMode.System;

        ToolStripMenuItem itemDash = new ToolStripMenuItem("Open Sizing Dashboard", null, (s, e) => OpenDashboard());
        itemDash.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
        trayMenu.Items.Add(itemDash);

        ToolStripMenuItem itemExport = new ToolStripMenuItem("Save Report to Desktop", null, (s, e) => SaveReportToDesktop());
        trayMenu.Items.Add(itemExport);

        trayMenu.Items.Add(new ToolStripSeparator());

        trayMenu.Items.Add(new ToolStripMenuItem("3-Hour Peak Workday View", null, (s, e) => OpenUrl("http://127.0.0.1:24816?days=0.125")));
        trayMenu.Items.Add(new ToolStripMenuItem("7-Day Deep Profile View", null, (s, e) => OpenUrl("http://127.0.0.1:24816?days=7")));
        trayMenu.Items.Add(new ToolStripMenuItem("15-Day View", null, (s, e) => OpenUrl("http://127.0.0.1:24816?days=15")));
        trayMenu.Items.Add(new ToolStripMenuItem("30-Day View", null, (s, e) => OpenUrl("http://127.0.0.1:24816?days=30")));

        trayMenu.Items.Add(new ToolStripSeparator());

        ToolStripMenuItem itemExit = new ToolStripMenuItem("Exit Mac RAM Advisor", null, OnExit);
        trayMenu.Items.Add(itemExit);

        // 3. Setup NotifyIcon
        trayIcon = new NotifyIcon();
        // NotifyIcon text limit is 63 chars
        trayIcon.Text = "Mac RAM Advisor (Click to Open)";
        
        string appDir = AppDomain.CurrentDomain.BaseDirectory;
        string iconPath = Path.Combine(appDir, "assets", "icon.ico");
        if (File.Exists(iconPath)) {
            try {
                trayIcon.Icon = new Icon(iconPath);
            } catch {
                trayIcon.Icon = SystemIcons.Application;
            }
        } else {
            trayIcon.Icon = SystemIcons.Application;
        }

        trayIcon.ContextMenuStrip = trayMenu;
        trayIcon.Visible = true;

        // Click actions: Single left-click or double-click opens dashboard
        trayIcon.Click += (s, e) => {
            MouseEventArgs me = e as MouseEventArgs;
            if (me == null || me.Button == MouseButtons.Left) {
                OpenDashboard();
            }
        };

        // 4. Show Windows Balloon Notification
        try {
            trayIcon.ShowBalloonTip(
                3500,
                "Mac RAM Advisor Active",
                "Monitoring system memory in background.\nClick tray icon anytime to view dashboard.",
                ToolTipIcon.Info
            );
        } catch {}

        // 5. Automatically open the browser dashboard on launch so the user sees it immediately!
        OpenDashboard();
    }

    private void EnsureBackendRunning() {
        if (IsServerResponding()) {
            return;
        }

        string appDir = AppDomain.CurrentDomain.BaseDirectory;

        // 1. Check for bundled backend_service.exe next to TrayHost
        string directExe = Path.Combine(appDir, "backend_service.exe");
        // 2. Check in engine subfolder
        string engineExe = Path.Combine(appDir, "engine", "backend_service.exe");
        // 3. Check in dist/backend_service (dev workspace)
        string distExe = Path.Combine(appDir, "dist", "backend_service", "backend_service.exe");
        // 4. Check in dist/backend_service_test (dev test)
        string testExe = Path.Combine(appDir, "dist", "backend_service_test", "backend_service_test.exe");

        string targetExe = null;
        string workingDir = appDir;

        if (File.Exists(directExe)) {
            targetExe = directExe;
        } else if (File.Exists(engineExe)) {
            targetExe = engineExe;
            workingDir = Path.Combine(appDir, "engine");
        } else if (File.Exists(distExe)) {
            targetExe = distExe;
            workingDir = Path.Combine(appDir, "dist", "backend_service");
        } else if (File.Exists(testExe)) {
            targetExe = testExe;
            workingDir = Path.Combine(appDir, "dist", "backend_service_test");
        }

        if (targetExe != null) {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = targetExe;
            psi.WorkingDirectory = workingDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;

            try {
                backendProcess = Process.Start(psi);
            } catch {}
        } else {
            // Fallback to python / pythonw for developer source runs
            string pyScript = Path.Combine(appDir, "backend_service.py");
            string pythonExe = "pythonw.exe";
            if (File.Exists(@"C:\Python314\pythonw.exe")) pythonExe = @"C:\Python314\pythonw.exe";
            else if (File.Exists(@"C:\Python313\pythonw.exe")) pythonExe = @"C:\Python313\pythonw.exe";

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = pythonExe;
            psi.Arguments = "\"" + pyScript + "\"";
            psi.WorkingDirectory = appDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;

            try {
                backendProcess = Process.Start(psi);
            } catch {
                try {
                    psi.FileName = "python.exe";
                    backendProcess = Process.Start(psi);
                } catch {}
            }
        }

        // Wait up to 10 seconds for the server to spin up so browser won't get ERR_CONNECTION_REFUSED
        for (int i = 0; i < 50; i++) {
            Thread.Sleep(200);
            if (IsServerResponding()) break;
        }
    }

    private bool IsServerResponding() {
        try {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:24816/api/status");
            req.Timeout = 800;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                return (resp.StatusCode == HttpStatusCode.OK);
            }
        } catch {
            return false;
        }
    }

    private void OpenDashboard() {
        OpenUrl("http://127.0.0.1:24816");
    }

    private void SaveReportToDesktop() {
        try {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:24816/api/export_desktop");
            req.Method = "POST";
            req.ContentLength = 0;
            req.Timeout = 3000;
            using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
                trayIcon.ShowBalloonTip(3000, "Report Saved", "Mac RAM Sizing Report saved directly to your Desktop!", ToolTipIcon.Info);
            }
        } catch (Exception ex) {
            MessageBox.Show("Could not export report: " + ex.Message, "Mac RAM Advisor", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private static void OpenUrl(string url) {
        try {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        } catch {}
    }

    private void OnExit(object sender, EventArgs e) {
        if (trayIcon != null) {
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }

        try {
            if (backendProcess != null && !backendProcess.HasExited) {
                // Kill process tree on Windows cleanly
                ProcessStartInfo psi = new ProcessStartInfo("taskkill", "/F /T /PID " + backendProcess.Id);
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi);
            }
        } catch {}

        ExitThread();
    }
}
