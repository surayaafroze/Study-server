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
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

const app = express();

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

/* ════════ DB ════════ */
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let roomsCollection;
let bookingCollection;

async function run() {
  try {
    await client.connect();
    const db = client.db("studyNook");
    roomsCollection = db.collection("addRooms");
    bookingCollection = db.collection("bookings");
    console.log("✅ MongoDB Connected");
  } catch (err) {
    console.error("MongoDB error:", err);
    process.exit(1);
  }
}
run();

/* ════════ AUTH MIDDLEWARE ════════ */
// const verifyToken = async (req, res, next) => {
//   const token = req.headers.authorization?.split(" ")[1];
//   if (!token) return res.status(401).json({ message: "Unauthorized – no token" });

//   try {
//     const response = await fetch(`${CLIENT_URL}/api/auth/get-session`, {
//       headers: {
//         Authorization: `Bearer ${token}`,
//         Cookie: `better-auth.session_token=${token}`,
//       },
//     });

//     if (!response.ok) {
//       return res.status(401).json({ message: "Unauthorized – invalid session" });
//     }

//     const data = await response.json();

//     if (!data?.user?.id) {
//       return res.status(401).json({ message: "Unauthorized – no user found" });
//     }

//     // Better Auth returns user.id as string — store as-is
//     req.user = data.user;
//     next();
//   } catch (err) {
//     console.error("Auth error:", err.message);
//     return res.status(401).json({ message: "Unauthorized" });
//   }
// };


const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);


const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    req.user = {
      id: payload.sub,
      email: payload.email,
    };
    // console.log(payload.id,'payload')
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};


// userId is always a plain string from Better Auth
const getUserId = (req) => req.user?.id?.toString();

/* ════════ HELPER ════════ */
// Safe ObjectId — returns null if id is invalid
const toObjectId = (id) => {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
};

/* ════════ ROUTES ════════ */

app.get("/", (_req, res) => res.send("StudyNook API ✅"));

/* ── ALL ROOMS with Search + Filter (public) ── */
app.get("/room", async (req, res) => {
  try {
    const { search, amenities, minRate, maxRate } = req.query;
    const query = {};

    if (search?.trim()) {
      query.roomName = {
        $regex: search.trim(),
        $options: "i",
      };
    }

    if (amenities?.trim()) {
      const list = amenities
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      if (list.length) query.amenities = { $in: list };
    }

    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) query.hourlyRate.$gte = Number(minRate);
      if (maxRate) query.hourlyRate.$lte = Number(maxRate);
    }

    const rooms = await roomsCollection.find(query).toArray();
    res.json(rooms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
/* ── LATEST 6 for Home Page (public) ──
   MUST come BEFORE /room/:id — otherwise Express
   treats "latest" as an :id and ObjectId cast fails */
app.get("/room/latest", async (_req, res) => {
  try {
    const rooms = await roomsCollection
      .find()
      .sort({ _id: -1 })
      .limit(6)
      .toArray();
    res.json(rooms);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── MY ROOMS – PROTECTED ── */
/* ── MY ROOMS – PROTECTED ── */
app.get("/my-rooms", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("🔍 Logged in userId:", userId); // এটা কী আসছে?
    
    const rooms = await roomsCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    console.log("🔍 Rooms found:", rooms.length);
    res.json({ success: true, data: rooms });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
/* ── ROOM DETAILS – PROTECTED ──
   MUST come AFTER /room/latest */
app.get("/room/:id", verifyToken, async (req, res) => {
  try {
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ message: "Invalid room ID" });

    const room = await roomsCollection.findOne({ _id: oid });
    if (!room) return res.status(404).json({ message: "Room not found" });
    res.json(room);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── CREATE ROOM – PROTECTED ── */
app.post("/room",verifyToken, async (req, res) => {
  try {
    const data = { ...req.body };

    // amenities must always be an array
    if (!Array.isArray(data.amenities)) {
      data.amenities = typeof data.amenities === "string" && data.amenities.trim()
        ? data.amenities.split(",").map((a) => a.trim())
        : [];
    }

    // Normalize: frontend may send "image" or "url" — store as "image"
    if (!data.image && data.url) {
      data.image = data.url;
      delete data.url;
    }

    data.userId = getUserId(req);
    data.bookingCount = 0;
    data.createdAt = new Date();

    const result = await roomsCollection.insertOne(data);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── UPDATE ROOM – owner only ── */
app.put("/room/:id", verifyToken, async (req, res) => {
  try {
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ message: "Invalid room ID" });

    const userId = getUserId(req);
    const room = await roomsCollection.findOne({ _id: oid });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    // Strip immutable fields
    const { _id, userId: _u, bookingCount, createdAt, ...updateData } = req.body;

    // Normalize amenities
    if (updateData.amenities && !Array.isArray(updateData.amenities)) {
      updateData.amenities = typeof updateData.amenities === "string"
        ? updateData.amenities.split(",").map((a) => a.trim())
        : [];
    }

    const result = await roomsCollection.updateOne({ _id: oid }, { $set: updateData });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── DELETE ROOM – owner only ── */
app.delete("/room/:id", verifyToken, async (req, res) => {
  try {
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ message: "Invalid room ID" });

    const userId = getUserId(req);
    const room = await roomsCollection.findOne({ _id: oid });
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (room.userId !== userId) return res.status(403).json({ message: "Forbidden" });

    await bookingCollection.deleteMany({ roomId: req.params.id });
    const result = await roomsCollection.deleteOne({ _id: oid });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ════════ BOOKINGS ════════ */

/* ── MY BOOKINGS ──
   MUST come before /bookings/:id so "my" is not
   treated as a booking ObjectId */
app.get("/bookings/my", verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req);
     console.log("bookings/my userId:", userId);
    const bookings = await bookingCollection
      .aggregate([
        { $match: { userId } },
        {
          $addFields: {
            roomObjectId: {
              $convert: { input: "$roomId", to: "objectId", onError: null },
            },
          },
        },
        {
          $lookup: {
            from: "addRooms",
            localField: "roomObjectId",
            foreignField: "_id",
            as: "room",
          },
        },
      { $unwind: { path: "$room", preserveNullAndEmptyArrays: true } },
        { $sort: { createdAt: -1 } },
      ])
      .toArray();
      console.log("bookings found:", bookings.length);
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── CREATE BOOKING ── */
app.post("/bookings", verifyToken, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { roomId, date, startTime, endTime, specialNote, totalCost } = req.body;

    if (!roomId || !date || !startTime || !endTime) {
      return res.status(400).json({ message: "Missing required booking fields" });
    }

    const roomOid = toObjectId(roomId);
    if (!roomOid) return res.status(400).json({ message: "Invalid room ID" });

    const room = await roomsCollection.findOne({ _id: roomOid });
    if (!room) return res.status(404).json({ message: "Room not found" });

    // Conflict check
    const conflict = await bookingCollection.findOne({
      roomId,
      date,
      status: "confirmed",
      $and: [
        { startTime: { $lt: endTime } },
        { endTime: { $gt: startTime } },
      ],
    });

    if (conflict) {
      return res.status(409).json({
        message: "This time slot is already booked. Please choose another.",
      });
    }

    const booking = {
      roomId,
      userId,
      date,
      startTime,
      endTime,
      totalCost,
      specialNote: specialNote || "",
      status: "confirmed",
      createdAt: new Date(),
    };

    const result = await bookingCollection.insertOne(booking);
    await roomsCollection.updateOne({ _id: roomOid }, { $inc: { bookingCount: 1 } });

    res.json({ ...result, booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ── CANCEL BOOKING ── */
app.patch("/bookings/:id/cancel", verifyToken, async (req, res) => {
  try {
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ message: "Invalid booking ID" });

    const userId = getUserId(req);
    const booking = await bookingCollection.findOne({ _id: oid });
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    if (booking.userId !== userId) return res.status(403).json({ message: "Forbidden" });
    if (booking.status === "cancelled") return res.status(400).json({ message: "Already cancelled" });

    await bookingCollection.updateOne({ _id: oid }, { $set: { status: "cancelled" } });

    const roomOid = toObjectId(booking.roomId);
    if (roomOid) {
      await roomsCollection.updateOne({ _id: roomOid }, { $inc: { bookingCount: -1 } });
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

/* ════════ START ════════ */
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));