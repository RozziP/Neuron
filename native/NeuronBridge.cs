using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

// A narrow JSON-lines bridge. No shell execution, drivers, or elevated service.
class NeuronBridge {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_SetFeature(SafeFileHandle handle, byte[] data, int length);
    [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetFeature(SafeFileHandle handle, byte[] data, int length);
    [DllImport("hid.dll", SetLastError = true)] static extern bool HidD_GetPreparsedData(SafeFileHandle handle, out IntPtr data);
    [DllImport("hid.dll")] static extern bool HidD_FreePreparsedData(IntPtr data);
    [DllImport("hid.dll")] static extern int HidP_GetCaps(IntPtr data, out HIDP_CAPS caps);
    [StructLayout(LayoutKind.Sequential)] struct HIDP_CAPS {
        public ushort Usage, UsagePage, InputReportByteLength, OutputReportByteLength, FeatureReportByteLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)] public ushort[] Reserved;
        public ushort NumberLinkCollectionNodes, NumberInputButtonCaps, NumberInputValueCaps, NumberInputDataIndices;
        public ushort NumberOutputButtonCaps, NumberOutputValueCaps, NumberOutputDataIndices;
        public ushort NumberFeatureButtonCaps, NumberFeatureValueCaps, NumberFeatureDataIndices;
    }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion data; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra; }
    static JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 65536 };
    static INPUT Key(ushort vk, bool up) {
        bool extended = (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B;
        return new INPUT { type = 1, data = new InputUnion { keyboard = new KEYBDINPUT { vk = vk, flags = (up ? 2u : 0u) | (extended ? 1u : 0u) } } };
    }
    static void Send(ushort vk, bool up) {
        if (SendInput(1, new INPUT[] { Key(vk, up) }, Marshal.SizeOf(typeof(INPUT))) != 1)
            throw new Exception("Windows could not send the key. The target app may be elevated.");
    }
    static object Handle(Dictionary<string, object> request) {
        string method = (string)request["method"];
        if (method == "hidCapabilities") {
            string path = (string)request["path"];
            if (!System.Text.RegularExpressions.Regex.IsMatch(path, @"^\\\\\?\\hid#vid_[0-9a-f]{4}&pid_[0-9a-f]{4}[&#]", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                throw new Exception("Only local USB HID collections are accepted.");
            // Inspect Windows' descriptor summary only. No feature requests or input reads.
            using (var handle = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
                IntPtr data;
                if (handle.IsInvalid || !HidD_GetPreparsedData(handle, out data)) throw new Exception("HID capabilities unavailable.");
                try {
                    HIDP_CAPS caps;
                    if (HidP_GetCaps(data, out caps) != 0x00110000) throw new Exception("Invalid HID capabilities.");
                    return new { inputReportBytes = caps.InputReportByteLength, outputReportBytes = caps.OutputReportByteLength,
                        featureReportBytes = caps.FeatureReportByteLength, linkCollections = caps.NumberLinkCollectionNodes,
                        inputButtonCaps = caps.NumberInputButtonCaps, inputValueCaps = caps.NumberInputValueCaps,
                        outputButtonCaps = caps.NumberOutputButtonCaps, outputValueCaps = caps.NumberOutputValueCaps,
                        featureButtonCaps = caps.NumberFeatureButtonCaps, featureValueCaps = caps.NumberFeatureValueCaps };
                } finally { HidD_FreePreparsedData(data); }
            }
        }
        if (method == "keyDown") {
            int key = Convert.ToInt32(request["key"]);
            if (key < 8 || key > 254) throw new Exception("Invalid virtual key.");
            return new { down = (GetAsyncKeyState(key) & 0x8000) != 0 };
        }
        if (method == "foreground") {
            uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            try { using (var process = Process.GetProcessById((int)pid)) { string file = ""; try { file = process.MainModule.FileName; } catch {} return new { executable = process.ProcessName + ".exe", path = file, pid = pid }; } }
            catch { return new { executable = "", path = "", pid = pid }; }
        }
        if (method == "tap") {
            var keys = (System.Collections.ArrayList)request["keys"];
            if (keys.Count < 1 || keys.Count > 5) throw new Exception("Invalid key chord.");
            var down = new List<ushort>();
            try {
                foreach (object value in keys) {
                    int number = Convert.ToInt32(value);
                    if (number < 8 || number > 254) throw new Exception("Invalid virtual key.");
                    ushort vk = (ushort)number; Send(vk, false); down.Add(vk);
                }
                Thread.Sleep(15);
            } finally {
                Exception releaseError = null;
                for (int i = down.Count - 1; i >= 0; i--) {
                    try { Send(down[i], true); } catch (Exception error) { releaseError = error; }
                }
                if (releaseError != null) throw releaseError;
            }
            return new { sent = true };
        }
        if (method == "exchange") {
            string path = (string)request["path"];
            if (!path.StartsWith("\\\\?\\hid#", StringComparison.OrdinalIgnoreCase) || path.IndexOf("vid_1532&", StringComparison.OrdinalIgnoreCase) < 0)
                throw new Exception("Only local Razer HID collections are accepted.");
            byte[] report = Convert.FromBase64String((string)request["report"]);
            if (report.Length != 90) throw new Exception("Expected a 90-byte report.");
            byte[] outgoing = new byte[91]; Array.Copy(report, 0, outgoing, 1, 90);
            // Zero desired access permits feature reports on Windows-owned keyboard/mouse collections.
            using (var handle = CreateFile(path, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Exception("Cannot open HID collection: " + Marshal.GetLastWin32Error());
                if (!HidD_SetFeature(handle, outgoing, outgoing.Length)) throw new Exception("HID request failed: " + Marshal.GetLastWin32Error());
                Thread.Sleep(40);
                byte[] incoming = new byte[91];
                if (!HidD_GetFeature(handle, incoming, incoming.Length)) throw new Exception("HID response failed: " + Marshal.GetLastWin32Error());
                byte[] payload = new byte[90]; Array.Copy(incoming, 1, payload, 0, 90);
                return new { report = Convert.ToBase64String(payload) };
            }
        }
        throw new Exception("Unknown bridge operation.");
    }
    static void Main() {
        string line;
        while ((line = Console.ReadLine()) != null) {
            object id = null;
            try {
                var request = json.Deserialize<Dictionary<string, object>>(line); id = request["id"];
                Console.WriteLine(json.Serialize(new { id = id, ok = true, result = Handle(request) }));
            } catch (Exception error) { Console.WriteLine(json.Serialize(new { id = id, ok = false, error = error.Message })); }
        }
    }
}
