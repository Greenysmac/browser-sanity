; Browser Sanity — native host installer (Windows / Inno Setup)
;
; TOOLCHAIN: Inno Setup 6+ (https://jrsoftware.org/isinfo.php). Compile with:
;   iscc installer\windows\browser-sanity.iss
; produces dist\BrowserSanitySetup.exe.
;
; This script is NOT run in the CI-less / offline sandbox — it requires the Inno
; Setup compiler (iscc.exe), which only runs on Windows. It is built on a
; windows-latest runner (see .github/workflows/release-host.yml) or by a
; maintainer. It expects the SEA binary from `npm run build:sea` at
; dist\host\browser-sanity-host.exe.
;
; What it does (per-user, no admin/elevation):
;   1. Copies browser-sanity-host.exe to %LOCALAPPDATA%\BrowserSanity\.
;   2. Runs `browser-sanity-host.exe --install chrome,edge` so the binary
;      writes the HKCU native-messaging registry keys pointing at itself.
;   3. On uninstall, runs `--uninstall chrome,edge` to remove them.

#define AppName "Browser Sanity Host"
; Version may be passed by CI: iscc /DAppVersion=0.1.8 ...  (falls back otherwise).
#ifndef AppVersion
  #define AppVersion "0.1.8"
#endif
#define ExeName "browser-sanity-host.exe"

[Setup]
AppId={{B0A9F3C2-6E4D-4F1A-9C7B-BROWSERORGANIZER}}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Jeff Greenberg
AppPublisherURL=https://github.com/Greenysmac/browser-sanity
AppSupportURL=https://github.com/Greenysmac/browser-sanity/issues
AppContact=https://github.com/Greenysmac/browser-sanity/issues
AppComments=Local helper that lets the Browser Sanity extension run your AI backend on this computer.
; Per-user install — no admin rights required.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\BrowserSanity
; Always show the destination-folder page so users see where it installs (the
; helper self-registers wherever it lands, so changing the location is safe).
; Explicit "no" — the default "auto" would hide it on upgrades/re-installs.
DisableDirPage=no
DisableProgramGroupPage=yes
Uninstallable=yes
OutputDir=..\..\dist
OutputBaseFilename=BrowserSanitySetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Authenticode signing is applied by CI after compilation (signtool), not here.

[Messages]
; Explain what/why on the welcome page and what to do next on the finish page.
WelcomeLabel2=Browser Sanity Host is a small local helper for the Browser Sanity extension in Chrome and Edge.%n%nThe extension cannot run AI features on its own. This helper runs the AI backend you choose (a local AI CLI or an OpenAI-compatible API) here on your computer and returns the results, so your tabs and bookmarks stay on this machine.%n%nIt installs for your account only (no administrator rights) and registers itself with Chrome and Edge.
FinishedLabel=Browser Sanity Host is installed and registered with Chrome and Edge.%n%nTo finish: open the extension's side panel, click the reload icon, then choose your AI backend under Settings.

[Files]
Source: "..\..\dist\host\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; Register the host for Chrome and Edge (writes HKCU keys → this exe).
Filename: "{app}\{#ExeName}"; Parameters: "--install chrome,edge"; \
  Flags: runhidden waituntilterminated; StatusMsg: "Registering native host..."

[UninstallRun]
; Unregister before the files are removed.
Filename: "{app}\{#ExeName}"; Parameters: "--uninstall chrome,edge"; \
  Flags: runhidden waituntilterminated; RunOnceId: "UnregisterHost"
