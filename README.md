# 🎟️ TICKLED PINK — Premium Entry System

A sophisticated, secure, and visually stunning entry management system designed for modern clubs and events. Featuring an Apple-style glassmorphism UI, real-time bouncer scanning, and automated WhatsApp pass delivery.

![License](https://img.shields.io/badge/license-MIT-blue)
![Tech](https://img.shields.io/badge/stack-Node.js%20%7C%20Supabase%20%7C%20Razorpay-pink)

## ✨ Key Features

### 🕺 Guest Experience
- **Guided Check-In**: Seamless multi-step flow for Single, Couple, and Group entries.
- **Member Detail Collection**: Smart registration for all party members by name and age.
- **Instant Digital Pass**: Elegant entry passes sent directly to WhatsApp upon payment.
- **Secure Payments**: Integrated with Razorpay for safe and quick transactions.

### 🛡️ Bouncer & Security
- **Real-Time Scanner**: Lightweight, mobile-friendly token verification.
- **Entry Window Controls**: Automated door opening/closing hours.
- **Guest List Verification**: Match names and WhatsApp numbers against custom guest lists.
- **Safety Features**: Kick-out and re-entry banning capabilities.

### 📊 Administrative Control
- **Live Stats Dashboard**: Monitor venue capacity and revenue in real-time.
- **Guest Management**: Full searchable guest list with masked PII for security.
- **CSV Data Export**: One-click export for event reporting.
- **Capacity Management**: Automated door closing when max capacity is reached.

## 🛠️ Tech Stack
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (Custom Glassmorphism Design).
- **Backend**: Node.js, Express.
- **Database**: PostgreSQL (Supabase).
- **Payments**: Razorpay API.
- **Messaging**: Twilio WhatsApp API.
- **Auth**: JWT-based Secure Admin/Bouncer access.

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v18+)
- A Supabase or PostgreSQL database
- Razorpay Account (Test mode works)
- Twilio Account (for WhatsApp)

### 2. Installation
```bash
git clone https://github.com/logic1391/TICKLED-PINK-ENTRY-SYSTEM.git
cd TICKLED-PINK-ENTRY-SYSTEM
npm install
```

### 3. Environment Setup
Create a `.env` file in the root directory and add your credentials:
```env
PORT=3000
DATABASE_URL=your_postgres_url
JWT_SECRET=your_jwt_secret
ADMIN_PIN=1234
BOUNCER_PIN=9999

# Razorpay
RAZORPAY_KEY_ID=your_key_id
RAZORPAY_KEY_SECRET=your_secret

# Twilio
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_WA_FROM=whatsapp:+14155238886

# Event Config
CLUB_NAME=Tickled Pink
MAX_CAPACITY=300
MAX_PARTY_SIZE=30
DOORS_OPEN=21:00
DOORS_CLOSE=03:00
```

### 4. Run the Project
```bash
npm run dev
```
Open `http://localhost:3000` to see the application.

## 🎨 UI Design
The system utilizes a **Frosted Glass (Glassmorphism)** aesthetic, emphasizing depth and elegance. 
- **Skyblue Male Symbols (`♂`)** and **Pink Female Symbols (`♀`)** for intuitive gender-based selection.
- Dynamic responsive layouts optimized for both Desktop and Mobile devices.

---
Created with ❤️ for premium event management.
