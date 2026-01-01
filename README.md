# eTuitionBd – Backend 🛠️

The backend power-house for the eTuitionBd platform. This server handles authentication, data persistence, payment processing, and real-time business logic. It provides a robust API for the frontend single-page application.


## 🔗 Live Project

- **Backend API:** https://etuitionbd-server-dkbd.onrender.com
- **Frontend App:** https://etuitionbd-the-best-tuition-media.netlify.app



## 🚀 Core Features

- **Secure Authentication**: Uses Firebase Admin SDK to verify Google/Email tokens and manage user roles (Student, Tutor, Admin).
- **Tuition Workflow**: API endpoints for creating, approving, and applying for tuitions.
- **Automated Notifications**: Server-side logic to alert tutors about new opportunities and students about applications.
- **Payment Processing**: Full Stripe integration (Checkout Sessions and Payment Intent tracking).
- **Dashboard Analytics**: Complex MongoDB aggregations to provide stats for users and platform administrators.
- **Role-Based Access Control (RBAC)**: Custom middlewares (`verifySTUDENT`, `verifyTUTOR`, `verifyADMIN`) to secure sensitive routes.
- **Advanced Querying**: Search, filter, pagination, and sorting for tuition posts and tutors.


## 🛠️ Main Technologies Used

- **Node.js**: JavaScript runtime environment.
- **Express.js**: Fast, unopinionated web framework for Node.js.
- **MongoDB**: NoSQL database for flexible data modeling.
- **Firebase Admin SDK**: Server-side authentication and user management.
- **Stripe**: Payment processing infrastructure.
- **Cors**: Cross-Origin Resource Sharing handling.
- **Dotenv**: Environment variable management.


## 📦 Dependencies

Runtime dependencies (from `package.json`):

- `cors`: ^2.8.5
- `dotenv`: ^16.3.1
- `express`: ^4.18.2
- `firebase-admin`: ^11.11.1
- `mongodb`: ^6.3.0
- `stripe`: ^14.10.0

Development dependencies:

- `nodemon`: ^3.0.2


## 🧩 Project Structure (Backend)

The server currently follows a monolithic structure centered around `index.js` for rapid development and deployment simplicity:

- `index.js` – Main entry point containing all routes, database connections, and business logic.
- `assingment-11-service-key.json` – Firebase service account credentials (local dev).
- `.env` – Environment variables for configuration.
- `firebase-service-key.json` – (Legacy/Backup) Firebase credentials.


## 🧪 Environment Variables

Create a `.env` file in the project root and provide the required variables.

**Note on Deployment:** For Render.com, these variables must be added in the Dashboard.

```env
# Database Connection
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority

# Stripe Payments
STRIPE_SECRET_KEY=sk_test_...

# Port Configuration (Optional, defaults to 5000)
PORT=5000

# Firebase Configuration (For Production/Render)
# Paste the entire content of your service-account.json here
FIREBASE_SERVICE_ACCOUNT={"type": "service_account", "project_id": "...", ...}
```


## 🧾 How To Run The Project Locally

### 1. Prerequisites

- Node.js 18 or higher
- MongoDB Account (Atlas or Local)
- Firebase Project
- Stripe Account

### 2. Clone The Repository

```bash
git clone <your-repo-url>
cd eTuitionBd-server
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment

- Create a `.env` file at the project root.
- Add your MongoDB URI and Stripe Secret Key.
- Place your `assingment-11-service-key.json` file in the root directory for local Firebase authentication.

### 5. Start The Server

**Development Mode (using Nodemon):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

The server will typically run on `http://localhost:5000`.

