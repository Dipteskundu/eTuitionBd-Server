const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db("tuitionDB");
        const usersCollection = db.collection("users");
        const tuitionsCollection = db.collection("tuitions");

        // --- 1. Seed Tutors ---
        const tutors = [
            { displayName: "Rahim Uddin", email: "rahim@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/5GzXbc3/man1.jpg", phone: "01711111111", location: "Dhaka", bio: "Expert in Math and Physics with 5 years experience.", expertise: ["Math", "Physics", "Chemistry"], hourlyRate: 500, verified: true },
            { displayName: "Fatima Begum", email: "fatima@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/7QpKscx/woman1.jpg", phone: "01822222222", location: "Chittagong", bio: "Passionate English teacher.", expertise: ["English", "History"], hourlyRate: 400, verified: true },
            { displayName: "Karim Hasan", email: "karim@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/M9kPqYn/man2.jpg", phone: "01933333333", location: "Sylhet", bio: "Computer Science graduate teaching ICT.", expertise: ["ICT", "Math"], hourlyRate: 600, verified: true },
            { displayName: "Ayesha Siddiqua", email: "ayesha@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/xgw6g2D/woman2.jpg", phone: "01644444444", location: "Dhaka", bio: "Specialized in Biology for O Levels.", expertise: ["Biology", "Chemistry"], hourlyRate: 450, verified: true },
            { displayName: "Suman Chowdhury", email: "suman@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/b3Hjj3g/man3.jpg", phone: "01555555555", location: "Rajshahi", bio: "Accounting and Finance expert.", expertise: ["Accounting", "Finance"], hourlyRate: 550, verified: false },
            { displayName: "Nadia Islam", email: "nadia@tutor.com", role: "tutor", photoURL: "https://i.ibb.co/kh0D0bH/woman3.jpg", phone: "01555555123", location: "Dhaka", bio: "English Literature expert.", expertise: ["English", "Literature"], hourlyRate: 500, verified: true },
        ];

        // Check if tutors exist, if not insert
        for (const tutor of tutors) {
            const exists = await usersCollection.findOne({ email: tutor.email });
            if (!exists) {
                await usersCollection.insertOne({ ...tutor, created_at: new Date() });
                console.log(`Inserted Tutor: ${tutor.displayName}`);
            }
        }

        // --- 2. Seed Tuitions ---
        const tuitions = [
            { studentEmail: "student1@gmail.com", subject: "Mathematics", class: "Class 10", location: "Dhanmondi, Dhaka", salary: "5000", daysPerWeek: 3, genderPreference: "Male", status: "approved", description: "Need a math tutor for SSC candidate." },
            { studentEmail: "student2@gmail.com", subject: "English", class: "Class 8", location: "Mirpur, Dhaka", salary: "4000", daysPerWeek: 4, genderPreference: "Female", status: "approved", description: "English medium background preferred." },
            { studentEmail: "student3@gmail.com", subject: "Physics", class: "HSC 1st Year", location: "Gulshan, Dhaka", salary: "7000", daysPerWeek: 3, genderPreference: "Any", status: "approved", description: "Physics tutor needed urgently." },
            { studentEmail: "student4@gmail.com", subject: "Chemistry", class: "Class 9", location: "Uttara, Dhaka", salary: "4500", daysPerWeek: 3, genderPreference: "Male", status: "pending", description: "Chemistry tutor for national curriculum." },
            { studentEmail: "student5@gmail.com", subject: "Biology", class: "Class 11", location: "Banani, Dhaka", salary: "6000", daysPerWeek: 2, genderPreference: "Female", status: "approved", description: "Medical student preferred." },
            { studentEmail: "student6@gmail.com", subject: "General Science", class: "Class 6", location: "Mohammadpur, Dhaka", salary: "3500", daysPerWeek: 4, genderPreference: "Any", status: "approved", description: "Friendly tutor needed for young child." },
            { studentEmail: "student7@gmail.com", subject: "Higher Math", class: "Class 12", location: "Bashundhara, Dhaka", salary: "8000", daysPerWeek: 3, genderPreference: "Male", status: "approved", description: "Preparation for BUET admission." },
        ];

        // Insert Tuitions (Simpler check or just insert if low count)
        const tuitionCount = await tuitionsCollection.countDocuments();
        if (tuitionCount < 5) {
            const result = await tuitionsCollection.insertMany(tuitions.map(t => ({ ...t, created_at: new Date(), updated_at: new Date() })));
            console.log(`Inserted ${result.insertedCount} Tuitions`);
        } else {
            console.log("Tuitions already populate, skipping.");
        }

        console.log("Seeding Completed!");

    } finally {
        await client.close();
    }
}

run().catch(console.dir);
