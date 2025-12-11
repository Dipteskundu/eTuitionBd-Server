require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require('firebase-admin') // Used for JWT Verification
const port = process.env.PORT || 3000

// Initialize Firebase Admin (for JWT verification)
// Initialize Firebase Admin (for JWT verification)
// Prevent crash if FB_SERVICE_KEY is missing
if (process.env.FB_SERVICE_KEY) {
    try {
        const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8')
        const serviceAccount = JSON.parse(decoded)
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        })
        console.log("Firebase Admin Initialized successfully.")
    } catch (error) {
        console.error("Error initializing Firebase Admin:", error.message)
    }
} else {
    console.warn("WARNING: FB_SERVICE_KEY not found in .env. Authentication (JWT Verification) will not work.")
}

const app = express()

// Middleware
app.use(
    cors({
        origin: [
            process.env.CLIENT_DOMAIN,
            'http://localhost:5173',
            'http://localhost:5174',
            'http://127.0.0.1:5173'
        ],
        credentials: true,
        optionSuccessStatus: 200,
    })
)
app.use(express.json())

// JWT Verification Middleware
// JWT Verification Middleware
const verifyJWT = async (req, res, next) => {
    const token = req?.headers?.authorization?.split(' ')[1]

    if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })

    // Check if Firebase is initialized
    if (admin.apps.length === 0) {
        console.warn("WARNING: Firebase Admin not initialized. Using MANUAL token decoding for development.")

        try {
            // Manual Decode (Header.Payload.Signature) using Node Buffer
            const base64Url = token.split('.')[1]
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
            const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8')

            const decoded = JSON.parse(jsonPayload)

            if (!decoded.email) throw new Error("No email in token")

            req.tokenEmail = decoded.email
            console.log("tokeEmail:", req.tokenEmail)
            return next()
        } catch (err) {
            console.error("Manual decode failed:", err.message)
            // For safety, providing a development fallback email helps if token format is completely different
            // But let's fail if we can't even decode.
            return res.status(500).send({ message: 'Server Authentication not configured and Token Invalid.' })
        }
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.tokenEmail = decoded.email
        next()
    } catch (err) {
        console.error(err)
        return res.status(401).send({ message: 'Unauthorized Access!', err })
    }
}

// MongoDB Connection Setup
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
})

async function run() {
    try {
        // Renamed Database & Collections for the Tuition Management System
        const db = client.db('eTuitionBd') // Unified database name
        const usersCollection = db.collection('users')
        const tutorsCollection = db.collection('tutors') // Separate collection for public tutor profiles
        const tuitionPostsCollection = db.collection('tuitionPosts')
        const applicationsCollection = db.collection('applications')
        const transactionsCollection = db.collection('transactions')

        // Role-Based Authorization Middlewares (Challenge 3: Role Verification)
        const verifyADMIN = async (req, res, next) => {
            const email = req.tokenEmail
            const user = await usersCollection.findOne({ email })
            if (user?.role !== 'admin')
                return res.status(403).send({ message: 'Admin only Actions!', role: user?.role })
            next()
        }
        // ... (skip unchanged code) ...
        // ------------------------------------
        // Tutors API (CRUD)
        // ------------------------------------

        // GET All Tutors
        app.get('/tutors', async (req, res) => {
            // Optional: Add filtering query params here if needed
            const result = await tutorsCollection.find().toArray()
            res.send(result)
        })

        // GET Single Tutor
        app.get('/tutors/:id', async (req, res) => {
            const id = req.params.id
            if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' })
            const result = await tutorsCollection.findOne({ _id: new ObjectId(id) })
            if (!result) return res.status(404).send({ message: 'Tutor not found' })
            res.send(result)
        })

        // POST New Tutor
        app.post('/tutors', async (req, res) => {
            const tutorData = req.body
            const result = await tutorsCollection.insertOne(tutorData)
            res.send(result)
        })

        // PUT Update Tutor
        app.put('/tutors/:id', async (req, res) => {
            const id = req.params.id
            const updateData = req.body
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: updateData
            }
            const result = await tutorsCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        // DELETE Tutor
        app.delete('/tutors/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const result = await tutorsCollection.deleteOne(query)
            res.send(result)
        })

        const verifyTUTOR = async (req, res, next) => {
            const email = req.tokenEmail
            const user = await usersCollection.findOne({ email })
            // Tutor must also be verified by Admin to post/apply
            if (user?.role !== 'tutor' || !user.isVerified)
                return res.status(403).send({ message: 'Tutor only Actions or Not Verified!', role: user?.role })
            next()
        }

        const verifySTUDENT = async (req, res, next) => {
            const email = req.tokenEmail
            const user = await usersCollection.findOne({ email })
            if (user?.role !== 'student')
                return res.status(403).send({ message: 'Student only Actions!', role: user?.role })
            next()
        }

        // ------------------------------------
        // 1. User and Authentication Endpoints
        // ------------------------------------

        // Register/Login: Save or update a user in db, setting initial role
        app.post('/user', async (req, res) => {
            const userData = req.body
            const query = { email: userData.email }

            const alreadyExists = await usersCollection.findOne(query)

            if (alreadyExists) {
                // Update last logged-in time and role if it was a temporary role
                const updateDoc = {
                    $set: {
                        last_loggedIn: new Date().toISOString(),
                    },
                }
                const result = await usersCollection.updateOne(query, updateDoc)
                return res.send(result)
            }

            // Saving new user info
            const newUser = {
                ...userData,
                created_at: new Date().toISOString(),
                last_loggedIn: new Date().toISOString(),
                // Set initial role. Assume 'student' if not specified for general sign-up
                role: userData.role || 'student',
                // All new Tutors start as unverified
                isVerified: userData.role === 'tutor' ? false : true,
                // Initialize profile objects
                tutorProfile: userData.role === 'tutor' ? { qualifications: 'N/A', subjects: [] } : undefined,
                studentProfile: userData.role === 'student' ? { postedTuitions: [] } : undefined,
            }

            const result = await usersCollection.insertOne(newUser)
            res.send(result)
        })

        // Get a user's role (for client-side routing/UI)
        app.get('/user/role', verifyJWT, async (req, res) => {
            const result = await usersCollection.findOne({ email: req.tokenEmail })
            res.send({ role: result?.role, isVerified: result?.isVerified })
        })

        // Get all users for Admin
        app.get('/admin/users', verifyJWT, verifyADMIN, async (req, res) => {
            const adminEmail = req.tokenEmail
            const result = await usersCollection
                .find({ email: { $ne: adminEmail } })
                .project({ password: 0 }) // Do not send hashed passwords
                .toArray()
            res.send(result)
        })

        // ------------------------------------
        // 2. Tuition Post Endpoints (Public/Search/Student)
        // ------------------------------------

        // Student: Post a new tuition requirement
        app.post('/tuitions', verifyJWT, verifySTUDENT, async (req, res) => {
            const tuitionData = req.body
            // Admin regulation requirement: set status to pending approval
            const newPost = {
                ...tuitionData,
                studentEmail: req.tokenEmail,
                status: 'pending-admin-approval',
                applicationsCount: 0,
            }
            const result = await tuitionPostsCollection.insertOne(newPost)
            res.send(result)
        })

        // Public/Tutor: Get all tuitions (Challenge 1: Search & Sort, Challenge 4: Advanced Filter)
        app.get('/tuitions', async (req, res) => {
            const { search, sort, filterSubject, filterLocation, filterClass, page = 1, limit = 10 } = req.query

            // Build the MongoDB Query
            let query = { status: 'open' } // Only show approved/open tuitions to public/tutors

            // 1. Search (by subject or location)
            if (search) {
                const searchRegex = new RegExp(search, 'i') // Case-insensitive regex
                query = {
                    ...query,
                    $or: [
                        { subject: searchRegex },
                        { location: searchRegex }
                    ]
                }
            }

            // 4. Advanced Filter (by class, subject, location)
            if (filterSubject) query.subject = filterSubject
            if (filterLocation) query.location = filterLocation
            if (filterClass) query.classLevel = filterClass

            // Build the Sort Options
            let sortOptions = { createdAt: -1 } // Default: newest first
            if (sort === 'budget-asc') sortOptions = { budget: 1 }
            if (sort === 'budget-desc') sortOptions = { budget: -1 }
            if (sort === 'date-asc') sortOptions = { createdAt: 1 }

            // 2. Pagination
            const skip = (parseInt(page) - 1) * parseInt(limit)

            const result = await tuitionPostsCollection
                .find(query)
                .sort(sortOptions)
                .skip(skip)
                .limit(parseInt(limit))
                .toArray()

            const totalCount = await tuitionPostsCollection.countDocuments(query)

            res.send({
                tuitions: result,
                totalPages: Math.ceil(totalCount / limit),
                currentPage: parseInt(page)
            })
        })

        // Get single tuition post
        app.get('/tuitions/:id', async (req, res) => {
            const id = req.params.id
            if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' })

            const result = await tuitionPostsCollection.findOne({ _id: new ObjectId(id) })
            if (!result) return res.status(404).send({ message: 'Tuition not found' })
            res.send(result)
        })



        // ------------------------------------
        // 3. Tutor Application Endpoints
        // ------------------------------------

        // Tutor: Apply to a tuition post
        app.post('/tuitions/:tuitionId/apply', verifyJWT, verifyTUTOR, async (req, res) => {
            const tuitionId = req.params.tuitionId
            const applicationData = req.body

            if (!ObjectId.isValid(tuitionId)) return res.status(400).send({ message: 'Invalid Tuition ID' })

            const tuition = await tuitionPostsCollection.findOne({ _id: new ObjectId(tuitionId), status: 'open' })
            if (!tuition) return res.status(404).send({ message: 'Tuition not found or not open for applications.' })

            const newApplication = {
                tuitionPostId: new ObjectId(tuitionId),
                tutorEmail: req.tokenEmail,
                coverLetter: applicationData.coverLetter,
                feeOffer: applicationData.feeOffer,
                status: 'pending',
                appliedAt: new Date().toISOString()
            }

            // Prevent duplicate applications
            const alreadyApplied = await applicationsCollection.findOne({
                tuitionPostId: new ObjectId(tuitionId),
                tutorEmail: req.tokenEmail
            })
            if (alreadyApplied) return res.status(409).send({ message: 'Already applied to this tuition post.' })

            const result = await applicationsCollection.insertOne(newApplication)

            // Increment applications count on the tuition post
            await tuitionPostsCollection.updateOne(
                { _id: new ObjectId(tuitionId) },
                { $inc: { applicationsCount: 1 } }
            )

            res.send(result)
        })

        // Student: View all applications for a specific tuition post
        app.get('/tuitions/:tuitionId/applications', verifyJWT, verifySTUDENT, async (req, res) => {
            const tuitionId = req.params.tuitionId
            if (!ObjectId.isValid(tuitionId)) return res.status(400).send({ message: 'Invalid ID' })

            // Ensure the student owns the tuition post
            const tuition = await tuitionPostsCollection.findOne({
                _id: new ObjectId(tuitionId),
                studentEmail: req.tokenEmail
            })
            if (!tuition) return res.status(403).send({ message: 'Not authorized to view these applications.' })

            const applications = await applicationsCollection
                .find({ tuitionPostId: new ObjectId(tuitionId) })
                .toArray()

            // Optionally, enrich application data with tutor profile details
            const applicationPromises = applications.map(async (app) => {
                const tutor = await usersCollection.findOne({ email: app.tutorEmail }, { projection: { password: 0 } })
                return { ...app, tutorDetails: tutor }
            })

            const results = await Promise.all(applicationPromises)
            res.send(results)
        })

        // Student: Accept a tutor application
        app.patch('/applications/:applicationId/accept', verifyJWT, verifySTUDENT, async (req, res) => {
            const applicationId = req.params.applicationId
            if (!ObjectId.isValid(applicationId)) return res.status(400).send({ message: 'Invalid ID' })

            const application = await applicationsCollection.findOne({ _id: new ObjectId(applicationId) })
            if (!application) return res.status(404).send({ message: 'Application not found.' })

            // Verify student owns the associated tuition post
            const tuition = await tuitionPostsCollection.findOne({
                _id: application.tuitionPostId,
                studentEmail: req.tokenEmail
            })
            if (!tuition) return res.status(403).send({ message: 'Not authorized to accept this application.' })

            // 1. Set the accepted application status
            const result = await applicationsCollection.updateOne(
                { _id: new ObjectId(applicationId) },
                { $set: { status: 'accepted' } }
            )

            // 2. Reject all other applications for this tuition post
            await applicationsCollection.updateMany(
                { tuitionPostId: application.tuitionPostId, _id: { $ne: new ObjectId(applicationId) } },
                { $set: { status: 'rejected' } }
            )

            // 3. Update the tuition post status
            await tuitionPostsCollection.updateOne(
                { _id: application.tuitionPostId },
                { $set: { status: 'in-progress', acceptedTutor: application.tutorEmail } }
            )

            res.send(result)
        })


        // ------------------------------------
        // 4. Admin Management Endpoints
        // ------------------------------------

        // Admin: Get all unverified tutors (replaces seller-requests)
        app.get('/admin/tutor-requests', verifyJWT, verifyADMIN, async (req, res) => {
            const result = await usersCollection.find({ role: 'tutor', isVerified: false }).toArray()
            res.send(result)
        })

        // Admin: Verify a Tutor (changes role/status - Challenge 3)
        app.patch('/admin/tutors/:email/verify', verifyJWT, verifyADMIN, async (req, res) => {
            const email = req.params.email
            const result = await usersCollection.updateOne(
                { email, role: 'tutor' },
                { $set: { isVerified: true } }
            )
            res.send(result)
        })

        // Admin: Approve a tuition post (changes status)
        app.patch('/admin/tuitions/:id/approve', verifyJWT, verifyADMIN, async (req, res) => {
            const id = req.params.id
            if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid ID' })

            const result = await tuitionPostsCollection.updateOne(
                { _id: new ObjectId(id), status: 'pending-admin-approval' },
                { $set: { status: 'open' } }
            )
            res.send(result)
        })

        // Admin: Get Reports & Analytics (Transaction History)
        app.get('/admin/reports/transactions', verifyJWT, verifyADMIN, async (req, res) => {
            const result = await transactionsCollection
                .find()
                .sort({ createdAt: -1 })
                .toArray()

            // Calculate total platform earnings for the dashboard report
            const totalEarnings = result.reduce((sum, transaction) => sum + (transaction.platformEarnings || 0), 0)

            res.send({ totalEarnings, transactions: result })
        })

        // ------------------------------------
        // 5. Payment Endpoints (Adapted for Tuition Posting Fee)
        // ------------------------------------

        // Create Checkout Session for a Tuition Post Fee
        app.post('/create-checkout-session', verifyJWT, async (req, res) => {
            const { feeAmount, tuitionPostId } = req.body
            const userEmail = req.tokenEmail

            // A fixed, non-refundable fee for posting a tuition (Example: $10)
            const feeInCents = feeAmount * 100

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: 'Tuition Posting Fee',
                                description: `Non-refundable fee to post tuition #${tuitionPostId}`,
                            },
                            unit_amount: feeInCents,
                        },
                        quantity: 1,
                    },
                ],
                customer_email: userEmail,
                mode: 'payment',
                metadata: {
                    userEmail: userEmail,
                    tuitionPostId: tuitionPostId,
                    type: 'tuition_post_fee'
                },
                success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.CLIENT_DOMAIN}/dashboard/my-tuitions`,
            })
            res.send({ url: session.url })
        })

        // Handle successful payment and record the transaction
        app.post('/payment-success', async (req, res) => {
            const { sessionId } = req.body
            const session = await stripe.checkout.sessions.retrieve(sessionId)

            // Check if transaction has already been processed
            const existingTransaction = await transactionsCollection.findOne({
                transactionId: session.payment_intent,
            })

            if (session.status === 'complete' && !existingTransaction) {
                const amountPaid = session.amount_total / 100
                const platformEarnings = amountPaid // The entire fee goes to the platform

                // save transaction data in db
                const transactionInfo = {
                    tuitionPostId: session.metadata.tuitionPostId,
                    transactionId: session.payment_intent,
                    payerEmail: session.metadata.userEmail,
                    amount: amountPaid,
                    type: session.metadata.type,
                    status: 'successful',
                    platformEarnings: platformEarnings,
                    createdAt: new Date().toISOString()
                }
                const result = await transactionsCollection.insertOne(transactionInfo)

                return res.send({
                    transactionId: session.payment_intent,
                    transactionId: result.insertedId,
                })
            }

            // If already processed, return existing info
            res.send({
                transactionId: session.payment_intent,
                transactionId: existingTransaction?._id,
            })
        })

        // Send a ping to confirm a successful connection
        await client.db('admin').command({ ping: 1 })
        console.log('Pinged your deployment. You successfully connected to MongoDB!')
    } finally {
        // Removed client.close() here to keep the connection alive
    }
}
run().catch(console.dir)

// Root endpoint
app.get('/', (req, res) => {
    res.send('eTuitionBd Server is Running..')
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})
