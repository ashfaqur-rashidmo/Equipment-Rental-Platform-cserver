import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from 'mongodb';

dotenv.config();
    

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("equipment_rental_platform");
const users = database.collection("user");
const equipments = database.collection("equipment");
const rentals = database.collection("rental");

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.send(" Rental Platform Server is running");
});



app.get("/users", async (req, res) => {
    const usersData = users.find({});
    const usersArray = await usersData.toArray();
    res.send(usersArray);
});


// Owner equipment add
app.post("/add-equipment", async (req, res) => {
  try {
    const equipmentData = req.body;
    const result = await equipments.insertOne(equipmentData);
    res.send(result);
  } catch (err) {
    console.error("Error adding equipment:", err);
    res.status(500).send({ error: "Failed to add equipment" });
  }
});




// Escape user input before it is used inside a $regex pattern.
const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toFiniteNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Build the MongoDB filter for /equipment (and /equipment/categories)
 * from the incoming query string.
 *
 * Supported params: search, name, location, category, rentalType,
 * minPrice, maxPrice, available ("1" | "0").
 */
function buildEquipmentQuery(params) {
  const query = {};
  const { search, name, location, category, rentalType, minPrice, maxPrice, available } =
    params;

  // Search by equipment name or location (single search term, case-insensitive)
  if (search) {
    const searchRegex = { $regex: escapeRegExp(search), $options: "i" };
    query.$or = [{ name: searchRegex }, { location: searchRegex }];
  }

  // Search by equipment name (case-insensitive)
  if (name) {
    query.name = { $regex: escapeRegExp(name), $options: "i" };
  }

  // Search by location (case-insensitive)
  if (location) {
    query.location = { $regex: escapeRegExp(location), $options: "i" };
  }

  // Category filter. Matched on the leading word so that the site's
  // "Photography Equipment" also matches a stored value of "Photography".
  if (category) {
    const leadingWord = String(category).trim().split(/\s+/)[0] || category;
    query.category = {
      $regex: `^${escapeRegExp(leadingWord)}`,
      $options: "i",
    };
  }

  // Rental type filter (Daily / Weekly / Monthly), exact but case-insensitive
  if (rentalType) {
    query.rentalType = {
      $regex: `^${escapeRegExp(rentalType)}$`,
      $options: "i",
    };
  }

  // Price range filter
  const priceFilter = {};
  const min = toFiniteNumber(minPrice);
  const max = toFiniteNumber(maxPrice);

  if (min !== null) priceFilter.$gte = min;
  if (max !== null) priceFilter.$lte = max;

  if (Object.keys(priceFilter).length > 0) {
    query.rentalPrice = priceFilter;
  }

  // Availability filter
  if (available === "1" || available === "true") {
    query.availableQuantity = { $gt: 0 };
  } else if (available === "0" || available === "false") {
    query.availableQuantity = { $lte: 0 };
  }

  return query;
}

app.get("/equipment", async (req, res) => {
  try {
    const query = buildEquipmentQuery(req.query);

    const equipmentArray = await equipments
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send(equipmentArray);
  } catch (err) {
    console.error("Error fetching equipment:", err);
    res.status(500).send({
      error: "Failed to fetch equipment",
    });
  }
});



// Distinct categories with counts, faceted by every active filter
// except `category` itself (so the list never collapses to one row).
app.get("/equipment/categories", async (req, res) => {
  try {
    const rest = { ...req.query };
    delete rest.category;

    const query = buildEquipmentQuery(rest);

    const rows = await equipments
      .aggregate([
        { $match: query },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $match: { _id: { $nin: [null, ""] } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    res
      .status(200)
      .send(rows.map((row) => ({ name: row._id, count: row.count })));
  } catch (err) {
    console.error("Error fetching equipment categories:", err);
    res.status(500).send({ error: "Failed to fetch categories" });
  }
});


// Single equipment item by id
app.get("/equipment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ error: "Equipment not found" });
    }

    const equipment = await equipments.findOne({ _id: new ObjectId(id) });

    if (!equipment) {
      return res.status(404).send({ error: "Equipment not found" });
    }

    res.status(200).send(equipment);
  } catch (err) {
    console.error("Error fetching equipment:", err);
    res.status(500).send({ error: "Failed to fetch equipment" });
  }
});


//  Rentals API


// GET /rentals?userId=... — bookings of one customer, newest first
app.get("/rentals", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send({ error: "userId is required" });
    }

    const list = await rentals
      .find({ customerId: String(userId) })
      .sort({ bookingDate: -1 })
      .toArray();

    res.status(200).send(list);
  } catch (err) {
    console.error("Error fetching rentals:", err);
    res.status(500).send({ error: "Failed to fetch rentals" });
  }
});

// POST /rentals — a customer rents an equipment for a date range
app.post("/rentals", async (req, res) => {
  try {
    const {
      equipmentId,
      equipmentName,
      customerId,
      customerName,
      startDate,
      endDate,
      quantity,
      rentalPrice,
      rentalType,
    } = req.body;

    if (!equipmentId || !customerId || !startDate || !endDate) {
      return res.status(400).send({
        error: "equipmentId, customerId, startDate and endDate are required",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return res.status(400).send({ error: "Invalid rental dates" });
    }

    const qty = Math.max(1, Number(quantity) || 1);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    const price = Number(rentalPrice) || 0;

    // Price of the whole window, priced by the item's rental type.
    let units = days;
    if (rentalType === "Weekly") units = Math.ceil(days / 7);
    if (rentalType === "Monthly") units = Math.ceil(days / 30);

    const rental = {
      equipmentId: String(equipmentId),
      equipmentName: equipmentName || "Equipment",
      customerId: String(customerId),
      customerName: customerName || "",
      startDate,
      endDate,
      quantity: qty,
      days,
      totalAmount: price * units * qty,
      paymentStatus: "Pending",
      bookingStatus: "Pending",
      bookingDate: new Date(),
    };

    const result = await rentals.insertOne(rental);

    res.status(201).send({ ...rental, _id: result.insertedId });
  } catch (err) {
    console.error("Error creating rental:", err);
    res.status(500).send({ error: "Failed to create rental" });
  }
});


// ---------------- Favorites ----------------
const favorites = database.collection("favorite");

// GET /favorites?userId=...&equipmentId=...  (equipmentId is optional)
// Returns the saved items with the current equipment record joined in.
app.get("/favorites", async (req, res) => {
  try {
    const { userId, equipmentId } = req.query;

    if (!userId) {
      return res.status(400).send({ error: "userId is required" });
    }

    const match = { userId: String(userId) };

    if (equipmentId && ObjectId.isValid(equipmentId)) {
      match.equipmentId = new ObjectId(equipmentId);
    }

    const rows = await favorites
      .aggregate([
        { $match: match },
        { $sort: { favoritedAt: -1 } },
        {
          $lookup: {
            from: "equipment",
            localField: "equipmentId",
            foreignField: "_id",
            as: "equipment",
          },
        },
        {
          $unwind: { path: "$equipment", preserveNullAndEmptyArrays: true },
        },
      ])
      .toArray();

    res.status(200).send(rows);
  } catch (err) {
    console.error("Error fetching favorites:", err);
    res.status(500).send({ error: "Failed to fetch favorites" });
  }
});

// POST /favorites — save an equipment to a customer's favorites
app.post("/favorites", async (req, res) => {
  try {
    const { userId, equipmentId } = req.body;

    if (!userId || !equipmentId || !ObjectId.isValid(equipmentId)) {
      return res.status(400).send({
        error: "userId and a valid equipmentId are required",
      });
    }

    const owner = String(userId);
    const equipment = new ObjectId(equipmentId);

    // Already saved? Return it instead of creating a duplicate.
    const existing = await favorites.findOne({
      userId: owner,
      equipmentId: equipment,
    });

    if (existing) return res.status(200).send(existing);

    const doc = {
      userId: owner,
      equipmentId: equipment,
      favoritedAt: new Date(),
    };

    const result = await favorites.insertOne(doc);

    res.status(201).send({ ...doc, _id: result.insertedId });
  } catch (err) {
    console.error("Error adding favorite:", err);
    res.status(500).send({ error: "Failed to add favorite" });
  }
});

// DELETE /favorites/:id — remove one saved item
app.delete("/favorites/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(404).send({ error: "Favorite not found" });
    }

    const result = await favorites.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).send({ error: "Favorite not found" });
    }

    res.status(200).send({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error("Error removing favorite:", err);
    res.status(500).send({ error: "Failed to remove favorite" });
  }
});


app.patch("/equipment/:id", async (req, res) => {
  const { id } = req.params;
  const updateData = {...req.body};

  delete updateData._id; 

  const result = await equipments.updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );
  res.send(result);
});



app.delete("/equipment/:id", async (req, res) => {
  const { id } = req.params;
  const result = await equipments.deleteOne({ _id: new ObjectId(id) });
  res.send(result);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});