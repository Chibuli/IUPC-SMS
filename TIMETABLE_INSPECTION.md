# Inspection report: `SETUP_PACKAGE_(KEY=2113).zip`

**Date:** 2026-10-21
**Method:** static analysis only. Nothing was executed, installed, or unpacked-and-run.
**Result:** this package does **not** contain a timetable application. It is a
disguised loader/dropper.

---

## 1. Structure of the package

| Layer | Entry | Protection | Notes |
|---|---|---|---|
| 1 | `UNL0CK_SETUP.zip` (34 MB) | none | contains `SETUP.zip` |
| 2 | `SETUP.zip` | ZipCrypto, password `2113` | 571 entries, 735 MB unpacked |
| - | `PASS KEY.png` | - | OCR text is literally `Password 2113` |

The password is delivered **as an image** (`PASS KEY.png`) instead of text. That is
the standard trick for keeping the key out of reach of mail/web scanners, search
indexing and automated sandbox pipelines.

## 2. What is actually inside `SETUP.zip`

| Path | Size | What it is |
|---|---|---|
| `Setup.exe` | 96 KB | **Genuine, validly signed `pythonw.exe`** (Python 3.7.7, "Python Software Foundation"), renamed. Imports exactly one function: `python37.dll!Py_Main`. |
| `python37.dll` | **724 MB** | Rust loader masquerading as the Python runtime (see §3). |
| `iptpt4.dll` | 640 KB | **Not a PE file.** Entropy **8.000** = fully encrypted/compressed blob. Referenced by name inside `python37.dll`. |
| `vcruntime140.dll` | 120 KB | Genuine Microsoft signed runtime (decoy). |
| `Restore.dll`, `Lib/WinClon64*.exe`, `Lib/MigrationService.exe`, `Lib/KillProcess.dll` | ~10 MB | Clonix **WinClon / Samsung SSD Data Migration** engine files (valid signatures) - unrelated filler. |
| `stats/**` | - | Wolfram **Mathematica** device-framework demos (`.m`) mixed with Steam `UserGameStats_*.bin` files. |
| `x64/**` | 1 KB-330 KB each | **Steam library cache** - 427 entries: 104 app-ID folders holding 271 images (`header.jpg`, `library_600x900.jpg`, `logo.png`...) plus `x64/assetcache.vdf`. |

No timetable code, schema, database, README, installer manifest or app resources
exist anywhere in the archive. The `stats/` and `x64/` trees are cargo from
unrelated software on whoever built this.

## 3. Why `python37.dll` is the payload (and not Python)

| Observation | Genuine `python37.dll` | This file |
|---|---|---|
| Size | ~4 MB | **724,471,139 bytes** |
| Bytes after the PE image | none | **718,286,691 bytes** |
| Composition of that padding | - | **98.5 % `0x90` (NOP) filler** + a Unicode table |
| Import table | ~60 KERNEL32 + CRT entries | **24 KERNEL32 + 1 CRT** |
| Interesting imports | - | `VirtualAlloc`, `VirtualQuery`, `CreateEventW`, `Sleep`, `GetTickCount` |
| Version resource | Python Software Foundation | **"Yamicsoft / Windows Manager - JumpListQuickLauncher.exe"** |
| Authenticode | valid | **HashMismatch** (modified after signing) |
| Exports | ~1,700 real CPython symbols | 1,691 symbols: Python names **plus** `DllMain`, `InitializeService`, `GetManagerStatus`, `DispatchSession`, `GetApplicationName` |

Details that settle it:

* The `.rdata` string region contains Rust-toolchain paths
  (`/ac68faa20c58cbccd01ee7208bf3b6e93a7d7f96/library/alloc/src/collections/btree/...`)
  and parser diagnostics: `it's not a PE file`, `invalid magic string`,
  `invalid bit version`. A Rust PE parser inside a file called `python37.dll`
  is a loader, not CPython.
* The string **`iptpt4.dll`** sits in that same loader region, i.e. the file that
  is 100 % high-entropy is loaded by name at runtime.
* The export table was **copied from the real `python37.dll`** so that
  `Setup.exe`'s `Py_Main` import resolves cleanly and the process starts without
  a "missing DLL" error. `DllMain` does the work before `Py_Main` ever matters.
* 718 MB of NOP padding is not an accident: it pushes the file past the upload
  limit of VirusTotal / Defender cloud submission and most sandbox file caps,
  so the interesting 6 MB is never analysed.

### Execution chain if `Setup.exe` is double-clicked

```
Setup.exe (real, signed pythonw.exe)
   └─ loads python37.dll  → Rust loader in DllMain
        └─ reads + decrypts iptpt4.dll (encrypted PE / shellcode)
             └─ reflectively maps it  → final payload
```

## 4. Verdict

**Do not run anything from this archive.** The combination - pass-key image,
nested encrypted archives, a signed host binary, a DLL-sideloading stub with a
cloned export table, one fully encrypted 640 KB blob, and a 718 MB NOP-padded
carrier - is the textbook construction of a dropper. The "timetable app" framing
is cover; there is no timetable software present.

* Microsoft Defender (defs `1.461.102.0`, real-time on) scanned the extracted
  tree with `-DisableRemediation` and reported **no threats**. That is expected
  for padded/encrypted stages and is *not* evidence of safety.
* The archive was assembled on 2026-10-20 (`iptpt4.dll` 20:28, `python37.dll`
  20:34, `SETUP.zip` 21:43), i.e. recently and deliberately.

## 5. Indicators of compromise

```
Setup.exe        SHA-256 8c1b9b8e72264e27253a7cc14d6f9a560a127ebd9f8bcec81faba94710c19a47
iptpt4.dll       SHA-256 f9dc2a0f364dcea2073577964fffca56f1deb0e6be1fbb3a5c3deffea0368f8e
Restore.dll      SHA-256 02c6aedd7688be26f9e4cbf29959f2fc70c210e1e3f1668aabfedb689534b646
PASS KEY.png     SHA-256 478f2802ef67061989a778ed72249f4ce93e219beb8112f9a8876dec67b2894b
python37.dll     724,471,139 bytes - first 8 MB SHA-256
                 379394399ac85022a4d0eeb8141c8551ad446c56a68a61dc0af82b181657f3ba
```

Behavioural markers to hunt for on a machine where it already ran:
`pythonw.exe` running from a folder containing `python37.dll` + `iptpt4.dll`;
`iptpt4.dll` read shortly after process start; any `Restore.dll` /
`WinClon64*.exe` side effects.

## 6. Recommended actions

1. Do not execute `Setup.exe`; block the archive hash in your mail gateway/EDR.
2. If it was already run: treat the host as compromised - isolate it, collect
   memory + the `%TEMP%`/`%LOCALAPPDATA%` artefacts, rotate credentials.
3. Ask whoever sent it for the real application; a timetable app never needs a
   password-protected installer, a signed Python host, or a 724 MB DLL.
