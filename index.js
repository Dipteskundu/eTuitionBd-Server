const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const admin = require('firebase-admin');
const stripe = require('stripe');
require('dotenv').config();


const requiredEnvVars = ['MONGODB_URI', 'STRIPE_SECRET_KEY'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error(`CRITICAL ERROR: Missing environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 5000;


const catchAsync = fn => {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
};



process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});





app.use(cors());
app.options('*', cors());

app.use(express.json());


const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);


let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (saEnv.startsWith('{')) {
            serviceAccount = JSON.parse(saEnv);
        } else {
            serviceAccount = JSON.parse(Buffer.from(saEnv, 'base64').toString('utf8'));
        }
        console.log('Firebase key loaded from environment variable');
    } catch (error) {
        console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT env var:', error.message);
        process.exit(1);
    }
} else {
    try {
        serviceAccount = require('./assingment-11-service-key.json');
        console.log('Firebase key loaded from local JSON');
    } catch (err) {
        console.error('Firebase key not found. Set FIREBASE_SERVICE_ACCOUNT or add assingment-11-service-key.json file.');
        process.exit(1);
    }
}

try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    console.log('Firebase Admin initialized successfully');
} catch (error) {
    console.error('Firebase Admin initialization failed:', error.message);
    process.exit(1);
}


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


let dbStatus = 'Initializing...';
let dbError = null;


let usersCollection,
    tuitionsPostCollection,
    applicationsCollection,
    paymentsCollection,
    roleRequestsCollection,
    reviewsCollection,
    bookmarksCollection,
    notificationsCollection,
    conversationsCollection,
    messagesCollection,
    schedulesCollection;

async function connectDB() {
    try {
        dbStatus = 'Connecting...';
        await client.connect();
        dbStatus = 'Connected';

        console.log('MongoDB Connected Successfully');

        const db = client.db('tuitionDB');
        usersCollection = db.collection('users');
        tuitionsPostCollection = db.collection('tuitions');
        applicationsCollection = db.collection('tutorApplications');
        paymentsCollection = db.collection('payments');
        roleRequestsCollection = db.collection('teacherRoleRequests');
        reviewsCollection = db.collection('reviews');
        bookmarksCollection = db.collection('bookmarks');
        notificationsCollection = db.collection('notifications');
        conversationsCollection = db.collection('conversations');
        messagesCollection = db.collection('messages');
        schedulesCollection = db.collection('schedules');

    } catch (error) {
        dbStatus = 'Failed';
        dbError = error;
        console.error('MongoDB Connection Error:', error);
        throw error;
    }
}






app.get('/', (req, res) => {
    res.json({
        status: 'Server is running',
        database: dbStatus,
        error: dbError ? dbError.message : null
    });
});



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


const verifyFBToken = async (req, res, next) => {
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

        req.decoded_email = decodedToken.email;

        req.tokenEmail = decodedToken.email;
        next();
    } catch (error) {
        console.error('JWT Verification Error Details:', {
            code: error.code,
            message: error.message,
            token_excerpt: token ? token.substring(0, 10) + '...' : 'none'
        });
        return res.status(401).send({
            message: 'Unauthorized access: Invalid token',
            error: error.message
        });
    }
};




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












app.post('/user', catchAsync(async (req, res) => {
    const user = req.body;

    if (user.displayName && !user.name) user.name = user.displayName;

    const query = { email: user.email };
    const existingUser = await usersCollection.findOne(query);
    if (existingUser) {
        return res.send({ message: 'User already exists', insertedId: null });
    }
    const result = await usersCollection.insertOne(user);
    res.send(result);
}));


app.get('/users/:email', catchAsync(async (req, res) => {
    const email = req.params.email;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    res.send(user);
}));


app.get('/users', verifyFBToken, verifyADMIN, catchAsync(async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
}));


app.delete('/user/:id', verifyFBToken, verifyADMIN, catchAsync(async (req, res) => {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await usersCollection.deleteOne(query);
    res.send(result);
}));


app.patch('/update-role/:id', verifyFBToken, verifyADMIN, async (req, res) => {
    const id = req.params.id;
    const { role } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
        $set: { role: role }
    };
    const result = await usersCollection.updateOne(filter, updateDoc);
    res.send(result);
});


app.get('/user/profile', verifyFBToken, async (req, res) => {
    const email = req.tokenEmail;
    const query = { email: email };
    const user = await usersCollection.findOne(query);
    if (user) {

        user.displayName = user.name || user.displayName;
    }
    res.send(user);
});


app.put('/user/profile', verifyFBToken, async (req, res) => {
    const email = req.tokenEmail;
    const item = req.body;
    const filter = { email: email };

    const updateFields = {
        phone: item.phone,
        photoURL: item.photoURL || item.image
    };
    if (item.displayName) updateFields.name = item.displayName;


    Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

    const updateDoc = {
        $set: updateFields
    };

    const result = await usersCollection.updateOne(filter, updateDoc);
    res.send(result);
});


app.get('/reports/analytics', verifyFBToken, verifyADMIN, async (req, res) => {
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


app.get('/admin/tuitions', verifyFBToken, verifyADMIN, async (req, res) => {
    const result = await tuitionsPostCollection.find().sort({ created_at: -1 }).toArray();
    res.send(result);
});


app.patch('/tuition-status/:id', verifyFBToken, verifyADMIN, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
        $set: { status: status, updated_at: new Date() }
    };
    const result = await tuitionsPostCollection.updateOne(filter, updateDoc);
    res.send(result);
});


app.get('/all-payments', verifyFBToken, verifyADMIN, async (req, res) => {
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






app.get('/tutors', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 8;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';

        const query = { role: 'tutor' };


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


app.get('/tutors/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id), role: 'tutor' };
        const result = await usersCollection.findOne(query);
        if (!result) {
            return res.status(404).send({ message: 'Tutor not found' });
        }
        res.send(result);
    } catch (error) {
        console.error('Error fetching tutor details:', error);
        res.status(500).send({ message: 'Failed to fetch tutor details' });
    }
});


app.get('/tuitions', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        const { search, sort, subject, location, stuClass } = req.query;

        const query = { status: 'approved' };


        if (search) {
            query.$or = [
                { subject: { $regex: search, $options: 'i' } },
                { location: { $regex: search, $options: 'i' } }
            ];
        }


        if (subject) query.subject = { $regex: subject, $options: 'i' };
        if (location) query.location = { $regex: location, $options: 'i' };
        if (stuClass) query.class = { $regex: stuClass, $options: 'i' };

        let sortOptions = { created_at: -1 };
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

app.get('/tuition/:id', async (req, res) => {
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









app.post('/reviews', verifyFBToken, verifySTUDENT, async (req, res) => {
    try {
        const { tutorEmail, rating, comment, tuitionId } = req.body;
        const studentEmail = req.tokenEmail;


        const payment = await paymentsCollection.findOne({
            studentEmail,
            tutorEmail
        });

        if (!payment || payment.status !== 'paid') {
            return res.status(403).send({ message: 'Only students with completed payments can review this tutor' });
        }


        const existingReview = await reviewsCollection.findOne({ studentEmail, tutorEmail });
        if (existingReview) {
            return res.status(409).send({ message: 'Focus on your studies! You have already reviewed this tutor.' });
        }


        const student = await usersCollection.findOne({ email: studentEmail });

        const review = {
            tutorEmail,
            studentEmail,
            reviewerName: student?.displayName || student?.name || 'Anonymous',
            reviewerPhoto: student?.photoURL || 'https://i.ibb.co/MBtH413/unknown-user.jpg',
            tuitionId,
            rating: Number(rating),
            comment,
            createdAt: new Date()
        };

        const result = await reviewsCollection.insertOne(review);


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









app.post('/bookmarks', verifyFBToken, async (req, res) => {
    try {
        const { itemId, type } = req.body;
        const userEmail = req.tokenEmail;

        const existing = await bookmarksCollection.findOne({ userEmail, itemId, type });

        if (existing) {

            await bookmarksCollection.deleteOne({ _id: existing._id });
            res.send({ bookmarked: false, message: 'Bookmark removed' });
        } else {

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


app.get('/my-bookmarks', verifyFBToken, async (req, res) => {
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


app.get('/is-bookmarked', verifyFBToken, async (req, res) => {
    try {
        const { itemId, type } = req.query;
        const userEmail = req.tokenEmail;

        const existing = await bookmarksCollection.findOne({ userEmail, itemId, type });
        res.send({ bookmarked: !!existing });
    } catch (error) {
        res.status(500).send({ message: 'Failed to check bookmark' });
    }
});











app.get('/notifications', verifyFBToken, async (req, res) => {
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


app.patch('/notifications/:id/read', verifyFBToken, async (req, res) => {
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


app.patch('/notifications/read-all', verifyFBToken, async (req, res) => {
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


app.delete('/notifications/:id', verifyFBToken, async (req, res) => {
    try {
        const { id } = req.params;
        await notificationsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to delete notification' });
    }
});









app.post('/conversations', verifyFBToken, async (req, res) => {
    try {
        const { recipientEmail } = req.body;
        const senderEmail = req.tokenEmail.toLowerCase();
        const recipientEmailLower = recipientEmail.toLowerCase();


        const existing = await conversationsCollection.findOne({
            participants: { $all: [senderEmail, recipientEmailLower] }
        });

        if (existing) {
            return res.send(existing);
        }


        const conversation = {
            participants: [senderEmail, recipientEmailLower],
            lastMessage: null,
            lastMessageAt: new Date(),
            createdAt: new Date()
        };

        const result = await conversationsCollection.insertOne(conversation);
        res.send({ ...conversation, _id: result.insertedId });
    } catch (error) {
        console.error('Error creating conversation:', error);
        res.status(500).send({ message: 'Failed to create conversation' });
    }
});



app.get('/my-conversations', verifyFBToken, async (req, res) => {
    try {
        const userEmail = req.tokenEmail.toLowerCase();


        const conversations = await conversationsCollection
            .find({ participants: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } })
            .sort({ lastMessageAt: -1 })
            .toArray();


        for (let conv of conversations) {

            const otherEmail = conv.participants.find(p => p.toLowerCase() !== userEmail);


            const otherUser = await usersCollection.findOne({
                email: { $regex: new RegExp(`^${otherEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
            });

            conv.otherParticipant = otherUser ? {
                email: otherUser.email,
                displayName: otherUser.displayName || otherUser.name,
                photoURL: otherUser.photoURL,
                _id: otherUser._id
            } : { email: otherEmail };
        }

        res.send(conversations);
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).send({ message: 'Failed to fetch conversations' });
    }
});


app.post('/messages', verifyFBToken, async (req, res) => {
    try {
        const { conversationId, content } = req.body;
        const senderEmail = req.tokenEmail.toLowerCase();

        const message = {
            conversationId,
            senderEmail,
            content,
            read: false,
            createdAt: new Date()
        };

        const result = await messagesCollection.insertOne(message);


        await conversationsCollection.updateOne(
            { _id: new ObjectId(conversationId) },
            { $set: { lastMessage: content, lastMessageAt: new Date() } }
        );


        const conv = await conversationsCollection.findOne({ _id: new ObjectId(conversationId) });


        const recipientEmail = conv.participants.find(p => p.toLowerCase() !== senderEmail);


        const sender = await usersCollection.findOne({
            email: { $regex: new RegExp(`^${senderEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });
        const senderName = sender?.displayName || sender?.name || 'Someone';

        if (recipientEmail) {
            await notificationsCollection.insertOne({
                userEmail: recipientEmail,
                type: 'message',
                message: `New message from ${senderName}`,
                link: `/dashboard/messages?id=${conversationId}`,
                read: false,
                createdAt: new Date()
            });
        }

        res.send({ ...message, _id: result.insertedId });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ message: 'Failed to send message' });
    }
});


app.get('/messages/:conversationId', verifyFBToken, async (req, res) => {
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










app.post('/schedules', verifyFBToken, async (req, res) => {
    try {
        const { tuitionId, partnerEmail, date, startTime, endTime, subject, notes, meetingLink } = req.body;
        const userEmail = req.tokenEmail;


        const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(tuitionId) });
        if (!tuition) return res.status(404).send({ message: 'Tuition not found' });

        let studentEmail, tutorEmail;
        const studentIdMatch = tuition.studentId?.toLowerCase() === userEmail.toLowerCase();
        const tutorEmailMatch = tuition.assignedTutorEmail?.toLowerCase() === userEmail.toLowerCase() ||
            tuition.assignedTutorId?.toLowerCase() === userEmail.toLowerCase();

        if (studentIdMatch) {

            studentEmail = userEmail;
            tutorEmail = partnerEmail || tuition.assignedTutorEmail;
        } else if (tutorEmailMatch) {

            tutorEmail = userEmail;
            studentEmail = partnerEmail || tuition.studentId;
        } else {
            return res.status(403).send({ message: 'You are not part of this tuition' });
        }


        const student = await usersCollection.findOne({ email: { $regex: new RegExp(`^${studentEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
        const tutor = await usersCollection.findOne({ email: { $regex: new RegExp(`^${tutorEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });

        const schedule = {
            tuitionId,
            tutorEmail: tutorEmail.toLowerCase(),
            tutorName: tutor?.displayName || tutor?.name || 'Tutor',
            studentEmail: studentEmail.toLowerCase(),
            studentName: student?.displayName || student?.name || 'Student',
            date: new Date(date),
            startTime,
            endTime,
            subject,
            notes,
            meetingLink: meetingLink || 'https://meet.google.com/',
            status: 'scheduled',
            createdBy: userEmail.toLowerCase(),
            creatorRole: (studentIdMatch ? 'student' : 'tutor'),
            createdAt: new Date()
        };

        const result = await schedulesCollection.insertOne(schedule);


        const isStudentCreator = userEmail.toLowerCase() === studentEmail.toLowerCase();
        const recipientEmail = isStudentCreator ? tutorEmail : studentEmail;
        const senderName = isStudentCreator ? (student?.displayName || student?.name) : (tutor?.displayName || tutor?.name);

        await notificationsCollection.insertOne({
            userEmail: recipientEmail.toLowerCase(),
            type: 'schedule',
            message: `New class: ${subject} with ${senderName} on ${new Date(date).toLocaleDateString()}`,
            link: isStudentCreator ? '/dashboard/tutor/calendar' : '/dashboard/student/calendar',
            read: false,
            createdAt: new Date()
        });

        res.send({ ...schedule, _id: result.insertedId });
    } catch (error) {
        console.error('Error creating schedule:', error);
        res.status(500).send({ message: 'Failed to create schedule' });
    }
});


app.get('/tutor/my-students', verifyFBToken, verifyTUTOR, async (req, res) => {
    try {
        const email = req.tokenEmail;
        const tuitions = await tuitionsPostCollection.find({
            $or: [
                { assignedTutorEmail: email },
                { assignedTutorId: email }
            ]
        }).toArray();


        for (let t of tuitions) {
            const student = await usersCollection.findOne({ email: t.studentId });
            t.studentName = student?.displayName || student?.name || 'Student';
            t.studentEmail = t.studentId;
        }

        res.send(tuitions);
    } catch (error) {
        res.status(500).send({ message: 'Failed to fetch students' });
    }
});


app.get('/student/my-tutors', verifyFBToken, verifySTUDENT, async (req, res) => {
    try {
        const email = req.tokenEmail;
        const tuitions = await tuitionsPostCollection.find({
            studentId: email,
            assignedTutorEmail: { $exists: true }
        }).toArray();


        for (let t of tuitions) {
            const tutor = await usersCollection.findOne({ email: t.assignedTutorEmail });
            t.tutorName = tutor?.displayName || tutor?.name || 'Tutor';
            t.tutorEmail = t.assignedTutorEmail;
        }

        res.send(tuitions);
    } catch (error) {
        res.status(500).send({ message: 'Failed to fetch tutors' });
    }
});

app.get('/my-schedule', verifyFBToken, async (req, res) => {
    try {
        const userEmail = req.tokenEmail.toLowerCase();
        const user = await usersCollection.findOne({
            email: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
        });

        if (!user) return res.status(404).send({ message: 'User not found' });

        const role = user.role?.toLowerCase();
        let query = {};

        if (role === 'student') {

            query = { studentEmail: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
        } else if (role === 'tutor' || role === 'teacher') {

            query = { tutorEmail: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } };
        } else if (role === 'admin') {

            query = {
                $or: [
                    { studentEmail: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
                    { tutorEmail: { $regex: new RegExp(`^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
                ]
            };
        } else {
            return res.status(403).send({ message: 'Forbidden: Unauthorized role access' });
        }

        const schedules = await schedulesCollection
            .find(query)
            .sort({ date: 1 })
            .toArray();
        res.send(schedules);
    } catch (error) {
        console.error('Error fetching schedule:', error);
        res.status(500).send({ message: 'Failed to fetch schedule' });
    }
});


app.patch('/schedules/:id', verifyFBToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userEmail = req.tokenEmail;
        const updates = req.body;
        delete updates._id;

        const schedule = await schedulesCollection.findOne({ _id: new ObjectId(id) });
        if (!schedule) return res.status(404).send({ message: 'Schedule not found' });

        if (schedule.createdBy?.toLowerCase() !== userEmail.toLowerCase()) {
            return res.status(403).send({ message: 'Forbidden: Only the creator can update this' });
        }

        await schedulesCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { ...updates, updatedAt: new Date() } }
        );
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: 'Failed to update schedule' });
    }
});


app.delete('/schedules/:id', verifyFBToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userEmail = req.tokenEmail.toLowerCase();

        const schedule = await schedulesCollection.findOne({ _id: new ObjectId(id) });
        if (!schedule) return res.status(404).send({ message: 'Schedule not found' });


        if (schedule.createdBy.toLowerCase() !== userEmail) {
            return res.status(403).send({
                success: false,
                message: 'Forbidden: Only the creator of this schedule can delete it'
            });
        }

        const result = await schedulesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ success: true, ...result });
    } catch (error) {
        console.error('Error deleting schedule:', error);
        res.status(500).send({ message: 'Failed to delete schedule' });
    }
});










app.post('/apply-tuition', verifyFBToken, verifyTUTOR, async (req, res) => {
    const { tuitionId, experience, qualification, expectedSalary } = req.body;
    const tutorEmail = req.tokenEmail;


    const existingApp = await applicationsCollection.findOne({
        tutorEmail: tutorEmail,
        tuitionId: tuitionId
    });
    if (existingApp) {
        return res.status(409).send({ message: 'Already applied' });
    }


    const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(tuitionId) });
    if (!tuition) {
        return res.status(404).send({ message: 'Tuition not found' });
    }


    if (tuition.status !== 'approved') {
        return res.status(403).send({ message: 'Tuition is not open for applications' });
    }
    if (tuition.assignedTutorEmail || tuition.assignedTutorId) {
        return res.status(409).send({ message: 'Tuition already assigned to a tutor' });
    }


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



app.get('/tuitions', verifyFBToken, verifyTUTOR, async (req, res) => {

    const status = req.query.status || 'approved';
    const query = {
        status: status,
        assignedTutorEmail: { $exists: false }
    };


    const { subject, location, class: classParam } = req.query;

    if (subject) query.subject = { $regex: subject, $options: 'i' };
    if (location) query.location = { $regex: location, $options: 'i' };
    if (classParam) query.class = { $regex: classParam, $options: 'i' };

    const result = await tuitionsPostCollection.find(query)
        .sort({ created_at: -1 })
        .toArray();

    res.send(result);
});




app.get('/my-applications', verifyFBToken, verifyTUTOR, async (req, res) => {
    const email = req.tokenEmail;
    const query = { tutorEmail: email };
    const result = await applicationsCollection.find(query).toArray();
    res.send(result);
});










app.post('/role-requests', verifyFBToken, verifySTUDENT, async (req, res) => {
    const request = req.body;
    const email = req.tokenEmail;


    const existing = await roleRequestsCollection.findOne({
        userId: email,
        status: 'pending'
    });

    if (existing) {
        return res.status(409).send({ message: 'You already have a pending request.' });
    }

    const newRequest = {
        userId: email,
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


app.get('/role-requests/my', verifyFBToken, async (req, res) => {
    const email = req.tokenEmail;
    const result = await roleRequestsCollection.find({ userId: email }).sort({ created_at: -1 }).toArray();
    res.send(result);
});


app.get('/role-requests', verifyFBToken, verifyADMIN, async (req, res) => {
    const status = req.query.status;
    let query = {};
    if (status) query.status = status;

    const result = await roleRequestsCollection.find(query).sort({ created_at: -1 }).toArray();
    res.send(result);
});


app.patch('/role-requests/:id', verifyFBToken, verifyADMIN, async (req, res) => {
    const id = req.params.id;
    const { status, adminId } = req.body;

    const request = await roleRequestsCollection.findOne({ _id: new ObjectId(id) });
    if (!request) return res.status(404).send({ message: 'Request not found' });

    if (status === 'approved') {

        const userUpdate = await usersCollection.updateOne(
            { email: request.userEmail },
            { $set: { role: 'tutor' } }
        );





        if (userUpdate.modifiedCount === 0) {

            console.warn(`User ${request.userEmail} not found while approving role.`);
        }
    }


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





app.get('/student/dashboard-stats', verifyFBToken, verifySTUDENT, async (req, res) => {
    const email = req.tokenEmail;

    try {



        const myTuitions = await tuitionsPostCollection.find({ studentId: email }).toArray();
        const myTuitionIds = myTuitions.map(t => t._id.toString());



        const totalApplicationsReceived = await applicationsCollection.countDocuments({
            tuitionId: { $in: myTuitionIds }
        });



        const totalTuitions = await tuitionsPostCollection.countDocuments({ studentId: email });


        const hiredTutorsCount = await tuitionsPostCollection.countDocuments({
            studentId: email,
            assignedTutorEmail: { $exists: true }
        });


        const payments = await paymentsCollection.find({ studentEmail: email }).toArray();
        const totalSpent = payments.reduce((sum, p) => sum + p.amount, 0);

        res.send({
            totalTuitions,
            activeTuitions: hiredTutorsCount,
            totalSpent,
            totalApplicationsReceived
        });

    } catch (error) {
        console.error("Error fetching student stats:", error);
        res.status(500).send({ message: "Failed to fetch stats" });
    }
});


app.get('/student-applications/:studentId', verifyFBToken, verifySTUDENT, async (req, res) => {
    const studentId = req.params.studentId;

    if (studentId !== req.tokenEmail) {
        return res.status(403).send({ message: 'Forbidden access' });
    }

    const query = { studentEmail: studentId };
    const result = await applicationsCollection.find(query).sort({ created_at: -1 }).toArray();


    for (let app of result) {

        const tutor = await usersCollection.findOne({ email: app.tutorEmail });
        if (tutor) {
            app.tutorName = tutor.name;
            app.tutorPhoto = tutor.photoURL || tutor.image;
        }

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



app.post('/tuition-application', verifyFBToken, verifyTUTOR, async (req, res) => {
    const { tuitionId, message, expectedSalary, availability, experience } = req.body;
    const tutorEmail = req.tokenEmail;


    const existingApp = await applicationsCollection.findOne({
        tutorEmail: tutorEmail,
        tuitionId: tuitionId
    });
    if (existingApp) {
        return res.status(409).send({ message: 'Already applied' });
    }


    const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(tuitionId) });
    if (!tuition) return res.status(404).send({ message: 'Tuition not found' });
    if (tuition.status !== 'approved') return res.status(403).send({ message: 'Tuition is not open' });


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




app.get('/applications/:tuitionId', verifyFBToken, verifySTUDENT, async (req, res) => {
    const tuitionId = req.params.tuitionId;
    const query = { tuitionId: tuitionId };
    const result = await applicationsCollection.find(query).toArray();


    for (let app of result) {
        const tutor = await usersCollection.findOne({ email: app.tutorEmail });
        if (tutor) {
            app.tutorName = tutor.name;
            app.tutorPhoto = tutor.photoURL || tutor.image;
        }
    }
    res.send(result);
});


app.delete('/applications/:id', verifyFBToken, verifySTUDENT, async (req, res) => {
    const id = req.params.id;
    const result = await applicationsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
});




app.get('/applied-tutors/:tuitionId', verifyFBToken, verifySTUDENT, async (req, res) => {
    const tuitionId = req.params.tuitionId;
    const query = { tuitionId: tuitionId };
    const result = await applicationsCollection.find(query).toArray();


    for (let app of result) {
        const tutor = await usersCollection.findOne({ email: app.tutorEmail });
        if (tutor) app.tutorName = tutor.name;
    }
    res.send(result);
});


app.post('/reject-tutor', verifyFBToken, verifySTUDENT, async (req, res) => {
    const { applicationId } = req.body;
    const filter = { _id: new ObjectId(applicationId) };
    const updateDoc = { $set: { status: 'rejected' } };
    const result = await applicationsCollection.updateOne(filter, updateDoc);
    res.send(result);
});




app.get('/student/recent-activities', verifyFBToken, verifySTUDENT, async (req, res) => {
    console.log("DEBUG: Hit /student/recent-activities");
    const email = req.tokenEmail;


    const recentTuitions = await tuitionsPostCollection.find({ studentId: email })
        .sort({ created_at: -1 })
        .limit(3)
        .toArray();

    res.send(recentTuitions);
});

app.post('/process-payment', verifyFBToken, verifySTUDENT, async (req, res) => {
    const { applicationId, tuitionId, tutorEmail, amount, method, transactionId } = req.body;
    const studentEmail = req.tokenEmail;


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


    await applicationsCollection.updateOne(
        { _id: new ObjectId(applicationId) },
        { $set: { status: 'accepted' } }
    );


    await tuitionsPostCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        { $set: { assignedTutorEmail: tutorEmail } }
    );

    res.send({ success: true, paymentId: paymentResult.insertedId });
});

app.post('/create-checkout-session', verifyFBToken, verifySTUDENT, catchAsync(async (req, res) => {
    const { amount, tuitionId, tutorEmail, applicationId, subject } = req.body;
    const studentEmail = req.decoded_email;

    const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'bdt',
                    product_data: {
                        name: subject || 'Tuition Fee Payment',
                        description: `Payment for tuition: ${tuitionId}`,
                    },
                    unit_amount: Math.round(amount * 100),
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        metadata: {
            tuitionId,
            tutorEmail,
            studentEmail,
            applicationId
        },

        success_url: `${req.get('origin')}/dashboard/student/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.get('origin')}/dashboard/student/applications`,
    });

    res.send({ id: session.id, url: session.url });
}));


app.post('/payments/demo', verifyFBToken, verifySTUDENT, async (req, res) => {
    const { applicationId, tuitionId, tutorEmail, amount } = req.body;
    const studentEmail = req.tokenEmail;


    const transactionId = 'DEMO_' + new Date().getTime();


    const payment = {
        transactionId,
        studentEmail,
        tutorEmail,
        tuitionId,
        applicationId,
        amount: parseFloat(amount),
        currency: 'BDT',
        status: 'paid',
        method: 'Demo PaymentSystem',
        date: new Date()
    };
    const paymentResult = await paymentsCollection.insertOne(payment);


    await applicationsCollection.updateOne(
        { _id: new ObjectId(applicationId) },
        { $set: { status: 'approved', paymentId: transactionId } }
    );


    await tuitionsPostCollection.updateOne(
        { _id: new ObjectId(tuitionId) },
        { $set: { assignedTutorEmail: tutorEmail, assignedTutorId: tutorEmail } }
    );


    await applicationsCollection.updateMany(
        { tuitionId: tuitionId, _id: { $ne: new ObjectId(applicationId) } },
        { $set: { status: 'rejected' } }
    );

    res.send({ success: true, paymentId: transactionId, status: "Success" });
});


app.patch('/applications/:id', verifyFBToken, verifySTUDENT, async (req, res) => {
    const id = req.params.id;
    const { status } = req.body;

    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
        $set: { status: status }
    };
    const result = await applicationsCollection.updateOne(filter, updateDoc);
    res.send(result);
});


app.get('/my-payments', verifyFBToken, async (req, res) => {
    const email = req.tokenEmail;
    const query = {
        $or: [
            { studentEmail: email },
            { tutorEmail: email }
        ]
    };
    const payments = await paymentsCollection.find(query).sort({ date: -1 }).toArray();


    for (let payment of payments) {

        if (payment.tuitionId) {
            const tuition = await tuitionsPostCollection.findOne({ _id: new ObjectId(payment.tuitionId) });
            if (tuition) payment.tuitionTitle = tuition.subject;
        }


        const otherEmail = payment.studentEmail === email ? payment.tutorEmail : payment.studentEmail;
        const user = await usersCollection.findOne({ email: otherEmail });
        if (user) payment.otherName = user.name;
    }

    res.send(payments);
});

app.get('/tutor/dashboard-stats', verifyFBToken, verifyTUTOR, async (req, res) => {
    const email = req.tokenEmail;


    const payments = await paymentsCollection.find({ tutorEmail: email, status: 'paid' }).toArray();
    const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);


    const activeTuitionsCount = await applicationsCollection.countDocuments({ tutorEmail: email, status: 'approved' });


    const totalApplications = await applicationsCollection.countDocuments({ tutorEmail: email });

    res.send({
        totalEarnings,
        activeTuitionsCount,
        totalApplications,

        profileViews: 0
    });
});

app.get('/tutor/recent-activities', verifyFBToken, verifyTUTOR, async (req, res) => {
    const email = req.tokenEmail;


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

app.put('/tutor/profile', verifyFBToken, verifyTUTOR, async (req, res) => {
    const email = req.tokenEmail;
    const { qualification, experience, subjects, bio, hourlyRate, location } = req.body;

    const filter = { email: email };
    const updateDoc = {
        $set: {
            qualification,
            experience,
            subjects,
            bio,
            hourlyRate: parseInt(hourlyRate),
            location,
            updated_at: new Date()
        }
    };
    const result = await usersCollection.updateOne(filter, updateDoc);
    res.send(result);
});

app.post('/tuitions', verifyFBToken, verifySTUDENT, catchAsync(async (req, res) => {
    const tuition = req.body;

    // Map frontend fields to database schema
    const newTuition = {
        studentEmail: req.tokenEmail,
        subject: tuition.subject,
        class: tuition.class,
        location: tuition.location,
        salary: String(tuition.salary),
        daysPerWeek: parseInt(tuition.daysPerWeek) || 0,
        genderPreference: tuition.tutorGender || tuition.genderPreference || 'Any',
        description: tuition.requirements || tuition.description || '',
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date()
    };

    const result = await tuitionsPostCollection.insertOne(newTuition);

    try {
        const tutors = await usersCollection.find({ role: 'tutor' }).toArray();
        if (tutors.length > 0) {
            const notifications = tutors.map(tutor => ({
                userEmail: tutor.email,
                type: 'application',
                message: `New tuition posted: ${tuition.subject} in ${tuition.location}. Apply now!`,
                link: `/tuition/${result.insertedId}`,
                read: false,
                createdAt: new Date()
            }));
            await notificationsCollection.insertMany(notifications);
        }
    } catch (notifyErr) {
        console.error('Failed to notify tutors about new tuition:', notifyErr);

    }

    res.send(result);
}));


app.get('/my-tuitions', verifyFBToken, verifySTUDENT, async (req, res) => {
    const email = req.tokenEmail;
    const query = { studentEmail: email };
    const result = await tuitionsPostCollection.find(query).toArray();
    res.send(result);
});


app.put('/tuition/:id', verifyFBToken, verifySTUDENT, async (req, res) => {
    const id = req.params.id;
    const email = req.tokenEmail;
    const data = req.body;

    const filter = { _id: new ObjectId(id), studentEmail: email };

    // Map frontend fields to database schema
    const updateDoc = {
        $set: {
            subject: data.subject,
            class: data.class,
            location: data.location,
            salary: String(data.salary),
            daysPerWeek: parseInt(data.daysPerWeek) || 0,
            genderPreference: data.tutorGender || data.genderPreference || 'Any',
            description: data.requirements || data.description || '',
            updated_at: new Date()
        }
    };

    const result = await tuitionsPostCollection.updateOne(filter, updateDoc);
    if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'Tuition not found or unauthorized' });
    }
    res.send(result);
});


app.delete('/tuition/:id', verifyFBToken, verifySTUDENT, catchAsync(async (req, res) => {
    const id = req.params.id;
    const email = req.tokenEmail;

    const filter = { _id: new ObjectId(id), studentEmail: email };
    const result = await tuitionsPostCollection.deleteOne(filter);

    if (result.deletedCount === 0) {
        return res.status(404).send({ message: 'Tuition not found or unauthorized' });
    }

    res.send({ message: 'Tuition deleted successfully', result });
}));



app.post('/payment-success', verifyFBToken, verifySTUDENT, async (req, res) => {
    const { sessionId } = req.body;

    try {
        if (sessionId.startsWith('DEMO_')) {

            const payment = await paymentsCollection.findOne({ transactionId: sessionId });
            if (payment) {
                return res.send({ success: true, message: 'Payment verified (Demo)', payment });
            } else {
                return res.send({ success: false, message: 'Payment not found in demo records' });
            }
        } else {

            const session = await stripeClient.checkout.sessions.retrieve(sessionId);

            if (session.payment_status === 'paid') {
                const { tuitionId, tutorEmail, studentEmail, applicationId } = session.metadata;
                const transactionId = session.payment_intent;


                const existingPayment = await paymentsCollection.findOne({ transactionId });
                if (existingPayment) {
                    return res.send({ message: 'Payment already recorded' });
                }


                const paymentRecord = {
                    tuitionId,
                    tutorEmail,
                    studentEmail,
                    transactionId,
                    amount: session.amount_total / 100,
                    currency: session.currency.toUpperCase(),
                    status: 'paid',
                    method: 'Stripe',
                    created_at: new Date()
                };
                await paymentsCollection.insertOne(paymentRecord);


                await applicationsCollection.updateOne(
                    { _id: new ObjectId(applicationId) },
                    { $set: { status: 'approved', paymentId: transactionId } }
                );

                await tuitionsPostCollection.updateOne(
                    { _id: new ObjectId(tuitionId) },
                    { $set: { assignedTutorId: tutorEmail, assignedTutorEmail: tutorEmail } }
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







app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    res.status(err.status || 500).send({
        success: false,
        message: err.message || 'Something went wrong on the server',
        error: process.env.NODE_ENV === 'production' ? {} : err.message
    });
});

async function startServer() {
    try {
        await connectDB();
        app.listen(port, () => {
            console.log(`eTuitionBd Server is running on port ${port}`);
            console.log(`CORS Policy: Open (All Origins Allowed)`);
        });
    } catch (error) {
        console.error('Server startup failed:', error);
        process.exit(1);
    }
}

startServer();


module.exports = app;
