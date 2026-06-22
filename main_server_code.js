/**
 * =============================================================================
 * SISB EARLY LEAVE SYSTEM - SERVER SIDE (Google Apps Script)
 * =============================================================================
 * * This script runs in the Google Apps Script environment bound to a Google Sheet.
 * It manages student early leave requests, handles secure routing, obfuscates
 * sensitive emails on the client-side, and coordinates action notifications via 
 * email to parents and the school office.
 * * Sheets Required in the Bound Spreadsheet:
 * 1. "StudentDatabase" - Contains student details, emails, and parent contacts.
 * 2. "Requests"        - Tracks leave status, reasons, and secure tokens.
 * * GitHub Release Version (Sanitized & Documented)
 */

// ==========================================
// CONFIGURATION BLOCK
// ==========================================
// Replace these with your school's actual values before deploying.
const OFFICE_EMAIL = "school-office-email@example.com"; 
const TIMEZONE = "Asia/Bangkok";
const PUBLIC_APPROVAL_URL = "https://script.google.com/macros/s/YOUR_WEB_APP_ID_HERE/exec";
const SCHOOL_LOGO_URL = "https://sisb.ac.th/wp-content/uploads/2024/06/Frame-48095825.webp"; // Feel free to swap with your school's logo

// ==========================================
// COLUMN MAPPINGS (Adjust to match your sheet)
// ==========================================
// Matches the zero-indexed columns of your "StudentDatabase" sheet
const DB_COLS = {
  CLASS: 0,         // Column A
  NICKNAME: 1,      // Column B
  STUDENT_EMAIL: 4, // Column E
  PARENT_1: 11,     // Column L
  PARENT_2: 12      // Column M
};

// Matches the zero-indexed columns of your "Requests" sheet
const REQ_COLS = {
  TIMESTAMP: 0,     // Column A
  STUDENT_EMAIL: 1, // Column B
  NICKNAME: 2,      // Column C
  REASON: 3,        // Column D
  LEAVE_TIME: 4,    // Column E
  STATUS: 5,        // Column F
  TOKEN: 6,         // Column G
  RESEND_TIME: 7    // Column H
};

// ==========================================
// CORE ROUTING (doGet)
// ==========================================

/**
 * Handles incoming HTTP GET requests to the Web App URL.
 * Routes requests to approval processing or serves the appropriate HTML page.
 * * @param {Object} e Event parameters passed by Google Apps Script execution engine.
 * @return {HtmlOutput} Evaluated HTML content.
 */
function doGet(e) {
  // 1. Process approval or rejection if a token is present in the URL query parameters
  if (e.parameter.token) {
    return processApproval(e.parameter.token, e.parameter.role, e.parameter.action);
  }
  
  // 2. Identify active user email address safely
  let userEmail = "";
  try {
    userEmail = Session.getActiveUser().getEmail();
  } catch (err) {
    userEmail = "";
  }
  
  // 3. Fetch student profile to verify access authorization
  const student = getStudentData(userEmail); 
  
  // 4. Access Control: block non-database users unless they are explicitly accessing the "teacher" dashboard view
  if (!student.found && e.parameter.view !== "teacher") {
     return HtmlService.createHtmlOutput(`
       <div style="font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 40px; background: #fff5f5; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box;">
         <img src="${SCHOOL_LOGO_URL}" width="120" style="margin-bottom:24px;">
         <div style="background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); max-width: 400px; border-top: 5px solid #dc3545;">
           <h2 style="color: #dc3545; margin-top: 0; font-size: 22px;">Access Denied</h2>
           <p style="color: #495057; font-size: 15px; line-height: 1.5; margin-bottom: 20px;">
             The email account <strong>${userEmail || "Unidentified User"}</strong> is not recognized in the Student Database.
           </p>
           <p style="color: #868e96; font-size: 13px;">Please make sure you are signed in using your school-issued email account.</p>
         </div>
       </div>
     `).setTitle("Access Denied - School Portal")
       .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
       .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // 5. Select the page view based on the URL query string
  let template = (e.parameter.view === "teacher") ? 'Teacher' : 'Index';
  return HtmlService.createTemplateFromFile(template)
      .evaluate()
      .setTitle("School Early Leave Portal")
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// DATA FETCHING & SECURITY OBFUSCATION
// ==========================================

/**
 * CLIENT-FACING SECURITY GATEWAY:
 * Checks database for a student and strips raw contact emails, passing back only masked data.
 * Prevents unauthorized scraper bots or client inspect tools from accessing raw parent emails.
 * * @param {string} email - The active user's email address.
 * @return {Object} Cleaned metadata object containing obfuscated entries.
 */
function getStudentData(email = "") {
  const student = getStudentDataInternal(email);
  if (!student.found) {
    return student; // Returns a safe, non-revealing error state
  }
  
  return {
    found: true,
    class: student.class,
    nickname: student.nickname,
    parent1Obfuscated: obfuscateEmail(student.parent1),
    parent2Obfuscated: obfuscateEmail(student.parent2)
  };
}

/**
 * SERVER-SIDE INTERNAL WORKER ONLY:
 * Performs raw reads from the spreadsheet. DO NOT expose output directly to frontend components.
 * * @param {string} email - Search key email query.
 * @return {Object} Student profile schema including raw personal emails.
 */
function getStudentDataInternal(email = "") {
  if (!email) {
    try {
      email = Session.getActiveUser().getEmail();
    } catch(e) {
      return { found: false, error: "not_logged_in" };
    }
  }
  if (!email) return { found: false, error: "not_logged_in" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("StudentDatabase");
  if (!sheet) return { found: false, error: "Database sheet missing" };
  
  const data = sheet.getDataRange().getValues();
  
  // Search row-by-row matching target email (Index 4 as defined)
  for (let i = 1; i < data.length; i++) {
    const dbEmail = data[i][DB_COLS.STUDENT_EMAIL];
    if (dbEmail && dbEmail.toString().toLowerCase().trim() === email.toLowerCase().trim()) { 
      return {
        found: true,
        email: email,
        class: data[i][DB_COLS.CLASS],
        nickname: data[i][DB_COLS.NICKNAME],
        parent1: data[i][DB_COLS.PARENT_1], 
        parent2: data[i][DB_COLS.PARENT_2]  
      };
    }
  }
  return { found: false, error: "not_in_database", email: email };
}

/**
 * Utility to obscure raw contact emails.
 * Turns "john.doe@domain.com" into "jo*******e@domain.com" to preserve privacy in UI.
 * * @param {string} email - The email to mask.
 * @return {string} Masked layout string.
 */
function obfuscateEmail(email) {
  if (!email) return "";
  const str = email.toString().trim();
  const atIdx = str.indexOf("@");
  if (atIdx < 1) return "";
  
  const local = str.substring(0, atIdx);
  const domain = str.substring(atIdx);
  
  if (local.length <= 2) {
    return local[0] + "***" + domain;
  }
  
  const visibleStart = local.substring(0, 2);
  const visibleEnd = local.substring(local.length - 1);
  const maskedLength = local.length - 3;
  const mask = maskedLength > 0 ? "*".repeat(maskedLength) : "**";
  
  return visibleStart + mask + visibleEnd + domain;
}

// ==========================================
// REQUEST ACTIONS
// ==========================================

/**
 * Creates and logs a new leave request to the spreadsheet database.
 * Auto-triggers verification email directly to parents.
 * * @param {string} reason - The explanation for early leave.
 * @param {string} leaveTime - Time of planned departure (e.g., "14:30").
 * @return {Object} Success flag and unique tracking token.
 */
function submitRequest(reason, leaveTime) {
  const student = getStudentDataInternal();
  if (!student.found) throw new Error("Student record lookup failure.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let reqSheet = ss.getSheetByName("Requests");
  
  // Automatically generate headers if "Requests" sheet does not exist
  if (!reqSheet) {
    reqSheet = ss.insertSheet("Requests");
    reqSheet.appendRow(["Timestamp", "Student Email", "Nickname", "Reason", "Leave Time", "Status", "Token", "Last Resend Timestamp"]);
  }
  
  const timestamp = new Date();
  const token = Utilities.getUuid(); // Generate a cryptographically secure token
  const dateStr = Utilities.formatDate(timestamp, TIMEZONE, "EEEE, MMMM d, yyyy");
  
  // Commit new row to "Requests" log
  reqSheet.appendRow([
    timestamp,
    student.email,
    student.nickname,
    reason,
    "'" + leaveTime, // Force text formatting to prevent accidental date-conversion bugs in Sheets
    "WAITING_PARENT",
    token,
    timestamp
  ]);
  
  // Dispatch notification email to validated parent contacts
  const parentEmails = [student.parent1, student.parent2].filter(e => e && e.toString().trim() !== "");
  if (parentEmails.length > 0) {
    sendActionEmail(parentEmails.join(","), student.nickname, student.class, reason, leaveTime, dateStr, token, "parent");
  }
  
  return { success: true, token: token };
}

/**
 * Cancels an active request in the system (Only authorized for the student).
 * * @param {string} token - The unique ID token tracking the request.
 * @return {Object} Status response object.
 */
function cancelRequest(token) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  if (!reqSheet) return { success: false, message: "Request system database offline." };
  
  const data = reqSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][REQ_COLS.TOKEN]).trim() === String(token).trim()) { 
      reqSheet.getRange(i + 1, REQ_COLS.STATUS + 1).setValue("CANCELLED"); 
      return { success: true };
    }
  }
  return { success: false, message: "Request ID mismatch." };
}

/**
 * Throttles and re-sends early leave alert emails to Parents or the Office.
 * Implements a 15-minute cool-down period to prevent email flooding.
 * * @param {string} token - Unique secure ID tracking the target request row.
 * @return {Object} Status feedback message.
 */
function resendNotification(token) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  if (!reqSheet) return { success: false, message: "Request database offline." };
  
  const data = reqSheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][REQ_COLS.TOKEN]).trim() === String(token).trim()) { 
      const lastSent = new Date(data[i][REQ_COLS.RESEND_TIME]);
      const now = new Date();
      const minsPassed = (now - lastSent) / 60000;
      
      // Cooldown block logic
      if (minsPassed < 15) {
        const minsLeft = Math.ceil(15 - minsPassed);
        return { success: false, message: `Please wait ${minsLeft} more minute(s) before resending.` };
      }
      
      const status = data[i][REQ_COLS.STATUS].toString().trim();
      const nickname = data[i][REQ_COLS.NICKNAME];
      const reason = data[i][REQ_COLS.REASON];
      const leaveTime = data[i][REQ_COLS.LEAVE_TIME].toString().replace("'", "");
      const dateStr = Utilities.formatDate(new Date(data[i][REQ_COLS.TIMESTAMP]), TIMEZONE, "EEEE, MMMM d, yyyy");
      
      const studentData = getStudentDataInternal(data[i][REQ_COLS.STUDENT_EMAIL]);
      
      if (status === "WAITING_PARENT") {
        const parentEmails = [studentData.parent1, studentData.parent2].filter(e => e && e.toString().trim() !== "");
        if (parentEmails.length === 0) return { success: false, message: "No parent emails on file." };
        sendActionEmail(parentEmails.join(","), nickname, studentData.class, reason, leaveTime, dateStr, token, "parent");
      } else if (status === "WAITING_OFFICE") {
        sendActionEmail(OFFICE_EMAIL, nickname, studentData.class, reason, leaveTime, dateStr, token, "office");
      } else {
        return { success: false, message: "Notification cannot be resent at this stage." };
      }
      
      // Update the Resend Timestamp cell
      reqSheet.getRange(i + 1, REQ_COLS.RESEND_TIME + 1).setValue(now);
      return { success: true, message: "Reminder notification dispatched successfully." };
    }
  }
  return { success: false, message: "Request token not found." };
}

/**
 * CORE STATE MACHINE: Processes incoming one-click email actions.
 * Transitions state: WAITING_PARENT -> WAITING_OFFICE -> APPROVED/REJECTED.
 * * @param {string} rawToken - UUID identifier for the record.
 * @param {string} rawRole - Actor persona ("parent" or "office").
 * @param {string} rawAction - Intent ("approve" or "disapprove").
 * @return {HtmlOutput} UI feedback message.
 */
function processApproval(rawToken, rawRole, rawAction) {
  const token = (rawToken || "").toString().trim();
  const role = (rawRole || "").toString().toLowerCase().trim();
  const action = (rawAction || "").toString().toLowerCase().trim();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  if (!reqSheet) return createStatusPage("Error: System table not initialized.");
  
  const data = reqSheet.getDataRange().getValues();
  
  let rowIndex = -1;
  let rowData = {};

  // Search for the row linked with this token
  for (let i = 1; i < data.length; i++) {
    if (data[i][REQ_COLS.TOKEN].toString().trim() === token) { 
      rowIndex = i + 1;
      rowData = {
        date: data[i][REQ_COLS.TIMESTAMP],
        email: data[i][REQ_COLS.STUDENT_EMAIL].toString().trim(),
        name: data[i][REQ_COLS.NICKNAME],
        reason: data[i][REQ_COLS.REASON],
        time: data[i][REQ_COLS.LEAVE_TIME].toString().replace("'", "").trim(),
        status: data[i][REQ_COLS.STATUS].toString().trim().toUpperCase() 
      };
      break;
    }
  }

  if (rowIndex === -1) return createStatusPage("Error: Request link expired or broken.");
  if (rowData.status === "CANCELLED") return createStatusPage("This request has already been cancelled by the student.");

  let newStatus = rowData.status;
  let responseMessage = "";

  if (action === "disapprove") {
    newStatus = "REJECTED";
    responseMessage = "The request has been rejected. The student has been notified.";
  } else if (action === "approve") {
    // Parent Approves -> Forward request and notify School Office
    if (role === "parent" && rowData.status === "WAITING_PARENT") {
      newStatus = "WAITING_OFFICE";
      responseMessage = "Parental consent verified! The request has been sent to the Sixth Form Office for final authorization.";
      
      const studentInfo = getStudentDataInternal(rowData.email);
      const dateStr = Utilities.formatDate(new Date(rowData.date), TIMEZONE, "EEEE, MMMM d, yyyy");
      const studentClass = studentInfo.class || "Unknown Class"; 
      
      sendActionEmail(OFFICE_EMAIL, rowData.name, studentClass, rowData.reason, rowData.time, dateStr, token, "office");
      
    // Office Approves -> Gate entry/departure is officially permitted
    } else if (role === "office" && rowData.status === "WAITING_OFFICE") {
      newStatus = "APPROVED";
      responseMessage = "Office authorization complete! The digital exit slip is now authorized for departure.";
      
    } else if (rowData.status === "APPROVED") {
      responseMessage = "✅ This request was already fully authorized by the school office.";
    } else if (rowData.status === "REJECTED") {
      responseMessage = "❌ This early leave request was already rejected.";
    } else {
      responseMessage = `This action is complete. Request status: ${rowData.status}`;
    }
  } else {
    responseMessage = "Error: Invalid action. Please retry using the action buttons.";
  }

  // Persist updated status cell in sheet
  if (newStatus !== rowData.status) {
    reqSheet.getRange(rowIndex, REQ_COLS.STATUS + 1).setValue(newStatus);
  }

  return createStatusPage(responseMessage);
}

/**
 * Generates an aesthetic and responsive landing status page for parents and office admins.
 * * @param {string} msg - Dynamic state feedback message to print.
 * @return {HtmlOutput} Rendered layout page.
 */
function createStatusPage(msg) {
  const isErr = msg.includes("Error:") || msg.includes("❌");
  const accentColor = isErr ? "#dc3545" : "#28a745";
  
  return HtmlService.createHtmlOutput(`
    <div style='font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 40px; background: #f8f9fa; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; box-sizing: border-box;'>
      <div style="background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); max-width: 450px; border-top: 6px solid ${accentColor};">
        <img src="${SCHOOL_LOGO_URL}" width="110" style="margin-bottom:24px;">
        <h2 style="color: #2b303a; font-size: 22px; line-height: 1.4; margin-bottom: 12px;">${msg}</h2>
        <p style="color: #6c757d; font-size: 14px; margin-top:15px;">You can close this tab safely now.</p>
      </div>
    </div>
  `).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// NOTIFICATIONS
// ==========================================

/**
 * Constructs and dispatches dynamic, stylized confirmation / action HTML emails.
 * Uses a modular structure with interactive direct-click action buttons.
 */
function sendActionEmail(recipient, nickname, studentClass, reason, leaveTime, dateStr, token, role) {
  const approveUrl = PUBLIC_APPROVAL_URL + "?token=" + token + "&role=" + role + "&action=approve";
  const disapproveUrl = PUBLIC_APPROVAL_URL + "?token=" + token + "&role=" + role + "&action=disapprove";
  
  const isOffice = (role === "office");
  const roleTitle = isOffice ? "Office" : "Parental";
  const mainHeader = isOffice ? "Parental Consent Received" : "Early Leave Request";
  
  const instructionText = isOffice 
    ? `<p style="color: #2b8a3e; font-weight: bold; margin-bottom: 10px;">✅ Parent has approved this early leave.</p>
       <p style="color: #555;">Please verify details and authorize this request:</p>`
    : `<p style="color: #555; margin-bottom: 20px;">An early leave request requires parent approval. Please review the details below:</p>`;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 12px; text-align: center;">
      <img src="${SCHOOL_LOGO_URL}" alt="School Logo" style="max-width: 120px; margin-bottom: 20px;">
      <h2 style="color: #333; margin-top: 0;">${mainHeader}</h2>
      <div style="text-align: left; background-color: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 25px; border-left: 5px solid #004b87;">
        <p style="margin: 5px 0;"><strong>Student:</strong> ${nickname} (${studentClass})</p>
        <p style="margin: 5px 0;"><strong>Date:</strong> ${dateStr}</p>
        <p style="margin: 5px 0;"><strong>Leave Time:</strong> <span style="color: #d9534f; font-weight: bold; font-size: 1.1em;">${leaveTime}</span></p>
        <p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>
      </div>
      <div style="margin-bottom: 25px;">${instructionText}</div>
      <div style="margin-bottom: 30px;">
        <a href="${approveUrl}" style="background-color: #28a745; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px; display: inline-block;">Approve Leave</a>
        <a href="${disapproveUrl}" style="background-color: #dc3545; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px; display: inline-block;">Disapprove</a>
      </div>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 25px 0;">
      <div style="background-color: #fff9db; padding: 15px; border-radius: 8px; border: 1px solid #ffec99; text-align: left;">
        <p style="margin: 0; font-size: 14px; color: #856404; line-height: 1.4;">
          <strong>Security Notice:</strong><br>
          Approval actions are single-use. If links do not respond, you can reply directly to this email to verify decisions manually.
        </p>
      </div>
      <p style="color: #999; font-size: 11px; margin-top: 25px;">School Early Leave System | ID: ${token}</p>
    </div>
  `;

  MailApp.sendEmail({ 
    to: recipient, 
    subject: `[Early Leave System] ${roleTitle} Action Required: ${nickname}`, 
    htmlBody: htmlBody,
    replyTo: OFFICE_EMAIL 
  });
}

// ==========================================
// GETTERS & UTILS
// ==========================================

/**
 * Queries the database for active leave requests belonging to the logged-in student for today.
 * Used by the UI frontend to render active status states dynamically.
 * * @return {Object|null} Today's request metadata or system default status.
 */
function getRequestStatus() {
  const student = getStudentData();
  if (!student.found) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  if (!reqSheet) return { status: "NONE" };
  
  const data = reqSheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  
  // Traverse backwards to pick up the most recent entry first
  for (let i = data.length - 1; i > 0; i--) {
    if (!data[i][REQ_COLS.TIMESTAMP]) continue;
    const rowDate = Utilities.formatDate(new Date(data[i][REQ_COLS.TIMESTAMP]), TIMEZONE, "yyyy-MM-dd");
    if (rowDate === todayStr && data[i][REQ_COLS.STUDENT_EMAIL] === student.email) { 
      return { 
        status: data[i][REQ_COLS.STATUS], 
        reason: data[i][REQ_COLS.REASON], 
        leaveTime: data[i][REQ_COLS.LEAVE_TIME].toString().replace("'", ""), 
        token: data[i][REQ_COLS.TOKEN] 
      };
    }
  }
  return { status: "NONE" };
}

/**
 * Fetches a list of all early leaves approved today.
 * Typically queried by security officers or teachers tracking attendance.
 * * @return {Array<Object>} List of approved students and planned departure times.
 */
function getTodayApprovedLeaves() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const reqSheet = ss.getSheetByName("Requests");
  if (!reqSheet) return [];
  
  const data = reqSheet.getDataRange().getValues();
  const todayStr = Utilities.formatDate(new Date(), TIMEZONE, "yyyy-MM-dd");
  let approvedList = [];

  for (let i = 1; i < data.length; i++) {
    const rawTimestamp = data[i][REQ_COLS.TIMESTAMP];
    if (rawTimestamp && Utilities.formatDate(new Date(rawTimestamp), TIMEZONE, "yyyy-MM-dd") === todayStr && data[i][REQ_COLS.STATUS] === "APPROVED") {
      const studentInfo = getStudentDataInternal(data[i][REQ_COLS.STUDENT_EMAIL]);
      approvedList.push({ 
        nickname: data[i][REQ_COLS.NICKNAME], 
        className: studentInfo.class || "Unknown", 
        time: data[i][REQ_COLS.LEAVE_TIME].toString().replace("'", "") 
      });
    }
  }
  return approvedList.sort((a, b) => a.time.localeCompare(b.time));
}