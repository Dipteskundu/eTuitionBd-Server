const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');
const stripe = require('stripe');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: [process.env.CLIENT_DOMAIN, 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());

// Initialize Services
// Stripe
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);

// Firebase Admin
// Firebase Admin
try {
    let serviceAccount;
    try {
        // Try local file first (Easy dev)
        serviceAccount = require('./assingment-11-service-key.json');
    } catch (e) {
        // If file not found or error, ignore and check env
    }

    if (!serviceAccount && process.env.FB_SERVICE_KEY) {
        // Fallback to Env Var (Production)
        serviceAccount = JSON.parse(Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('ascii'));
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        console.log("Firebase Admin Initialized");
    } else {
        console.error("Firebase Admin NOT Initialized: Missing service key file or FB_SERVICE_KEY env var");
    }
} catch (error) {
    console.error("Firebase Admin Init Error:", error.message);
}

// MongoDB Connection
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    connectTimeoutMS: 5000,
    socketTimeoutMS: 5000,
    serverSelectionTimeoutMS: 5000
});

async function run() {
    try {
        await client.connect();

        const db = client.db("tuitionDB");
        const usersCollection = db.collection("users");
        const tuitionsCollection = db.collection("tuitions"); // Keeping for legacy/safekeeping if needed
        const tuitionsPostCollection = db.collection("tuitions-post"); // NEW Collection
        const applicationsCollection = db.collection("tutorApplications");
        const paymentsCollection = db.collection("payments");
        const roleRequestsCollection = db.collection("teacherRoleRequests"); // NEW Collection: Role Requests

        // ========================================
        // MIDDLEWARE: JWT Verification
        // ========================================
        const verifyJWT = async (req, res, next) => {
            const authorization = req.headers.authorization;
            if (!authorization) {
                return res.status(401).send({ message: 'Unauthorized access: No token provided' });
            }

            const token = authorization.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'Unauthorized access: Invalid token format' });
            }

            try {
                const decodedToken = await admin.auth().verifyIdToken(token);
                req.decoded = decodedToken;
                req.tokenEmail = decodedToken.email;
                next();
            } catch (error) {
                console.error('JWT Verification Error:', error.message);
                return res.status(401).send({ message: 'Unauthorized access: Invalid token' });
            }
        };

        // ========================================
        // MIDDLEWARE: Role Verification
        // ========================================
        const verifySTUDENT = async (req, res, next) => {
            const email = req.tokenEmail;
            const user = await usersCollection.findOne({ email: email });

            if (!user || user.role !== 'student') {
                return res.status(403).send({ message: 'Forbidden: Student access required' });
            }
            next();
        };

        const verifyTUTOR = async (req, res, next) => {
            const email = req.tokenEmail;
            const user = await usersCollection.findOne({ email: email });

            if (!user || user.role !== 'tutor') {
                return res.status(403).send({ message: 'Forbidden: Tutor access required' });
            }
            next();
        };

        const verifyADMIN = async (req, res, next) => {
            const email = req.tokenEmail;
            const user = await usersCollection.findOne({ email: email });

            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden: Admin access required' });
            }
            next();
        };

        // ========================================
        // USER MANAGEMENT APIs
        // ========================================

        // 1. Create User (POST /user) - Used by Register & Login
        app.post('/user', async (req, res) => {
            const user = req.body;
            // Ensure displayName is saved if provided
            if (user.displayName && !user.name) user.name = user.displayName;

            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // 2. Get User Role (GET /users/:email) - Used by AuthContext
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send(user);
        });

        // 3. Get All Users (GET /users) - Used by Admin ManageUsers
        app.get('/users', verifyJWT, verifyADMIN, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // 4. Delete User (DELETE /user/:id) - Used by Admin ManageUsers
        app.delete('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await usersCollection.deleteOne(query);
            res.send(result);
        });

        // 5. Get My Profile (GET /user/profile) - Used by ProfileSettings
        app.get('/user/profile', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user) {
                // Map name to displayName for frontend compatibility if needed
                user.displayName = user.name || user.displayName;
            }
            res.send(user);
        });

        // 6. Update My Profile (PUT /user/profile) - Used by ProfileSettings
        app.put('/user/profile', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const item = req.body;
            const filter = { email: email };

            const updateFields = {
                phone: item.phone,
                photoURL: item.photoURL || item.image
            };
            if (item.displayName) updateFields.name = item.displayName;

            // Remove undefined fields
            Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

            const updateDoc = {
                $set: updateFields
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // 0. Admin Analytics (GET /reports/analytics)
        app.get('/reports/analytics', verifyJWT, verifyADMIN, async (req, res) => {
            const totalUsers = await usersCollection.countDocuments();
            const totalStudentCount = await usersCollection.countDocuments({ role: 'student' });
            const totalTutorCount = await usersCollection.countDocuments({ role: 'tutor' });
            const totalTuitions = await tuitionsPostCollection.countDocuments();

            const payments = await paymentsCollection.find({ status: 'paid' }).toArray();
            const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

            res.send({
                totalUsers,
                totalTuitions,
                totalStudentCount,
                totalTutorCount,
                totalRevenue
            });
        });

        // 7. Get All Tuitions for Admin (GET /admin/tuitions)
        app.get('/admin/tuitions', verifyJWT, verifyADMIN, async (req, res) => {
            const result = await tuitionsPostCollection.find().sort({ created_at: -1 }).toArray();
            res.send(result);
        });

        // 8. Update Tuition Status (PATCH /tuition-status/:id)
        app.patch('/tuition-status/:id', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: status, updated_at: new Date() }
            };
            const result = await tuitionsPostCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // ... (in STUDENT APIs)



        // ...


        // ========================================
        // PUBLIC APIs
        // ========================================

        // Get All Tutors (GET /tutors) - Public Access
        app.get('/tutors', async (req, res) => {
            try {
                const query = { role: 'tutor' };
                const tutors = await usersCollection.find(query).toArray();
                res.send(tutors);
            } catch (error) {
                console.error('Error fetching tutors:', error);
                res.status(500).send({ message: 'Failed to fetch tutors' });
            }
        });

        // Get Public Generic Tuitions (GET /tuitions) - Public Access
        app.get('/tuitions', async (req, res) => {
            // Requirement: "Shown in Tuition page that can see every one without login"
            // Showing all approved tuitions
            const query = { status: 'approved' };
            const result = await tuitionsPostCollection.find(query).sort({ created_at: -1 }).toArray();

            // Format for frontend (Tuitions.jsx expects res.data.data)
            res.send({ data: result, total: result.length });
        });

        // ---------------------------------------------------------
        // TUTOR APIs
        // ---------------------------------------------------------

        // Apply for Tuition (POST /apply-tuition)
        app.post('/apply-tuition', verifyJWT, verifyTUTOR, async (req, res) => {
            const { tuitionId, experience, qualification, expectedSalary } = req.body;
            const tutorEmail = req.tokenEmail;

            // 1. Check if already applied
            const existingApp = await applicationsCollection.findOne({
                tutorEmail: tutorEmail,
                tuitionId: tuitionId
            });
            if (existingApp) {
                return res.status(409).send({ message: 'Already applied' });
            }

            // 2. Get Tuition Details
            const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(tuitionId) });
            if (!tuition) {
                return res.status(404).send({ message: 'Tuition not found' });
            }

            // Strict Validation Rules
            if (tuition.status !== 'approved') {
                return res.status(403).send({ message: 'Tuition is not open for applications' });
            }
            if (tuition.assignedTutorEmail || tuition.assignedTutorId) {
                return res.status(409).send({ message: 'Tuition already assigned to a tutor' });
            }

            // 3. Create Application
            const newApplication = {
                tuitionId: tuitionId,
                tutorEmail: tutorEmail,
                studentEmail: tuition.studentId, // studentId stores email in this system
                experience,
                qualification,
                expectedSalary,
                status: 'pending',
                subject: tuition.subject,
                created_at: new Date()
            };

            const result = await applicationsCollection.insertOne(newApplication);
            res.send(result);
        });

        // Get Active Tuition Posts (Strict Requirement: GET /tuitions-post)
        // Only for Tutors, Only 'open' status.
        app.get('/tuitions-post', verifyJWT, verifyTUTOR, async (req, res) => {
            // Strict requirements: Fetch only active/approved posts
            // Frontend sends ?status=approved
            const status = req.query.status || 'approved';
            const query = { status: status };

            // Support Filters
            // Frontend sends 'class', 'subject', 'location'
            const { subject, location, class: classParam } = req.query;

            if (subject) query.subject = { $regex: subject, $options: 'i' };
            if (location) query.location = { $regex: location, $options: 'i' };
            if (classParam) query.class = { $regex: classParam, $options: 'i' }; // Partial match for class is better

            const result = await tuitionsPostCollection.find(query)
                .sort({ created_at: -1 })
                .toArray();

            res.send(result);
        });

        // Legacy/Generic GET /tuitions (Public) -> Should probably be disabled or point to new collection with restriction?
        // User says "Tuition posts are not visible to other students anywhere".
        // Public route allows anyone. I should RESTRICT this or changing it to use verifyTUTOR?
        // To be safe and strict: I will leave generic /tuitions for now but make it return empty or restrict it. 
        // Actually, I'll update the Tutor Dashboard to use `/tuitions-post` and ignore `/tuitions`.


        app.get('/my-applications', verifyJWT, verifyTUTOR, async (req, res) => {
            const email = req.tokenEmail;
            const query = { tutorEmail: email };
            const result = await applicationsCollection.find(query).toArray();
            res.send(result);
        });

        // ========================================
        // TEACHER ROLE REQUEST APIs
        // ========================================

        // 1. Create Role Request (POST /role-requests) - Student Only
        app.post('/role-requests', verifyJWT, verifySTUDENT, async (req, res) => {
            const request = req.body;
            const email = req.tokenEmail;

            // Check if pending request exists
            const existing = await roleRequestsCollection.findOne({
                userId: email,
                status: 'pending'
            });

            if (existing) {
                return res.status(409).send({ message: 'You already have a pending request.' });
            }

            const newRequest = {
                userId: email, // Using email as ID
                userName: request.userName,
                userEmail: email,
                currentRole: 'student',
                requestedRole: 'tutor',
                status: 'pending',
                created_at: new Date(),
                reviewedBy: null,
                reviewedAt: null
            };

            const result = await roleRequestsCollection.insertOne(newRequest);
            res.send(result);
        });

        // 2. Get My Requests (GET /role-requests/my) - Student/Tutor
        app.get('/role-requests/my', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const result = await roleRequestsCollection.find({ userId: email }).sort({ created_at: -1 }).toArray();
            res.send(result);
        });

        // 3. Get All Pending Requests (GET /role-requests) - Admin Only
        app.get('/role-requests', verifyJWT, verifyADMIN, async (req, res) => {
            const status = req.query.status;
            let query = {};
            if (status) query.status = status;

            const result = await roleRequestsCollection.find(query).sort({ created_at: -1 }).toArray();
            res.send(result);
        });

        // 4. Admin Action: Approve/Reject (PATCH /role-requests/:id)
        app.patch('/role-requests/:id', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id;
            const { status, adminId } = req.body; // status: 'approved' | 'rejected'

            const request = await roleRequestsCollection.findOne({ _id: new ObjectId(id) });
            if (!request) return res.status(404).send({ message: 'Request not found' });

            if (status === 'approved') {
                // Update User Role in Users Collection
                const userUpdate = await usersCollection.updateOne(
                    { email: request.userEmail },
                    { $set: { role: 'tutor' } }
                );

                if (userUpdate.modifiedCount === 0) {
                    // Should not happen unless user deleted
                    // Proceeding to update request status anyway or handle error?
                    // Let's assume success for now, but log it.
                    console.warn(`User ${request.userEmail} not found while approving role.`);
                }
            }

            // Update Request Status
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    status: status,
                    reviewedBy: req.tokenEmail,
                    reviewedAt: new Date()
                }
            };

            const result = await roleRequestsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // ========================================
        // STUDENT APPLICATION MANAGEMENT & PAYMENT
        // ========================================

        // Phase 2: Fetch Applications for a Student (GET /student-applications/:studentId)
        app.get('/student-applications/:studentId', verifyJWT, verifySTUDENT, async (req, res) => {
            const studentId = req.params.studentId;
            // In our system, studentId is often the email. 
            // Verify requested ID matches token to prevent spying
            if (studentId !== req.tokenEmail) {
                return res.status(403).send({ message: 'Forbidden access' });
            }

            const query = { studentEmail: studentId };
            const result = await applicationsCollection.find(query).sort({ created_at: -1 }).toArray();

            // Enrich with Tutor Details and Tuition Title
            for (let app of result) {
                // Attach Tutor Info
                const tutor = await usersCollection.findOne({ email: app.tutorEmail });
                if (tutor) {
                    app.tutorName = tutor.name;
                    app.tutorPhoto = tutor.photoURL || tutor.image;
                }
                // Attach Tuition Info (Subject, Class)
                if (app.tuitionId) {
                    const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(app.tuitionId) });
                    if (tuition) {
                        app.tuitionTitle = `${tuition.subject} (Class ${tuition.class})`;
                        app.tuitionSubject = tuition.subject;
                        app.tuitionClass = tuition.class;
                        app.tuitionSalary = tuition.salary;
                    }
                }
            }
            res.send(result);
        });

        // Phase 1: Submit Application (POST /tuition-application)
        // Aliasing logic to support prompt requirement
        app.post('/tuition-application', verifyJWT, verifyTUTOR, async (req, res) => {
            const { tuitionId, message, expectedSalary, availability, experience } = req.body;
            const tutorEmail = req.tokenEmail;

            // 1. Check if already applied
            const existingApp = await applicationsCollection.findOne({
                tutorEmail: tutorEmail,
                tuitionId: tuitionId
            });
            if (existingApp) {
                return res.status(409).send({ message: 'Already applied' });
            }

            // 2. Get Tuition Details
            const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(tuitionId) });
            if (!tuition) return res.status(404).send({ message: 'Tuition not found' });
            if (tuition.status !== 'approved') return res.status(403).send({ message: 'Tuition is not open' });

            // 3. Create Application
            const newApplication = {
                tuitionId,
                tutorEmail,
                studentEmail: tuition.studentId,
                message, // New Field
                expectedSalary, // New Field
                availability, // New Field
                experience, // Keeping legacy support
                status: 'pending',
                created_at: new Date()
            };

            const result = await applicationsCollection.insertOne(newApplication);
            res.send({ success: true, ...result });
        });

        // ALLIED & STRICT API Endpoints for Full Implementation Prompt

        // 1. GET Applications for Tuition (Strict: GET /applications/:tuitionId)
        app.get('/applications/:tuitionId', verifyJWT, verifySTUDENT, async (req, res) => {
            const tuitionId = req.params.tuitionId;
            const query = { tuitionId: tuitionId };
            const result = await applicationsCollection.find(query).toArray();

            // Enrich with Tutor Details for Frontend UI
            for (let app of result) {
                const tutor = await usersCollection.findOne({ email: app.tutorEmail });
                if (tutor) {
                    app.tutorName = tutor.name; // Crucial for displaying name
                    app.tutorPhoto = tutor.photoURL || tutor.image;
                }
            }
            res.send(result);
        });

        // 2. DELETE Application (Strict: DELETE /applications/:id)
        app.delete('/applications/:id', verifyJWT, verifySTUDENT, async (req, res) => {
            const id = req.params.id;
            const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });

        // (Keeping legacy endpoint for backwards compatibility if needed, but the new one covers it)
        // Get Applications for a Tuition (GET /applied-tutors/:tuitionId)
        app.get('/applied-tutors/:tuitionId', verifyJWT, verifySTUDENT, async (req, res) => {
            const tuitionId = req.params.tuitionId;
            const query = { tuitionId: tuitionId };
            const result = await applicationsCollection.find(query).toArray();

            // Attach Tutor Name
            for (let app of result) {
                const tutor = await usersCollection.findOne({ email: app.tutorEmail });
                if (tutor) app.tutorName = tutor.name;
            }
            res.send(result);
        });

        // Reject Application (POST /reject-tutor)
        app.post('/reject-tutor', verifyJWT, verifySTUDENT, async (req, res) => {
            const { applicationId } = req.body;
            const filter = { _id: new ObjectId(applicationId) };
            const updateDoc = { $set: { status: 'rejected' } };
            const result = await applicationsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // Process Demo Payment (POST /process-payment)
        app.post('/process-payment', verifyJWT, verifySTUDENT, async (req, res) => {
            const { applicationId, tuitionId, tutorEmail, amount, method, transactionId } = req.body;
            const studentEmail = req.tokenEmail;

            // 1. Record Payment
            const payment = {
                transactionId,
                studentEmail,
                tutorEmail,
                tuitionId,
                applicationId,
                amount: parseFloat(amount),
                currency: 'BDT',
                status: 'paid',
                method: method || 'Demo Card',
                date: new Date()
            };
            const paymentResult = await paymentsCollection.insertOne(payment);

            // 2. Update Application Status to 'accepted'
            await applicationsCollection.updateOne(
                { _id: new ObjectId(applicationId) },
                { $set: { status: 'accepted' } }
            );

            // 3. Close the Tuition Post and Assign Tutor
            await tuitionsPostCollection.updateOne(
                { _id: new ObjectId(tuitionId) },
                { $set: { status: 'closed', assignedTutorEmail: tutorEmail } }
            );

            res.send({ success: true, paymentId: paymentResult.insertedId });
        });

        // Demo Payment API (POST /payments/demo)
        app.post('/payments/demo', verifyJWT, verifySTUDENT, async (req, res) => {
            const { applicationId, tuitionId, tutorEmail, amount } = req.body;
            const studentEmail = req.tokenEmail;

            // 1. Simulate Payment Success
            const transactionId = 'DEMO_' + new Date().getTime();

            // 2. Record Payment
            const payment = {
                transactionId,
                studentEmail,
                tutorEmail,
                tuitionId,
                applicationId,
                amount: parseFloat(amount),
                currency: 'BDT',
                status: 'paid', // Success
                method: 'Demo PaymentSystem',
                date: new Date()
            };
            const paymentResult = await paymentsCollection.insertOne(payment);

            // 3. Update Application Status to 'approved'
            await applicationsCollection.updateOne(
                { _id: new ObjectId(applicationId) },
                { $set: { status: 'approved', paymentId: transactionId } }
            );

            // 4. Close Tuition and Assign Tutor
            await tuitionsPostCollection.updateOne(
                { _id: new ObjectId(tuitionId) },
                { $set: { status: 'ongoing', assignedTutorEmail: tutorEmail, assignedTutorId: tutorEmail } }
            );

            // 5. Reject other applications for this tuition
            await applicationsCollection.updateMany(
                { tuitionId: tuitionId, _id: { $ne: new ObjectId(applicationId) } },
                { $set: { status: 'rejected' } }
            );

            res.send({ success: true, paymentId: transactionId, status: "Success" });
        });

        // Patch Application Status (PATCH /applications/:id)
        app.patch('/applications/:id', verifyJWT, verifySTUDENT, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body; // Expecting 'rejected'

            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { status: status }
            };
            const result = await applicationsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // Get My Payments (Student & Tutor) - Enriched
        app.get('/my-payments', verifyJWT, async (req, res) => {
            const email = req.tokenEmail;
            const query = {
                $or: [
                    { studentEmail: email },
                    { tutorEmail: email }
                ]
            };
            const payments = await paymentsCollection.find(query).sort({ date: -1 }).toArray();

            // Enrich with details
            for (let payment of payments) {
                // Get Tuition Title
                if (payment.tuitionId) {
                    const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(payment.tuitionId) });
                    if (tuition) payment.tuitionTitle = tuition.subject;
                }

                // Get Other Party Name
                const otherEmail = payment.studentEmail === email ? payment.tutorEmail : payment.studentEmail;
                const user = await usersCollection.findOne({ email: otherEmail });
                if (user) payment.otherName = user.name;
            }

            res.send(payments);
        });

        app.get('/tutor/dashboard-stats', verifyJWT, verifyTUTOR, async (req, res) => {
            const email = req.tokenEmail;

            // Earnings
            const payments = await paymentsCollection.find({ tutorEmail: email, status: 'paid' }).toArray();
            const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

            // Active Tuitions (Approved Applications/Positions)
            // Assuming 'approved' application means they got the job. 
            // Better yet, check if they are the assigned tutor in a tuition? 
            // For now, based on application acceptance + payment success flow:
            const activeTuitionsCount = await applicationsCollection.countDocuments({ tutorEmail: email, status: 'approved' });

            // Total Applications
            const totalApplications = await applicationsCollection.countDocuments({ tutorEmail: email });

            res.send({
                totalEarnings,
                activeTuitionsCount,
                totalApplications,
                // Profile views is mocked for now as we don't track it
                profileViews: 0
            });
        });

        app.get('/tutor/recent-activities', verifyJWT, verifyTUTOR, async (req, res) => {
            const email = req.tokenEmail;

            // Combine recent applications and recent payments
            const recentApps = await applicationsCollection.find({ tutorEmail: email })
                .sort({ created_at: -1 })
                .limit(3)
                .toArray();

            const recentPayments = await paymentsCollection.find({ tutorEmail: email })
                .sort({ created_at: -1 })
                .limit(3)
                .toArray();

            res.send({ recentApps, recentPayments });
        });

        app.put('/tutor/profile', verifyJWT, verifyTUTOR, async (req, res) => {
            const email = req.tokenEmail;
            const { qualification, experience, subjects, bio, hourlyRate, location } = req.body;

            const filter = { email: email };
            const updateDoc = {
                $set: {
                    qualification,
                    experience,
                    subjects, // Array of strings
                    bio,
                    hourlyRate: parseInt(hourlyRate),
                    location,
                    updated_at: new Date()
                }
            };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });


        // ---------------------------------------------------------
        // ADMIN APIs
        // ---------------------------------------------------------

        // Create Tuition Post (Strict Requirement: POST /tuitions-post)
        app.post('/tuitions-post', verifyJWT, verifySTUDENT, async (req, res) => {
            const tuition = req.body;
            const newTuition = {
                ...tuition,
                studentId: req.tokenEmail, // Using email as ID reference based on auth flow, or we could fetch _id. User req says "studentId".
                status: 'pending', // Step 1: Default status is Pending
                created_at: new Date(),
                updated_at: new Date()
            };
            const result = await tuitionsPostCollection.insertOne(newTuition);
            res.send(result);
        });

        // Get My Tuitions (Updated to use tuitions-post)
        app.get('/my-tuitions', verifyJWT, verifySTUDENT, async (req, res) => {
            const email = req.tokenEmail;
            const query = { studentEmail: email };
            const result = await tuitionsPostCollection.find(query).toArray();
            res.send(result);
        });

        // ...

        // Get Active Tuition Posts (Strict Requirement: GET /tuitions-post)
        // Only for Tutors. Step 2 Outcome: Tutors only see 'approved' posts.
        app.get('/tuitions-post', verifyJWT, verifyTUTOR, async (req, res) => {
            const query = { status: 'approved' }; // Only show Admin-approved tuitions

            // Support Filters
            const { subject, location, className } = req.query;
            if (subject) query.subject = { $regex: subject, $options: 'i' };
            if (location) query.location = { $regex: location, $options: 'i' };
            if (className) query.class = className;

            const result = await tuitionsPostCollection.find(query)
                .sort({ created_at: -1 })
                .toArray();

            res.send(result);
        });

        // ...

        app.post('/payment-success', verifyJWT, verifySTUDENT, async (req, res) => {
            const { sessionId } = req.body;

            const session = await stripeClient.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const { tuitionId, tutorEmail, studentEmail, applicationId } = session.metadata;
                const transactionId = session.payment_intent;

                // Check for duplicate
                const existingPayment = await paymentsCollection.findOne({ transactionId });
                if (existingPayment) {
                    return res.send({ message: 'Payment already recorded' });
                }

                // Record Payment
                const paymentRecord = {
                    tuitionId,
                    tutorEmail,
                    studentEmail,
                    transactionId,
                    amount: session.amount_total / 100,
                    status: 'paid', // Transaction status
                    created_at: new Date()
                };
                await paymentsCollection.insertOne(paymentRecord);

                // Step 5 Database Updates:
                // 1. Application: Status -> 'approved' (User req: "Approved")
                await applicationsCollection.updateOne(
                    { _id: new ObjectId(applicationId) },
                    { $set: { status: 'approved', paymentId: transactionId } }
                );

                // 2. Tuition: Status -> 'ongoing' (User req: "Ongoing")
                await tuitionsPostCollection.updateOne(
                    { _id: new ObjectId(tuitionId) },
                    { $set: { status: 'ongoing', assignedTutorId: tutorEmail } } // using email as ID ref
                );

                // 3. Reject All Other Applications for this Tuition (Optional but requested system logic)
                await applicationsCollection.updateMany(
                    {
                        tuitionId: tuitionId,
                        _id: { $ne: new ObjectId(applicationId) }
                    },
                    { $set: { status: 'rejected' } }
                );

                return res.send({ success: true, message: 'Payment verified, Tutor Hired (Approved), Tuition Ongoing.' });
            } else {
                return res.status(400).send({ success: false, message: 'Payment not successful' });
            }
        });

    } catch (error) {
        console.error("MongoDB Connection Error:", error);
    }
}

// Root Route (Moved outside for better visibility)
app.get('/', (req, res) => {
    res.send('eTuitionBd Server is Running (Check logs for DB status)');
});

run().catch(console.dir);

app.listen(port, () => {
    console.log(`eTuitionBd Server is running on port ${port}`);
});
