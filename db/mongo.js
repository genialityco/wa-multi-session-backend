import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

let client;

export async function connectMongo() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI no está definido en el archivo .env");
  }

  if (!client) {
    client = new MongoClient(process.env.MONGO_URI, {});
  }

  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }
  return client.db();
}

export default client;
