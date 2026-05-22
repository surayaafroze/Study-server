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

app.use(cors({ origin: "http://localhost:3000", credentials: true }));
app.use(express.json());

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
);

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
let addRoomsCollection;
let bookingCollection;

/* ── Middleware ─────────────────────────────── */
const logger = (req, res, next) => {
  console.log(`${req.method} | ${req.url}`);
  next();
};

const verifytoken = async (req, res, next) => {
  const { authorization } = req.headers;
  const token = authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorize" });
  try {
    const JWKS = createRemoteJWKSet(
      new URL("http://localhost:3000/api/auth/jwks")
    );
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.error("Token validation failed:", error);
    return res.status(401).json({ message: "Unauthorize" });
  }
};

/* ── DB Connect ─────────────────────────────── */
async function run() {
  try {
    await client.connect();
    db = client.db("studyNook");
    addRoomsCollection = db.collection("addRooms");
    bookingCollection = db.collection("bookings");
    console.log("MongoDB Connected");
  } catch (err) {
    console.error(err);
  }
}
run();

/* ══════════════════════════════════════════════
   ROUTES
══════════════════════════════════════════════ */

app.get("/", (req, res) => res.send("Server running"));

/* ── ROOMS ──────────────────────────────────── */

// Public – all rooms
app.get("/addroom", async (req, res) => {
  const result = await addRoomsCollection.find().toArray();
  res.json(result);
});

// Create room (auth required)
app.post("/addroom", verifytoken, async (req, res) => {
  const data = req.body;
  if (!Array.isArray(data.amenities)) data.amenities = [];
  // ownerId stored so only owner can edit/delete
  data.ownerId = req.user.sub || req.user.id;
  const result = await addRoomsCollection.insertOne(data);
  res.json(result);
});

// Search / filter rooms
// GET /room?search=quiet&amenities=Wi-Fi,Projector
app.get("/room", async (req, res) => {
  try {
    const { search, amenities } = req.query;
    let query = {};

    if (search && search.trim() !== "") {
      query.$or = [
        { roomName: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (amenities) {
      const list = amenities.split(",").map((a) => a.trim()).filter(Boolean);
      if (list.length > 0) query.amenities = { $in: list };
    }

    const result = await addRoomsCollection.find(query).toArray();
    res.json(result);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Room details (auth required)
app.get("/room/:id", logger, verifytoken, async (req, res) => {
  const { id } = req.params;
  const result = await addRoomsCollection.findOne({ _id: new ObjectId(id) });
  res.json(result);
});

// Update room – only owner
app.put("/room/:id", verifytoken, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user.sub || req.user.id;

    const room = await addRoomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) return res.status(404).json({ message: "Room not found" });

    if (room.ownerId !== callerId) {
      return res.status(403).json({ message: "Forbidden: not your room" });
    }

    const { _id, ownerId, ...updates } = req.body; // strip immutable fields
    if (!Array.isArray(updates.amenities)) updates.amenities = room.amenities;

    const result = await addRoomsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );
    res.json(result);
  } catch (err) {
    console.error("Update room error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

//  Delete room – only owner
app.delete("/room/:id", verifytoken, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user.sub || req.user.id;

    const room = await addRoomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) return res.status(404).json({ message: "Room not found" });

    if (room.ownerId !== callerId) {
      return res.status(403).json({ message: "Forbidden: not your room" });
    }

    await addRoomsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ message: "Room deleted" });
  } catch (err) {
    console.error("Delete room error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

//My listings – rooms owned by logged-in user
app.get("/my-rooms", verifytoken, async (req, res) => {
  try {
    const ownerId = req.user.sub || req.user.id;
    const result = await addRoomsCollection.find({ ownerId }).toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ── BOOKINGS ───────────────────────────────── */

// Create booking – with conflict check
app.post("/bookings", verifytoken, async (req, res) => {
  try {
    const bookingData = req.body;
    const { roomId, date, startTime, endTime } = bookingData;

    if (!roomId || !date || !startTime || !endTime) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Conflict check: same room, same date, overlapping time
    // A new booking [S2,E2] conflicts with existing [S1,E1] if S2 < E1 AND E2 > S1
    const conflict = await bookingCollection.findOne({
      roomId,
      date,
      status: { $ne: "cancelled" },
      $and: [
        { startTime: { $lt: endTime } },
        { endTime: { $gt: startTime } },
      ],
    });

    if (conflict) {
      return res.status(409).json({
        message: "This time slot is already booked. Please choose another time.",
      });
    }

    bookingData.userId = req.user.sub || req.user.id;
    bookingData.status = "confirmed";
    bookingData.createdAt = new Date();

    const result = await bookingCollection.insertOne(bookingData);

    // $inc bookingCount on the room
    await addRoomsCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } }
    );

    res.json(result);
  } catch (err) {
    console.error("Booking error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user bookings
app.get("/bookings/:userId", verifytoken, async (req, res) => {
  try {
    const callerId = req.user.sub || req.user.id;
    const { userId } = req.params;

    // users can only fetch their own bookings
    if (callerId !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const result = await bookingCollection.find({ userId }).toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

//  Cancel booking – only booking owner
app.patch("/bookings/:id/cancel", verifytoken, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user.sub || req.user.id;

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.userId !== callerId) {
      return res.status(403).json({ message: "Forbidden: not your booking" });
    }

    await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled" } }
    );

    // decrement bookingCount
    if (booking.roomId) {
      await addRoomsCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } }
      );
    }

    res.json({ message: "Booking cancelled" });
  } catch (err) {
    console.error("Cancel error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

//  Delete booking – only booking owner
app.delete("/bookings/:id", verifytoken, async (req, res) => {
  try {
    const { id } = req.params;
    const callerId = req.user.sub || req.user.id;

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.userId !== callerId) {
      return res.status(403).json({ message: "Forbidden: not your booking" });
    }

    await bookingCollection.deleteOne({ _id: new ObjectId(id) });

    if (booking.roomId) {
      await addRoomsCollection.updateOne(
        { _id: new ObjectId(booking.roomId) },
        { $inc: { bookingCount: -1 } }
      );
    }

    res.json({ message: "Booking deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

/* ── START ──────────────────────────────────── */
app.listen(PORT, () => console.log(`Server running on ${PORT}`));