# eTuitionBd - Backend 🛠️

The backend power-house for the eTuitionBd platform. This server handles authentication, data persistence, payment processing, and real-time business logic.

Live Link: https://etuitionbd-the-best-tuition-media.netlify.app

## 🌟 Core Functionality

- **Secure Authentication**: Uses Firebase Admin SDK to verify Google/Email tokens and manage user roles (Student, Tutor, Admin).
- **Tuition Workflow**: API endpoints for creating, approving, and applying for tuitions.
- **Automated Notifications**: Server-side logic to bulk-notify tutors about new opportunities.
- **Payment Processing**: Full Stripe integration (Checkout Sessions and Payment Intent tracking).
- **Dashboard Analytics**: Complex MongoDB aggregations to provide stats for users and platform administrators.
- **Role-Based Access Control (RBAC)**: Custom middlewares (`verifySTUDENT`, `verifyTUTOR`, `verifyADMIN`) to secure sensitive routes.

## 🛠️ Technology Stack

- **Node.js & Express**: Fast and minimalist web framework.
- **MongoDB**: NoSQL database for flexible data modeling and high performance.
- **Firebase Admin SDK**: For robust server-side identity verification.
- **Stripe API**: Secure financial transactions and professional billing.
- **CORS & Security**: Standardized cross-origin handling and security headers.



Managed by [Dipto Kundu](https://github.com/Dipteskundu)
