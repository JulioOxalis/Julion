import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri) {
  throw new Error(
    "MONGODB_URI is not set.\n" +
    "Add it to your .env file (see .env.example for the format)."
  );
}

let clientPromise;

if (process.env.NODE_ENV !== "production") {
  // In development, reuse the client across hot-reloads
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  // In production, each function instance gets its own client
  const client = new MongoClient(uri);
  clientPromise = client.connect();
}

export default clientPromise;
