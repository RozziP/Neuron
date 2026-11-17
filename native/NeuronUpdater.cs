using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// A GUI-subsystem helper can outlive Electron without a console or PowerShell.
class NeuronUpdater {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static string Text(Dictionary<string, object> request, string key) { return Convert.ToString(request[key]); }
    static bool SamePath(string first, string second) { return String.Equals(Path.GetFullPath(first), Path.GetFullPath(second), StringComparison.OrdinalIgnoreCase); }
    static bool Verify(string file, string digest) {
        using (var stream = File.OpenRead(file)) using (var hash = SHA256.Create()) {
            return String.Equals(BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", ""), digest, StringComparison.OrdinalIgnoreCase);
        }
    }
    static void WriteResult(string file, object result) {
        var temporary = file + ".tmp";
        File.WriteAllText(temporary, Json.Serialize(result), new UTF8Encoding(false));
        if (File.Exists(file)) File.Delete(file);
        File.Move(temporary, file);
    }
    static int Main(string[] args) {
        string resultPath = null, appPath = null, version = null;
        bool parentExited = false;
        try {
            if (args.Length != 1) throw new Exception("Missing update request.");
            var requestPath = Path.GetFullPath(args[0]);
            var request = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(requestPath));
            var directory = Path.GetDirectoryName(requestPath);
            var installer = Path.GetFullPath(Text(request, "file"));
            resultPath = Text(request, "resultPath"); appPath = Text(request, "appPath"); version = Text(request, "version");
            var digest = Text(request, "sha256");
            if (!SamePath(Path.GetDirectoryName(installer), directory)) throw new Exception("Installer is outside the update directory.");
            if (!Verify(installer, digest)) throw new Exception("Installer checksum verification failed.");
            if (FileVersionInfo.GetVersionInfo(installer).ProductVersion != version) throw new Exception("Installer version verification failed.");
            using (var parent = Process.GetProcessById(Convert.ToInt32(request["parentId"]))) {
                // Acquire the process handle before publishing readiness, avoiding PID reuse.
                var parentHandle = parent.Handle;
                if (!SamePath(parent.MainModule.FileName, appPath)) throw new Exception("The running Neuron process does not match the update request.");
                Process bridge = null;
                try {
                    if (request.ContainsKey("bridgeId") && request["bridgeId"] != null) {
                        try { bridge = Process.GetProcessById(Convert.ToInt32(request["bridgeId"])); var bridgeHandle = bridge.Handle; }
                        catch (ArgumentException) { bridge = null; }
                    }
                    if (File.Exists(resultPath)) File.Delete(resultPath);
                    File.WriteAllText(Path.Combine(directory, "ready"), "ready");
                    if (!parent.WaitForExit(120000)) throw new Exception("Neuron did not finish shutting down. The update was not installed.");
                    parentExited = true;
                    if (bridge != null && !bridge.WaitForExit(30000)) throw new Exception("The mouse helper did not finish shutting down. The update was not installed.");
                } finally { if (bridge != null) bridge.Dispose(); }
            }
            if (!Verify(installer, digest)) throw new Exception("Installer checksum verification failed.");
            var start = new ProcessStartInfo(installer, "/S --updated --force-run /D=" + Path.GetDirectoryName(appPath));
            start.UseShellExecute = false; start.CreateNoWindow = true; start.WindowStyle = ProcessWindowStyle.Hidden;
            start.WorkingDirectory = directory;
            using (var process = Process.Start(start)) {
                process.WaitForExit();
                if (process.ExitCode != 0) throw new Exception("The installer exited with code " + process.ExitCode + ". Try updating again.");
            }
            WriteResult(resultPath, new { ok = true, version = version });
            foreach (var file in new[] { installer, requestPath, Path.Combine(directory, "ready") }) {
                try { File.Delete(file); } catch { }
            }
            return 0;
        } catch (Exception error) {
            try { if (resultPath != null) WriteResult(resultPath, new { ok = false, version = version, error = error.Message }); } catch { }
            if (parentExited && appPath != null && File.Exists(appPath)) {
                try { Process.Start(new ProcessStartInfo(appPath) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(appPath) }); } catch { }
            }
            return 1;
        }
    }
}
