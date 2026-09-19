SOILMATES 4.0 — NEXT-GEN DIGITAL TWIN
=====================================

SECURE HACKATHON ACCESS
-----------------------
The public welcome screen now leads to a password page before the dashboard.
The dashboard and /api routes are protected by an HttpOnly session cookie.

LOCAL SETUP
-----------
1. Install Node.js.
2. Open this folder in a terminal.
3. Set the password before starting:

   Windows PowerShell:
   $env:SOILMATES_PASSWORD="YourJudgePassword"
   $env:NODE_ENV="development"

   Windows CMD:
   set SOILMATES_PASSWORD=YourJudgePassword

   macOS/Linux:
   export SOILMATES_PASSWORD="YourJudgePassword"
   export NODE_ENV=development

4. Run:
   npm install
   npm start

5. Open:
   http://localhost:3000

DEPLOYMENT
----------
Use a Node/Express host such as Render or Railway. Add the environment variable:
SOILMATES_PASSWORD = your private hackathon password
NODE_ENV = production

Do NOT put the real password inside public HTML or JavaScript.
Do NOT commit a .env file containing the real password to GitHub.

NOTE
----
This is intentionally lightweight protection for a hackathon demo, not a high-security production authentication system. Sessions are stored in server memory and expire after 12 hours or when the server restarts.
