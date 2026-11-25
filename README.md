# Team Resource & Compliance Tracker (v2)

A **100% GitHub + Google Sheets + Google Drive + Google Apps Script** practice management, statutory compliance, real-time resource availability, attendance, and weekly timesheet app built for CA firms.

- **Zero external paid backends**: No Supabase, no AppSheet, no Electron, no Microsoft 365 Entra ID.
- **Native Desktop Apps**: Lightweight Windows (`.exe`) and macOS (`.dmg`) installers built with **Tauri v2** (native OS WebView2 / WKWebView) via GitHub Actions.
- **Mobile & Web PWA**: Installable Progressive Web App hosted on **GitHub Pages** from the exact same `web/` codebase.
- **Work Email + PIN Login**: Pre-seeded for `shahrukh.kamal@vmgassociates.in` (temporary PIN `123456`) using salted SHA-256 hashes stored in `Employee_Master` — works with any Microsoft 365 / custom domain email without Entra ID.

## Included Modules & Business Rules

1. **7-Level Organizational Hierarchy**: `Executive` (1) → `Associate` (2) → `Senior Associate` (3) → `Manager` (4) → `Associate Director` (5) → `Associate Partner` (6) → `Partner` (7).
2. **Executive Screen Lock**: Executives see only `My Tasks`, `My To-Do`, `Weekly Timesheet`, `Mark Attendance`, and `My Archived Tasks`.
3. **Compliance Task Lifecycle & Audit Trail**: `Pending` → `In Process` → `Pending for Review` → `Approved` → `Filed` (auto-archived & permanently frozen). Enforces downward assignment, no self-approval, mandatory filing attachment, and one-time date locking (`completion_date`, `approval_date`, `filing_date`).
4. **Auto Resource Suggestion & Layered Availability**: Tracks active below-Manager staff with priority `On Leave / Exam Leave` → `Absent` → `Blocked` → `Free (0)` / `Available Soon (1)` / `Busy (2+)`, plus daily **11:00 AM IST self-status lock** and Partner `"Always Available"` rule.
5. **GPS Attendance Register**: One-click `Mark Present` with auto timestamp + Lat/Long and 10:30 AM IST Late detection.
6. **Previous-Week Mon–Sat Consulting Timesheet**: Auto-generated every Monday 9:00 AM IST, multiple client rows per day, `<= 10h/day` validation, lock & archive on `Submit Week`, plus Friday 6:00 PM IST reminder to unsubmitted Executives only.
7. **Google Drive Structured Storage & Weekly Backups**: Auto-named filings under `ComplianceTracker/<Client>/<Compliance>/<Client>_<Compliance>_<DD-MMM-YYYY>_<HHMMSS>.<ext>`, Client KYC folders, and automated Sunday 11:00 PM IST Excel + PDF backups.
8. **One Daily Digest Email Per Person (Free Gmail Safe)**: At 9:00 AM IST each day, Apps Script `MailApp` sends **at most one consolidated email per person** combining their overdue tasks, upcoming reminders (30/14/7/2/0 days), pending reviews, approved tasks ready to file, Day 1/3/7+ escalations, and (on Fridays) the Executive-only timesheet reminder—keeping a 35–50 person firm comfortably within Google's free `@gmail.com` 100/day email quota.

## 5-Minute Setup Guide

### Step 1 — Set up Google Sheets & Apps Script Backend
1. Create a new Google Sheet in your firm's Google Drive (e.g. `VMG Compliance Tracker DB`).
2. Click **Extensions → Apps Script**.
3. In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**.
4. Copy the contents of all 8 files from `apps-script/` into the Apps Script editor (`appsscript.json`, `config.gs`, `setup.gs`, `auth.gs`, `drive.gs`, `mail.gs`, `triggers.gs`, `Code.gs`).
5. Select `setupWorkbook` in the function dropdown and click **Run** (approve permissions once). This creates all 14 sheets, Drive folders, 10 Indian CA compliance templates, your initial Partner login (`shahrukh.kamal@vmgassociates.in` / PIN `123456`), and all 4 automated triggers.
6. Click **Deploy → New deployment → Web app**:
   - **Execute as**: `Me`
   - **Who has access**: `Anyone`
   - Click **Deploy** and copy the Web App URL.

### Step 2 — Connect Frontend & Push to GitHub
1. Paste your Web App URL into `web/config.js` (`API_URL`).
2. Push this folder to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: Team Resource & Compliance Tracker v2"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/<YOUR-REPO>.git
   git push -u origin main
   ```
3. In GitHub → **Settings → Pages → Source**, choose **GitHub Actions**. Your mobile PWA will publish automatically.
4. To build native **Windows `.exe`** and **macOS `.dmg`** installers, open the **Actions** tab → **Build Native Windows & macOS Desktop Installers (Tauri v2)** → **Run workflow** (or push a tag like `git tag v2.0.0 && git push origin v2.0.0`). Download the installers from **Releases**.
