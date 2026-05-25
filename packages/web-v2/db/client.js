import { MongoClient } from "mongodb";
import dns from "dns";

// Node.js on Windows fails querySrv via its own resolver — force OS resolver
dns.setDefaultResultOrder("ipv4first");

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is not set.\n" +
    "Add it to your .env file (see .env.example for the format)."
  );
}

let clientPromise;

const MONGO_OPTS = { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 };

if (process.env.NODE_ENV !== "production") {
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, MONGO_OPTS);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  const client = new MongoClient(uri, MONGO_OPTS);
  clientPromise = client.connect();
}

export default clientPromise;
