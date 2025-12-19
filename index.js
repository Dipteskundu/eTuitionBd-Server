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
    origin: [
        process.env.CLIENT_DOMAIN,
        'http://localhost:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:5174'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
}));
app.use(express.json());


// Stripe
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);


// Firebase Admin
try {
    let serviceAccount;

    // 1. Try to load from local file first (Local Development)
    try {
        serviceAccount = require('./assingment-11-service-key.json');
    } catch (e) {
        // Fallback to environment variable if file is missing
    }

    // 2. Fallback to Environment Variable (Production/Vercel)
    if (!serviceAccount && process.env.FB_SERVICE_KEY) {
        try {
            const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
            serviceAccount = JSON.parse(decoded);
        } catch (e) {
            console.error("Error parsing FB_SERVICE_KEY env var:", e.message);
        }
    }

    if (serviceAccount) {
        if (admin.apps.length === 0) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
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
    connectTimeoutMS: 30000,
    socketTimeoutMS: 30000,
    serverSelectionTimeoutMS: 30000
});

// Connection Status
let dbStatus = "Initializing...";
let dbError = null;

// Database Collections (Global Scope)
let usersCollection, tuitionsPostCollection, applicationsCollection, paymentsCollection,
    roleRequestsCollection, reviewsCollection, bookmarksCollection,
    notificationsCollection, conversationsCollection, messagesCollection;

async function connectDB() {
    try {
        dbStatus = "Connecting...";
        await client.connect();
        dbStatus = "Connected";
        console.log("MongoDB Connected Successfully");

        const db = client.db("tuitionDB");
        usersCollection = db.collection("users");
        tuitionsPostCollection = db.collection("tuitions-post");
        applicationsCollection = db.collection("tutorApplications");
        paymentsCollection = db.collection("payments");
        roleRequestsCollection = db.collection("teacherRoleRequests");
        reviewsCollection = db.collection("reviews");
        bookmarksCollection = db.collection("bookmarks");
        notificationsCollection = db.collection("notifications");
        conversationsCollection = db.collection("conversations");
        messagesCollection = db.collection("messages");
    } catch (error) {
        dbStatus = "Failed";
        dbError = error;
        console.error("MongoDB Connection Error:", error);
    }
}

connectDB().catch(console.dir);

// MIDDLEWARE: Check Database Connection
app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/health') return next();

    if (dbStatus !== "Connected") {
        return res.status(503).send({
            message: "Database is connecting or unavailable. Please try again in a moment.",
            status: dbStatus,
            error: dbError ? dbError.message : null
        });
    }
    next();
});

// MIDDLEWARE: JWT Verification
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


// MIDDLEWARE: Role Verification

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




// USER MANAGEMENT APIs


//  Create User (POST /user) - Used by Register & Login
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

//  Get User Role (GET /users/:email) - Used by AuthContext
app.get('/users/:email', async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send(user);
});

//  Get All Users (GET /users) - Used by Admin ManageUsers
app.get('/users', verifyJWT, verifyADMIN, async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
});

//  Delete User (DELETE /user/:id) - Used by Admin ManageUsers
app.delete('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await usersCollection.deleteOne(query);
    res.send(result);
});

//  Get My Profile (GET /user/profile) - Used by ProfileSettings
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

//  Update My Profile (PUT /user/profile) - Used by ProfileSettings
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

//  Admin Analytics (GET /reports/analytics)
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

//  Get All Tuitions for Admin (GET /admin/tuitions)
app.get('/admin/tuitions', verifyJWT, verifyADMIN, async (req, res) => {
    const result = await tuitionsPostCollection.find().sort({ created_at: -1 }).toArray();
    res.send(result);
});

//  Update Tuition Status (PATCH /tuition-status/:id)
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

//  Get All Payments for Admin (GET /all-payments)
app.get('/all-payments', verifyJWT, verifyADMIN, async (req, res) => {
    try {
        const payments = await paymentsCollection.find()
            .sort({ date: -1, created_at: -1 })
            .toArray();
        res.send(payments);
    } catch (error) {
        console.error('Error fetching all payments:', error);
        res.status(500).send({ message: 'Failed to fetch payments' });
    }
});





// ...



// PUBLIC APIs


// Get All Tutors (GET /tutors) - Public Access with Pagination
app.get('/tutors', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const query = { role: 'tutor' };

        // Search by name or email
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { displayName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await usersCollection.countDocuments(query);
        const tutors = await usersCollection.find(query)
            .skip(skip)
            .limit(limit)
            .toArray();

        res.send({
            data: tutors,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error('Error fetching tutors:', error);
        res.status(500).send({ message: 'Failed to fetch tutors' });
    }
});

// Get Public Generic Tuitions (GET /tuitions) - Public Access
app.get('/tuitions', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        const { search, sort, subject, location, stuClass } = req.query;

        const query = { status: 'approved' };

        // 1. Search (Subject or Location)
        if (search) {
            query.$or = [
                { subject: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }

        // 2. Advanced Filters
        if (subject) query.subject = { $regex: subject, $options: 'i' };
        if (location) query.location = { $regex: location, $options: 'i' };
        if (stuClass) query.class = { $regex: stuClass, $options: 'i' };

        // 3. Sorting
        let sortOptions = { created_at: -1 }; // Default: Newest
        if (sort === 'price_asc') {
            sortOptions = { salary: 1 };

        } else if (sort === 'price_desc') {
            sortOptions = { salary: -1 };
        } else if (sort === 'newest') {
            sortOptions = { created_at: -1 };
        }

        const total = await tuitionsPostCollection.countDocuments(query);
        const result = await tuitionsPostCollection.find(query)
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .toArray();

        res.send({
            data: result,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error("Error fetching tuitions:", error);
        res.status(500).send({ message: "Failed to fetch tuitions" });
    }
});

// Get Single Tuition Details (GET /tuitions/:id) - Public Access
app.get('/tuitions/:id', async (req, res) => {
    const id = req.params.id;
    try {
        const query = { _id: new ObjectId(id) };
        const result = await tuitionsPostCollection.findOne(query);
        res.send(result);
    } catch (error) {
        console.error("Error fetching tuition:", error);
        res.status(500).send({ message: "Error fetching tuition details" });
    }
});


// REVIEWS APIs


// Submit a Review (POST /reviews) - Student only
app.post('/reviews', verifyJWT, verifySTUDENT, async (req, res) => {
    try {
        const { tutorEmail, rating, comment, tuitionId } = req.body;
        const studentEmail = req.tokenEmail;

        // Check if student has a completed/ongoing tuition with this tutor
        const hasTuition = await paymentsCollection.findOne({
            studentEmail,
            tutorEmail,
            status: 'paid'
        });

        if (!hasTuition) {
            return res.status(403).send({ message: 'You can only review tutors you have hired' });
        }

        // Check if already reviewed this tutor
        const existingReview = await reviewsCollection.findOne({ studentEmail, tutorEmail });
        if (existingReview) {
            return res.status(409).send({ message: 'You have already reviewed this tutor' });
        }

        const review = {
            tutorEmail,
            studentEmail,
            tuitionId,
            rating: Number(rating),
            comment,
            createdAt: new Date()
        };

        const result = await reviewsCollection.insertOne(review);

        // Create notification for tutor
        await notificationsCollection.insertOne({
            userEmail: tutorEmail,
            type: 'review',
            message: `You received a ${rating}-star review!`,
            link: '/dashboard/tutor/reviews',
            read: false,
            createdAt: new Date()
        });

        res.send(result);
    } catch (error) {
        console.error('Error submitting review:', error);
        res.status(500).send({ message: 'Failed to submit review' });
    }
});

// Get Reviews for a Tutor (GET /reviews/:tutorEmail)
app.get('/reviews/:tutorEmail', async (req, res) => {
    try {
        const { tutorEmail } = req.params;
        const reviews = await reviewsCollection.find({ tutorEmail })
            .sort({ createdAt: -1 })
            .toArray();
        res.send(reviews);
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).send({ message: 'Failed to fetch reviews' });
    }
});

// Get Average Rating for a Tutor (GET /tutor-rating/:tutorEmail)
app.get('/tutor-rating/:tutorEmail', async (req, res) => {
    try {
        const { tutorEmail } = req.params;
        const reviews = await reviewsCollection.find({ tutorEmail }).toArray();

        if (reviews.length === 0) {
            return res.send({ averageRating: 0, totalReviews: 0 });
        }

        const totalRating = reviews.reduce((sum, r) => sum + r.rating, 0);
        const averageRating = (totalRating / reviews.length).toFixed(1);

        res.send({ averageRating: parseFloat(averageRating), totalReviews: reviews.length });
    } catch (error) {
        console.error('Error fetching tutor rating:', error);
        res.status(500).send({ message: 'Failed to fetch rating' });
    }
});


// BOOKMARKS APIs


// Toggle Bookmark (POST /bookmarks)
app.post('/bookmarks', verifyJWT, async (req, res) => {
    try {
        const { itemId, type } = req.body; // type = 'tutor' | 'tuition'
        const userEmail = req.tokenEmail;

        const existing = await bookmarksCollection.findOne({ userEmail, itemId, type });

        if (existing) {
            // Remove bookmark
            await bookmarksCollection.deleteOne({ _id: existing._id });
            res.send({ bookmarked: false, message: 'Bookmark removed' });
        } else {
            // Add bookmark
            await bookmarksCollection.insertOne({
                userEmail,
                itemId,
                type,
                createdAt: new Date()
            });
            res.send({ bookmarked: true, message: 'Bookmark added' });
        }
    } catch (error) {
        console.error('Error toggling bookmark:', error);
        res.status(500).send({ message: 'Failed to toggle bookmark' });
    }
});

// Get My Bookmarks (GET /my-bookmarks)
app.get('/my-bookmarks', verifyJWT, async (req, res) => {
    try {
        const userEmail = req.tokenEmail;
        const { type } = req.query;

        const query = { userEmail };
        if (type) query.type = type;

        const bookmarks = await bookmarksCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(bookmarks);
    } catch (error) {
        console.error('Error fetching bookmarks:', error);
        res.status(500).send({ message: 'Failed to fetch bookmarks' });
    }
});

// Check if Bookmarked (GET /is-bookmarked)
app.get('/is-bookmarked', verifyJWT, async (req, res) => {
    try {
        const { itemId, type } = req.query;
        const userEmail = req.tokenEmail;

        const existing = await bookmarksCollection.findOne({ userEmail, itemId, type });
        res.send({ bookmarked: !!existing });
    } catch (error) {
        res.status(500).send({ message: 'Failed to check bookmark' });
    }
});


// NOTIFICATIONS APIs


// Get My Notifications (GET /notifications)
app.get('/notifications', verifyJWT, async (req, res) => {
    try {
        const userEmail = req.tokenEmail;
        const notifications = await notificationsCollection
            .find({ userEmail })
            .sort({ createdAt: -1 })
            .limit(20)
            .toArray();
        res.send(notifications);
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).send({ message: 'Failed to fetch notifications' });
    }
});

// Mark Notification as Read (PATCH /notifications/:id/read)
app.patch('/notifications/:id/read', verifyJWT, async (req, res) => {
    try {
        const { id } = req.params;
        await notificationsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { read: true } }
        );
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to mark as read' });
    }
});

// Mark All Notifications as Read (PATCH /notifications/read-all)
app.patch('/notifications/read-all', verifyJWT, async (req, res) => {
    try {
        const userEmail = req.tokenEmail;
        await notificationsCollection.updateMany(
            { userEmail, read: false },
            { $set: { read: true } }
        );
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to mark all as read' });
    }
});

// Delete Notification (DELETE /notifications/:id)
app.delete('/notifications/:id', verifyJWT, async (req, res) => {
    try {
        const { id } = req.params;
        await notificationsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to delete notification' });
    }
});


// MESSAGING APIs


// Start or Get Conversation (POST /conversations)
app.post('/conversations', verifyJWT, async (req, res) => {
    try {
        const { recipientEmail } = req.body;
        const senderEmail = req.tokenEmail;

        // Check if conversation already exists
        const existing = await conversationsCollection.findOne({
            participants: { $all: [senderEmail, recipientEmail] }
        });

        if (existing) {
            return res.send(existing);
        }

        // Create new conversation
        const conversation = {
            participants: [senderEmail, recipientEmail],
            lastMessage: null,
            lastMessageAt: new Date(),
            createdAt: new Date()
        };

        const result = await conversationsCollection.insertOne(conversation);
        res.send({ ...conversation, _id: result.insertedId });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).send({ message: 'Failed to start conversation' });
    }
});

// Get My Conversations (GET /my-conversations)
app.get('/my-conversations', verifyJWT, async (req, res) => {
    try {
        const userEmail = req.tokenEmail;
        const conversations = await conversationsCollection
            .find({ participants: userEmail })
            .sort({ lastMessageAt: -1 })
            .toArray();

        // Populate other participant info
        for (let conv of conversations) {
            const otherEmail = conv.participants.find(p => p !== userEmail);
            const otherUser = await usersCollection.findOne({ email: otherEmail });
            conv.otherParticipant = otherUser ? {
                email: otherUser.email,
                displayName: otherUser.displayName || otherUser.name,
                photoURL: otherUser.photoURL
            } : { email: otherEmail };
        }

        res.send(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).send({ message: 'Failed to fetch conversations' });
    }
});

// Send Message (POST /messages)
app.post('/messages', verifyJWT, async (req, res) => {
    try {
        const { conversationId, content } = req.body;
        const senderEmail = req.tokenEmail;

        const message = {
            conversationId,
            senderEmail,
            content,
            read: false,
            createdAt: new Date()
        };

        const result = await messagesCollection.insertOne(message);

        // Update conversation's lastMessage
        await conversationsCollection.updateOne(
            { _id: new ObjectId(conversationId) },
            { $set: { lastMessage: content, lastMessageAt: new Date() } }
        );

        // Create notification for recipient
        const conv = await conversationsCollection.findOne({ _id: new ObjectId(conversationId) });
        const recipientEmail = conv.participants.find(p => p !== senderEmail);

        await notificationsCollection.insertOne({
            userEmail: recipientEmail,
            type: 'message',
            message: 'You have a new message',
            link: '/dashboard/messages',
            read: false,
            createdAt: new Date()
        });

        res.send({ ...message, _id: result.insertedId });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ message: 'Failed to send message' });
    }
});

// Get Messages for a Conversation (GET /messages/:conversationId)
app.get('/messages/:conversationId', verifyJWT, async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await messagesCollection
            .find({ conversationId })
            .sort({ createdAt: 1 })
            .toArray();
        res.send(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).send({ message: 'Failed to fetch messages' });
    }
});


// SCHEDULE/CALENDAR APIs


// Create Schedule (POST /schedules) - Tutor creates for ongoing tuition
app.post('/schedules', verifyJWT, async (req, res) => {
    try {
        const { tuitionId, studentEmail, date, startTime, endTime, subject, notes } = req.body;
        const tutorEmail = req.tokenEmail;

        const schedule = {
            tuitionId,
            tutorEmail,
            studentEmail,
            date: new Date(date),
            startTime,
            endTime,
            subject,
            notes,
            status: 'scheduled',
            createdAt: new Date()
        };

        const result = await db.collection('schedules').insertOne(schedule);

        // Notify student
        await notificationsCollection.insertOne({
            userEmail: studentEmail,
            type: 'schedule',
            message: `New class scheduled for ${subject} on ${new Date(date).toLocaleDateString()}`,
            link: '/dashboard/student/calendar',
            read: false,
            createdAt: new Date()
        });

        res.send({ ...schedule, _id: result.insertedId });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).send({ message: 'Failed to create schedule' });
    }
});

// Get My Schedule (GET /my-schedule)
app.get('/my-schedule', verifyJWT, async (req, res) => {
    try {
        const userEmail = req.tokenEmail;
        const schedules = await db.collection('schedules')
            .find({ $or: [{ tutorEmail: userEmail }, { studentEmail: userEmail }] })
            .sort({ date: 1 })
            .toArray();
        res.send(schedules);
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).send({ message: 'Failed to fetch schedule' });
    }
});

// Update Schedule (PATCH /schedules/:id)
app.patch('/schedules/:id', verifyJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        delete updates._id;

        await db.collection('schedules').updateOne(
            { _id: new ObjectId(id) },
            { $set: { ...updates, updatedAt: new Date() } }
        );
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to update schedule' });
    }
});

// Delete Schedule (DELETE /schedules/:id)
app.delete('/schedules/:id', verifyJWT, async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('schedules').deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to delete schedule' });
    }
});


// TUTOR APIs


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

    //  Create Application
    const newApplication = {
        tuitionId: tuitionId,
        tutorEmail: tutorEmail,
        studentEmail: tuition.studentId,
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

app.get('/tuitions-post', verifyJWT, verifyTUTOR, async (req, res) => {

    const status = req.query.status || 'approved';
    const query = { status: status };


    const { subject, location, class: classParam } = req.query;

    if (subject) query.subject = { $regex: subject, $options: 'i' };
    if (location) query.location = { $regex: location, $options: 'i' };
    if (classParam) query.class = { $regex: classParam, $options: 'i' }; // Partial match for class is better

    const result = await tuitionsPostCollection.find(query)
        .sort({ created_at: -1 })
        .toArray();

    res.send(result);
});




app.get('/my-applications', verifyJWT, verifyTUTOR, async (req, res) => {
    const email = req.tokenEmail;
    const query = { tutorEmail: email };
    const result = await applicationsCollection.find(query).toArray();
    res.send(result);
});


// TEACHER ROLE REQUEST APIs


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

//  Get My Requests (GET /role-requests/my) - Student/Tutor
app.get('/role-requests/my', verifyJWT, async (req, res) => {
    const email = req.tokenEmail;
    const result = await roleRequestsCollection.find({ userId: email }).sort({ created_at: -1 }).toArray();
    res.send(result);
});

//  Get All Pending Requests (GET /role-requests) - Admin Only
app.get('/role-requests', verifyJWT, verifyADMIN, async (req, res) => {
    const status = req.query.status;
    let query = {};
    if (status) query.status = status;

    const result = await roleRequestsCollection.find(query).sort({ created_at: -1 }).toArray();
    res.send(result);
});


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




// STUDENT APPLICATION MANAGEMENT & PAYMENT






// Student Dashboard Stats (GET /student/dashboard-stats)
app.get('/student/dashboard-stats', verifyJWT, verifySTUDENT, async (req, res) => {
    const email = req.tokenEmail;

    try {

        // 1. Get all tuition IDs by this student
        const myTuitions = await tuitionsPostCollection.find({ studentId: email }).toArray();
        const myTuitionIds = myTuitions.map(t => t._id.toString());

        // 2. Count applications for these tuitions
        // 2. Count applications for these tuitions
        const totalApplicationsReceived = await applicationsCollection.countDocuments({
            tuitionId: { $in: myTuitionIds }
        });


        // 1. Total Tuitions Posted
        const totalTuitions = await tuitionsPostCollection.countDocuments({ studentId: email });

        // 2. Total Hired Tutors (Assigned)
        const hiredTwitorsCount = await tuitionsPostCollection.countDocuments({ studentId: email, status: 'ongoing' }); // or assignedTutorEmail exists

        // 3. Total Spending
        const payments = await paymentsCollection.find({ studentEmail: email }).toArray();
        const totalSpent = payments.reduce((sum, p) => sum + p.amount, 0);

        res.send({
            totalTuitions,
            hiredTutors: hiredTwitorsCount,
            totalSpent,
            totalApplications: 0
        });

    } catch (error) {
        console.error("Error fetching student stats:", error);
        res.status(500).send({ message: "Failed to fetch stats" });
    }
});


app.get('/student-applications/:studentId', verifyJWT, verifySTUDENT, async (req, res) => {
    const studentId = req.params.studentId;

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
        message,
        expectedSalary,
        availability,
        experience,
        status: 'pending',
        created_at: new Date()
    };

    const result = await applicationsCollection.insertOne(newApplication);
    res.send({ success: true, ...result });
});



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

app.get('/student/recent-activities', verifyJWT, verifySTUDENT, async (req, res) => {
    console.log("DEBUG: Hit /student/recent-activities");
    const email = req.tokenEmail;

    // Recent Tuitions Posted
    const recentTuitions = await tuitionsPostCollection.find({ studentId: email })
        .sort({ created_at: -1 })
        .limit(3)
        .toArray();

    res.send(recentTuitions);
});

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



// ADMIN APIs


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



// Verify Payment Success (POST /payment-success)
app.post('/payment-success', verifyJWT, verifySTUDENT, async (req, res) => {
    const { sessionId } = req.body;

    try {
        if (sessionId.startsWith('DEMO_')) {
            // DEMO FLOW
            const payment = await paymentsCollection.findOne({ transactionId: sessionId });
            if (payment) {
                return res.send({ success: true, message: 'Payment verified (Demo)', payment });
            } else {
                return res.send({ success: false, message: 'Payment not found in demo records' });
            }
        } else {
            // STRIPE FLOW
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
                    currency: session.currency.toUpperCase(),
                    status: 'paid', // Transaction status
                    method: 'Stripe',
                    created_at: new Date()
                };
                await paymentsCollection.insertOne(paymentRecord);

                // Database Updates
                await applicationsCollection.updateOne(
                    { _id: new ObjectId(applicationId) },
                    { $set: { status: 'approved', paymentId: transactionId } }
                );

                await tuitionsPostCollection.updateOne(
                    { _id: new ObjectId(tuitionId) },
                    { $set: { status: 'ongoing', assignedTutorId: tutorEmail, assignedTutorEmail: tutorEmail } }
                );

                await applicationsCollection.updateMany(
                    {
                        tuitionId: tuitionId,
                        _id: { $ne: new ObjectId(applicationId) }
                    },
                    { $set: { status: 'rejected' } }
                );

                return res.send({ success: true, message: 'Payment verified, Tutor Hired.' });
            } else {
                return res.status(400).send({ success: false, message: 'Payment not successful' });
            }
        }
    } catch (error) {
        console.error("Payment Verification Error:", error);
        res.status(500).send({ success: false, message: 'Verification failed' });
    }
});

// End of Routes

// Root Route (Moved outside for better visibility)
app.get('/', (req, res) => {
    res.send({
        status: 'Server Running',
        dbStatus,
        dbError: dbError ? dbError.message : null,
        timestamp: new Date()
    });
});


app.listen(port, () => {
    console.log(`eTuitionBd Server is running on port ${port}`);
});

// Export app for Vercel
module.exports = app;
