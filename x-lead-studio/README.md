# X Lead Studio

Local-only acquisition workbench. It binds to `127.0.0.1:8020`, stores the X cookie with Windows DPAPI, keeps lead data in `.data/`, and never sends replies or direct messages.

## Setup

```powershell
cd D:\Coding\DiyProject\x-lead-studio
..\mockup-renderer\.venv\Scripts\python.exe -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
Copy-Item .env.example .env
```

Load `.env` in your preferred secret manager or PowerShell session, then run `./run.ps1`. Open `http://127.0.0.1:8020`. The marketing secret must match the DIY site's `MARKETING_INGEST_SECRET`.

The optional `install-startup-task.ps1` registers a hidden Windows logon task. Run it only after the workbench is configured and tested.

## Safety boundary

- One self-owned brand account, manually imported cookie, read-only X calls only.
- No login automation, posting, DMs, proxies, account pools, fingerprint spoofing, CAPTCHA handling, or challenge bypass.
- CAPTCHA, Cloudflare, authentication failure, or persistent throttling pauses collection.
- Original images and mockups are removed after seven days. Anonymous statistics and suppression records remain.
- Routine tests mock X and do not authenticate to X.
