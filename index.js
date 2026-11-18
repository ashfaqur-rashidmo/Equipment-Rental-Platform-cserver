import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from 'mongodb';

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
const users = database.collection("users");

const app = express();
const port = process.env.PORT || 6000;

app.use(cors());

app.get("/", (req, res) => {
  res.send(" Rental Platform Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});