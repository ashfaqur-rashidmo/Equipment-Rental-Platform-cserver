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


app.get("/equipment", async (req, res) => {
    try {
    const equipmentData = equipments.find({});
    const equipmentArray = await equipmentData.toArray();
    res.send(equipmentArray);
    } catch (err) {
    console.error("Error fetching equipment:", err);
    res.status(500).send({ error: "Failed to fetch equipment" });
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