# Product Requirements Document (PRD)
**Product Name:** Tickled Pink / VoidClub Entry System
**Type:** Web Application (Single-Page Application Frontend + Node.js/Express Backend)

## 1. Product Purpose
The Tickled Pink Entry System is a comprehensive web portal designed to manage ticketing, payments, guest lists, and entry validation for a nightclub or live event venue. It replaces physical tickets with a digital token system delivered via WhatsApp, streamlining the check-in process at the door while giving administrators real-time insights into venue capacity and revenue.

## 2. User Roles
The system serves three primary user personas:
1. **Public Guest:** A person visiting the website to buy tickets or register for the guest list.
2. **Bouncer (Doorman):** Ground staff at the venue who scan digital passes to grant or deny entry.
3. **Administrator:** The venue manager who oversees operations, reviews financial stats, manages the guest list, and handles manual entry overrides.

## 3. Core Workflows & Features

### A. Public Guest Flow (Ticketing & Registration)
- **Form Submission:** Guests enter their full name, WhatsApp number, Aadhaar (ID) number, party size, and the exact age of *each* person in the party.
- **Validation Rules:**
  - Mandatory age restriction: Every individual must be 18+. If anyone is underage, the entire party is denied registration.
  - Party limits and maximum venue capacity (e.g., 300) are strictly enforced before processing payment.
  - Duplication checks: A specific WhatsApp or Aadhaar number can only check in once per event/day.
- **Payment Gateway:** Integration with Razorpay to process ticket fees based on the selected tier (e.g., General, VIP).
- **Guestlist Access:** Pre-approved numbers skip payment if they are on the backend guest list.
- **Pass Delivery:** Upon successful registration/payment, a unique 6-character alphanumeric token is generated and sent to the guest via WhatsApp (using Twilio API).

### B. Bouncer Workflow (Scanner)
- **PIN Authentication:** Bouncers log in using a secured PIN.
- **Entry Validation:** Bouncers enter the guest's 6-character token. The system verifies:
  - Does the token exist?
  - Is the token valid for *today's* date?
  - Is the scan occurring within the specified "Doors Open" and "Doors Close" time window?
  - Was the guest previously "Kicked Out" and banned?
  - Has the token already been scanned? (If yes, it flags it as a "Re-entry").
- **Visual Feedback:** Shows clear Green (Allow), Yellow (Re-entry), or Red (Deny/Banned) screens.

### C. Administrator Dashboard
- **PIN Authentication:** Admins log in using a master PIN.
- **Live Statistics:** Real-time visibility into Total Bookings, Scanned In, Waitlist, Revenue, VIP vs. General split, and remaining venue capacity.
- **Guest Management:** View the master list of all attendees today.
- **Manual Overrides:** The ability to "Force Entry" (bypass the scanner) or "Kick Out" (revoke access and ban reentry) any specific guest.
- **Guestlist Pre-approval:** Admins can manually add name/WhatsApp combinations to a pre-approved guest list so those VIPs bypass standard payments.
- **Reporting:** Export today's complete data as a CSV file and quickly wipe/clear all data to prepare for the following night.

## 4. Technical Architecture
- **Frontend:** Vanilla HTML, CSS, and JavaScript. It functions as a Single-Page Application (SPA) where different "views" (public form, scanner, dashboard) are toggled via DOM manipulation.
- **Backend API:** Node.js framework utilizing Express.
- **Database:** PostgreSQL (hosted on Supabase) using the `pg` driver. Manages tables for `guests`, `guest_list`, and `audit_log`.
- **Integrations:**
  - Razorpay (Payment Processing)
  - Twilio (WhatsApp Messaging)
  - JSON Web Tokens (JWT) for session management (Admin/Bouncer roles)
  - bcryptjs for PIN hashing

## 5. Security & Edge Cases Handled
- **Rate Limiting:** Prevents brute-forcing of Bouncer/Admin PINs.
- **Concurrency/Timezones:** Normalizes all entry dates to local time (IST) to prevent UTC rollover bugs crossing past midnight.
- **Audit Logging:** Every critical action (failed auth, manual force entry, kick-outs, duplicate registration attempts, payment failures) is recorded in an `audit_log` table linking IP and timestamp.
