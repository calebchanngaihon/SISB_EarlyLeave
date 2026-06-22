🚪 Google Sheets Early Leave Portal

An automated, self-contained Student Early Leave Portal built entirely on the Google Apps Script (GAS) ecosystem and backed by Google Sheets. Designed to coordinate and authorize departures securely, this system handles the process from student submission to parental verification, administrative office approval, and active physical gate pass verification.

🌟 Key Features

🔒 Double-Gate Security Workflow:

$$\text{Student Request} \longrightarrow \text{Parental Email Consent} \longrightarrow \text{School Office Verification} \longrightarrow \text{Active Gate Pass}$$

📱 Dynamic Responsive Panels: Built with a clean, mobile-first design system suitable for standard student mobile screens or tablets at security gates.

🎨 Live, Color-Coded Exit Slip: A visually secure digital gate pass featuring a real-time running clock. The border color automatically rotates daily based on a secure pattern to prevent student spoofing at security gatehouses.

⏳ Throttled Resend Limits: Prevents email flooding by imposing a server-side 15-minute cooldown timer for reminding parent/admin approvers.

👩‍🏫 Teacher Registry Dashboard: A separate live dashboard view showing a chronological, searchable register of all students approved for early leave today.

🛡️ Secure Email Masking: Frontend components only receive obfuscated versions of parent emails (e.g., pa******1@domain.com), preventing scrapers and client inspect tools from harvesting raw contact data.

📊 Spreadsheet Database Architecture

To run this system, you need a Google Sheet with two sheets (tabs) configured exactly as follows:


| Column | Header Name | Description | Example Value |
| :--- | :--- | :--- | :--- |
| **A** | Class | Student's current room/form group | `Grade 11A` |
| **B** | Nickname | Student's common preferred name | `Alex` |
| **C** | Any | (Optional Placeholder) | |
| **D** | Any | (Optional Placeholder) | |
| **E** | Student Email | The school-issued Google/G Suite email | `alex.smith@school.com` |
| **F-K** | Any | (Optional Placeholders) | |
| **L** | Parent 1 Email | Primary contact for verification | `parent.one@domain.com` |
| **M** | Parent 2 Email | Secondary contact for verification | `parent.two@domain.com` |


2. Tab Name: Requests

This sheet logs all submitted early-leave entries, authorization states, and secure tracking signatures. If this sheet doesn't exist, the script will automatically initialize it with the following headers on the first submission:
 Timestamp (A) — Date and time of request.

Student Email (B) — Who made the request.

1. Nickname (C) — Student preferred name.
2. Reason (D) — Justification for departure.
3. Leave Time (E) — Target checkout time.
4. Status (F) — Tracks current state: WAITING_PARENT, WAITING_OFFICE, APPROVED, CANCELLED, or REJECTED.
5. Token (G) — A cryptographically secure UUID utilized for one-click action links.
6. Last Resend Timestamp (H) — Used to enforce email notification cooldown timers.

🚀 Installation & Deployment Instructions

Follow these steps to deploy this system for your school in under 10 minutes:

Step 1: Prepare the Google Sheet
Create a new Google Sheet.
Rename your default sheet tab to StudentDatabase and populate it with your student records following the column structure above.

Step 2: Open the Apps Script Editor
In your Google Sheet, click on Extensions > Apps Script.
Delete any default code in the editor.

Step 3: Add Code and Views
reate three separate files inside your Apps Script project matching these exact names:
* code.gs: Copy the entire contents of the server-side code file.
* Index.html: Create an HTML file, name it Index, and copy the contents of your student panel file.
* Teacher.html: Create a second HTML file, name it Teacher, and copy the contents of the teacher registry file.

Step 4: Configure Settings

At the top of your code.gs file, modify the parameter values to fit your local setup:

// ==========================================
// CONFIGURATION BLOCK
// ==========================================
const OFFICE_EMAIL = "your-office-email@school.com"; 
const TIMEZONE = "Asia/Bangkok"; // Set your school's local timezone
const PUBLIC_APPROVAL_URL = "PENDING_WEB_APP_URL"; // You will update this in Step 5
const SCHOOL_LOGO_URL = "https://your-school-logo-url.png"; 


Step 5: Publish the Web App

1. In the top-right of the Apps Script editor, click Deploy > New deployment.
2. Click the gear icon next to "Select type" and choose Web app.
3. Configure the settings exactly as follows:
   * Description: Early Leave Portal v1.0
   * Execute as: Me (your-admin-account@school.com) — Required to write to the sheet database on behalf of students and parents.
   * Who has access: Anyone — Allows external parent emails to process click-approvals without logging into a school domain account.
   * Click Deploy and authorize all required permissions when prompted.
   * Crucial: Copy the generated Web App URL.
   * Paste this URL into your code.gs configuration block as the value for PUBLIC_APPROVAL_URL.
   * Click Deploy > Manage deployments > Edit (pencil icon) > select New version, and click Deploy to publish the changes.

💡 Accessing Portal Views

Student Portal Access: Share the main Web App URL with students. Since the app executes under domain constraints, G Suite authentication automatically matches their login email with the StudentDatabase tab.

Teacher/Staff Dashboard Access: Append ?view=teacher to your Web App URL.

Example URL: https://script.google.com/macros/s/.../exec?view=teacher

(Tip: Bookmark this dashboard URL at security checkpoints, gatehouses, and admin desks).

📄 License

This project is open-source and free to adapt. Feel free to modify the interface branding, layout parameters, or notification templates to match your institution's custom procedures.
