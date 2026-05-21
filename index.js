const dns = require("node:dns");
const dotenv = require("dotenv");
const cors = require("cors");
const express = require("express");

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

dns.setServers(["8.8.8.8", "8.8.4.4"]);

dotenv.config();

const uri = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;

const app = express();

// 🔑 CORS কনফিগারেশন আপডেট করা হয়েছে (credentials ট্রাস্ট করার জন্য origin নির্দিষ্ট করা হয়েছে)
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));

app.use(express.json());

const JWKS = createRemoteJWKSet(
  new URL('http://localhost:3000/api/auth/jwks')
);

// ✅ AUTH MIDDLEWARE (FIXED)
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: Invalid token format" });
    }

    const token = authHeader.split(" ")[1];

    // Better Auth এর সেশন চেক এন্ডপয়েন্টে রিকোয়েস্ট পাঠানো
    const authResponse = await fetch("http://localhost:3000/api/auth/get-session", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Cookie": req.headers.cookie || ""
      }
    });

    if (!authResponse.ok) {
      console.error(`Better Auth API response failed with status: ${authResponse.status}`);
      return res.status(401).json({ message: "Invalid session or expired token" });
    }

    const sessionData = await authResponse.json();

    // সেশন ডেটা ভ্যালিড হলে এবং ইউজার থাকলে রিকোয়েস্টে সেট করে দেওয়া
    if (sessionData && sessionData.user) {
      req.user = sessionData.user;
      req.session = sessionData.session; 
      next();
    } else {
      return res.status(401).json({ message: "Unauthorized: No active session found" });
    }

  } catch (error) {
    console.error("Backend Auth Error:", error.message);
    return res.status(401).json({
      message: "Authentication failed",
      error: error.message,
    });
  }
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("MongoDB Connected Successfully");

    const db = client.db("studyNook");
    const addRoomsCollection = db.collection("addRooms");
    const bookingCollection = db.collection("bookings");

    // ✅ HOME
    app.get("/", (req, res) => {
      res.send("Server is running fine!");
    });

    // ✅ GET ALL ROOMS (PUBLIC)
    app.get("/addroom", async (req, res) => {
      try {
        const result = await addRoomsCollection.find().toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch rooms",
          error: error.message,
        });
      }
    });

    // ✅ CREATE ROOM (PROTECTED)
    app.post("/addroom", verifyToken, async (req, res) => {
      try {
        const addroomData = req.body;
        delete addroomData._id;

        if (!Array.isArray(addroomData.amenities)) {
          addroomData.amenities = [];
        }

        const result = await addRoomsCollection.insertOne(addroomData);
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to create room",
          error: error.message,
        });
      }
    });

    // ✅ GET ROOM DETAILS (PROTECTED)
    app.get("/room/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        let query;

        try {
          query = { _id: new ObjectId(id) };
        } catch {
          query = { _id: id };
        }

        const result = await addRoomsCollection.findOne(query);

        if (!result) {
          return res.status(404).json({ message: "Room not found" });
        }

        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch room",
          error: error.message,
        });
      }
    });

    // ✅ CREATE BOOKING (PROTECTED)
    app.post("/bookings", verifyToken, async (req, res) => {
      try {
        const bookingData = req.body;
        delete bookingData._id;

        const result = await bookingCollection.insertOne(bookingData);
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to create booking",
          error: error.message,
        });
      }
    });

    // ✅ GET BOOKINGS BY USER (PROTECTED)
    app.get("/bookings/:userId", verifyToken, async (req, res) => {
      try {
        const { userId } = req.params;
        const result = await bookingCollection.find({ userId }).toArray();
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to fetch bookings",
          error: error.message,
        });
      }
    });

    // ✅ DELETE BOOKING (PROTECTED)
    app.delete("/bookings/:bookingsId", verifyToken, async (req, res) => {
      try {
        const { bookingsId } = req.params;
        const result = await bookingCollection.deleteOne({
          _id: new ObjectId(bookingsId),
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to delete booking",
          error: error.message,
        });
      }
    });

    // ✅ PING
    await client.db("admin").command({ ping: 1 });

  } catch (error) {
    console.error(error);
  }
}

run().catch(console.dir);

// ✅ SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});