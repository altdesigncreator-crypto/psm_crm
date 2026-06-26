# Requirements Document

## 1. Application Overview

**Application Name**: Enterprise Sales CRM

**Description**: A premium, professional CRM application designed for top-tier Real Estate brands to manage customer leads, track sales progress, and analyze business metrics. The system integrates Firebase Auth for authentication, Firestore Database for real-time data storage, and Firebase Storage for media file management.

## 2. Users and Usage Scenarios

**Target Users**: Real Estate sales teams, sales managers, and business executives

**Core Usage Scenarios**:
- Sales managers monitor overall lead distribution and conversion metrics
- Sales representatives add new customer leads with voice notes and location data
- Team members track follow-up tasks and update lead statuses
- Executives export lead data for external analysis and reporting

## 3. Page Structure and Functionality

```
Enterprise Sales CRM
├── Login Page
├── Registration Page
└── Main Application
    ├── Main Dashboard (Boss View)
    ├── Add Customer Lead Form
    └── Customer Leads Table
```

### 3.1 Login Page

**Purpose**: User authentication entry point

**Functionality**:
- Email and password input fields
- Login button to authenticate via Firebase Auth
- Link to Registration Page
- Error message display for failed login attempts

### 3.2 Registration Page

**Purpose**: New user account creation

**Functionality**:
- Email and password input fields
- Confirm password field
- Register button to create account via Firebase Auth
- Link to Login Page
- Error message display for registration failures

### 3.3 Main Dashboard (Boss View)

**Purpose**: Display high-level business metrics and visual analytics

**Functionality**:
- Display three metric cards showing real-time data from Firestore 'leads' collection:
  - Total Leads: Count of all lead records
  - Follow Up Remaining: Count of leads with status \"Follow Up\"
  - Success/Sold: Count of leads with status \"Success\"
- Pie Chart visualization showing \"Leads by Project\" distribution:
  - Projects: Dagon Landmark Residence, Emerald Bay Tower 3, Perfect Signature Residence, Bahtoo Gyi Condo
  - Data fetched dynamically from Firestore
- Bar Chart visualization showing \"Leads by Status\" distribution:
  - Statuses: New, Contacted, Follow Up, Success
  - Data fetched dynamically from Firestore
- Navigation to Add Customer Lead Form and Customer Leads Table

### 3.4 Add Customer Lead Form

**Purpose**: Capture new customer lead information with enhanced data collection

**Functionality**:
- Input fields:
  - Name (text input, required)
  - Phone Number (text input, required)
  - Project (dropdown selection, required)
    - Options: Dagon Landmark Residence, Emerald Bay Tower 3, Perfect Signature Residence, Bahtoo Gyi Condo
  - Status (dropdown selection, required)
    - Options: New, Contacted, Follow Up, Success
- Voice Recording feature:
  - \"Start Recording\" button with microphone icon
  - Record audio for up to 30 seconds using Web Audio API
  - Upload recorded audio file to Firebase Storage
  - Save audio file URL to Firestore lead document
- Location Tracking:
  - Automatically capture user's GPS coordinates (Latitude/Longitude) using HTML5 Geolocation API upon form submission
  - Save coordinates to Firestore lead document
- Submit button to save lead data to Firestore 'leads' collection
- Form validation and error message display

### 3.5 Customer Leads Table

**Purpose**: Display and manage all customer leads with real-time updates

**Functionality**:
- Display all leads from Firestore 'leads' collection in a structured data table
- Table columns:
  - Name
  - Phone Number
  - Project
  - Status (displayed as pill-shaped colored badge)
  - Voice Note (inline audio player, displayed only if audio URL exists)
  - Location (\"View Map\" link, displayed only if GPS coordinates exist)
- Status badge color coding:
  - Success: Green background
  - Follow Up: Yellow background
  - New: Blue background
  - Contacted: Gray background
- \"View Map\" link functionality:
  - Opens GPS coordinates in inline modal or Google Maps
- \"Export to CSV\" button at top of table:
  - Downloads all current leads as CSV file
  - CSV headers: Name, Phone, Project, Status
- Real-time data synchronization with Firestore

## 4. Business Rules and Logic

### 4.1 Authentication Flow
- Users must complete registration before accessing the application
- Successful login redirects to Main Dashboard
- Unauthenticated users are redirected to Login Page

### 4.2 Lead Data Management
- All lead data is stored in Firestore 'leads' collection
- Each lead document contains: name, phone, project, status, timestamp, optional voiceNoteURL, optional latitude, optional longitude
- Dashboard metrics and charts update in real-time when lead data changes
- Customer Leads Table updates in real-time when lead data changes

### 4.3 Voice Recording Rules
- Recording duration is limited to 30 seconds maximum
- Audio files are uploaded to Firebase Storage upon recording completion
- Audio file URL is saved to corresponding lead document in Firestore

### 4.4 Location Tracking Rules
- GPS coordinates are captured automatically when Add Customer Lead Form is submitted
- Location capture uses HTML5 Geolocation API
- Coordinates are saved as latitude and longitude fields in Firestore

### 4.5 CSV Export Rules
- Export includes all leads currently displayed in Customer Leads Table
- CSV file format includes headers: Name, Phone, Project, Status
- File is downloaded directly to user's device

## 5. Exceptions and Boundary Cases

| Scenario | Handling |
|----------|----------|
| User denies geolocation permission | Lead is saved without GPS coordinates; \"View Map\" link is not displayed |
| Voice recording fails or is not supported | Lead is saved without voice note; audio player is not displayed |
| Firebase Storage upload fails | Display error message; allow user to retry submission |
| Firestore connection lost | Display error message; retry data fetch automatically |
| No leads exist in database | Display empty state message in Customer Leads Table |
| Chart data is empty | Display empty chart with placeholder message |
| Invalid email format during registration | Display validation error message |
| Weak password during registration | Display password strength requirement message |
| CSV export with no data | Display message indicating no data available to export |

## 6. Acceptance Criteria

1. User completes registration with email and password, account is created in Firebase Auth
2. User logs in successfully and is redirected to Main Dashboard
3. Main Dashboard displays three metric cards with accurate real-time counts from Firestore
4. Main Dashboard displays Pie Chart showing lead distribution by project and Bar Chart showing lead distribution by status
5. User navigates to Add Customer Lead Form, fills in Name, Phone Number, Project, and Status
6. User clicks \"Start Recording\" button, records voice note for up to 30 seconds, audio file is uploaded to Firebase Storage
7. User submits form, GPS coordinates are captured, and lead data (including voice note URL and GPS coordinates) is saved to Firestore
8. User navigates to Customer Leads Table, all leads are displayed in real-time with correct status badge colors
9. User clicks \"View Map\" link for a lead with GPS coordinates, map view opens showing location
10. User clicks inline audio player for a lead with voice note, audio plays successfully
11. User clicks \"Export to CSV\" button, CSV file containing all leads is downloaded to device

## 7. Out of Scope for Current Release

- Lead editing or deletion functionality
- Advanced filtering or search capabilities in Customer Leads Table
- User role management or permission controls
- Email or SMS notification system for follow-up reminders
- Integration with external CRM platforms or third-party APIs
- Mobile application version
- Multi-language support beyond Myanmar text legibility
- Lead assignment to specific sales representatives
- Historical data tracking or audit logs
- Bulk import of leads from external files
- Custom report generation beyond CSV export
- Lead scoring or prioritization algorithms
- Calendar integration for scheduling follow-ups
- Document attachment functionality for leads
- Social media integration for lead capture