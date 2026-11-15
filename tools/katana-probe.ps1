# Read-only probe for the Katana Gen 3 on the Windows MIDI port "KATANA3".
# Sends only the identity request and RQ1 (read) requests, except with -SelectTest, -EditorMode and
# -WriteTest (see the parameters below).
# Usage:  powershell -File tools/katana-probe.ps1 [-IdleSeconds 60] [-OutDir captures]
# BOSS Tone Studio and any browser tab using the port must be closed.
param(
  [int]$IdleSeconds = 60,
  [string]$OutDir = (Join-Path $PSScriptRoot '..\captures'),
  [string]$PortName = 'KATANA',
  # The only mode that writes: selects A1..B4 by PATCH_SELECT, compares each with its stored slot,
  # then returns to the channel it started on. Unsaved changes of the current channel are lost.
  [switch]$SelectTest,
  # Read-only: snapshot, listen this many seconds while someone operates the amp (beep at start,
  # double beep at the end), snapshot again and show what the amp sent and which bytes changed.
  [int]$Listen = 0,
  [string]$Label = 'amp operated by hand',
  [int]$MaxLines = 80,
  # Writes: sets editor mode (DT1 7F 00 00 01) to 0 or 1 first. -1 = leave it alone.
  [int]$EditorMode = -1,
  # Writes: echo and send-pacing test on the NS threshold of the current patch only (never PATCH_WRITE).
  # The original value is restored at the end. Needs the BOSS Tone Studio backup.
  [switch]$WriteTest
)
$ErrorActionPreference = 'Stop'

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

public class KMsg { public double T; public byte[] Data; }

public class KatanaMidi : IDisposable
{
    [StructLayout(LayoutKind.Sequential)]
    struct MIDIHDR
    {
        public IntPtr lpData; public uint dwBufferLength; public uint dwBytesRecorded; public IntPtr dwUser;
        public uint dwFlags; public IntPtr lpNext; public IntPtr reserved; public uint dwOffset;
        public IntPtr r0, r1, r2, r3, r4, r5, r6, r7;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MIDIINCAPS
    {
        public ushort wMid; public ushort wPid; public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
        public uint dwSupport;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct MIDIOUTCAPS
    {
        public ushort wMid; public ushort wPid; public uint vDriverVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
        public ushort wTechnology; public ushort wVoices; public ushort wNotes; public ushort wChannelMask;
        public uint dwSupport;
    }
    delegate void MidiInProc(IntPtr h, uint msg, IntPtr inst, IntPtr p1, IntPtr p2);

    [DllImport("winmm.dll")] static extern uint midiInGetNumDevs();
    [DllImport("winmm.dll")] static extern uint midiOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiInGetDevCapsW")] static extern uint midiInGetDevCaps(UIntPtr id, ref MIDIINCAPS caps, uint size);
    [DllImport("winmm.dll", CharSet = CharSet.Unicode, EntryPoint = "midiOutGetDevCapsW")] static extern uint midiOutGetDevCaps(UIntPtr id, ref MIDIOUTCAPS caps, uint size);
    [DllImport("winmm.dll")] static extern uint midiInOpen(out IntPtr h, uint id, MidiInProc cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] static extern uint midiInClose(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInStart(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInStop(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInReset(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiInPrepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] static extern uint midiInUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] static extern uint midiInAddBuffer(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] static extern uint midiOutOpen(out IntPtr h, uint id, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] static extern uint midiOutClose(IntPtr h);
    [DllImport("winmm.dll")] static extern uint midiOutPrepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] static extern uint midiOutUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] static extern uint midiOutLongMsg(IntPtr h, IntPtr hdr, uint size);

    const int BufCount = 256, BufSize = 1024;
    static readonly uint HdrSize = (uint)Marshal.SizeOf(typeof(MIDIHDR));

    IntPtr hIn, hOut;
    MidiInProc callback;
    List<IntPtr> headers = new List<IntPtr>();
    volatile bool closing;
    readonly object gate = new object();
    List<KMsg> queue = new List<KMsg>();
    List<byte> partial = new List<byte>();
    Stopwatch clock = Stopwatch.StartNew();
    public int ActiveSensing;
    public int ShortMessages;
    public string InName, OutName;

    public double Now { get { return clock.Elapsed.TotalMilliseconds; } }

    public static string[] ListPorts()
    {
        var names = new List<string>();
        for (uint i = 0; i < midiInGetNumDevs(); i++) { var c = new MIDIINCAPS(); midiInGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(MIDIINCAPS))); names.Add("in " + i + ": " + c.szPname); }
        for (uint i = 0; i < midiOutGetNumDevs(); i++) { var c = new MIDIOUTCAPS(); midiOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(MIDIOUTCAPS))); names.Add("out " + i + ": " + c.szPname); }
        return names.ToArray();
    }

    public KatanaMidi(string nameContains)
    {
        int inId = -1, outId = -1;
        for (uint i = 0; i < midiInGetNumDevs(); i++) { var c = new MIDIINCAPS(); midiInGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(MIDIINCAPS))); if (inId < 0 && c.szPname.IndexOf(nameContains, StringComparison.OrdinalIgnoreCase) >= 0) { inId = (int)i; InName = c.szPname; } }
        for (uint i = 0; i < midiOutGetNumDevs(); i++) { var c = new MIDIOUTCAPS(); midiOutGetDevCaps((UIntPtr)i, ref c, (uint)Marshal.SizeOf(typeof(MIDIOUTCAPS))); if (outId < 0 && c.szPname.IndexOf(nameContains, StringComparison.OrdinalIgnoreCase) >= 0) { outId = (int)i; OutName = c.szPname; } }
        if (inId < 0 || outId < 0) throw new Exception("MIDI port not found: " + nameContains);

        callback = OnMidi;
        uint r = midiInOpen(out hIn, (uint)inId, callback, IntPtr.Zero, 0x30000);
        if (r != 0) throw new Exception("midiInOpen failed: " + r + " (port in use by another program?)");
        r = midiOutOpen(out hOut, (uint)outId, IntPtr.Zero, IntPtr.Zero, 0);
        if (r != 0) { midiInClose(hIn); throw new Exception("midiOutOpen failed: " + r + " (port in use by another program?)"); }

        for (int i = 0; i < BufCount; i++)
        {
            IntPtr data = Marshal.AllocHGlobal(BufSize);
            IntPtr hdr = Marshal.AllocHGlobal((int)HdrSize);
            var h = new MIDIHDR(); h.lpData = data; h.dwBufferLength = BufSize;
            Marshal.StructureToPtr(h, hdr, false);
            midiInPrepareHeader(hIn, hdr, HdrSize);
            midiInAddBuffer(hIn, hdr, HdrSize);
            headers.Add(hdr);
        }
        midiInStart(hIn);
    }

    void OnMidi(IntPtr h, uint msg, IntPtr inst, IntPtr p1, IntPtr p2)
    {
        try
        {
            if (msg == 0x3C3) // MIM_DATA
            {
                if (((long)p1 & 0xFF) == 0xFE) ActiveSensing++; else ShortMessages++;
                return;
            }
            if (msg != 0x3C4) return; // MIM_LONGDATA
            var hdr = (MIDIHDR)Marshal.PtrToStructure(p1, typeof(MIDIHDR));
            int n = (int)hdr.dwBytesRecorded;
            if (n > 0)
            {
                byte[] bytes = new byte[n];
                Marshal.Copy(hdr.lpData, bytes, 0, n);
                double t = Now;
                lock (gate)
                {
                    foreach (byte b in bytes)
                    {
                        partial.Add(b);
                        if (b == 0xF7) { queue.Add(new KMsg { T = t, Data = partial.ToArray() }); partial.Clear(); }
                    }
                }
            }
            if (!closing) midiInAddBuffer(hIn, p1, HdrSize);
        }
        catch { }
    }

    public void Send(byte[] data)
    {
        IntPtr buf = Marshal.AllocHGlobal(data.Length);
        IntPtr hdr = Marshal.AllocHGlobal((int)HdrSize);
        try
        {
            Marshal.Copy(data, 0, buf, data.Length);
            var h = new MIDIHDR(); h.lpData = buf; h.dwBufferLength = (uint)data.Length; h.dwBytesRecorded = (uint)data.Length;
            Marshal.StructureToPtr(h, hdr, false);
            uint r = midiOutPrepareHeader(hOut, hdr, HdrSize);
            if (r != 0) throw new Exception("midiOutPrepareHeader failed: " + r);
            r = midiOutLongMsg(hOut, hdr, HdrSize);
            if (r != 0) throw new Exception("midiOutLongMsg failed: " + r);
            while (midiOutUnprepareHeader(hOut, hdr, HdrSize) == 65) Thread.Sleep(1); // MIDIERR_STILLPLAYING
        }
        finally { Marshal.FreeHGlobal(buf); Marshal.FreeHGlobal(hdr); }
    }

    public KMsg[] Drain()
    {
        lock (gate) { var a = queue.ToArray(); queue.Clear(); return a; }
    }

    // Collects until nothing arrived for silenceMs (or nothing at all within firstTimeoutMs).
    public KMsg[] Collect(int firstTimeoutMs, int silenceMs)
    {
        var all = new List<KMsg>();
        double start = Now, last = -1;
        while (true)
        {
            Thread.Sleep(2);
            var got = Drain();
            if (got.Length > 0) { all.AddRange(got); last = Now; }
            if (last < 0 && Now - start > firstTimeoutMs) break;
            if (last >= 0 && Now - last > silenceMs) break;
        }
        return all.ToArray();
    }

    public void Dispose()
    {
        closing = true;
        if (hIn != IntPtr.Zero)
        {
            midiInStop(hIn); midiInReset(hIn);
            foreach (IntPtr hdr in headers) midiInUnprepareHeader(hIn, hdr, HdrSize);
            midiInClose(hIn); hIn = IntPtr.Zero;
        }
        if (hOut != IntPtr.Zero) { midiOutClose(hOut); hOut = IntPtr.Zero; }
    }
}
'@

function Hex($bytes) { ($bytes | ForEach-Object { '{0:X2}' -f $_ }) -join ' ' }
function Lin($a) { ((($a[0] * 128 + $a[1]) * 128 + $a[2]) * 128) + $a[3] }
function Rq1([byte[]]$addr, [byte[]]$size) {
  $p = $addr + $size
  $sum = 0; $p | ForEach-Object { $sum += $_ }
  [byte[]](@(0xF0, 0x41, $script:Dev, 0x01, 0x05, 0x07, 0x11) + $p + @(((128 - ($sum % 128)) % 128), 0xF7))
}
function Dt1([byte[]]$addr, [byte[]]$data) {
  $p = $addr + $data
  $sum = 0; $p | ForEach-Object { $sum += $_ }
  [byte[]](@(0xF0, 0x41, $script:Dev, 0x01, 0x05, 0x07, 0x12) + $p + @(((128 - ($sum % 128)) % 128), 0xF7))
}
function ParseDt1($m) {
  $d = $m.Data
  if ($d.Length -ge 14 -and $d[0] -eq 0xF0 -and $d[1] -eq 0x41 -and $d[3] -eq 1 -and $d[4] -eq 5 -and $d[5] -eq 7 -and $d[6] -eq 0x12) {
    [pscustomobject]@{ T = $m.T; Addr = [byte[]]$d[7..10]; Lin = (Lin $d[7..10]); Data = [byte[]]$d[11..($d.Length - 3)] }
  }
}

$script:Dev = 0x10
$script:Events = New-Object System.Collections.ArrayList
function Mark($text) { [void]$script:Events.Add([ordered]@{ t = [math]::Round($midi.Now, 2); dir = 'marker'; text = $text }) }
function Record($dir, $t, $bytes) { [void]$script:Events.Add([ordered]@{ t = [math]::Round($t, 2); dir = $dir; bytes = (Hex $bytes) }) }

# Sends one message, records everything, returns the incoming messages.
function Ask([byte[]]$msg, [string]$label, [int]$first = 1500, [int]$silence = 300) {
  foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data; $script:Stray += , $m }
  Mark $label
  $t0 = $midi.Now
  Record 'out' $t0 $msg
  $midi.Send($msg)
  $got = $midi.Collect($first, $silence)
  foreach ($m in $got) { Record 'in' $m.T $m.Data }
  $dur = if ($got.Count) { $got[-1].T - $t0 } else { 0 }
  [pscustomobject]@{ Messages = $got; Dt1 = @($got | ForEach-Object { ParseDt1 $_ } | Where-Object { $_ }); Ms = [math]::Round($dur, 1) }
}
function Summary($r) {
  $bytes = 0; $r.Dt1 | ForEach-Object { $bytes += $_.Data.Length }
  $asc = $true; for ($i = 1; $i -lt $r.Dt1.Count; $i++) { if ($r.Dt1[$i].Lin -lt $r.Dt1[$i - 1].Lin) { $asc = $false } }
  $dupes = @($r.Dt1 | Group-Object Lin | Where-Object { $_.Count -gt 1 }).Count
  "{0} messages, {1} DT1, {2} data bytes, {3} ms, ascending={4}, duplicate addresses={5}" -f $r.Messages.Count, $r.Dt1.Count, $bytes, $r.Ms, $asc, $dupes
}

$script:Stray = @()
"Ports: " + ([KatanaMidi]::ListPorts() -join ' | ')
$midi = New-Object KatanaMidi $PortName
try {
  "Opened in '$($midi.InName)' / out '$($midi.OutName)'"

  "`n== Identity"
  $r = Ask ([byte[]](0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7)) 'identity request'
  $r.Messages | ForEach-Object { Hex $_.Data }
  $id = $r.Messages | Where-Object { $_.Data[1] -eq 0x7E } | Select-Object -First 1
  if (-not $id) { throw 'No identity reply' }
  $script:Dev = $id.Data[2]

  if ($EditorMode -ge 0) {
    "`n== Editor mode (writes DT1 7F 00 00 01 = $EditorMode)"
    "before: " + (Hex (Ask (Rq1 (0x7F, 0, 0, 1) (0, 0, 0, 1)) 'RQ1 editor mode' 400 50).Dt1[0].Data)
    $w = Ask (Dt1 (0x7F, 0, 0, 1) (, [byte]$EditorMode)) "DT1 editor mode = $EditorMode" 600 200
    "amp sent {0} message(s):" -f $w.Messages.Count
    $w.Messages | Select-Object -First 10 | ForEach-Object { "  " + (Hex ($_.Data | Select-Object -First 32)) }
    "after: " + (Hex (Ask (Rq1 (0x7F, 0, 0, 1) (0, 0, 0, 1)) 'RQ1 editor mode' 400 50).Dt1[0].Data)
    if ($Listen -le 0) { return }
  }

  if ($Listen -gt 0) {
    # Read-only: snapshot, listen while someone operates the amp, snapshot again, diff.
    function Snapshot($label) {
      $map = @{}
      foreach ($req in @(@((0, 0, 0, 0), (0, 0, 0, 2)), @((0x10, 0, 0, 0), (0, 1, 0, 0)), @((0x20, 0, 0, 0), (0, 2, 0, 0)))) {
        foreach ($d in (Ask (Rq1 $req[0] $req[1]) "snapshot $label").Dt1) { $map[[int]$d.Lin] = $d.Data }
      }
      $map
    }
    function FromLin([int]$n) { Hex @([int]([math]::Floor($n / 2097152) % 128), [int]([math]::Floor($n / 16384) % 128), [int]([math]::Floor($n / 128) % 128), [int]($n % 128)) }
    $a = Snapshot 'A'
    "`n== Listening for $Listen s: $Label"
    Mark "listen start: $Label"
    [console]::Beep(880, 400)
    $t0 = $midi.Now; $heard = @()
    while ($midi.Now - $t0 -lt $Listen * 1000) {
      Start-Sleep -Milliseconds 20
      foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data; $heard += , $m }
    }
    [console]::Beep(440, 250); [console]::Beep(440, 250)
    Mark 'listen end'
    "{0} message(s) from the amp:" -f $heard.Count
    $heard | Select-Object -First $MaxLines | ForEach-Object { "  {0,6:N2} s  {1}" -f (($_.T - $t0) / 1000), (Hex ($_.Data | Select-Object -First 36)) }
    if ($heard.Count -gt $MaxLines) { "  ... $($heard.Count - $MaxLines) more (all in the capture)" }
    $b = Snapshot 'B'
    "`n== Changed bytes (snapshot before -> after)"
    $n = 0
    foreach ($k in ($b.Keys | Sort-Object)) {
      $old = $a[$k]; $new = $b[$k]
      for ($i = 0; $i -lt $new.Length; $i++) {
        if ($null -eq $old -or $i -ge $old.Length -or $old[$i] -ne $new[$i]) {
          $n++
          if ($n -le $MaxLines) { "  {0}: {1:X2} -> {2:X2}" -f (FromLin ($k + $i)), $(if ($null -ne $old -and $i -lt $old.Length) { $old[$i] } else { 0 }), $new[$i] }
        }
      }
    }
    "$n byte(s) changed"
    return
  }

  if ($WriteTest) {
    "`n== Write test on NS threshold 20 00 58 01 (current patch only, value restored at the end)"
    $nsAddr = [byte[]](0x20, 0, 0x58, 1)
    function ReadNs { $x = Ask (Rq1 $nsAddr (0, 0, 0, 1)) 'RQ1 NS threshold' 400 60; if ($x.Dt1.Count) { [int]$x.Dt1[0].Data[0] } else { -1 } }
    $em = (Ask (Rq1 (0x7F, 0, 0, 1) (0, 0, 0, 1)) 'RQ1 editor mode' 400 50).Dt1[0].Data[0]
    $v0 = ReadNs
    "editor mode = $em, NS threshold = $v0"
    if ($v0 -lt 0) { throw 'NS threshold not readable' }
    $alt = if ($v0 -ge 50) { $v0 - 3 } else { $v0 + 3 }
    try {
      # --- B4: does the amp echo a DT1 we wrote? ---
      foreach ($pass in 1..3) {
        $val = if ($pass % 2) { $alt } else { $v0 }
        $w = Ask (Dt1 $nsAddr (, [byte]$val)) "DT1 NS threshold = $val (echo check $pass)" 800 300
        $echo = @($w.Dt1 | Where-Object { $_.Lin -eq (Lin $nsAddr) })
        "write {0}: amp sent {1} message(s) within 800 ms, echo at 20 00 58 01: {2}; read back {3}" -f $val, $w.Messages.Count, $echo.Count, (ReadNs)
        $w.Messages | Select-Object -First 8 | ForEach-Object { "    +{0,5:N1} ms  {1}" -f ($_.T - $w.Messages[0].T), (Hex ($_.Data | Select-Object -First 24)) }
      }

      # --- B5: send pacing ---
      # Burst of DT1 at a fixed gap with distinct values, then read back: the last value must stick and no
      # error or unexpected message may appear. Then DT1 immediately followed by RQ1 (no gap).
      "`n-- pacing: 20 DT1 per burst, values alternate around $v0, read back after each burst"
      foreach ($gap in 20, 10, 5, 2, 0) {
        $vals = 0..19 | ForEach-Object { if ($_ % 2) { $alt } else { $v0 } }
        $vals[19] = $alt
        foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data }
        Mark "pacing burst gap $gap ms"
        $t0 = $midi.Now
        foreach ($v in $vals) {
          $msg = Dt1 $nsAddr (, [byte]$v); Record 'out' $midi.Now $msg; $midi.Send($msg)
          if ($gap -gt 0) { $until = $midi.Now + $gap; while ($midi.Now -lt $until) { } }
        }
        $sendMs = $midi.Now - $t0
        $in = $midi.Collect(300, 150); foreach ($m in $in) { Record 'in' $m.T $m.Data }
        $rb = ReadNs
        "gap {0,2} ms: 20 DT1 sent in {1,6:N1} ms, amp sent {2} message(s), read back {3} (expected {4}) {5}" -f $gap, $sendMs, $in.Count, $rb, $alt, $(if ($rb -eq $alt) { 'OK' } else { 'MISMATCH' })
        $null = Ask (Dt1 $nsAddr (, [byte]$v0)) 'DT1 NS threshold restore' 200 50
      }

      "`n-- DT1 immediately followed by RQ1, 10 rounds"
      $ok = 0; $times = @()
      foreach ($i in 1..10) {
        $v = if ($i % 2) { $alt } else { $v0 }
        foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data }
        $w = Dt1 $nsAddr (, [byte]$v); $q = Rq1 $nsAddr (0, 0, 0, 1)
        $t0 = $midi.Now; Record 'out' $t0 $w; $midi.Send($w); Record 'out' $midi.Now $q; $midi.Send($q)
        $in = $midi.Collect(400, 60); foreach ($m in $in) { Record 'in' $m.T $m.Data }
        $rep = @($in | ForEach-Object { ParseDt1 $_ } | Where-Object { $_ -and $_.Lin -eq (Lin $nsAddr) })
        if ($rep.Count -and $rep[-1].Data[0] -eq $v) { $ok++; $times += ($rep[-1].T - $t0) }
      }
      "{0} of 10 reads returned the value written just before{1}" -f $ok, $(if ($times.Count) { (", reply after {0:N1} to {1:N1} ms" -f ($times | Measure-Object -Minimum).Minimum, ($times | Measure-Object -Maximum).Maximum) } else { '' })

      "`n-- 20 pairs DT1 + RQ1 back to back without waiting (each reply must carry the value of its pair)"
      foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data }
      Mark 'DT1+RQ1 pair burst x20'
      $expect = @(); $t0 = $midi.Now
      foreach ($i in 0..19) {
        $v = $v0 - 10 + $i
        $expect += $v
        $w = Dt1 $nsAddr (, [byte]$v); $q = Rq1 $nsAddr (0, 0, 0, 1)
        Record 'out' $midi.Now $w; $midi.Send($w); Record 'out' $midi.Now $q; $midi.Send($q)
      }
      $sendMs = $midi.Now - $t0
      $in = $midi.Collect(1000, 300); foreach ($m in $in) { Record 'in' $m.T $m.Data }
      $got = @($in | ForEach-Object { ParseDt1 $_ } | Where-Object { $_ -and $_.Lin -eq (Lin $nsAddr) } | ForEach-Object { [int]$_.Data[0] })
      "40 messages sent in {0:N1} ms, {1} NS messages back: {2}; expected {3} -> {4}" -f $sendMs, $got.Count, ($got -join ' '), ($expect -join ' '), $(if (($got -join ' ') -eq ($expect -join ' ')) { 'OK' } else { 'DIFFERENT' })
      $null = Ask (Dt1 $nsAddr (, [byte]$v0)) 'DT1 NS threshold restore' 200 50

      "`n-- 30 small RQ1 back to back (no gap), count replies"
      foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data }
      Mark 'RQ1 burst x30'
      $t0 = $midi.Now
      foreach ($i in 1..30) { $q = Rq1 $nsAddr (0, 0, 0, 1); Record 'out' $midi.Now $q; $midi.Send($q) }
      $sendMs = $midi.Now - $t0
      $in = $midi.Collect(1000, 300); foreach ($m in $in) { Record 'in' $m.T $m.Data }
      "30 RQ1 sent in {0:N1} ms, {1} replies, last after {2:N1} ms" -f $sendMs, $in.Count, $(if ($in.Count) { $in[-1].T - $t0 } else { 0 })

      "`n-- 5 full patch RQ1 back to back (large replies), count blocks"
      foreach ($m in $midi.Drain()) { Record 'in' $m.T $m.Data }
      Mark 'full patch RQ1 burst x5'
      $t0 = $midi.Now
      foreach ($i in 1..5) { $q = Rq1 (0x20, 0, 0, 0) (0, 2, 0, 0); Record 'out' $midi.Now $q; $midi.Send($q) }
      $in = $midi.Collect(1500, 500); foreach ($m in $in) { Record 'in' $m.T $m.Data }
      $d = @($in | ForEach-Object { ParseDt1 $_ } | Where-Object { $_ })
      "{0} DT1 received (5 x 80 = 400 expected), {1} distinct addresses, last after {2:N0} ms" -f $d.Count, @($d | Group-Object Lin).Count, $(if ($in.Count) { $in[-1].T - $t0 } else { 0 })
    }
    finally {
      $null = Ask (Dt1 $nsAddr (, [byte]$v0)) 'DT1 NS threshold restore (final)' 300 100
      "`nrestored NS threshold, read back: " + (ReadNs) + " (original $v0)"
    }
    return
  }

  if ($SelectTest) {
    "`n== PATCH_SELECT test (writes DT1 7F 00 01 00; needs the BOSS Tone Studio backup)"
    $r = Ask (Rq1 (0, 0, 0, 0) (0, 0, 0, 2)) 'RQ1 patch number'
    $start = $r.Dt1[0].Data[0] * 16 + $r.Dt1[0].Data[1]
    "start index = $start, editor mode byte = " + (Hex (Ask (Rq1 (0x7F, 0, 0, 1) (0, 0, 0, 1)) 'RQ1 editor mode' 400 50).Dt1[0].Data)
    $all = Ask (Rq1 (0x20, 0x10, 0, 0) (1, 0x20, 0, 0)) 'RQ1 all stored slots' 1500 500
    $slotBase = Lin (0x20, 0x10, 0, 0); $stride = Lin (0, 0x10, 0, 0); $base = Lin (0x20, 0, 0, 0)
    $slots = @{}
    foreach ($d in $all.Dt1) {
      $i = [int][math]::Floor(($d.Lin - $slotBase) / $stride); $ofs = [int](($d.Lin - $slotBase) % $stride)
      if (-not $slots.ContainsKey($i)) { $slots[$i] = @{} }
      $slots[$i][$ofs] = Hex $d.Data
    }
    foreach ($n in (@(1..8) + $start)) {
      "`n-- select index $n"
      $sel = Ask (Dt1 (0x7F, 0, 1, 0) (0, $n)) "DT1 PATCH_SELECT index $n" 1500 700
      "amp sent {0} message(s) within {1} ms:" -f $sel.Messages.Count, $sel.Ms
      $sel.Messages | Select-Object -First 12 | ForEach-Object { "  " + (Hex ($_.Data | Select-Object -First 32)) }
      $pn = (Ask (Rq1 (0, 0, 0, 0) (0, 0, 0, 2)) 'RQ1 patch number').Dt1[0].Data
      $cur = Ask (Rq1 (0x20, 0, 0, 0) (0, 2, 0, 0)) 'RQ1 current patch'
      $same = 0; foreach ($d in $cur.Dt1) { if ($slots[$n][[int]($d.Lin - $base)] -eq (Hex $d.Data)) { $same++ } }
      $nm = $cur.Dt1 | Where-Object { $_.Lin -eq $base } | Select-Object -First 1
      "patch number {0}, name '{1}', {2} of {3} blocks identical with slot {4}" -f (Hex $pn), (-join ($nm.Data | ForEach-Object { [char]$_ })).TrimEnd(), $same, $cur.Dt1.Count, $n
    }
    return
  }

  "`n== Command area 7F 00 00 00, 16 bytes (editor level, editor mode, ...)"
  # A range request over this area gets no reply; the bytes must be asked for one by one.
  foreach ($o in 0..7) {
    $r = Ask (Rq1 (0x7F, 0, 0, $o) (0, 0, 0, 1)) ("RQ1 7F 00 00 0$o size 1") 400 50
    if ($r.Dt1.Count) { $r.Dt1 | ForEach-Object { "{0}: {1}" -f (Hex $_.Addr), (Hex $_.Data) } } else { "7F 00 00 0${o}: no reply" }
  }

  "`n== Setup area 00 00 00 00, range 00 00 01 00 (patch number)"
  $r = Ask (Rq1 (0, 0, 0, 0) (0, 0, 1, 0)) 'RQ1 00 00 00 00 size 00 00 01 00'
  $r.Dt1 | ForEach-Object { "{0}: {1}" -f (Hex $_.Addr), (Hex $_.Data) }
  $patchIndex = -1
  $pn = $r.Dt1 | Where-Object { $_.Lin -eq 0 } | Select-Object -First 1
  if ($pn -and $pn.Data.Length -ge 2) { $patchIndex = $pn.Data[0] * 16 + $pn.Data[1] }
  "patch index = $patchIndex"

  "`n== SYSTEM 10 00 00 00, range 00 01 00 00"
  $r = Ask (Rq1 (0x10, 0, 0, 0) (0, 1, 0, 0)) 'RQ1 SYSTEM'
  Summary $r
  $r.Dt1 | ForEach-Object { "{0}: {1}" -f (Hex $_.Addr), (Hex $_.Data) }

  "`n== Current patch 20 00 00 00, size 00 02 00 00"
  $cur = Ask (Rq1 (0x20, 0, 0, 0) (0, 2, 0, 0)) 'RQ1 current patch'
  Summary $cur
  $base = Lin (0x20, 0, 0, 0)
  $name = $cur.Dt1 | Where-Object { $_.Lin -eq $base } | Select-Object -First 1
  if ($name) { "name: '" + (-join ($name.Data[0..15] | ForEach-Object { [char]$_ })) + "'" }
  "block table (address:length, in arrival order):"
  ($cur.Dt1 | ForEach-Object { "{0}:{1}" -f (Hex $_.Addr), $_.Data.Length }) -join ', '

  "`n== All stored slots 20 10 00 00, size 01 20 00 00"
  $all = Ask (Rq1 (0x20, 0x10, 0, 0) (1, 0x20, 0, 0)) 'RQ1 all stored slots' 1500 500
  Summary $all
  $slotBase = Lin (0x20, 0x10, 0, 0); $stride = Lin (0, 0x10, 0, 0)
  $slots = @{}
  foreach ($d in $all.Dt1) {
    $i = [int][math]::Floor(($d.Lin - $slotBase) / $stride); $ofs = [int](($d.Lin - $slotBase) % $stride)
    if (-not $slots.ContainsKey($i)) { $slots[$i] = @{} }
    $slots[$i][$ofs] = Hex $d.Data
  }
  foreach ($i in ($slots.Keys | Sort-Object)) {
    $n = if ($slots[$i].ContainsKey(0)) { -join (($slots[$i][0] -split ' ')[0..15] | ForEach-Object { [char][Convert]::ToInt32($_, 16) }) } else { '?' }
    "slot index {0}: {1} blocks, name '{2}'" -f $i, $slots[$i].Count, $n
  }

  "`n== Q6: current patch vs. stored slot at index $patchIndex"
  if ($patchIndex -ge 0 -and $slots.ContainsKey($patchIndex)) {
    $diff = @()
    foreach ($d in $cur.Dt1) {
      $ofs = [int]($d.Lin - $base)
      if ($slots[$patchIndex][$ofs] -ne (Hex $d.Data)) { $diff += ("  +{0}: current {1} | stored {2}" -f $ofs, (Hex $d.Data), $slots[$patchIndex][$ofs]) }
    }
    "{0} of {1} blocks differ" -f $diff.Count, $cur.Dt1.Count
    $diff | Select-Object -First 12
    foreach ($i in ($slots.Keys | Sort-Object)) {
      $same = 0; foreach ($d in $cur.Dt1) { if ($slots[$i][[int]($d.Lin - $base)] -eq (Hex $d.Data)) { $same++ } }
      "  identical blocks with slot {0}: {1}" -f $i, $same
    }
  }

  "`n== Beyond PREVIEW: 21 30 00 00, and TEMP 30 00 00 00"
  Summary (Ask (Rq1 (0x21, 0x30, 0, 0) (0, 2, 0, 0)) 'RQ1 21 30 00 00')
  $t = Ask (Rq1 (0x30, 0, 0, 0) (0, 2, 0, 0)) 'RQ1 TEMP 30 00 00 00'
  Summary $t
  ($t.Dt1 | Select-Object -First 6 | ForEach-Object { "{0}: {1}" -f (Hex $_.Addr), (Hex ($_.Data | Select-Object -First 24)) })

  "`n== Q4: five full patch reads in a row"
  1..5 | ForEach-Object { Summary (Ask (Rq1 (0x20, 0, 0, 0) (0, 2, 0, 0)) "RQ1 current patch, repeat $_") }
  "small read after that (patch name):"
  Summary (Ask (Rq1 (0x20, 0, 0, 0) (0, 0, 0, 16)) 'RQ1 patch name' 1500 1000)

  "`n== Q4: idle for $IdleSeconds s, nothing sent"
  Mark "idle listen $IdleSeconds s"
  $as0 = $midi.ActiveSensing
  Start-Sleep -Seconds $IdleSeconds
  $idle = $midi.Drain()
  foreach ($m in $idle) { Record 'in' $m.T $m.Data }
  "{0} SysEx messages while idle, {1} active sensing, {2} other short messages (total)" -f $idle.Count, ($midi.ActiveSensing - $as0), $midi.ShortMessages
  $idle | Select-Object -First 20 | ForEach-Object { "  t={0:N0} {1}" -f $_.T, (Hex ($_.Data | Select-Object -First 40)) }

  "`nStray messages seen between requests: $($script:Stray.Count)"
  $script:Stray | Select-Object -First 20 | ForEach-Object { "  t={0:N0} {1}" -f $_.T, (Hex ($_.Data | Select-Object -First 40)) }
}
finally {
  $midi.Dispose()
  if ($script:Events.Count) {
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $file = Join-Path $OutDir ("katana-probe-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    [ordered]@{ formatVersion = 1; tool = 'katana-probe.ps1'; startedAt = (Get-Date).ToString('o'); events = $script:Events } |
      ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding utf8 $file
    "`nCapture saved: $file"
  }
}
